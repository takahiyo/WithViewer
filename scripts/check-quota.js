import { wav } from '../src/audio.js';

// One synthetic silence request. Never print API keys, raw errors, or request URLs.
const model = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash';
const clean = value => typeof value === 'string' && /^[A-Za-z0-9_./ -]{1,180}$/.test(value) ? value : undefined;
try {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [
      { text: 'Transcribe the audio. Return an empty string for silence.' },
      { inlineData: { mimeType: 'audio/wav', data: Buffer.from(wav(new Uint8Array(16000), 16000)).toString('base64') } }
    ] }] }), signal: AbortSignal.timeout(60000)
  });
  const data = await response.json();
  const message = String(data.error?.message || '').toLowerCase();
  console.log(JSON.stringify({ model, status: response.status, providerStatus: clean(data.error?.status),
    billingMentioned: /billing|credit|payment|balance/.test(message),
    quotaMentioned: /quota|rate.limit/.test(message), capacityMentioned: /capacity|overload|resource.exhaust/.test(message),
    details: (data.error?.details || []).map(d => ({ type: clean(d['@type']), reason: clean(d.reason), retryDelay: clean(d.retryDelay),
      violations: d.violations?.map(v => ({ metric: clean(v.quotaMetric), id: clean(v.quotaId), value: clean(v.quotaValue),
        model: clean(v.quotaDimensions?.model), location: clean(v.quotaDimensions?.location) })) }))
  }, null, 2));
} catch { console.log('Quota check: network failure or timeout (details withheld).'); process.exitCode = 1; }
