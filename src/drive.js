import { authHeaders, post } from './api.js';
import { meetingAudio, meetingFrames } from './storage.js';
import { meetingArchive } from './meeting-archive.js';
import { driveJson, writableFolder, uploadArchive } from './drive-upload.js';

export function createDriveBackup({ currentMeeting, saveTarget, onBusy = () => {}, canConfigure = () => true }) {
  const $ = id => document.getElementById(id);
  let settings = {}, account = '', connected = false, configured = false, busy = false, popup;
  const timers = new Map(), queued = new Map();
  const preferenceKey = () => `withviewer-drive:${account}`;
  const status = text => { $('drive-status').textContent = text; };
  const remember = () => localStorage.setItem(preferenceKey(), JSON.stringify(settings));
  function render() {
    $('drive-connect').disabled = !configured || busy || !canConfigure();
    $('drive-folder').disabled = !connected || busy || !canConfigure();
    $('drive-disconnect').disabled = !connected || busy;
    $('drive-auto').checked = !!settings.auto; $('drive-auto').disabled = !connected || !settings.folder || busy;
    $('drive-save').disabled = !connected || !settings.folder || busy;
    $('drive-folder-name').textContent = settings.folder?.name || '未選択';
    $('drive-connect').textContent = connected ? 'Google Driveを接続し直す' : 'Google Driveを接続';
  }
  async function refresh() {
    try {
      const response = await fetch('/api/drive/status', { headers: await authHeaders(), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Drive連携の状態を確認できません。');
      const result = await response.json(); configured = result.configured; connected = result.connected; account = result.account || '';
      try { settings = JSON.parse(localStorage.getItem(preferenceKey()) || '{}'); } catch { settings = {}; }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
      status(!configured ? '公開版の管理者によるDrive API・OAuth設定が必要です。' : connected ? (settings.folder ? '保存先を設定済みです。自動保存を有効にすると会議終了時に保存します。' : '保存先フォルダを選んでください。') : '初回は、ログインしたGoogleアカウントでDriveへの保存を許可してください。');
    } catch (e) { connected = false; status(e.message); }
    render();
  }
  let loadingPicker;
  function loadPicker() {
    loadingPicker ||= new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('フォルダ選択を読み込めません。')), timeout: 15000, ontimeout: () => reject(new Error('フォルダ選択の読込みがタイムアウトしました。')) });
      script.onerror = () => reject(new Error('Googleのフォルダ選択に接続できません。')); document.head.append(script);
    }).catch(e => { loadingPicker = null; throw e; });
    return loadingPicker;
  }
  $('drive-connect').onclick = async () => {
    if (!canConfigure()) return;
    popup = window.open('about:blank', 'withviewer-drive', 'popup,width=650,height=760');
    if (!popup) { status('Drive接続のため、このサイトのポップアップを許可してください。'); return; }
    try { const result = await post('/api/drive/connect', {}); popup.location = result.url; status('Googleで保存を許可した後、保存先フォルダを選んでください。'); }
    catch (e) { popup.close(); status(e.message); }
  };
  window.addEventListener('message', event => { if (event.origin === location.origin && event.source === popup && event.data?.type === 'withviewer-drive-connected') refresh(); });
  window.addEventListener('focus', () => { if (popup) refresh(); });
  $('drive-folder').onclick = async () => {
    if (!canConfigure()) return;
    try {
      await loadPicker(); const token = await post('/api/drive/token', {}), picker = window.google.picker;
      const view = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
      new picker.PickerBuilder().addView(view).setOAuthToken(token.accessToken).setDeveloperKey(token.pickerKey).setAppId(token.appId).setOrigin(location.origin).setTitle('WithViewerの保存先フォルダ').setCallback(async data => {
        if (data.action !== picker.Action.PICKED) return;
        try { settings.folder = await writableFolder(data.docs[0].id, token.accessToken); remember(); status('保存先を設定しました。会議終了時の自動保存を有効にできます。'); render(); }
        catch (e) { status(e.message); }
      }).build().setVisible(true);
    } catch (e) { status(e.message); }
  };
  $('drive-auto').onchange = () => { settings.auto = $('drive-auto').checked; remember(); status(settings.auto ? '会議終了時に自動保存します。終了後の文字起こし・議事録も更新します。保存完了まではページを開いておいてください。' : '自動保存を停止しました。Drive上の保存済みファイルは残ります。'); };
  $('drive-disconnect').onclick = async () => {
    try { await post('/api/drive/disconnect', {}); settings.auto = false; remember(); connected = false; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); queued.clear(); status('このブラウザーのDrive連携を解除しました。保存済みファイルは残っています。'); render(); }
    catch (e) { status(e.message); }
  };
  $('drive-save').onclick = () => save(currentMeeting());
  async function save(target) {
    if (!target || !connected || !settings.folder) return;
    clearTimeout(timers.get(target.id)); timers.delete(target.id);
    if (busy) { queued.set(target.id, target); return; }
    busy = true; onBusy(true); render(); status('会議の記録・音声・画像をまとめています…');
    try {
      const folder = settings.folder.id, token = await post('/api/drive/token', {});
      await writableFolder(folder, token.accessToken);
      const [audio, frames] = await Promise.all([meetingAudio(target.id), meetingFrames(target.id)]);
      const archive = await meetingArchive(target, audio, frames);
      let fileId = target.driveBackup?.folder === folder ? target.driveBackup.fileId : null;
      if (!fileId) {
        fileId = (await driveJson('/generateIds?count=1&space=drive&type=files', token.accessToken)).ids[0];
        target.driveBackup = { folder, fileId }; await saveTarget(target, false);
      }
      const result = await uploadArchive({ ...archive, token: token.accessToken, folder, fileId, meetingId: target.id, progress: percent => status(`Google Driveに保存しています… ${percent}%`) });
      target.driveBackup = { folder, fileId: result.id, savedAt: new Date().toISOString() }; await saveTarget(target, false);
      const missing = archive.manifest.missingAudio.length + archive.manifest.missingImages.length;
      status(`「${target.title}」の会議一式をGoogle Driveへ保存しました。${missing ? `ローカルに原本がない記録が${missing}件あります。` : ''}`);
    } catch (e) { status(`保存未完了：${e.message}「今すぐ保存」で再試行できます。`); }
    finally {
      busy = false; onBusy(false); render();
      const next = queued.entries().next().value;
      if (next) { queued.delete(next[0]); schedule(next[1]); }
    }
  }
  function schedule(target) {
    if (!connected || !settings.auto || !settings.folder || !target?.endedAt) return;
    clearTimeout(timers.get(target.id));
    const age = target.driveBackup?.savedAt ? Date.now() - Date.parse(target.driveBackup.savedAt) : Infinity;
    timers.set(target.id, setTimeout(() => save(target), Math.max(2000, 30000 - age)));
  }
  async function finish(target) {
    if (!connected || !settings.auto || !settings.folder || !target?.endedAt) return;
    clearTimeout(timers.get(target.id)); timers.delete(target.id); queued.delete(target.id);
    while (busy) await new Promise(r => setTimeout(r, 250));
    await save(target);
  }
  return { initialize: refresh, schedule, render, finish, get busy() { return busy; }, get pending() { return timers.size > 0 || queued.size > 0; } };
}
