// Two extra requests at most, with a shared cooldown before any queued audio.
export const RETRY_DELAYS = [30_000, 120_000];
export function retryDelay(error, retries) {
  if (/未設定|設定が未完了/.test(error.message || '')) return null;
  if (error.code === '1101' || error.code === '1102') return null;
  const temporary = [408, 502, 503, 504].includes(error.status) ||
    ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
  return temporary ? RETRY_DELAYS[retries] ?? null : null;
}
