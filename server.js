import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { createApi, apiError } from './cloudflare/api.js';

export const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const transcribeModel = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash';
const key = process.env.GEMINI_API_KEY;
const ai = key ? new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1beta', timeout: 60000 } }) : null;
export function liveConfig(context) { return createApi({provider:ai,liveModel,transcribeModel}).liveConfig(context); }

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw Object.assign(new Error('送信データが大きすぎます。'), { status: 413, clientMessage: '送信データが大きすぎます。' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('JSONの形式が不正です。'), { status: 400, clientMessage: 'JSONの形式が不正です。' }); }
}

export function createApp({ provider = ai, middleware = null, port = 5173, production = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    // Local-only app: block foreign origins and DNS rebinding before token issuance.
    const host = req.headers.host;
    const localPort = port || server.address()?.port;
    const allowed = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
    if (!allowed.includes(host) || (req.headers.origin && !allowed.map(h => `http://${h}`).includes(req.headers.origin))) return json(403, { error: 'ローカルのアプリからアクセスしてください。' });
    const url = new URL(req.url, `http://${host}`);
    try {
      if(url.pathname.startsWith('/api/')) {
        const body=req.method==='POST'?await readJson(req):undefined;
        const response=await createApi({provider,liveModel,transcribeModel}).handle(url.pathname,req.method,body);
        res.writeHead(response.status,Object.fromEntries(response.headers));
        return res.end(await response.text());
      }
      if (middleware) return middleware(req, res);
      if (production) {
        const root = resolve('dist');
        const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(root + sep)) return json(403, { error: 'アクセスできません。' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        let data;
        try { data = await readFile(file); } catch { return json(404, { error: '見つかりません。' }); }
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
        return res.end(data);
      }
      json(404, { error: '見つかりません。' });
    } catch (error) {
      // Provider errors can contain request URLs and keys; never forward raw errors.
      if (provider === ai && !error.clientMessage) console.warn('Gemini request failed:', JSON.stringify({
        status: Number.isInteger(error.status) ? error.status : null,
        type: /^[A-Za-z]+$/.test(error.name) ? error.name : 'unknown',
        code: /^[A-Z_0-9]+$/.test(error.cause?.code || error.code || '') ? (error.cause?.code || error.code) : null
      }));
      const response=apiError(error);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(await response.text());
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 5173);
  const production = process.argv.includes('--production');
  const vite = production ? null : await (await import('vite')).createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  const server = createApp({ middleware: vite?.middlewares, port, production });
  server.listen(port, '127.0.0.1', () => console.log(`WithViewer: http://127.0.0.1:${port} (${ai ? 'Gemini configured' : 'API key not configured'})`));
}
