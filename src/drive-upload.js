const API = 'https://www.googleapis.com/drive/v3/files';
const headers = token => ({ Authorization: `Bearer ${token}` });
const error = response => Object.assign(new Error(response.status === 401 ? 'Google Driveを接続し直してください。' : response.status === 403 ? 'Google Driveの保存権限・空き容量・利用制限を確認してください。' : `Google Driveへの保存に失敗しました（HTTP ${response.status}）。ローカルの記録は残っています。`), { status: response.status });
export async function driveJson(path, token, options = {}, fetcher = fetch) {
  const response = await fetcher(`${API}${path}`, { ...options, headers: { ...headers(token), ...options.headers }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw error(response);
  return response.json();
}
export async function writableFolder(id, token, fetcher = fetch) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error('保存先フォルダを選び直してください。');
  const folder = await driveJson(`/${id}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)`, token, {}, fetcher);
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren) throw new Error('このフォルダには保存できません。保存先を選び直してください。');
  return { id: folder.id, name: folder.name };
}
export async function uploadArchive({ blob, name, folder, fileId, meetingId, token, progress = () => {}, fetcher = fetch, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  let existing = false;
  try {
    const file = await driveJson(`/${fileId}?fields=id,trashed,parents,appProperties`, token, {}, fetcher);
    if (file.trashed || !file.parents?.includes(folder) || file.appProperties?.withviewerMeeting !== meetingId) throw new Error('保存ファイルが移動または削除されています。新しい保存先を設定して保存し直してください。');
    existing = true;
  } catch (e) { if (e.status !== 404) throw e; }
  const endpoint = `https://www.googleapis.com/upload/drive/v3/files${existing ? `/${fileId}` : ''}?uploadType=resumable&fields=id,webViewLink`;
  const init = await fetcher(endpoint, { method: existing ? 'PATCH' : 'POST', headers: { ...headers(token), 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(existing ? { name } : { id: fileId, name, parents: [folder], appProperties: { withviewerMeeting: meetingId } }), signal: AbortSignal.timeout(30000) });
  if (!init.ok) throw error(init);
  const location = init.headers.get('Location');
  if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Google Driveのアップロード先を確認できません。');
  let offset = 0, retries = 0;
  const position = response => {
    const range = response.headers.get('Range'), end = range?.match(/^bytes=0-(\d+)$/)?.[1];
    const next = end === undefined ? 0 : Number(end) + 1;
    if (!Number.isSafeInteger(next) || next < offset || next > blob.size) throw new Error('Google Driveの保存位置を確認できません。');
    return next;
  };
  while (offset < blob.size) {
    const end = Math.min(offset + 8 * 1024 * 1024, blob.size);
    let response;
    try {
      response = await fetcher(location, { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/zip', 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` }, body: blob.slice(offset, end), signal: AbortSignal.timeout(120000) });
      if (response.ok) { progress(100); return response.json(); }
      if (response.status === 308) {
        const next = position(response);
        if (next <= offset) throw new Error('Google Driveへの送信が進んでいません。');
        offset = next; progress(Math.floor(offset / blob.size * 100)); continue;
      }
      if (![429, 500, 502, 503, 504].includes(response.status)) throw error(response);
    } catch (e) { if (e.status && ![429, 500, 502, 503, 504].includes(e.status)) throw e; }
    if (++retries > 3) throw new Error('Google Driveへの送信を再試行しましたが完了できませんでした。「今すぐ保存」で再試行できます。ローカルの記録は残っています。');
    await wait([2000, 5000, 15000][retries - 1]);
    const check = await fetcher(location, { method: 'PUT', headers: { ...headers(token), 'Content-Range': `bytes */${blob.size}` }, signal: AbortSignal.timeout(30000) });
    if (check.ok) { progress(100); return check.json(); }
    if (check.status !== 308) throw error(check);
    offset = position(check);
  }
  throw new Error('Google Driveの保存完了を確認できません。「今すぐ保存」で確認してください。');
}
