import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { meetingArchive } from '../../src/meeting-archive.js';
import { build } from 'esbuild';

test('Drive会議一式ZIPを復元し、再読込み後も原音声・画像を取得して未変換音声を再試行できる', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  await page.goto('/'); await expect(page.locator('#title')).toHaveValue('新しい会議');
  const source = { id: 'backup-source', title: 'Drive復元試験', createdAt: '2026-10-09T00:00:00Z', endedAt: '2026-10-09T00:01:00Z', segments: [{ id: 'raw', source: 'meeting', start: 0, end: 10, text: '原文を保持', status: 'done' }, { id: 'retry', source: 'meeting', start: 10, end: 20, text: '', status: 'failed' }], consultations: [{ source: 'consultation', role: 'user', text: '別の相談' }], visuals: [{ id: 'image', source: 'meeting-visual', at: 5, text: '図の説明' }], minutes: { format: 2, parts: ['清書の文章'] }, summary: { text: '保存した要約', through: 20 } };
  const archive = await meetingArchive(source, [{ id: 'raw', start: 0, end: 10, rate: 16000, blob: new Blob(['raw-original']) }, { id: 'retry', start: 10, end: 20, rate: 16000, blob: new Blob(['retry-original']) }], [{ id: 'image', at: 5, mimeType: 'image/png', image: 'AQID' }]);
  await page.locator('#import').setInputFiles({ name: archive.name, mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
  await expect(page.locator('#notice')).toContainText('音声2件・画像1枚'); await expect(page.locator('#title')).toHaveValue(source.title);
  await expect(page.locator('#meetings option')).toHaveCount(2);
  await page.reload(); await page.locator('#meetings').selectOption({ label: source.title }); await expect(page.locator('#title')).toHaveValue(source.title); await expect(page.locator('#minutes')).toContainText('清書の文章'); await expect(page.locator('#summary')).toContainText('保存した要約');
  const restored = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('withviewer'); r.onsuccess = () => resolve(r.result); });
    const all = store => new Promise(resolve => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const audio = await all('audio'), frames = await all('frames'), meetings = await all('meetings'); db.close();
    return { audio: await Promise.all(audio.map(async a => ({ id: a.id, text: await a.blob.text(), meetingId: a.meetingId }))), frames, meeting: meetings.find(m => m.title === 'Drive復元試験') };
  });
  expect(restored.audio.map(a => a.text).sort()).toEqual(['raw-original', 'retry-original']);
  expect(restored.frames[0].image).toBe('AQID'); expect(restored.frames[0].id).toBe(restored.meeting.visuals[0].id);
  expect(restored.audio.find(a => a.text === 'retry-original').id).toBe(restored.meeting.segments[1].id);
  expect(restored.meeting.id).not.toBe('backup-source');
  let received = false;
  await page.route('**/api/transcribe', route => { received = true; expect(route.request().postDataJSON().audio).toBe(Buffer.from('retry-original').toString('base64')); return route.fulfill({ json: { text: '復元音声を変換' } }); });
  await page.locator('#retry-all').click(); await expect(page.locator('#segments')).toContainText('復元音声を変換'); expect(received).toBe(true);
});

test('復元の保存失敗は会議・音声・画像の全書込みを取り消し既存原本を守る', async ({ page }) => {
  const storage = (await build({ entryPoints: ['src/storage.js'], bundle: true, format: 'esm', write: false })).outputFiles[0].text;
  await page.route('**/storage-test.js', route => route.fulfill({ contentType: 'text/javascript', body: storage }));
  await page.goto('/'); await expect(page.locator('#title')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { saveAudio, restoreArchive, listMeetings, getAudio, getFrame } = await import('/storage-test.js');
    await saveAudio({ id: 'collision', meetingId: 'existing', blob: new Blob(['protected']) });
    let rejected = false;
    try { await restoreArchive({ meeting: { id: 'should-not-exist' }, audio: [{ id: 'new-audio', blob: new Blob(['new']) }, { id: 'collision', blob: new Blob(['overwrite']) }], frames: [{ id: 'new-image' }] }); } catch { rejected = true; }
    return { rejected, partial: (await listMeetings()).some(m => m.id === 'should-not-exist'), audio: !!await getAudio('new-audio'), image: !!await getFrame('new-image'), original: await (await getAudio('collision')).blob.text() };
  });
  expect(result).toEqual({ rejected: true, partial: false, audio: false, image: false, original: 'protected' });
});

