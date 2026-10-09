import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMeetingName, elapsedFilename, imageFiles, zipImages } from '../src/image-export.js';

test('画像名は会議名と経過時間を使い禁止文字を置換し同時刻の重複を避ける', () => {
  assert.equal(safeMeetingName('  企画/会議:*?  '), '企画_会議___');
  assert.equal(safeMeetingName('...'), '会議');
  assert.equal(elapsedFilename(3661.125), '01-01-01-125');
  assert.equal(elapsedFilename(59.9996), '00-01-00-000');
  const frames = [2, 1, 1].map(at => ({ at, image: 'AP/+', mimeType: 'image/jpeg' }));
  const files = imageFiles('企画/会議', frames);
  assert.deepEqual(files.map(f => f.name), ['企画_会議_00-00-01-000.jpg', '企画_会議_00-00-01-000_02.jpg', '企画_会議_00-00-02-000.jpg']);
  assert.deepEqual([...files[0].data], [0, 255, 254]);
  assert.throws(() => imageFiles('会議', [{ at: 0, image: '', mimeType: 'text/html' }]), /形式/);
});

test('ZIPはUTF-8名と元画像のバイト列を保持し既知のCRC32を格納する', async () => {
  const name = '企画会議_00-01-30-000.jpg';
  const data = new TextEncoder().encode('123456789');
  const blob = zipImages([{ name, data }]);
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(blob.type, 'application/zip');
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  const size = view.getUint16(26, true);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + size)), name);
  assert.deepEqual(bytes.slice(30 + size, 30 + size + data.length), data);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 1);
  const directory = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(directory, true), 0x02014b50);
  assert.equal(view.getUint32(directory + 42, true), 0);
  assert.throws(() => zipImages([]), /画像がありません/);
});
