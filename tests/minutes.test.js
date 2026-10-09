import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesBatches, minutesDocument, minutesFingerprint } from '../src/minutes.js';
import { retryDelay } from '../src/transcription-retry.js';
import { createApi } from '../cloudflare/api.js';
import { newMeeting, validateBackup } from '../src/core.js';

test('自動再試行は一時障害だけを間隔付きで2回まで処理し認証・利用枠・実行上限を再送しない', () => {
  for (const error of [{ status: 503 }, { status: 502 }, { name: 'TypeError' }, { name: 'TimeoutError' }]) {
    assert.equal(retryDelay(error, 0), 30000); assert.equal(retryDelay(error, 1), 120000); assert.equal(retryDelay(error, 2), null);
  }
  for (const error of [{ status: 429 }, { status: 401 }, { status: 400 }, { status: 500, code: '1102' }, { status: 503, message: 'APIキーが未設定です。' }]) assert.equal(retryDelay(error, 0), null);
});
test('長い会議を切り捨てず分割し相談・メモ・未完了区間を整文に混ぜない', async () => {
  const segments = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, start: i * 10, end: i * 10 + 10, status: 'done', text: `発言${i}：${'詳細'.repeat(400)}` }));
  const meeting = { title: '会議', segments, consultations: [{ text: '相談の秘密' }], visuals: [] };
  const batches = minutesBatches(meeting);
  assert.ok(batches.length > 1); assert.ok(batches.every(b => b.length <= 18000));
  for (const s of segments) assert.ok(batches.join('\n').includes(s.text));
  const before = await minutesFingerprint(meeting); segments[0].text = '訂正した発言';
  assert.notEqual(await minutesFingerprint(meeting), before);
  meeting.segments.push({ id: 'gap', start: 800, end: 810, text: '', status: 'failed' }, { id: 'note', start: 810, end: 810, text: '手入力内容', kind: 'note', status: 'done' });
  assert.ok(!minutesBatches(meeting).join('').includes('手入力内容'));
  meeting.visuals = [{ id: 'image', at: 20, text: '図の内容（AI読取り）' }];
  const document = minutesDocument(meeting, { parts: ['整文済み', null] }, new Map([['image', 'image.jpg']]));
  assert.match(document, /未完了/); assert.match(document, /対応は未確認/); assert.match(document, /image.jpg/); assert.match(document, /手入力内容/); assert.match(document, /訂正した発言/); assert.doesNotMatch(document, /相談の秘密/);
});
test('議事録APIは整文の指示を用い、入力上限と途中切れを検出する', async () => {
  let calls = 0, options, finishReason = 'STOP';
  const api = createApi({ provider: { models: { generateContent: async input => { calls++; options = input; return { text: '整文結果', candidates: [{ finishReason }] }; } } } });
  assert.equal((await api.handle('/api/minutes', 'POST', { evidence: 'a'.repeat(18001) })).status, 400); assert.equal(calls, 0);
  const result = await api.handle('/api/minutes', 'POST', { evidence: '[00:10] 原発言' });
  assert.equal((await result.json()).text, '整文結果'); assert.match(options.config.systemInstruction, /要約ではなく/);
  finishReason = 'MAX_TOKENS'; await assert.rejects(api.handle('/api/minutes', 'POST', { evidence: '原発言' }), { status: 502 });
});
test('JSON復元でも議事録の部分成功を保持し、整文の不正形式を拒否する', () => {
  const meeting = newMeeting(); meeting.minutes = { parts: ['成功した部分', null], fingerprint: 'old', at: '2026-10-09' };
  const restored = validateBackup({ version: 1, meeting });
  assert.deepEqual(restored.minutes.parts, meeting.minutes.parts); assert.equal(restored.minutes.fingerprint, '');
  meeting.minutes.parts.push({ text: '不正' }); assert.throws(() => validateBackup({ version: 1, meeting }), /議事録の形式/);
});
