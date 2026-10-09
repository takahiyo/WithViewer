import { decodeJwt } from 'jose';

const TOKEN = '__Host-wv-drive', STATE = '__Host-wv-drive-state';
const scope = 'https://www.googleapis.com/auth/drive.file';
const cookie = (name, value, age, sameSite = 'Strict') => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${age}`;
const readCookie = (request, name) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, clientMessage: message }); };
export const driveConfigured = env => !!(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET && env.GOOGLE_DRIVE_PICKER_API_KEY && typeof env.DRIVE_TOKEN_SECRET === 'string' && env.DRIVE_TOKEN_SECRET.length >= 32);
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
async function key(env) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.DRIVE_TOKEN_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function seal(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify(value))));
  return `${encode(iv)}.${encode(encrypted)}`;
}
export async function unseal(value, env) {
  try {
    if (!value || value.length > 3800) return null;
    const [iv, data] = value.split('.');
    const result = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await key(env), decode(data))));
    return result.exp > Date.now() ? result : null;
  } catch { return null; }
}
async function google(fetcher, url, options) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { fail(503, 'Google Driveに接続できません。ローカルの記録は残っています。'); }
  if (!response.ok) {
    // Expose only known codes, never upstream descriptions or credentials.
    const result = await response.json().catch(() => ({}));
    const messages = {
      invalid_client: 'Google認証のクライアント設定が一致しません（invalid_client）。管理者はプレビュー環境のGOOGLE_DRIVE_CLIENT_IDとGOOGLE_DRIVE_CLIENT_SECRETが同じOAuthクライアントの値か確認し、再デプロイしてください。',
      unauthorized_client: 'Google認証のクライアント種別・設定を確認してください（unauthorized_client）。ウェブアプリケーション用OAuthクライアントが必要です。',
      invalid_grant: 'Googleの認可が期限切れ・使用済み、または認証設定と一致しません（invalid_grant）。この画面を再読み込みせず、アプリからGoogle Driveを接続し直してください。繰り返す場合はリダイレクトURIの設定を確認してください。',
      redirect_uri_mismatch: 'Google認証の戻り先URLが一致しません（redirect_uri_mismatch）。OAuthクライアントの承認済みリダイレクトURIに、このサイトの/api/drive/callbackを登録してください。',
      insufficient_scope: 'Google Driveへの保存権限が不足しています。アプリから接続し直して保存を許可してください。'
    };
    const message = typeof result.error === 'string' ? messages[result.error] : undefined;
    fail(response.status === 400 || response.status === 401 ? 401 : 503,
      (message || `Googleとの認証通信に失敗しました（HTTP ${response.status}）。時間をおいてアプリから接続し直してください。`) + ' ローカルの記録は残っています。');
  }
  return response.json();
}
const exchange = (env, fetcher, params) => google(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_DRIVE_CLIENT_ID, client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET, ...params }) });

// Only this callback is unauthenticated. A short-lived, encrypted, browser-bound
// state cookie binds Google's response to the already verified Firebase identity.
export async function driveCallback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!driveConfigured(env) || url.origin !== env.PUBLIC_ORIGIN || request.method !== 'GET') fail(403, 'Drive連携の公開URLと設定を確認してください。');
  const state = await unseal(readCookie(request, STATE), env);
  if (!state || state.nonce !== url.searchParams.get('state') || url.searchParams.has('error')) fail(400, 'Drive連携を完了できませんでした。アプリから接続し直してください。');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) fail(400, 'Drive連携の応答が不正です。');
  const result = await exchange(env, fetcher, { code, grant_type: 'authorization_code', redirect_uri: `${url.origin}/api/drive/callback`, code_verifier: state.verifier });
  if (!result.refresh_token || !result.scope?.split(' ').includes(scope)) fail(400, '自動保存のため、Driveへの保存を許可して接続し直してください。');
  const account = await google(fetcher, 'https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${result.access_token}` } });
  if (account.email_verified !== true || account.email?.toLowerCase() !== state.email) fail(403, 'アプリにログインしたGoogleアカウントと同じアカウントを選んでください。');
  const sealed = await seal({ uid: state.uid, email: state.email, refresh: result.refresh_token, exp: Date.now() + 180 * 86400000 }, env);
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
  headers.append('Set-Cookie', cookie(TOKEN, sealed, 180 * 86400)); headers.append('Set-Cookie', cookie(STATE, '', 0, 'Lax'));
  return new Response('<!doctype html><meta charset="utf-8"><title>Drive連携</title><p>Google Driveと連携しました。このウィンドウを閉じ、アプリで保存先フォルダを選んでください。</p><script>if(window.opener){window.opener.postMessage({type:"withviewer-drive-connected"},location.origin);window.close()}</script>', { headers });
}

export async function driveApi(request, env, body, fetcher = fetch) {
  const url = new URL(request.url), path = url.pathname;
  // Called only after verifyFirebase succeeds; never trust these decoded claims
  // on an unauthenticated route.
  const identity = decodeJwt(request.headers.get('Authorization').slice(7));
  const credentials = driveConfigured(env) ? await unseal(readCookie(request, TOKEN), env) : null;
  const linked = credentials?.uid === identity.sub && credentials?.email === identity.email?.toLowerCase();
  if (path === '/api/drive/status' && request.method === 'GET') return Response.json({ configured: driveConfigured(env), connected: !!linked, account: identity.email });
  if (request.method !== 'POST') return Response.json({ error: 'この操作は利用できません。' }, { status: 405 });
  if (!driveConfigured(env)) fail(503, '管理者によるGoogle Drive連携の設定が必要です。');
  if (path === '/api/drive/connect') {
    const nonce = encode(crypto.getRandomValues(new Uint8Array(24))), verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = await seal({ nonce, verifier, uid: identity.sub, email: identity.email.toLowerCase(), exp: Date.now() + 600000 }, env);
    const query = new URLSearchParams({ client_id: env.GOOGLE_DRIVE_CLIENT_ID, redirect_uri: `${url.origin}/api/drive/callback`, response_type: 'code', scope: `openid email ${scope}`, access_type: 'offline', prompt: 'consent', state: nonce, login_hint: identity.email, code_challenge: challenge, code_challenge_method: 'S256' });
    return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` }, { headers: { 'Set-Cookie': cookie(STATE, state, 600, 'Lax') } });
  }
  if (!linked) fail(401, 'Google Driveを接続し直してください。');
  if (path === '/api/drive/disconnect') {
    // Removing the app's local link does not delete any Drive files.
    return Response.json({ connected: false }, { headers: { 'Set-Cookie': cookie(TOKEN, '', 0) } });
  }
  if (path === '/api/drive/token') {
    const result = await exchange(env, fetcher, { refresh_token: credentials.refresh, grant_type: 'refresh_token' });
    if (!result.access_token) fail(502, 'Google Driveの保存用認可を取得できませんでした。');
    return Response.json({ accessToken: result.access_token, pickerKey: env.GOOGLE_DRIVE_PICKER_API_KEY, appId: env.GOOGLE_DRIVE_CLIENT_ID.split('-')[0], account: identity.email });
  }
  return Response.json({ error: '見つかりません。' }, { status: 404 });
}
