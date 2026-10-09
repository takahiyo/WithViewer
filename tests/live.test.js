import test from 'node:test';
import assert from 'node:assert/strict';
import { Consultation } from '../src/live.js';
import { newMeeting, addObservation } from '../src/core.js';

function fixture() {
  let interrupted = 0, closed = 0, stops = 0;
  const sent = [], played = [];
  const live = new Consultation({ changed() {}, status() {}, error() {} });
  live.meeting = newMeeting(); live.state = 'active';
  live.player = { play: x => played.push(x), interrupt: () => interrupted++, close: async () => closed++ };
  live.mic = { stop: async () => stops++ };
  live.session = { sendClientContent: data => sent.push(data), sendToolResponse: data => sent.push(data), close() {} };
  return { live, sent, played, counts: () => ({ interrupted, closed, stops }) };
}
test('対話の入力と出力を相談履歴に残し会議記録を変更しない', () => {
  const { live } = fixture();
  live.message({ serverContent: { inputTranscription: { text: 'どう思う？' } } });
  live.message({ serverContent: { outputTranscription: { text: '私の見方では' }, turnComplete: true } });
  assert.equal(live.meeting.segments.length, 0);
  assert.deepEqual(live.meeting.consultations.map(c => c.role), ['user', 'model']);
});
test('割り込みイベントは再生を停止し途中の応答をマークする', () => {
  const { live, played, counts } = fixture();
  live.message({ serverContent: { outputTranscription: { text: '途中の回答' }, modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] } } });
  live.message({ serverContent: { interrupted: true } });
  assert.deepEqual(played, ['AAAA']); assert.equal(counts().interrupted, 1);
  assert.equal(live.meeting.consultations[0].interrupted, true);
});
test('会議の新しい決定は応答開始せず文脈へ追加され検索できる', () => {
  const { live, sent } = fixture();
  const segment = { id: 'decision', source: 'meeting', start: 20, end: 30, status: 'done', text: 'A案を採用' };
  addObservation(live.meeting, segment); live.updateContext(segment);
  assert.equal(sent[0].turnComplete, false);
  live.message({ toolCall: { functionCalls: [{ id: 'search', name: 'search_meeting', args: { query: 'A案' } }] } });
  assert.equal(sent[1].functionResponses[0].response.evidence[0].id, 'decision');
});
test('対話の終了はマイクと出力を停止し会議記録を保持する', async () => {
  const { live, counts } = fixture();
  addObservation(live.meeting, { id: 'recording', source: 'meeting', start: 0, end: 10, status: 'pending', text: '' });
  await live.stop(); await live.stop();
  assert.equal(live.state, 'idle'); assert.equal(counts().stops, 1); assert.equal(counts().closed, 1);
  assert.equal(live.meeting.segments[0].status, 'pending');
});
