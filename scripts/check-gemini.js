import { wav } from '../src/audio.js';
import { GoogleGenAI } from '@google/genai';

// Only synthetic silence and a fixed test context are sent. Never print tokens.
const url = `http://127.0.0.1:${process.env.PORT || 5173}`;
async function post(path, body) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
try {
  const result = await post('/api/transcribe', { audio: Buffer.from(wav(new Uint8Array(16000), 16000)).toString('base64') });
  console.log('Transcription API: OK (synthetic silence; output characters=' + result.text.length + ')');
  if (process.argv.includes('--live')) {
    const credentials = await post('/api/live-token', { context: '{"purpose":"connection check; no meeting content"}' });
    const client = new GoogleGenAI({ apiKey: credentials.token, httpOptions: { apiVersion: 'v1beta' } });
    let resolveSetup, rejectSetup;
    const setup = new Promise((resolve, reject) => { resolveSetup = resolve; rejectSetup = reject; });
    setup.catch(() => {});
    const timer = setTimeout(() => rejectSetup(new Error('Live connection timed out')), 20000);
    let session;
    try {
      session = await client.live.connect({ model: credentials.model, config: credentials.config, callbacks: {
        onmessage: message => { if (message.setupComplete) resolveSetup(); },
        onerror: () => rejectSetup(new Error('Live connection failed')),
        onclose: () => rejectSetup(new Error('Live connection closed'))
      } });
      await setup; console.log('Live API: OK (setup handshake; no audio sent)');
    } finally { clearTimeout(timer); session?.close(); }
  }
} catch (error) { console.error('Gemini check failed: ' + error.message); process.exitCode = 1; }
