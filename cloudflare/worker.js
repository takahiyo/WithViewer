import { GoogleGenAI } from '@google/genai';
import { createApi, apiError } from './api.js';
import { firebaseSettings, publicFirebaseConfig, verifyFirebase } from './firebase-auth.js';

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, headers });
}
const failure = (status, error) => secure(Response.json({ error }, { status }));

async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw Object.assign(new Error(), { status: 415, clientMessage: 'JSON形式で送信してください。' });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error(), { status: 400, clientMessage: '送信データがありません。' });
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 2_000_000) { await reader.cancel(); throw Object.assign(new Error(), { status: 413, clientMessage: '送信データが大きすぎます。' }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error(), { status: 400, clientMessage: 'JSONの形式が不正です。' }); }
}

export function createWorker({ authorize = verifyFirebase, providerFactory = env => new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta', timeout: 60000 }
}) } = {}) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) {
        // The login shell is public; meeting data and paid APIs require a verified token.
        if (!['GET', 'HEAD'].includes(request.method)) return failure(405, 'この操作は利用できません。');
        return secure(await env.ASSETS.fetch(request));
      }
      // External links may open the public login page. Only API requests
      // must originate from the site itself.
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
        return failure(403, '同じサイトからアクセスしてください。');
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return secure(Response.json({ deployment: 'cloudflare', authProvider: 'firebase', configured: false,
          firebase: publicFirebaseConfig(env), setupError: firebaseSettings(env) ? null : 'Firebaseログインの設定が未完了です。管理者に確認してください。' }));
      }
      if (!firebaseSettings(env)) return failure(503, 'Firebaseログインの設定が未完了です。管理者に確認してください。');
      if (url.origin !== env.PUBLIC_ORIGIN) return failure(403, '設定された公開URLからアクセスしてください。');
      if (!await authorize(request, env)) return failure(401, 'ログインの期限が切れているか、このGoogleアカウントには利用権限がありません。');
      if (url.pathname === '/api/session' && request.method === 'GET')
        return secure(Response.json({ configured: !!env.GEMINI_API_KEY, authenticated: true }));
      const provider = env.GEMINI_API_KEY ? providerFactory(env) : null;
      const api = createApi({ provider, liveModel: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
        transcribeModel: env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash' });
      const body = request.method === 'POST' ? await readBody(request) : undefined;
      const response = await api.handle(url.pathname, request.method, body);
      return secure(response);
    } catch (error) { return secure(apiError(error)); }
  } };
}

export default createWorker();
