import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('公開版の未設定時はGoogleログイン案内を表示し会議操作を隠す', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { authProvider: 'firebase', firebase: null, setupError: 'Firebaseログインの設定が未完了です。' } }));
  await page.goto('/');
  await expect(page.locator('#login-panel')).toBeVisible();
  await expect(page.locator('#app-main')).toBeHidden();
  await expect(page.locator('#google-login')).toBeDisabled();
  await expect(page.locator('#login-status')).toContainText('設定が未完了');
});

test('公開版はFirebaseを初期化し未ログインなら会議APIを送信しない', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let apiCalls = 0;
  await page.route('**/api/session', route => { apiCalls++; return route.fulfill({ status: 401, json: {} }); });
  await page.route('**/api/config', route => route.fulfill({ json: { authProvider: 'firebase', firebase: {
    apiKey: 'public-test-key', projectId: 'withviewer-test', appId: 'test-app', authDomain: 'withviewer-test.firebaseapp.com'
  } } }));
  await page.goto('/');
  await expect(page.locator('#login-status')).toContainText('Googleアカウントでログインしてください。');
  await expect(page.locator('#google-login')).toBeEnabled();
  await expect(page.locator('#app-main')).toBeHidden();
  expect(apiCalls).toBe(0); expect(errors).toEqual([]);
});

async function syntheticMedia(page) {
  await page.addInitScript(() => {
    function audioStream() {
      const context = new AudioContext(); const oscillator = context.createOscillator();
      oscillator.frequency.value = 220;
      const destination = context.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start(); context.resume();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); context.close(); };
      }
      return destination.stream;
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      const stream = audioStream(); const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
      const paint = canvas.getContext('2d'); paint.fillStyle = '#fff'; paint.fillRect(0, 0, 100, 100); paint.fillStyle = '#000'; paint.fillText('Plan A', 10, 50);
      stream.addTrack(canvas.captureStream(1).getVideoTracks()[0]); return stream;
    };
    navigator.mediaDevices.getUserMedia = async () => audioStream();
  });
}

test('音声API上限では自動送信を止め、録音の保存と失敗理由を維持して再試行できる', async ({ page }) => {
  await syntheticMedia(page);
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  let attempts = 0;
  await page.route('**/api/transcribe', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 429, json: { error: 'Geminiの利用枠または呼び出し頻度の上限です。' } }) : route.fulfill({ json: { text: '再試行で回復した発言' } });
  });
  await page.goto('/'); await page.locator('#record').click();
  await expect(page.locator('#transcription-status')).toContainText('API上限', { timeout: 20000 });
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await expect(page.locator('#segments')).toContainText('呼び出し頻度の上限');
  await page.locator('#stop-record').click();
  await expect(page.locator('#segments .entry')).toHaveCount(2);
  expect(attempts).toBe(1);
  await expect(page.locator('#segments')).toContainText('録音音声は保存');
  const savedCount = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('withviewer'); r.onsuccess = () => resolve(r.result); });
    return new Promise(resolve => { const r = db.transaction('audio').objectStore('audio').count(); r.onsuccess = () => { db.close(); resolve(r.result); }; });
  });
  expect(savedCount).toBe(2);
  await page.reload(); await expect(page.locator('#segments')).toContainText('呼び出し頻度の上限');
  await page.getByRole('button', { name: '再試行', exact: true }).first().click();
  await expect(page.locator('#segments')).toContainText('再試行で回復した発言');
  expect(attempts).toBe(2);
});

