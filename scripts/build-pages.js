import { build as buildVite } from 'vite';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

await buildVite();
await build({ entryPoints: ['cloudflare/worker.js'], outfile: 'dist/_worker.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', conditions: ['worker', 'browser'], minify: true });
await writeFile('dist/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
console.log('Cloudflare Pages build complete. Every route requires Cloudflare Access.');
