import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { build } from 'vite';

const url = 'http://127.0.0.1:5174/api/config';
try {
  await fetch(url, { signal: AbortSignal.timeout(500) });
  throw new Error('ブラウザーテスト用の5174番ポートを空けてください。');
} catch (error) { if (error.message.includes('5174')) throw error; }

// Own the direct child process so Windows cleanup does not depend on taskkill /T.
await build();
const server = spawn(process.execPath, ['server.js', '--production'], { env: { ...process.env, PORT: '5174', GEMINI_API_KEY: '' }, stdio: 'inherit', windowsHide: true });
let exited = false; server.once('exit', () => exited = true);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('テスト用サーバーが起動できませんでした。');
    try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch {}
    await setTimeout(500);
  }
  if (!ready) throw new Error('テスト用サーバーの起動がタイムアウトしました。');
  const runner = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], { stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => { runner.on('error', reject); runner.on('exit', code => resolve(code ?? 1)); });
} finally {
  if (!exited) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
}