test('ポリシーと規約はログイン前から開けて運営者とデータの取扱いを表示する', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { authProvider: 'firebase', firebase: null, setupError: '未設定' } }));
  await page.goto('/'); await expect(page.getByRole('link', { name: 'プライバシーポリシー', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'プライバシーポリシー', exact: true }).click(); await expect(page.locator('h1')).toHaveText('プライバシーポリシー'); await expect(page.locator('main')).toContainText('Flateight'); await expect(page.locator('main')).toContainText('drive.file');
  await page.getByRole('link', { name: '利用規約', exact: true }).click(); await expect(page.locator('h1')).toHaveText('利用規約'); await expect(page.getByRole('link', { name: 'withviewer@flateight.jp' })).toHaveAttribute('href', 'mailto:withviewer@flateight.jp');
});

async function seedReportMeeting(page, texts = ['', '', '']) {
  await page.route('**/api/config', route => route.fulfill({ json: { configured: true } }));
  await page.goto('/'); await expect(page.locator('#title')).toHaveValue('新しい会議');
  await page.evaluate(async texts => {
    const db = await new Promise(resolve => { const r = indexedDB.open('withviewer'); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => {
      const tx = db.transaction(['meetings', 'audio', 'frames'], 'readwrite');
      tx.objectStore('meetings').clear();
      const segments = texts.map((text, i) => ({ id: `s${i}`, source: 'meeting', start: i * 10, end: i * 10 + 10, text, status: text ? 'done' : 'failed' }));
      tx.objectStore('meetings').put({ id: 'fixture', title: '企画会議', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), segments,
        consultations: [{ role: 'user', text: '個人の相談', at: new Date().toISOString() }], visuals: [{ id: 'frame', source: 'meeting-visual', at: 15, text: '予算100万円の図' }] });
      for (const s of segments) tx.objectStore('audio').put({ id: s.id, meetingId: 'fixture', start: s.start, rate: 16000, blob: new Blob(['synthetic audio']) });
      tx.objectStore('frames').put({ id: 'frame', meetingId: 'fixture', at: 15, mimeType: 'image/png', image: 'iVBORw==' });
      tx.oncomplete = resolve;
    }); db.close();
  }, texts);
  await page.reload(); await expect(page.locator('#title')).toHaveValue('企画会議');
}

test('一括再試行は共通の待機時間と回数制限を守り、障害が続けば残りの音声を保存したまま停止する', async ({ page }) => {
  await seedReportMeeting(page);
  await page.clock.install();
  let attempts = 0, recovered = false;
  await page.route('**/api/transcribe', route => { attempts++; return recovered ? route.fulfill({ json: { text: `回復した発言${attempts}` } }) : route.fulfill({ status: 503, json: { error: 'Gemini側の一時的な障害' } }); });
  await page.locator('#retry-all').click();
  await expect(page.locator('#transcription-status')).toContainText('30秒後'); expect(attempts).toBe(1);
  await page.clock.fastForward(29999); expect(attempts).toBe(1);
  await page.clock.fastForward(1); await expect(page.locator('#transcription-status')).toContainText('120秒後'); expect(attempts).toBe(2);
  await page.clock.fastForward(120000); await expect(page.locator('#transcription-status')).toContainText('自動送信を停止'); expect(attempts).toBe(3);
  await expect(page.locator('#segments .failed')).toHaveCount(3);
  recovered = true; await page.locator('#retry-all').click();
  await expect(page.locator('#pending')).toHaveText('文字起こし 0件待ち'); await expect(page.locator('#segments .failed')).toHaveCount(0); expect(attempts).toBe(6);
  await page.reload(); await expect(page.locator('#segments')).toContainText('回復した発言6');
});

test('自動再試行で一時障害が回復したら次の区間も処理する', async ({ page }) => {
  await seedReportMeeting(page); await page.clock.install(); let attempts = 0;
  await page.route('**/api/transcribe', route => { attempts++; return attempts === 1 ? route.fulfill({ status: 502, body: '<html>Bad gateway</html>' }) : route.fulfill({ json: { text: '回復した原発言' } }); });
  await page.locator('#retry-all').click(); await expect(page.locator('#transcription-status')).toContainText('30秒後');
  await page.clock.fastForward(30000); await expect(page.locator('#segments .failed')).toHaveCount(0);
  await expect(page.locator('#pending')).toHaveText('文字起こし 0件待ち'); expect(attempts).toBe(4);
});

