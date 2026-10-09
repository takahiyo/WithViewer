import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingArchive } from '../src/meeting-archive.js';
import { importMeetingArchive, readArchive } from '../src/meeting-import.js';
import { zipImages } from '../src/image-export.js';

function fixture() {
  return { id: 'original', title: '復元会議', createdAt: '2026-10-09T00:00:00Z', endedAt: '2026-10-09T01:00:00Z',
    segments: [{ id: 'a', source: 'meeting', start: 0, end: 10, status: 'done', text: '\n 原文\r\nそのまま ' }, { id: 'b', source: 'meeting', start: 10, end: 20, status: 'pending', text: '' }],
    consultations: [{ id: 'c', source: 'consultation', role: 'user', text: '相談', at: '2026-10-09T00:01:00Z' }],
    visuals: [{ id: 'f', source: 'meeting-visual', at: 5, text: '資料の説明' }], summary: { text: '要約', through: 20 }, minutes: { format: 2, parts: ['清書'] }, driveBackup: { fileId: 'original-drive-file' } };
}
const chunks = [{ id: 'a', start: 0, end: 10, rate: 16000, blob: new Blob(['original-WAV-bytes']) }, { id: 'b', start: 10, end: 20, rate: 16000, blob: new Blob(['retry-WAV-bytes']) }];
const images = [{ id: 'f', at: 5, mimeType: 'image/png', image: 'AQID' }];
test('会議一式ZIPから原音声・画像・文章・相談・清書を回復しIDとDrive保存先を分離する', async () => {
  const archive = await meetingArchive(fixture(), chunks, images);
  const restored = await importMeetingArchive(archive.blob);
  assert.notEqual(restored.meeting.id, 'original'); assert.equal(restored.meeting.driveBackup, undefined);
  assert.equal(restored.meeting.segments[0].text, fixture().segments[0].text);
  assert.equal(restored.meeting.segments[1].status, 'failed');
  assert.equal(restored.audio[0].id, restored.meeting.segments[0].id);
  assert.equal(restored.audio[1].id, restored.meeting.segments[1].id);
  assert.equal(await restored.audio[0].blob.text(), 'original-WAV-bytes');
  assert.equal(restored.frames[0].id, restored.meeting.visuals[0].id); assert.equal(restored.frames[0].image, 'AQID');
  assert.equal(restored.meeting.consultations[0].text, '相談'); assert.equal(restored.meeting.summary.text, '要約'); assert.deepEqual(restored.meeting.minutes.parts, ['清書']);
  assert.equal(restored.missingAudio + restored.missingImages, 0);
  const again = await importMeetingArchive(archive.blob); assert.notEqual(again.meeting.id, restored.meeting.id);
});
test('元からない原本は不足件数を示し、対応表にあるファイルの欠落は拒否する', async () => {
  const archive = await meetingArchive(fixture(), chunks.slice(0, 1), []);
  const restored = await importMeetingArchive(archive.blob); assert.equal(restored.missingAudio, 1); assert.equal(restored.missingImages, 1);
  const files = readArchive(new Uint8Array(await archive.blob.arrayBuffer()));
  const broken = zipImages([...files].filter(([name]) => !name.startsWith('音声/')).map(([name, data]) => ({ name, data })));
  await assert.rejects(importMeetingArchive(broken), /破損/);
});
test('CRC不一致・切断・重複名・相対パス・別用途ZIPを復元しない', async () => {
  const archive = await meetingArchive(fixture(), chunks, images), bytes = new Uint8Array(await archive.blob.arrayBuffer());
  const damaged = bytes.slice(); damaged[100] ^= 1; assert.throws(() => readArchive(damaged), /破損/);
  assert.throws(() => readArchive(bytes.subarray(0, bytes.length - 1)), /破損/);
  for (const names of [['../記録.json'], ['duplicate', 'duplicate']]) {
    const bad = zipImages(names.map(name => ({ name, data: new Uint8Array([1]) })));
    await assert.rejects(importMeetingArchive(bad), /破損/);
  }
  await assert.rejects(importMeetingArchive(zipImages([{ name: '議事録.html', data: new Uint8Array() }])), /破損/);
});
