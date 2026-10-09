import { timeLabel } from './core.js';

export function cleanCopy(report) { return report.parts.filter(Boolean).join('\n\n').trim(); }
export function copyParagraphs(report) { return cleanCopy(report).split(/\n\s*\n/).filter(Boolean); }
const orderedVisuals = meeting => [...(meeting.visuals || [])].sort((a, b) => a.at - b.at);
export function segmentImages(meeting, segment) {
  const end = Math.max(0, ...meeting.segments.filter(s => !s.kind).map(s => s.end));
  return orderedVisuals(meeting).map((v, i) => ({ ...v, number: i + 1 }))
    .filter(v => v.at >= segment.start && (v.at < segment.end || segment.end === end && v.at === end));
}
const escape = value => String(value ?? '').replace(/[&<>"'\r\n]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;', '\n': '&#10;' }[c]));
function rawFence(text) {
  const length = Math.max(2, ...(text.match(/`+/g) || []).map(s => s.length)) + 1;
  return `${'`'.repeat(length)}text\n${text}\n${'`'.repeat(length)}`;
}
export function minutesDocument(meeting, report, images = new Map()) {
  const lines = [`# ${meeting.title}`, '', '## 1. 清書', '', cleanCopy(report), '', '## 2. 音声原本', ''];
  if (report.parts.some(p => !p)) lines.push('清書には未完了の部分があります。', '');
  for (const s of [...meeting.segments].filter(s => !s.kind).sort((a, b) => a.start - b.start)) {
    lines.push(`### ${timeLabel(s.start)}–${timeLabel(s.end)}${s.status !== 'done' ? '（文字起こし未完了）' : ''}`, '', rawFence(s.text), '');
    for (const v of segmentImages(meeting, s)) lines.push(`スクショ ${v.number} · ${timeLabel(v.at)}${images.has(v.id) ? ` · [画像](<${images.get(v.id)}>)` : ''}`, '');
  }
  const notes = meeting.segments.filter(s => s.kind === 'note');
  if (notes.length) { lines.push('### 手入力メモ（音声原本とは別）', ''); for (const n of notes) lines.push(rawFence(n.text), ''); }
  lines.push('## 3. スクショ', '');
  for (const [i, v] of orderedVisuals(meeting).entries()) {
    lines.push(`### スクショ ${i + 1} · ${timeLabel(v.at)}`, '', images.has(v.id) ? `![スクショ ${i + 1}](<${images.get(v.id)}>)` : '画像本体はありません。', '', v.text, '');
  }
  if (!meeting.visuals?.length) lines.push('保存されたスクショはありません。');
  return lines.join('\n');
}
export const MINUTES_CSS = `.minutes-report{color:#243832;font-family:"Yu Gothic",Meiryo,sans-serif;line-height:1.9}.minutes-nav{display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #dfe6df;padding:14px 0;margin-bottom:30px}.minutes-report a{color:#285b4e}.minutes-report h2{font-size:24px;margin:32px 0 20px}.minutes-copy{max-width:48em;margin:auto;font-size:17px;line-height:2.05;overflow-wrap:anywhere}.minutes-copy p{margin:0 0 1.5em;white-space:pre-wrap}.minutes-original,.minutes-gallery{margin-top:36px;border-top:1px solid #dfe6df;padding-top:20px}.minutes-original summary,.minutes-gallery summary{font-size:19px;font-weight:600}.minutes-raw{border-bottom:1px solid #e5ebe5;padding:22px 0}.minutes-raw header{background:none;border:0;padding:0;margin-bottom:8px;font-size:13px;color:#6c7f71;justify-content:flex-start}.minutes-raw pre{font:inherit;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.minutes-refs{font-size:13px;margin-top:12px}.minutes-gallery figure{margin:24px 0 36px}.minutes-gallery img{display:block;width:100%;height:auto;border:1px solid #e1e7df;margin:12px 0}.minutes-gallery figcaption{font-size:14px;font-weight:600}.minutes-image-note{white-space:pre-wrap;font-size:13px;color:#6c7f71}.minutes-state{color:#876121;font-size:13px}@media(max-width:600px){.minutes-copy{font-size:16px}.minutes-nav{gap:14px}}`;
export function minutesBody(meeting, report, images = new Map(), interactive = true) {
  const raw = [...meeting.segments].filter(s => !s.kind).sort((a, b) => a.start - b.start).map(s => {
    const refs = segmentImages(meeting, s).map(v => `<a href="#report-image-${v.number}">スクショ ${v.number} · ${escape(timeLabel(v.at))}</a>`).join('　');
    return `<article class="minutes-raw" data-segment="${escape(s.id)}"><header>${escape(timeLabel(s.start))}–${escape(timeLabel(s.end))}${s.status !== 'done' ? ' · 文字起こし未完了' : ''}</header><pre><span></span>${escape(s.text)}</pre>${refs ? `<div class="minutes-refs">${refs}</div>` : ''}</article>`;
  }).join('');
  const gallery = orderedVisuals(meeting).map((v, i) => `<figure id="report-image-${i + 1}"><figcaption>スクショ ${i + 1} · ${escape(timeLabel(v.at))}</figcaption><img data-frame="${escape(v.id)}" alt="スクショ ${i + 1}" loading="lazy"${images.has(v.id) ? ` src="${escape(images.get(v.id))}"` : ' hidden'}><p class="minutes-image-missing"${images.has(v.id) ? ' hidden' : ''}>画像本体はありません。</p><details><summary>画面の読取り内容</summary><p class="minutes-image-note">${escape(v.text)}</p></details></figure>`).join('');
  const notes = meeting.segments.filter(s => s.kind === 'note').map(s => `<article class="minutes-raw" data-segment="${escape(s.id)}"><header>手入力メモ</header><pre>${escape(s.text)}</pre></article>`).join('');
  const section = (id, title, content, className) => interactive ? `<details id="${id}" class="${className}"><summary>${title}</summary>${content}</details>` : `<section id="${id}" class="${className}"><h2>${title}</h2>${content}</section>`;
  return `<nav class="minutes-nav" aria-label="議事録の目次"><a href="#report-copy">1. 清書</a><a href="#report-original">2. 音声原本</a><a href="#report-screens">3. スクショ</a></nav>${report.parts.some(p => !p) ? '<p class="minutes-state">清書は一部未完了です。作成・更新で続きから再開できます。</p>' : ''}${report.format !== 2 ? '<p class="minutes-state">旧形式の議事録です。作成・更新で新しい清書に変更できます。</p>' : ''}<section id="report-copy"><h2>1. 清書</h2><div class="minutes-copy">${copyParagraphs(report).map((p, index) => `<p id="report-paragraph-${index}">${escape(p)}</p>`).join('')}</div></section>${section('report-original', '2. 音声原本', raw + (notes ? `<details><summary>手入力メモ（音声原本とは別）</summary>${notes}</details>` : ''), 'minutes-original')}${section('report-screens', '3. スクショ', gallery || '<p>保存されたスクショはありません。</p>', 'minutes-gallery')}`;
}
export function minutesHtml(meeting, report, images = new Map()) {
  return `<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(meeting.title)} — 議事録</title><style>body{background:#f5f7f4;margin:0;padding:32px 16px}.minutes-report{max-width:900px;margin:auto;background:white;padding:clamp(20px,5vw,60px);border-radius:12px}h1{font-size:28px}@media print{body{background:white;padding:0}.minutes-report{padding:0}.minutes-nav{display:none}}${MINUTES_CSS}</style><main class="minutes-report"><h1>${escape(meeting.title)}</h1>${minutesBody(meeting, report, images, false)}</main></html>`;
}
