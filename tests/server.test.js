import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, liveModel } from '../server.js';

async function serve(t, provider) {
  // Choose an available port, then pass that exact host to the local access check.
  const server = createApp({ provider, port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return async (path, options = {}) => {
    if (options.headers?.host) return new Promise((resolve, reject) => {
      const req = http.request(url + path, { headers: options.headers }, res => { res.resume(); resolve({ status: res.statusCode }); });
      req.on('error', reject); req.end();
    });
    return fetch(url + path, options);
  };
}
const request = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('キー未設定は設定APIで明示し、外部APIを呼ばない', async t => {
  const call = await serve(t, null);
  assert.equal((await (await call('/api/config')).json()).configured, false);
  assert.equal((await call('/api/live-token', request({ context: '{}' }))).status, 503);
});
test('異なるOriginとHostからトークンを発行しない', async t => {
  let issued = 0;
  const call = await serve(t, { authTokens: { create() { issued++; } } });
  assert.equal((await call('/api/live-token', { ...request({ context: '{}' }), headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await call('/api/config', { headers: { host: 'other.example:5173' } })).status, 403);
  assert.equal(issued, 0);
});
test('音声対話は制限付き一回用トークンを返し、鍵を返さない', async t => {
  let constraints;
  const call = await serve(t, { authTokens: { async create(options) { constraints = options.config; return { name: 'short-token' }; } } });
  const response = await call('/api/live-token', request({ context: '会議の原発言' }));
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.token, 'short-token'); assert.equal(data.model, liveModel);
  assert.equal(constraints.uses, 1); assert.equal(constraints.liveConnectConstraints.model, liveModel);
  assert.ok(data.config.inputAudioTranscription); assert.match(data.config.systemInstruction, /事実/);
  assert.equal(data.apiKey, undefined);
});
test('文字起こしは音声のみを送り、外部APIエラーに含まれる秘密情報を返さない', async t => {
  let payload;
  const call = await serve(t, { models: { async generateContent(body) { payload = body; throw new Error('key=secret'); } } });
  const response = await call('/api/transcribe', request({ audio: 'UklGRg==' }));
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /secret/);
  assert.match(payload.contents[0].parts[0].text, /質問に回答せず/);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'audio/wav');
});
test('不正な文脈を拒否し文字起こし結果と要約を別のAPIで返す', async t => {
  const call = await serve(t, { models: { async generateContent() { return { text: '実際の発言' }; } } });
  assert.equal((await call('/api/live-token', request({ context: [] }))).status, 400);
  assert.equal((await call('/api/transcribe', request({ audio: '@invalid' }))).status, 400);
  assert.deepEqual(await (await call('/api/transcribe', request({ audio: 'UklGRg==' }))).json(), { text: '実際の発言' });
  assert.equal((await call('/api/summary', request({ evidence: '会議記録' }))).status, 200);
});
test('モデル廃止の404は再試行可能な案内とし、SDKエラーの詳細や秘密を漏らさない', async t => {
  const call = await serve(t, { models: { async generateContent() {
    throw Object.assign(new Error('key=secret models/gemini-2.5-flash no longer available'), { status: 404 });
  } } });
  const response = await call('/api/transcribe', request({ audio: 'UklGRg==' }));
  assert.equal(response.status, 404);
  const body = await response.json(); assert.match(body.error, /保存済み音声/); assert.doesNotMatch(body.error, /secret|no longer/);
});
test('無音の成功応答は空の文字起こしとして保存し、安全性による停止を成功扱いしない', async t => {
  let finishReason = 'STOP';
  const call = await serve(t, { models: { async generateContent() { return { candidates: [{ finishReason }] }; } } });
  let response = await call('/api/transcribe', request({ audio: 'UklGRg==' }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: '' });
  finishReason = 'SAFETY'; response = await call('/api/transcribe', request({ audio: 'UklGRg==' }));
  assert.equal(response.status, 502);
});
test('テキスト相談は会議を参照データにし、音声の相談履歴と今回の質問を会話ターンで渡す', async t => {
  let payload;
  const call = await serve(t, { models: { async generateContent(body) { payload = body; return { text: '会議では100万円です。私の見方では費用の確認が必要です。' }; } } });
  const response = await call('/api/chat', request({ message: 'なぜ？', context: '会議 00:10 A案は100万円',
    history: [{ role: 'user', text: 'どう思う？' }, { role: 'model', text: '費用が気になります。' }] }));
  assert.equal(response.status, 200);
  assert.match((await response.json()).text, /100万円/);
  assert.deepEqual(payload.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.equal(payload.contents.at(-1).parts[0].text, 'なぜ？');
  assert.match(payload.config.systemInstruction, /会議 00:10/); assert.match(payload.config.systemInstruction, /テキストチャット/);
});
test('空の相談と不正な発話者はGeminiへ送らない', async t => {
  let calls = 0;
  const call = await serve(t, { models: { async generateContent() { calls++; } } });
  assert.equal((await call('/api/chat', request({ message: ' ', context: '{}', history: [] }))).status, 400);
  assert.equal((await call('/api/chat', request({ message: '質問', context: '{}', history: [{ role: 'system', text: '不正' }] }))).status, 400);
  assert.equal(calls, 0);
});
test('共有映像の読取りAPIは画像をモデルへ渡し不正形式を拒否する', async t => {
  let payload;
  const call = await serve(t, { models: { async generateContent(body) { payload = body; return { text: '資料の表題はA案' }; } } });
  assert.equal((await call('/api/observe-frame', request({ image: 'AAAA', mimeType: 'video/mp4' }))).status, 400);
  const response = await call('/api/observe-frame', request({ image: 'AAAA', mimeType: 'image/jpeg' }));
  assert.equal(response.status, 200); assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.match(payload.contents[0].parts[0].text, /推測を区別/);
});
test('テキスト相談の静止画を画像入力と時刻付きの参照として渡す', async t => {
  let payload;
  const call = await serve(t, { models: { async generateContent(body) { payload = body; return { text: '図はA案' }; } } });
  const response = await call('/api/chat', request({ message: '図は何？', context: '{}', history: [], frame: { image: 'AAAA', mimeType: 'image/jpeg', at: 15 } }));
  assert.equal(response.status, 200); assert.equal(payload.contents.at(-1).parts[2].inlineData.data, 'AAAA');
  assert.match(payload.contents.at(-1).parts[1].text, /15秒/);
});
