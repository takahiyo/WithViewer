let getToken;
export function setTokenProvider(provider) { getToken = provider; }
export async function authHeaders() {
  if (!getToken) return {};
  const token = await getToken();
  if (!token) throw Object.assign(new Error('Googleアカウントでログインしてください。'), { status: 401 });
  return { Authorization: `Bearer ${token}` };
}
function unexpectedResponse(response, text) {
  // Extract only known diagnostic identifiers; never display the HTML response.
  const code = text.match(/(?:error\s*(?:code\s*)?[:#]?\s*|<title>\s*)(1101|1102|1015)\b/i)?.[1];
  let message;
  if (code === '1102') message = 'Cloudflareの実行リソース上限に達しました。管理者がWorkerの実行ログを確認する必要があります。';
  else if (code === '1101') message = 'Cloudflareでサーバー処理が異常終了しました。管理者がWorkerの実行ログを確認する必要があります。';
  else if (response.status === 401) message = 'ログイン認証に失敗しました。録音を終了して保存してから、ログインし直してください。';
  else if (response.status === 403) message = 'サーバーがアクセスを拒否しました。公開URLとアクセス設定を確認してください。';
  else if (response.status === 413) message = '音声または画像の送信サイズがサーバーの上限を超えています。';
  else if (response.status === 429 || code === '1015') message = 'サーバーのリクエスト頻度上限に達しました。少し待ってから再試行してください。';
  else message = 'サーバーから想定外の応答が返りました。保存済み区間を再試行し、続く場合は管理者にこのエラーを伝えてください。';
  const ray = response.headers.get('cf-ray');
  const details = [`HTTP ${response.status}`, ...(code ? [`Cloudflare ${code}`] : []),
    ...(/^[a-f0-9]{8,32}-[a-z]{3}$/i.test(ray || '') ? [`Ray ${ray}`] : [])];
  return Object.assign(new Error(`${message}（${details.join(' / ')}）`), { status: response.status, code });
}
export async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...await authHeaders() },
    body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  let result;
  const text = await response.text();
  try { result = JSON.parse(text); }
  catch { throw unexpectedResponse(response, text); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw unexpectedResponse(response, '');
  if (!response.ok) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : `処理に失敗しました。（HTTP ${response.status}）`), { status: response.status });
  return result;
}
