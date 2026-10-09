import { imageFiles, zipImages, safeMeetingName, elapsedFilename } from './image-export.js';
import { minutesHtml, minutesDocument } from './minutes-layout.js';

export async function meetingArchive(meeting, audio, frames) {
  const snapshot = structuredClone(meeting); delete snapshot.driveBackup;
  const name = safeMeetingName(snapshot.title), encoder = new TextEncoder();
  const sortedFrames = [...frames].sort((a, b) => a.at - b.at), files = imageFiles(name, sortedFrames);
  files.forEach(file => { file.name = `スクショ/${file.name}`; });
  const images = new Map(sortedFrames.map((frame, i) => [frame.id, files[i].name]));
  const manifest = { version: 1, meetingId: snapshot.id, audio: [], images: sortedFrames.map(frame => ({ id: frame.id, at: frame.at, mimeType: frame.mimeType, path: images.get(frame.id) })), missingAudio: [], missingImages: [] };
  let bytes = files.reduce((sum, file) => sum + file.data.length, 0);
  if (bytes > 512 * 1024 * 1024) throw new Error('一括保存は512MBまでです。画像を個別に保存してください。');
  for (const [i, chunk] of [...audio].sort((a, b) => a.start - b.start).entries()) {
    bytes += chunk.blob.size;
    if (bytes > 512 * 1024 * 1024) throw new Error('一括保存は512MBまでです。音声と画像を個別に保存してください。ローカルの記録は残っています。');
    const path = `音声/${name}_${elapsedFilename(chunk.start)}_${String(i + 1).padStart(5, '0')}.wav`;
    files.push({ name: path, data: new Uint8Array(await chunk.blob.arrayBuffer()) });
    manifest.audio.push({ id: chunk.id, start: chunk.start, end: chunk.end, rate: chunk.rate, path });
  }
  const audioIds = new Set(audio.map(chunk => chunk.id));
  manifest.missingAudio = snapshot.segments.filter(s => !s.kind && !audioIds.has(s.id)).map(s => ({ id: s.id, start: s.start, end: s.end }));
  manifest.missingImages = (snapshot.visuals || []).filter(v => !images.has(v.id)).map(v => ({ id: v.id, at: v.at }));
  const addText = (filename, value) => files.push({ name: filename, data: encoder.encode(value) });
  addText(`${name}_記録.json`, JSON.stringify({ version: 1, audioIncluded: true, meeting: snapshot, archive: manifest }, null, 2));
  // Even before AI clean-copy creation, the HTML retains raw text and images.
  addText(`${name}_議事録.html`, minutesHtml(snapshot, snapshot.minutes || { format: 2, parts: [] }, images));
  addText(`${name}_議事録.md`, minutesDocument(snapshot, snapshot.minutes || { format: 2, parts: [] }, images));
  addText('保存内容.txt', '会議の記録JSON（相談履歴・要約・作成済み清書を含む）、議事録HTML・Markdown、音声/ の元の録音WAV、スクショ/ の元の保存画像をまとめています。\nJSONだけをアプリに読み込んでも音声・画像本体は復元しません。音声・画像も復元する場合は、解凍せずZIPのまま「記録を読み込む」で選択してください。原本が元からない記録は復元後に不足として表示します。\n清書を未作成の場合は音声原本とスクショを保存します。文字起こしや清書が後から完成すると、自動保存設定が有効でページが開いている間は同じDriveファイルを更新します。\n');
  return { blob: zipImages(files), name: `${name}_${snapshot.createdAt.slice(0, 10)}_会議一式.zip`, manifest };
}
