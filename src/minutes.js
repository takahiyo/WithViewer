import { minutesDocument } from './minutes-layout.js';
export { minutesDocument };
export const MINUTES_FORMAT = 2;
export function minutesBatches(meeting) {
  const text = [...meeting.segments].sort((a, b) => a.start - b.start)
    .filter(s => s.status === 'done' && s.text && !s.kind).map(s => s.text).join('');
  const batches = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 18000, text.length);
    if (end < text.length) {
      const from = Math.max(start, end - 2000);
      const sentence = text.slice(from, end).match(/[。！？!?][^。！？!?]*$/);
      if (sentence) end = from + sentence.index + 1;
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    batches.push(text.slice(start, end)); start = end;
  }
  return batches;
}
export async function minutesFingerprint(meeting) {
  const source = JSON.stringify({ format: MINUTES_FORMAT, text: minutesBatches(meeting) });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
