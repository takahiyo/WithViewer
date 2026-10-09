import { GoogleGenAI } from '@google/genai';
import { wav } from '../src/audio.js';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta', timeout: 20000 } });
for (const model of [process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash', process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live']) {
  try {
    const info = await ai.models.get({ model });
    console.log(JSON.stringify({ model, found: !!info.name }));
  } catch (error) {
    console.log(JSON.stringify({ model, found: false, status: Number.isInteger(error.status) ? error.status : null,
      name: /^[A-Za-z]+$/.test(error.name) ? error.name : 'unknown',
      code: /^[A-Z_0-9]+$/.test(error.cause?.code || error.code || '') ? (error.cause?.code || error.code) : null }));
  }
}
try {
  const response = await ai.models.generateContent({ model: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: '会議音声を文字起こししてください。無音は空文字にしてください。文字起こし本文だけを出力してください。' },
      { inlineData: { data: Buffer.from(wav(new Uint8Array(16000), 16000)).toString('base64'), mimeType: 'audio/wav' } }] }] });
  console.log(JSON.stringify({ audioRequest: true, textType: typeof response.text, candidates: response.candidates?.map(c => ({ finishReason: c.finishReason, parts: c.content?.parts?.map(p => ({ text: typeof p.text, thought: p.thought })) })) }));
} catch (error) { console.log(JSON.stringify({ audioRequest: false, status: error.status || null, name: error.name, code: error.cause?.code || error.code || null })); }
