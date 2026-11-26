import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runStep(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: rootDir, stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function waitForVite(url, retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (attempts >= retries) reject(new Error('Vite dev server did not start in time'));
          else setTimeout(poll, 350);
        });
    };
    poll();
  });
}

async function main() {
  console.log('[VEIL] Compiling Electron main process...');
  await runStep(npmCmd, ['run', 'build:electron']);

  console.log('[VEIL] Starting Vite renderer dev server...');
  const vite = spawn(npmCmd, ['exec', 'vite'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });

  await waitForVite('http://localhost:5173');
  console.log('[VEIL] Launching Windows 11 Electron client...');

  const electron = spawn(npmCmd, ['exec', 'electron', '.'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VEIL_DEV_URL: 'http://localhost:5173'
    }
  });

  const cleanup = () => {
    try { vite.kill(); } catch {}
    try { electron.kill(); } catch {}
    process.exit(0);
  };

  electron.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[VEIL] Dev startup error:', err);
  process.exit(1);
});