test('初期表示、メモ検索、保存・再読込、書き出し・復元、狭い画面', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#connection')).toHaveText('APIキー未設定');
  await expect(page.locator('#talk')).toBeDisabled();
  await expect(page.locator('#send-chat')).toBeDisabled();
  await page.locator('#title').fill('企画会議'); await page.locator('#title').blur();
  await page.locator('summary').filter({ hasText: '会議メモを追加' }).click();
  await page.locator('#note').fill('A案の予算は100万円。来週再検討する。');
  await page.getByRole('button', { name: '会議記録に追加' }).click();
  await expect(page.locator('#segments')).toContainText('100万円');
  await page.locator('#query').fill('予算'); await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.locator('#results')).toContainText('100万円');
  await expect(page.locator('#consultations')).not.toContainText('100万円');
  await page.reload(); await expect(page.locator('#title')).toHaveValue('企画会議'); await expect(page.locator('#segments')).toContainText('100万円');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); const backup = await download;
  const path = testInfo.outputPath('record.json'); await backup.saveAs(path);
  await page.locator('#new').click(); await expect(page.locator('#segments')).not.toContainText('100万円');
  await page.locator('#import').setInputFiles(path); await expect(page.locator('#segments')).toContainText('100万円');
  await expect(page.locator('#segments')).toContainText('手入力');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('会議の連続音声を保存し、対話接続の失敗後も記録を続ける', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await syntheticMedia(page);
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  let attempts = 0;
  await page.route('**/api/transcribe', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 502, json: { error: 'テスト用の一時的な失敗' } }) : route.fulfill({ json: { text: 'A案を採用する。' } });
  });
  await page.route('**/api/live-token', route => route.fulfill({ status: 503, json: { error: 'テスト用の対話接続失敗' } }));
  await page.goto('/'); await page.locator('#record').click();
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await page.locator('#talk').click(); await expect(page.locator('#notice')).toContainText('対話接続失敗');
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await expect(page.locator('#stop-record')).toBeEnabled();
  await expect(page.locator('#segments')).toContainText('文字起こし未完了', { timeout: 20000 });
  await page.getByRole('button', { name: '再試行' }).click(); await expect(page.locator('#segments')).toContainText('A案を採用する。');
  await page.locator('#stop-record').click(); await expect(page.locator('#record-badge')).toHaveText('待機中');
  await expect(page.locator('#pending')).toHaveText('文字起こし 0件待ち');
  const download = page.waitForEvent('download'); await page.locator('#download-audio').click();
  const audio = await download; expect(audio.suggestedFilename()).toBe('withviewer-meeting.wav');
  const chunks = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('withviewer'); r.onsuccess = () => resolve(r.result); });
    return new Promise(resolve => { const r = db.transaction('audio').objectStore('audio').getAll(); r.onsuccess = () => resolve(r.result.map(c => ({ start: c.start, size: c.blob.size, rate: c.rate }))); });
  });
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  const sorted = chunks.sort((a, b) => a.start - b.start);
  expect(sorted[0].size).toBe(44 + sorted[0].rate * 10 * 2);
  expect(sorted[1].start).toBe(10);
  await page.reload(); await expect(page.locator('#segments')).toContainText('A案を採用する。');
  expect(errors).toEqual([]);
});
test('マイクを使わずテキストで相談し、続く質問と保存後にも相談履歴を引き継ぐ', async ({ page }, testInfo) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error('テキスト相談ではマイクを使わない'); }; });
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  const requests = [];
  await page.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { text: requests.length === 1 ? '会議メモではA案は100万円です。私の見方では費用の確認が必要です。' : '先ほどの費用の懸念について、根拠はA案の100万円です。' } });
  });
  await page.goto('/'); await expect(page.locator('#send-chat')).toBeEnabled();
  await page.locator('summary').filter({ hasText: '会議メモを追加' }).click(); await page.locator('#note').fill('A案は100万円');
  await page.getByRole('button', { name: '会議記録に追加' }).click();
  await page.locator('#chat-message').fill('今の説明、どう思う？'); await page.locator('#send-chat').click();
  await expect(page.locator('#consultations')).toContainText('費用の確認が必要');
  await expect(page.locator('#chat-message')).toHaveValue('');
  await expect(page.locator('#segments')).not.toContainText('費用の確認が必要');
  await page.locator('#chat-message').fill('なぜ？'); await page.locator('#chat-message').press('Control+Enter');
  await expect(page.locator('#consultations')).toContainText('先ほどの費用の懸念');
  expect(requests[0].history).toEqual([]); expect(requests[0].context).toContain('100万円');
  expect(requests[1].history.map(c => c.role)).toEqual(['user', 'model']);
  await page.reload(); await expect(page.locator('#consultations')).toContainText('先ほどの費用の懸念');
  await page.locator('#chat-message').fill('もう一度確認したい'); await page.locator('#send-chat').click();
  await expect.poll(() => requests.length).toBe(3); expect(requests[2].history.length).toBe(4);
  await expect(page.locator('#send-chat')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('text-chat.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('テキスト相談の失敗時も相談文を保持し、録音の継続を妨げない', async ({ page }) => {
  await syntheticMedia(page);
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  await page.route('**/api/chat', route => route.fulfill({ status: 429, json: { error: '利用枠の上限です。' } }));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: '会議の発言' } }));
  await page.goto('/'); await page.locator('#record').click(); await expect(page.locator('#record-badge')).toHaveText('記録中');
  await page.locator('#chat-message').fill('予算について教えて'); await page.locator('#send-chat').click();
  await expect(page.locator('#notice')).toContainText('利用枠');
  await expect(page.locator('#chat-message')).toHaveValue('予算について教えて');
  await expect(page.locator('#consultations')).toContainText('予算について教えて');
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await page.locator('#stop-record').click(); await expect(page.locator('#record-badge')).toHaveText('待機中');
});
test('記録中に映像をオン・オフでき、オフでは添付を止め、単発読取りと記録を保存する', async ({ page }, testInfo) => {
  await syntheticMedia(page);
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: '会議の音声' } }));
  const images = [], chats = [];
  await page.route('**/api/observe-frame', route => { images.push(route.request().postDataJSON()); return route.fulfill({ json: { text: '画面にPlan Aと表示されています。' } }); });
  await page.route('**/api/chat', route => { chats.push(route.request().postDataJSON()); return route.fulfill({ json: { text: '静止画にはPlan Aが見えます。' } }); });
  await page.goto('/'); await page.locator('#record').click(); await expect(page.locator('#record-badge')).toHaveText('記録中');
  expect(images.length).toBe(0);
  await page.locator('#vision-enabled').check(); await expect(page.locator('#visuals')).toContainText('Plan A');
  expect(images.length).toBe(1); expect(images[0].mimeType).toBe('image/jpeg');
  await writeFile(testInfo.outputPath('synthetic-frame.jpg'), Buffer.from(images[0].image, 'base64'));
  await page.locator('#chat-message').fill('何が映っている？'); await page.locator('#send-chat').click();
  await expect(page.locator('#send-chat')).toBeEnabled(); expect(chats[0].frame.mimeType).toBe('image/jpeg');
  await page.locator('#vision-enabled').uncheck(); await expect(page.locator('#vision-status')).toContainText('映像オフ');
  await page.locator('#chat-message').fill('前の画面を振り返りたい'); await page.locator('#send-chat').click();
  await expect(page.locator('#send-chat')).toBeEnabled(); expect(chats[1].frame).toBeUndefined(); expect(chats[1].context).toContain('Plan A');
  await page.locator('#read-frame').click(); await expect(page.locator('#vision-status')).toContainText('送信 2枚');
  await expect(page.locator('#read-frame')).toBeEnabled(); expect(images.length).toBe(2);
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await page.locator('#stop-record').click(); await expect(page.locator('#record-badge')).toHaveText('待機中');
  await page.locator('summary').filter({ hasText: '映像の読取り記録' }).click();
  await page.screenshot({ path: testInfo.outputPath('vision.png'), fullPage: true });
  await page.reload(); await expect(page.locator('#visuals')).toContainText('Plan A');
  await expect(page.locator('#vision-enabled')).not.toBeChecked();
});
test('既存の保存形式から更新しても会議と音声を保持する', async ({ page }) => {
  const root = 'http://127.0.0.1:5174/';
  await page.route(root, route => route.fulfill({ contentType: 'text/html', body: '<html><body>Migration fixture</body></html>' }));
  await page.goto('/');
  await page.evaluate(async () => {
    const db = await new Promise(resolve => {
      const request = indexedDB.open('withviewer', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('meetings', { keyPath: 'id' }); const audio = request.result.createObjectStore('audio', { keyPath: 'id' }); audio.createIndex('meetingId', 'meetingId'); };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise(resolve => {
      const tx = db.transaction(['meetings', 'audio'], 'readwrite');
      tx.objectStore('meetings').put({ id: 'old-meeting', title: '以前の会議', createdAt: new Date().toISOString(), endedAt: null, summary: null,
        segments: [{ id: 'audio1', source: 'meeting', start: 0, end: 10, text: '以前の発言', status: 'done' }], consultations: [] });
      tx.objectStore('audio').put({ id: 'audio1', meetingId: 'old-meeting', blob: new Blob(['audio']), start: 0, rate: 16000 });
      tx.oncomplete = resolve;
    }); db.close();
  });
  await page.unroute(root); await page.reload();
  await expect(page.locator('#title')).toHaveValue('以前の会議'); await expect(page.locator('#segments')).toContainText('以前の発言');
  const data = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('withviewer'); request.onsuccess = () => resolve(request.result); });
    return new Promise(resolve => { const request = db.transaction('audio').objectStore('audio').get('audio1'); request.onsuccess = () => resolve({ version: db.version, audio: request.result.blob.size, frames: db.objectStoreNames.contains('frames') }); });
  });
  expect(data).toEqual({ version: 2, audio: 5, frames: true });
});
