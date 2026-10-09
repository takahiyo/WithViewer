import test from 'node:test';
import assert from 'node:assert/strict';
import { newMeeting, addObservation, addConsultation, contextFor, textChatPayload, searchMeeting, validateBackup, evidence } from '../src/core.js';
import { SampleChunks, pcm16, wav, AudioPlayer } from '../src/audio.js';

test('相談と会議の原発言を分離し、検索結果にAIの意見を含めない', () => {
  const m = newMeeting();
  addObservation(m, { id: 'm1', source: 'meeting', start: 0, end: 10, text: 'A案の予算は100万円', status: 'done' });
  addConsultation(m, 'user', 'B案にしたい'); addConsultation(m, 'model', 'B案なら80万円かもしれません');
  assert.equal(m.segments.length, 1); assert.equal(m.consultations.length, 2);
  assert.deepEqual(searchMeeting(m, 'B案'), []);
  assert.equal(searchMeeting(m, 'A案')[0].id, 'm1');
  assert.throws(() => addObservation(m, { source: 'consultation', start: 0, end: 1 }));
});
test('文字起こし待ちを事実に変換せず、後から到着した会議内容を時刻順に扱う', () => {
  const m = newMeeting();
  addObservation(m, { id: 'm2', source: 'meeting', start: 10, end: 20, text: 'A案を採用', status: 'done' });
  addObservation(m, { id: 'm1', source: 'meeting', start: 0, end: 10, text: '', status: 'pending' });
  const context = JSON.parse(contextFor(m));
  assert.equal(context.recentMeetingEvidence.length, 1); assert.equal(context.unavailable.length, 1);
  m.segments[0].status = 'done'; m.segments[0].text = '当初はB案';
  assert.equal(JSON.parse(contextFor(m)).recentMeetingEvidence.length, 2);
});
test('JSON復元で入力元を検証し、元の記録を上書きせず手入力メモの出典を維持する', () => {
  const m = newMeeting();
  addObservation(m, { id: 'm1', source: 'meeting', kind: 'note', start: 0, end: 0, text: '<script>未確認メモ</script>', status: 'done' });
  addConsultation(m, 'model', '私の意見', true);
  const restored = validateBackup({ version: 1, meeting: m });
  assert.notEqual(restored.id, m.id); assert.equal(restored.consultations[0].interrupted, true);
  assert.match(evidence(restored.segments[0]), /手入力/);
  m.segments[0].source = 'consultation'; assert.throws(() => validateBackup({ version: 1, meeting: m }));
});
test('不規則なパケットと最終部分を分割しても全サンプルが欠落・重複しない', () => {
  const emitted = [];
  const splitter = new SampleChunks(7, (samples, start) => emitted.push({ samples: [...samples], start }));
  splitter.push(Float32Array.from([0, 1, 2])); splitter.push(Float32Array.from([3, 4, 5, 6, 7, 8, 9, 10]));
  splitter.push(Float32Array.from([11, 12, 13, 14, 15, 16])); splitter.flush(); splitter.flush();
  assert.deepEqual(emitted.flatMap(e => e.samples), Array.from({ length: 17 }, (_, i) => i));
  assert.deepEqual(emitted.map(e => e.start), [0, 7, 14]);
});
test('PCMはlittle endianでクリップし、WAVヘッダーがサンプル数に一致する', () => {
  const pcm = pcm16(Float32Array.from([-2, 0, 2]));
  const view = new DataView(pcm.buffer);
  assert.deepEqual([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)], [-32768, 0, 32767]);
  const audio = wav(pcm, 16000), header = new DataView(audio.buffer);
  assert.equal(header.getUint32(24, true), 16000); assert.equal(header.getUint32(40, true), 6);
  assert.deepEqual(audio.slice(44), pcm);
});
test('割り込み時に再生中と予約済み音声をすべて停止し次の再生時刻をリセットする', () => {
  const sources = [];
  const context = { currentTime: 10, destination: {}, createBuffer: (_, n) => ({ getChannelData: () => new Float32Array(n), duration: n / 24000 }),
    createBufferSource() { const s = { connect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } }; sources.push(s); return s; } };
  const player = new AudioPlayer(context);
  player.play(btoa('\0\0')); player.play(btoa('\0\0'));
  assert.ok(sources[1].at > sources[0].at); player.interrupt();
  assert.ok(sources.every(s => s.stopped)); assert.equal(player.sources.size, 0); assert.equal(player.next, 10);
});
test('テキスト相談は共有履歴を保ち、履歴と会議文脈を重複させずに渡す', () => {
  const m = newMeeting();
  addObservation(m, { id: 'm1', source: 'meeting', start: 10, end: 20, status: 'done', text: 'A案は100万円' });
  addConsultation(m, 'user', 'どう思う？'); addConsultation(m, 'model', '費用を確認したいです。');
  const payload = textChatPayload(m, 'A案');
  assert.equal(payload.history.length, 2); assert.equal(payload.message, 'A案');
  const context = JSON.parse(payload.context);
  assert.equal(context.consultationHistory, undefined); assert.equal(context.matchingPastEvidence[0].id, 'm1');
  assert.equal(m.segments.length, 1); assert.equal(m.consultations.length, 2);
});
