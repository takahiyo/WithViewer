import { evidence, timeLabel } from './core.js';

export function minutesBatches(meeting) {
  const batches = []; let current = '';
  for (const segment of meeting.segments.filter(s => s.status === 'done' && s.text && !s.kind).sort((a, b) => a.start - b.start)) {
    // Split even a long imported segment; never truncate the transcript.
    for (let i = 0; i < segment.text.length;) {
      let end = Math.min(i + 15000, segment.text.length);
      if (end < segment.text.length && /[\uD800-\uDBFF]/.test(segment.text[end - 1])) end--;
      const part = evidence({ ...segment, text: segment.text.slice(i, end) });
      if (current && current.length + part.length + 1 > 18000) { batches.push(current); current = ''; }
      current += `${current ? '\n' : ''}${part}`;
      i = end;
    }
  }
  if (current) batches.push(current);
  return batches;
}
export async function minutesFingerprint(meeting) {
  const source = JSON.stringify({ title: meeting.title, segments: meeting.segments, visuals: meeting.visuals || [] });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export function minutesDocument(meeting, report, images = new Map()) {
  const lines = [`# ${meeting.title} — 議事録`, '', `整文の作成開始：${report.at || '不明'}`, '', 'AIが発言の文章を整えています。整文は作成時点の記録が対象です。文字起こし再試行・記録更新後は「議事録を作成・更新」を実行してください。正確な確認には末尾の文字起こし原文と録音を参照してください。', '', '## 発言の記録（整文）', ''];
  report.parts.forEach((part, i) => lines.push(`### 記録 ${i + 1}`, '', part || 'この部分の整文は未完了です。末尾の原文を参照してください。', ''));
  lines.push('## 資料・画像の一覧', '', '時刻は静止画の取得時点です。資料が表示されていた全期間や、発言がこの画像を指すかは未確認です。読取り内容はAIの解釈を含みます。', '');
  for (const v of [...(meeting.visuals || [])].sort((a, b) => a.at - b.at)) {
    lines.push(`### ${timeLabel(v.at)} の画像`, '', v.text, '');
    const name = images.get(v.id);
    if (name) lines.push(`![${timeLabel(v.at)}の共有画面](<${name}>)`, '');
    else lines.push('画像本体はこの文書に含まれていません。', '');
    const nearby = meeting.segments.filter(s => !s.kind && s.status === 'done' && s.text && s.end >= v.at - 30 && s.start <= v.at + 30);
    lines.push('時刻が近い発言（前後30秒・画像との対応は未確認）：', '', ...nearby.map(evidence), '');
    if (!nearby.length) lines.push('この付近の文字起こしはありません。', '');
  }
  if (!meeting.visuals?.length) lines.push('画像の読取り記録はありません。', '');
  lines.push('## 文字起こし原文・未完了区間', '');
  for (const s of [...meeting.segments].sort((a, b) => a.start - b.start)) {
    lines.push(s.status === 'done' ? evidence({ ...s, text: s.text || '（発言なし）' }) :
      `[会議 ${timeLabel(s.start)}–${timeLabel(s.end)}] 文字起こし未完了（${s.status}）。内容は補完していません。`, '');
  }
  return lines.join('\n');
}
