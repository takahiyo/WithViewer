import test from 'node:test';
import assert from 'node:assert/strict';
import { post, setTokenProvider } from '../src/api.js';

test('公開版のAPIは毎回現在のIDトークンを使い、未ログインなら送信しない', async () => {
  const originalFetch = globalThis.fetch;
  const headers = [];
  globalThis.fetch = async (_url, options) => { headers.push(options.headers); return Response.json({ text: 'ok' }); };
  try {
    let token = 'first'; setTokenProvider(() => token);
    await post('/api/chat', { message: '質問' });
    token = 'refreshed'; await post('/api/transcribe', { audio: 'AAAA' });
    assert.equal(headers[0].Authorization, 'Bearer first');
    assert.equal(headers[1].Authorization, 'Bearer refreshed');
    token = null; await assert.rejects(post('/api/chat', {}), { status: 401 });
    assert.equal(headers.length, 2);
    setTokenProvider(null); await post('/api/chat', {});
    assert.equal(headers[2].Authorization, undefined);
  } finally { globalThis.fetch = originalFetch; setTokenProvider(null); }
});
