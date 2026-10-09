import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifyFirebase, firebaseSetupError } from '../cloudflare/firebase-auth.js';
import { createWorker } from '../cloudflare/worker.js';

const env = { FIREBASE_WEB_CONFIG: JSON.stringify({ projectId: 'withviewer-test', authDomain: 'withviewer-test.firebaseapp.com', apiKey: 'public-test-key', appId: 'test-app' }),
  ALLOWED_EMAIL: 'owner@example.com', PUBLIC_ORIGIN: 'https://withviewer.pages.dev', GEMINI_API_KEY: 'test-only-key',
  ASSETS: { fetch: async () => new Response('private asset') } };
const pair = await generateKeyPair('RS256');
const jwk = await exportJWK(pair.publicKey); jwk.kid = 'test-key';
const keys = createLocalJWKSet({ keys: [jwk] });
async function token(overrides = {}, key = pair.privateKey) {
  return new SignJWT({ email: env.ALLOWED_EMAIL, email_verified: true, sub: 'owner', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'google.com' }, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.iss || 'https://securetoken.google.com/withviewer-test').setAudience(overrides.aud || 'withviewer-test')
    .setIssuedAt(overrides.iat).setExpirationTime(overrides.exp || '5m').sign(key);
}
const request = (path, jwt, body, origin = env.PUBLIC_ORIGIN) => new Request(env.PUBLIC_ORIGIN + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { Authorization: jwt ? `Bearer ${jwt}` : '',
    'Content-Type': 'application/json', Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const authorize = (req, settings) => verifyFirebase(req, settings, keys);

test('未設定と不正JSONと不足項目を区別し、設定の値はエラーへ漏らさない', () => {
  assert.equal(firebaseSetupError(env), null);
  assert.match(firebaseSetupError({}), /FIREBASE_WEB_CONFIGを登録/);
  assert.match(firebaseSetupError({ ...env, FIREBASE_WEB_CONFIG: 'const firebaseConfig = {secret};' }), /JSONとして読み取れません/);
  assert.match(firebaseSetupError({ ...env, FIREBASE_WEB_CONFIG: JSON.stringify(env.FIREBASE_WEB_CONFIG) }), /JSONオブジェクト/);
  assert.match(firebaseSetupError({ ...env, FIREBASE_WEB_CONFIG: '{"apiKey":"secret"}' }), /authDomain・projectId・appId/);
  assert.match(firebaseSetupError({ ...env, ALLOWED_EMAIL: 'invalid-private-value' }), /ALLOWED_EMAIL/);
  assert.match(firebaseSetupError({ ...env, PUBLIC_ORIGIN: env.PUBLIC_ORIGIN + '/' }), /PUBLIC_ORIGIN/);
  assert.equal(firebaseSetupError({ ...env, ALLOWED_EMAIL: 'invalid-private-value' }).includes('invalid-private-value'), false);
});

test('外部サイトからログイン画面を開けるが外部サイトのAPI要求は拒否する', async () => {
  let calls = 0;
  const worker = createWorker({ authorize, providerFactory: () => { calls++; throw new Error(); } });
  const navigation = new Request(env.PUBLIC_ORIGIN + '/', { headers: {
    'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
    Referer: 'https://dash.cloudflare.com/'
  } });
  assert.equal((await worker.fetch(navigation, env)).status, 200);
  const jwt = await token();
  for (const path of ['/api/config', '/api/session', '/api/live-token', '/api/chat']) {
    const crossSite = new Request(env.PUBLIC_ORIGIN + path, { headers: {
      Authorization: `Bearer ${jwt}`, 'Sec-Fetch-Site': 'cross-site'
    } });
    assert.equal((await worker.fetch(crossSite, env)).status, 403);
  }
  assert.equal(calls, 0);
});

test('公開版は署名・期限・発行者・対象アプリ・本人メールを検証する', async () => {
  assert.equal(await authorize(request('/', await token()), env), true);
  for (const changes of [{ email: 'other@example.com' }, { iss: 'https://securetoken.google.com/wrong-project' },
    { aud: 'wrong-project' }, { exp: Math.floor(Date.now() / 1000) - 60 }, { email_verified: false },
    { firebase: { sign_in_provider: 'password' } }, { sub: '' }, { auth_time: Math.floor(Date.now() / 1000) + 60 },
    { iat: Math.floor(Date.now() / 1000) + 60 }]) {
    assert.equal(await authorize(request('/', await token(changes)), env), false);
  }
  const attacker = await generateKeyPair('RS256');
  assert.equal(await authorize(request('/', await token({}, attacker.privateKey)), env), false);
  assert.equal(await authorize(request('/', 'fake-token'), env), false);
});

test('ログイン画面だけを公開し、認証なし・未設定・別URLのAPIからGeminiを呼ばない', async () => {
  let calls = 0;
  const worker = createWorker({ authorize, providerFactory: () => { calls++; throw new Error(); } });
  for (const path of ['/', '/assets/app.js', '/pcm-worklet.js', '/api/config']) {
    assert.equal((await worker.fetch(request(path), env)).status, 200);
  }
  for (const path of ['/api/session', '/api/live-token', '/api/transcribe', '/api/chat', '/api/observe-frame', '/api/summary', '/api/minutes']) {
    assert.equal((await worker.fetch(request(path), env)).status, 401);
  }
  assert.equal((await worker.fetch(request('/api/session'), {})).status, 503);
  const publicConfig = await (await worker.fetch(request('/api/config'), env)).text();
  assert.equal(publicConfig.includes(env.GEMINI_API_KEY), false);
  assert.equal(publicConfig.includes(env.ALLOWED_EMAIL), false);
  const jwt = await token();
  assert.equal((await worker.fetch(new Request('https://preview.withviewer.pages.dev/api/session', { headers: { Authorization: `Bearer ${jwt}` } }), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/chat', jwt, {}, 'https://other.example.com'), env)).status, 403);
  assert.equal(calls, 0);
});

test('本人ログイン後の画面・設定・音声・画像・相談・Liveを共通APIに接続する', async () => {
  const calls = [];
  const provider = { models: { generateContent: async body => { calls.push(body); return { text: '確認した結果' }; } },
    authTokens: { create: async body => { calls.push(body); return { name: 'ephemeral-token' }; } } };
  const worker = createWorker({ authorize, providerFactory: () => provider });
  const jwt = await token();
  assert.equal(await (await worker.fetch(request('/', jwt), env)).text(), 'private asset');
  const config = await (await worker.fetch(request('/api/config', jwt), env)).json();
  assert.equal(config.deployment, 'cloudflare'); assert.equal(config.authProvider, 'firebase');
  assert.equal((await (await worker.fetch(request('/api/session', jwt), env)).json()).authenticated, true);
  assert.equal(JSON.stringify(config).includes(env.GEMINI_API_KEY), false);
  for (const [path, body] of [
    ['/api/transcribe', { audio: 'AAAA' }], ['/api/observe-frame', { image: 'AAAA', mimeType: 'image/jpeg' }],
    ['/api/chat', { message: 'どう思う？', history: [], context: '{}' }], ['/api/summary', { evidence: '会議原文' }],
    ['/api/minutes', { evidence: '会議原文' }], ['/api/live-token', { context: '{}' }]
  ]) {
    const response = await worker.fetch(request(path, jwt, body), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(calls.length, 6);
  assert.equal(calls.at(-1).config.uses, 1);
});

test('公開版も大きすぎる入力・不正JSONを拒否し、SDKの秘密情報を返さない', async () => {
  let calls = 0;
  const worker = createWorker({ authorize, providerFactory: () => ({ models: { generateContent: async () => {
    calls++; throw Object.assign(new Error('key=provider-secret'), { status: 429 });
  } } }) });
  const jwt = await token();
  const make = body => new Request(env.PUBLIC_ORIGIN + '/api/transcribe', { method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body });
  assert.equal((await worker.fetch(make('x'.repeat(2_000_001)), env)).status, 413);
  assert.equal((await worker.fetch(make('invalid-json'), env)).status, 400);
  assert.equal((await worker.fetch(make('null'), env)).status, 400);
  assert.equal(calls, 0);
  const response = await worker.fetch(request('/api/transcribe', jwt, { audio: 'AAAA' }), env);
  assert.equal(response.status, 429); assert.equal((await response.text()).includes('provider-secret'), false);
});
