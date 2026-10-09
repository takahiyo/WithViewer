import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualObserver } from '../src/vision.js';
function fixture(overrides = {}) {
  const observations = [], sent = [];
  const observer = new VisualObserver({ readFrame: async () => ({ id: 'frame', image: 'AAAA', mimeType: 'image/jpeg', at: 10 }),
    analyze: async frame => { sent.push(frame); return { text: '資料は100万円' }; },
    observed: frame => observations.push(frame), changed() {}, error() {}, ...overrides });
  return { observer, observations, sent };
}
test('映像オフでは自動送信せず、明示した一枚だけの読取りは許可する', async () => {
  const { observer, observations, sent } = fixture(); observer.setAvailable(true);
  await observer.read(); assert.equal(sent.length, 0);
  await observer.read(true); assert.equal(sent.length, 1); assert.equal(observations[0].text, '資料は100万円');
  assert.equal(observer.timer, undefined);
});
test('キャプチャ中に映像をオフにするとAPIへ送信しない', async () => {
  let resolveFrame;
  const { observer, sent } = fixture({ readFrame: () => new Promise(resolve => resolveFrame = resolve) });
  observer.setAvailable(true); observer.enabled = true;
  const task = observer.read(); observer.setEnabled(false); resolveFrame({ image: 'AAAA' }); await task;
  assert.equal(sent.length, 0); assert.equal(observer.busy, false);
});
test('読取り中の重複送信を防ぎ、オフ後は周期タイマーを残さない', async () => {
  let resolveResponse;
  const { observer } = fixture({ analyze: () => new Promise(resolve => resolveResponse = resolve) });
  observer.setAvailable(true); observer.enabled = true;
  const task = observer.read(); await Promise.resolve(); await observer.read();
  assert.equal(observer.sent, 1); observer.setEnabled(false); resolveResponse({ text: '以前の読取り' }); await task;
  assert.equal(observer.busy, false); assert.equal(observer.enabled, false); assert.equal(observer.sent, 1);
});
test('利用枠の上限では自動読取りをオフにして再送ループを止める', async () => {
  const errors = [];
  const { observer } = fixture({ analyze: async () => { throw Object.assign(new Error('上限'), { status: 429 }); }, error: message => errors.push(message) });
  observer.setAvailable(true); observer.enabled = true; await observer.read();
  assert.equal(observer.enabled, false); assert.equal(observer.sent, 1); assert.match(errors[0], /停止/);
  await observer.read(); assert.equal(observer.sent, 1);
});