test('議事録は途中成功を保持して再開し、原文・未完了区間・画像を同じZIPへ保存する', async ({ page }, testInfo) => {
  await seedReportMeeting(page, ['発言A'.repeat(4000), '発言B'.repeat(4000), '']);
  let calls = 0;
  await page.route('**/api/minutes', route => {
    calls++;
    expect(route.request().postDataJSON().evidence).not.toContain('個人の相談');
    return calls === 2 ? route.fulfill({ status: 503, json: { error: '一時障害' } }) : route.fulfill({ json: { text: `整文結果${calls}` } });
  });
  await page.locator('#create-minutes').click(); await expect(page.locator('#notice')).toHaveText('一時障害');
  await page.reload(); await expect(page.locator('#minutes')).toContainText('整文結果1');
  await page.locator('#create-minutes').click(); await expect(page.locator('#notice')).toContainText('清書を保存'); expect(calls).toBe(3);
  await expect(page.locator('#minutes')).toContainText('整文結果3');
  await expect(page.locator('#minutes')).toContainText('文字起こし未完了');
  const pending = page.waitForEvent('download'); await page.locator('#download-minutes').click(); const download = await pending;
  expect(download.suggestedFilename()).toBe('企画会議_議事録.zip');
  const path = testInfo.outputPath('minutes.zip'); await download.saveAs(path);
  const zip = await readFile(path); const entries = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), nameSize = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'), start = offset + 30 + nameSize + extra;
    entries.set(name, zip.subarray(start, start + size)); offset = start + size;
  }
  expect(entries.size).toBe(3);
  const markdown = entries.get('企画会議_議事録.md').toString('utf8');
  expect(markdown).toContain('整文結果1'); expect(markdown).toContain('整文結果3'); expect(markdown).toContain('予算100万円の図'); expect(markdown).toContain('2. 音声原本'); expect(markdown).toContain('発言A'.repeat(4000)); expect(markdown).not.toContain('個人の相談');
  expect(entries.has('スクショ/企画会議_00-00-15-000.png')).toBe(true);
  const html = entries.get('企画会議_議事録.html').toString('utf8'); expect(html).toContain('src="スクショ/企画会議_00-00-15-000.png"');
  await expect(page.locator('.minutes-copy')).toHaveText('整文結果1整文結果3');
  await page.getByRole('link', { name: '2. 音声原本', exact: true }).click();
  await expect(page.locator('.minutes-raw pre').first()).toHaveText('発言A'.repeat(4000));
  await page.getByRole('link', { name: '1. 清書', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('minutes-layout.png'), fullPage: false });
});

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
    return attempts === 1 ? route.fulfill({ status: 400, json: { error: 'テスト用の形式エラー' } }) : route.fulfill({ json: { text: 'A案を採用する。' } });
  });
  await page.route('**/api/live-token', route => route.fulfill({ status: 503, json: { error: 'テスト用の対話接続失敗' } }));
  await page.goto('/'); await page.locator('#record').click();
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await page.locator('#talk').click(); await expect(page.locator('#notice')).toContainText('対話接続失敗');
  await expect(page.locator('#record-badge')).toHaveText('記録中');
  await expect(page.locator('#stop-record')).toBeEnabled();
  await expect(page.locator('#segments')).toContainText('文字起こし未完了', { timeout: 20000 });
  await page.getByRole('button', { name: '再試行', exact: true }).click(); await expect(page.locator('#segments')).toContainText('A案を採用する。');
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
  await page.locator('#title').fill('企画/会議'); await page.locator('#title').blur();
  await page.locator('summary').filter({ hasText: '映像の読取り記録' }).click();
  const imageDownload = page.waitForEvent('download'); await page.locator('#download-images').click();
  const archive = await imageDownload;
  expect(archive.suggestedFilename()).toBe('企画_会議_画像.zip');
  await archive.saveAs(testInfo.outputPath('meeting-images.zip'));
  await expect(page.locator('#notice')).toContainText('2枚の画像をZIPに保存');
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
