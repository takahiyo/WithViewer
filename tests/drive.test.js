import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, driveApi, driveCallback } from '../cloudflare/drive.js';
import { createWorker } from '../cloudflare/worker.js';
import { meetingArchive } from '../src/meeting-archive.js';
import { uploadArchive, writableFolder } from '../src/drive-upload.js';

const env = { GOOGLE_DRIVE_CLIENT_ID: '123-test.apps.googleusercontent.com', GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret', GOOGLE_DRIVE_PICKER_API_KEY: 'test-picker-key', DRIVE_TOKEN_SECRET: 'test-encryption-key-at-least-32-characters', PUBLIC_ORIGIN: 'https://withviewer.pages.dev' };
const jwt = `e30.${Buffer.from(JSON.stringify({ sub: 'user-1', email: 'owner@example.com' })).toString('base64url')}.signature`;
const request = (path, cookies = '', method = 'POST', token = jwt) => new Request(env.PUBLIC_ORIGIN + path, { method, headers: { Authorization: `Bearer ${token}`, Cookie: cookies } });
const credentials = async () => `__Host-wv-drive=${await seal({ uid: 'user-1', email: 'owner@example.com', refresh: 'test-refresh-token', exp: Date.now() + 86400000 }, env)}`;
function entries(bytes) {
  const files = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), n = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28), start = offset + 30 + n + extra;
    files.set(bytes.subarray(offset + 30, offset + 30 + n).toString(), bytes.subarray(start, start + size)); offset = start + size;
  }
  return files;
}
test('Driveの長期認可は暗号化し、改変・別暗号鍵・期限切れを拒否する', async () => {
  const value = { refresh: 'secret-refresh', exp: Date.now() + 10000 };
  const encoded = await seal(value, env);
  assert.ok(!encoded.includes('secret-refresh')); assert.deepEqual(await unseal(encoded, env), value);
  assert.equal(await unseal(`${encoded.slice(0, -6)}aaaaaa`, env), null);
  assert.equal(await unseal(encoded, { ...env, DRIVE_TOKEN_SECRET: 'different-key' }), null);
  assert.equal(await unseal(await seal({ ...value, exp: 1 }, env), env), null);
});
test('OAuthはオフライン認可・限定権限・PKCE・本人メールを指定し、状態をHttpOnly Cookieに保存する', async () => {
  const response = await driveApi(request('/api/drive/connect'), env, {});
  const result = await response.json(), url = new URL(result.url), cookie = response.headers.get('set-cookie');
  assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('login_hint'), 'owner@example.com'); assert.match(url.searchParams.get('scope'), /drive.file/);
  assert.doesNotMatch(url.searchParams.get('scope'), /auth\/drive /); assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.ok(!JSON.stringify(result).includes('test-client-secret'));
});
test('OAuth callbackはブラウザーのstateとGoogleアカウントの一致を確認してから連携する', async () => {
  const connect = await driveApi(request('/api/drive/connect'), env, {}), url = new URL((await connect.json()).url);
  const state = url.searchParams.get('state'), cookies = connect.headers.get('set-cookie').split(';')[0];
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; if (url.includes('/token')) { assert.ok(options.body.get('code_verifier')); return Response.json({ access_token: 'access', refresh_token: 'refresh', scope: 'openid email https://www.googleapis.com/auth/drive.file' }); }
    return Response.json({ email: 'owner@example.com', email_verified: true });
  };
  await assert.rejects(driveCallback(request('/api/drive/callback?state=bad&code=code', cookies, 'GET'), env, fetcher), /接続し直して/); assert.equal(calls, 0);
  const response = await driveCallback(request(`/api/drive/callback?state=${state}&code=code`, cookies, 'GET'), env, fetcher);
  assert.match(response.headers.get('set-cookie'), /__Host-wv-drive=/); assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.doesNotMatch(await response.text(), /refresh|access_token/);
  await assert.rejects(driveCallback(request(`/api/drive/callback?state=${state}&code=code`, cookies, 'GET'), env, async url => url.includes('/token') ? Response.json({ access_token: 'a', refresh_token: 'r', scope: 'https://www.googleapis.com/auth/drive.file' }) : Response.json({ email: 'another@example.com', email_verified: true })), /同じアカウント/);
});
test('長時間会議の保存時は長期認可から新しいトークンを取得し、別ユーザーには渡さない', async () => {
  const cookies = await credentials(); let calls = 0;
  const fetcher = async (url, options) => { calls++; assert.equal(options.body.get('grant_type'), 'refresh_token'); assert.equal(options.body.get('refresh_token'), 'test-refresh-token'); return Response.json({ access_token: 'fresh-access' }); };
  const result = await (await driveApi(request('/api/drive/token', cookies), env, {}, fetcher)).json();
  assert.equal(result.accessToken, 'fresh-access'); assert.ok(!JSON.stringify(result).includes('test-refresh-token'));
  const other = `e30.${Buffer.from(JSON.stringify({ sub: 'another', email: 'owner@example.com' })).toString('base64url')}.s`;
  await assert.rejects(driveApi(request('/api/drive/token', cookies, 'POST', other), env, {}, fetcher), /接続し直して/); assert.equal(calls, 1);
});
test('WorkerはDrive APIにもFirebase認証を要求し、認証なしcallbackはstateを要求する', async () => {
  const worker = createWorker({ authorize: async () => false });
  const settings = { ...env, FIREBASE_WEB_CONFIG: JSON.stringify({ apiKey: 'public', projectId: 'project', authDomain: 'project.firebaseapp.com', appId: 'app' }), ALLOWED_EMAIL: 'owner@example.com' };
  const response = await worker.fetch(request('/api/drive/status', '', 'GET'), settings); assert.equal(response.status, 401);
  const callback = await worker.fetch(request('/api/drive/callback?code=test&state=test', '', 'GET'), settings); assert.equal(callback.status, 400);
});
test('会議一式ZIPは元の録音・全保存画像・相談・清書と対応表を欠落なく含む', async () => {
  const meeting = { id: 'meeting', title: '会議/試験', createdAt: '2026-10-09T01:00:00Z', segments: [{ id: 'a', start: 0, end: 10, text: '\n 原文。 ', status: 'done' }, { id: 'missing', start: 10, end: 20, text: '', status: 'failed' }], consultations: [{ role: 'user', text: '個別の相談' }], summary: '要約', minutes: { format: 2, parts: ['清書の文章。'] }, visuals: [{ id: 'f', at: 5, text: '資料' }], driveBackup: { fileId: 'private-metadata' } };
  const audio = [{ id: 'a', meetingId: 'meeting', start: 0, end: 10, rate: 16000, blob: new Blob([new Uint8Array([1, 2, 3])]) }];
  const frames = [{ id: 'f', at: 5, mimeType: 'image/png', image: 'AQID' }];
  const result = await meetingArchive(meeting, audio, frames), files = entries(Buffer.from(await result.blob.arrayBuffer()));
  const record = JSON.parse(files.get('会議_試験_記録.json'));
  assert.equal(record.meeting.consultations[0].text, '個別の相談'); assert.equal(record.meeting.segments[0].text, '\n 原文。 '); assert.equal(record.meeting.driveBackup, undefined);
  assert.deepEqual([...files.get(record.archive.audio[0].path)], [1, 2, 3]); assert.deepEqual([...files.get(record.archive.images[0].path)], [1, 2, 3]);
  assert.equal(record.archive.missingAudio.length, 1); assert.match(files.get('会議_試験_議事録.html').toString(), /清書の文章/); assert.match(record.archive.images[0].path, /^スクショ\//);
});
test('Driveの通信切断は保存位置を確認して再送し、受信済みデータを重複送信しない', async () => {
  let puts = 0; const ranges = [];
  const fetcher = async (url, options) => {
    if (url.includes('/upload/')) return new Response(null, { headers: { Location: 'https://www.googleapis.com/session' } });
    if (options.method !== 'PUT') return new Response('', { status: 404 });
    ranges.push(options.headers['Content-Range']); puts++;
    if (puts === 1) throw new TypeError('connection interrupted');
    if (puts === 2) return new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } });
    return Response.json({ id: 'file' });
  };
  const result = await uploadArchive({ blob: new Blob([new Uint8Array(524288)]), name: '会議.zip', folder: 'folder', fileId: 'file', meetingId: 'meeting', token: 'access', fetcher, wait: async () => {} });
  assert.equal(result.id, 'file'); assert.deepEqual(ranges, ['bytes 0-524287/524288', 'bytes */524288', 'bytes 262144-524287/524288']);
});
test('再保存は同じ会議ファイルだけを更新し、無関係な既存ファイルや保存不可フォルダを拒否する', async () => {
  await assert.rejects(writableFolder('folder', 'access', async () => Response.json({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: false } })), /保存できません/);
  let method;
  const fetcher = async (url, options) => {
    if (url.includes('/upload/')) { method = options.method; return new Response(null, { headers: { Location: 'https://www.googleapis.com/session' } }); }
    if (options.method === 'PUT') return Response.json({ id: 'file' });
    return Response.json({ id: 'file', parents: ['folder'], appProperties: { withviewerMeeting: 'meeting' } });
  };
  await uploadArchive({ blob: new Blob(['zip']), name: '会議.zip', folder: 'folder', fileId: 'file', meetingId: 'meeting', token: 'access', fetcher }); assert.equal(method, 'PATCH');
  await assert.rejects(uploadArchive({ blob: new Blob(['zip']), name: '会議.zip', folder: 'folder', fileId: 'file', meetingId: 'other-meeting', token: 'access', fetcher }), /移動または削除/);
});
