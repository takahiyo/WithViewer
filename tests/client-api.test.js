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

test('JSON以外のサーバー障害は認証期限切れと混同せず、安全な診断情報だけを表示する', async () => {
  const originalFetch = globalThis.fetch;
  try {
    setTokenProvider(null);
    for (const [status, html, expected] of [
      [500, '<title>Error 1102</title><p>private server details</p>', /実行リソース上限/],
      [500, '<h1>error code: 1101</h1>', /異常終了/],
      [502, '<p>private server details</p>', /想定外の応答/],
      [200, '<html>private server details</html>', /想定外の応答/],
      [401, '<html>Unauthorized</html>', /ログイン認証に失敗/],
      [413, '', /送信サイズ/],
      [429, '', /頻度上限/],
    ]) {
      globalThis.fetch = async () => new Response(html, { status, headers: { 'cf-ray': 'abcdef1234567890-NRT' } });
      await assert.rejects(post('/api/transcribe', { audio: 'AAAA' }), error => {
        assert.match(error.message, expected);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /Ray abcdef1234567890-NRT/);
        assert.doesNotMatch(error.message, /private server details|有効期限/);
        assert.equal(error.status, status);
        if (html.includes('1102')) assert.equal(error.code, '1102');
        return true;
      });
    }
    globalThis.fetch = async () => Response.json(null);
    await assert.rejects(post('/api/transcribe', {}), /想定外の応答/);
    globalThis.fetch = async () => Response.json({ error: '利用枠に達しています。' }, { status: 429 });
    await assert.rejects(post('/api/transcribe', {}), { message: '利用枠に達しています。', status: 429 });
  } finally { globalThis.fetch = originalFetch; setTokenProvider(null); }
});
