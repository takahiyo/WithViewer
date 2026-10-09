import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

const bundle = (await build({ entryPoints: ['src/drive.js'], bundle: true, format: 'esm', write: false })).outputFiles[0].text;
test('設定済みのDriveへ終了後に全原本を自動保存し、後から完成した議事録は同じファイルを更新する', async ({ page }, testInfo) => {
  await page.route('**/drive-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ja"><body><button id="drive-connect"></button><button id="drive-folder">フォルダ</button><button id="drive-disconnect">解除</button><input id="drive-auto" type="checkbox"><button id="drive-save">今すぐ保存</button><span id="drive-folder-name"></span><p id="drive-status"></p></body></html>' }));
  await page.route('**/drive-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.route('**/api/drive/status', route => route.fulfill({ json: { configured: true, connected: true, account: 'owner@example.com' } }));
  await page.route('**/api/drive/token', route => route.fulfill({ json: { accessToken: 'test-access', appId: '123', pickerKey: 'test-picker' } }));
  const methods = [], archives = []; let existing = false;
  await page.route('https://www.googleapis.com/**', route => {
    const req = route.request(), url = req.url();
    if (url.includes('generateIds')) return route.fulfill({ json: { ids: ['archive-file'] } });
    if (url.includes('/files/folder?')) return route.fulfill({ json: { id: 'folder', name: '会議記録', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } } });
    if (url.includes('/upload/')) { methods.push(req.method()); return route.fulfill({ status: 200, headers: { Location: 'https://www.googleapis.com/session', 'Access-Control-Expose-Headers': 'Location' }, body: '' }); }
    if (url.includes('/session')) { archives.push(req.postDataBuffer()); existing = true; return route.fulfill({ json: { id: 'archive-file' } }); }
    if (!existing) return route.fulfill({ status: 404, json: { error: 'not found' } });
    return route.fulfill({ json: { id: 'archive-file', parents: ['folder'], appProperties: { withviewerMeeting: 'meeting' } } });
  });
  await page.goto('/drive-fixture'); await page.clock.install();
  await page.evaluate(async () => {
    localStorage.setItem('withviewer-drive:owner@example.com', JSON.stringify({ auto: true, folder: { id: 'folder', name: '会議記録' } }));
    const { createDriveBackup } = await import('/drive-fixture.js');
    window.fixture = { id: 'meeting', title: '企画会議', createdAt: '2026-10-09T00:00:00Z', endedAt: '2026-10-09T01:00:00Z', segments: [{ id: 'a', start: 0, end: 10, text: '原発言', status: 'done' }], consultations: [{ role: 'user', text: '個別相談' }], visuals: [{ id: 'image', at: 5, text: '資料' }] };
    const db = await new Promise(resolve => { const r = indexedDB.open('withviewer', 2); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const tx = db.transaction(['audio', 'frames'], 'readwrite'); tx.objectStore('audio').put({ id: 'a', meetingId: 'meeting', start: 0, rate: 16000, blob: new Blob(['original-audio']) }); tx.objectStore('frames').put({ id: 'image', meetingId: 'meeting', at: 5, mimeType: 'image/png', image: 'AQID' }); tx.oncomplete = resolve; }); db.close();
    window.backup = createDriveBackup({ currentMeeting: () => window.fixture, saveTarget: async () => {} }); await window.backup.initialize(); window.backup.schedule(window.fixture);
  });
  await page.clock.fastForward(2000); await expect(page.locator('#drive-status')).toContainText('保存しました');
  expect(methods).toEqual(['POST']); expect(archives[0].includes(Buffer.from('音声/'))).toBe(true); expect(archives[0].includes(Buffer.from('スクショ/'))).toBe(true); expect(archives[0].includes(Buffer.from('個別相談'))).toBe(true);
  await page.evaluate(() => { window.fixture.minutes = { format: 2, parts: ['完成した清書'] }; window.backup.schedule(window.fixture); });
  await page.clock.fastForward(30000); await expect.poll(() => methods.length).toBe(2); await expect(page.locator('#drive-status')).toContainText('保存しました');
  expect(methods).toEqual(['POST', 'PATCH']); expect(archives[1].includes(Buffer.from('完成した清書'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('drive-auto.png') });
});

test('Driveの保存失敗を成功表示せず、端末の記録を残して一括再試行できる', async ({ page }) => {
  await page.route('**/drive-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body><button id="drive-connect"></button><button id="drive-folder"></button><button id="drive-disconnect"></button><input id="drive-auto" type="checkbox"><button id="drive-save">今すぐ保存</button><span id="drive-folder-name"></span><p id="drive-status"></p></body></html>' }));
  await page.route('**/drive-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.route('**/api/drive/status', route => route.fulfill({ json: { configured: true, connected: true, account: 'owner@example.com' } }));
  let calls = 0;
  await page.route('**/api/drive/token', route => { calls++; return route.fulfill({ status: 401, json: { error: 'Google Driveを接続し直してください。' } }); });
  await page.goto('/drive-fixture');
  await page.evaluate(async () => { localStorage.setItem('withviewer-drive:owner@example.com', JSON.stringify({ auto: true, folder: { id: 'folder', name: '保存先' } })); const { createDriveBackup } = await import('/drive-fixture.js'); window.fixture = { id: 'meeting', segments: [{ text: '消してはいけない原本' }] }; window.backup = createDriveBackup({ currentMeeting: () => window.fixture, saveTarget: async () => {} }); await window.backup.initialize(); });
  await page.locator('#drive-save').click(); await expect(page.locator('#drive-status')).toContainText('保存未完了'); await expect(page.locator('#drive-save')).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.segments[0].text)).toBe('消してはいけない原本');
  await page.locator('#drive-save').click(); await expect.poll(() => calls).toBe(2);
});
