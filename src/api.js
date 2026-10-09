let getToken;
export function setTokenProvider(provider) { getToken = provider; }
export async function authHeaders() {
  if (!getToken) return {};
  const token = await getToken();
  if (!token) throw Object.assign(new Error('Googleアカウントでログインしてください。'), { status: 401 });
  return { Authorization: `Bearer ${token}` };
}
export async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...await authHeaders() },
    body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  let result;
  try { result = await response.json(); }
  catch { throw Object.assign(new Error('ログインの有効期限またはサーバーの応答を確認してください。公開版ではページを開き直してログインしてください。'), { status: response.status }); }
  if (!response.ok) throw Object.assign(new Error(result.error || '処理に失敗しました。'), { status: response.status });
  return result;
}
