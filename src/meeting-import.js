import { crc32 } from './image-export.js';
import { validateBackup } from './core.js';

export const ARCHIVE_LIMIT = 600 * 1024 * 1024;
const invalid = () => { throw new Error('会議一式ZIPが破損しているか、対応する保存形式ではありません。Driveからダウンロードした元のZIPを選んでください。'); };

// Read the uncompressed UTF-8 ZIP produced by meetingArchive. Nothing is
// extracted to disk or executed; names, sizes, headers and checksums are checked.
export function readArchive(bytes) {
  if (bytes.length < 22 || bytes.length > ARCHIVE_LIMIT) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = n => { if (n < 0 || n + 2 > bytes.length) invalid(); return view.getUint16(n, true); };
  const u32 = n => { if (n < 0 || n + 4 > bytes.length) invalid(); return view.getUint32(n, true); };
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)) invalid();
  const count = u16(end + 10), start = u32(end + 16), length = u32(end + 12);
  if (!count || count !== u16(end + 8) || start + length !== end) invalid();
  const files = new Map(), decoder = new TextDecoder('utf-8', { fatal: true });
  let cursor = start, localEnd = 0;
  for (let i = 0; i < count; i++) {
    if (u32(cursor) !== 0x02014b50 || u16(cursor + 8) !== 0x800 || u16(cursor + 10) !== 0 || u16(cursor + 34)) invalid();
    const crc = u32(cursor + 16), size = u32(cursor + 20), nameSize = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32), offset = u32(cursor + 42);
    if (size !== u32(cursor + 24) || cursor + 46 + nameSize + extra + comment > end || offset !== localEnd) invalid();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = decoder.decode(nameBytes);
    if (!name || name.startsWith('/') || name.includes('\\') || /[\x00-\x1f]/.test(name) || name.split('/').some(p => p === '.' || p === '..' || !p) || files.has(name)) invalid();
    if (u32(offset) !== 0x04034b50 || u16(offset + 6) !== 0x800 || u16(offset + 8) || u32(offset + 14) !== crc || u32(offset + 18) !== size || u32(offset + 22) !== size || u16(offset + 26) !== nameSize) invalid();
    const dataStart = offset + 30 + nameSize + u16(offset + 28);
    if (dataStart + size > start || decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameSize)) !== name) invalid();
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) invalid();
    files.set(name, data); localEnd = dataStart + size; cursor += 46 + nameSize + extra + comment;
  }
  if (cursor !== end || localEnd !== start) invalid();
  return files;
}

export async function importMeetingArchive(file) {
  if (file.size > ARCHIVE_LIMIT) throw new Error('会議一式ZIPは600MB以内にしてください。');
  const files = readArchive(new Uint8Array(await file.arrayBuffer()));
  const records = [...files].filter(([name]) => name.endsWith('_記録.json') && !name.includes('/'));
  if (records.length !== 1 || records[0][1].length > 20 * 1024 * 1024) invalid();
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(records[0][1]));
  const manifest = value.archive, source = value.meeting;
  if (manifest?.version !== 1 || manifest.meetingId !== source?.id || !Array.isArray(manifest.audio) || !Array.isArray(manifest.images)) invalid();
  const meeting = validateBackup(value), audio = [], frames = [], ids = new Map(), imageIds = new Map(), paths = new Set();
  const sorted = [...source.segments].sort((a, b) => a.start - b.start);
  sorted.forEach((s, i) => { if (ids.has(s.id)) invalid(); ids.set(s.id, meeting.segments[i].id); if (typeof s.error === 'string') meeting.segments[i].error = s.error; });
  (source.visuals || []).forEach((v, i) => { if (typeof v.id !== 'string' || imageIds.has(v.id)) invalid(); imageIds.set(v.id, meeting.visuals[i].id); if (typeof v.capturedAt === 'string') meeting.visuals[i].capturedAt = v.capturedAt; });
  const segmentsById = new Map(source.segments.map(s => [s.id, s])), visualsById = new Map((source.visuals || []).map(v => [v.id, v]));
  const content = (entry, prefix) => {
    if (typeof entry.path !== 'string' || !entry.path.startsWith(prefix) || paths.has(entry.path) || !files.has(entry.path)) invalid();
    paths.add(entry.path); return files.get(entry.path);
  };
  const audioUsed = new Set(), imageUsed = new Set();
  for (const entry of manifest.audio) {
    if (typeof entry.id !== 'string' || audioUsed.has(entry.id) || !Number.isFinite(entry.start) || entry.start < 0 || !Number.isFinite(entry.rate) || entry.rate <= 0 || (entry.end !== undefined && (!Number.isFinite(entry.end) || entry.end < entry.start))) invalid();
    const segment = segmentsById.get(entry.id);
    if (segment && (segment.kind || segment.start !== entry.start || (entry.end !== undefined && segment.end !== entry.end))) invalid();
    audioUsed.add(entry.id);
    const id = ids.get(entry.id) || crypto.randomUUID(), data = content(entry, '音声/');
    audio.push({ id, meetingId: meeting.id, start: entry.start, end: entry.end, rate: entry.rate, blob: new Blob([data], { type: 'audio/wav' }) });
  }
  for (const entry of manifest.images) {
    if (typeof entry.id !== 'string' || imageUsed.has(entry.id) || !Number.isFinite(entry.at) || entry.at < 0 || !['image/png', 'image/jpeg'].includes(entry.mimeType)) invalid();
    const visual = visualsById.get(entry.id);
    if (visual && visual.at !== entry.at) invalid();
    imageUsed.add(entry.id);
    const data = content(entry, 'スクショ/'); let image = '';
    for (let i = 0; i < data.length; i += 32768) image += String.fromCharCode(...data.subarray(i, i + 32768));
    frames.push({ id: imageIds.get(entry.id) || crypto.randomUUID(), meetingId: meeting.id, at: entry.at, mimeType: entry.mimeType, image: btoa(image) });
  }
  if (source.summary != null) {
    if (typeof source.summary.text !== 'string' || !Number.isFinite(source.summary.through) || source.summary.through < 0) invalid();
    meeting.summary = { text: source.summary.text, through: source.summary.through, ...(typeof source.summary.at === 'string' ? { at: source.summary.at } : {}) };
  }
  if (typeof source.endedAt === 'string' && Number.isFinite(Date.parse(source.endedAt))) meeting.endedAt = source.endedAt;
  // Pending work is retained as failed for explicit retry, never auto-submitted.
  const missingAudio = source.segments.filter(s => !s.kind && !audioUsed.has(s.id)).length;
  const missingImages = (source.visuals || []).filter(v => !imageUsed.has(v.id)).length;
  return { meeting, audio, frames, missingAudio, missingImages };
}
