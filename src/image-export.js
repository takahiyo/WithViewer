// JPEGs are already compressed. Store them in a standard UTF-8 ZIP without
// another compression pass or a network request.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function safeMeetingName(title) {
  return String(title || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim().replace(/[. ]+$/, '').slice(0, 80).replace(/[. ]+$/, '') || '会議';
}
export function elapsedFilename(seconds) {
  const ms = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const pad = (value, digits = 2) => String(value).padStart(digits, '0');
  return `${pad(Math.floor(ms / 3600000))}-${pad(Math.floor(ms / 60000) % 60)}-${pad(Math.floor(ms / 1000) % 60)}-${pad(ms % 1000, 3)}`;
}
export function imageFiles(title, frames) {
  const name = safeMeetingName(title), used = new Map();
  return [...frames].sort((a, b) => a.at - b.at).map(frame => {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png' }[frame.mimeType];
    if (!extension) throw new Error('保存画像の形式を確認してください。');
    const base = `${name}_${elapsedFilename(frame.at)}`;
    const count = (used.get(base) || 0) + 1; used.set(base, count);
    const data = Uint8Array.from(atob(frame.image), c => c.charCodeAt(0));
    return { name: `${base}${count > 1 ? `_${String(count).padStart(2, '0')}` : ''}.${extension}`, data };
  });
}
export function zipImages(files) {
  if (!files.length) throw new Error('保存した会議画像がありません。');
  if (files.length > 65535) throw new Error('画像の枚数がZIPの上限を超えています。');
  const parts = [], central = []; let offset = 0, directorySize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = file.data;
    if (name.length > 65535 || data.length > 0xffffffff || offset + 30 + name.length + data.length > 0xffffffff)
      throw new Error('画像の合計サイズがZIPの上限を超えています。');
    const crc = crc32(data);
    const local = new Uint8Array(30), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true); view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
    parts.push(local, name, data);
    const header = new Uint8Array(46), entry = new DataView(header.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true); entry.setUint16(14, 33, true); entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    central.push(header, name); directorySize += header.length + name.length;
    offset += local.length + name.length + data.length;
  }
  if (offset + directorySize + 22 > 0xffffffff) throw new Error('画像の合計サイズがZIPの上限を超えています。');
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
