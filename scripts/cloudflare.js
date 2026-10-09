import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Keep OAuth credentials and CLI logs in the ignored workspace directory.
const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env,
    XDG_CONFIG_HOME: resolve('.wrangler/config'), WRANGLER_LOG_PATH: resolve('.wrangler/logs'), WRANGLER_SEND_METRICS: 'false' }
});
child.on('error', () => { console.error('Cloudflare CLIを起動できません。npm installを確認してください。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
