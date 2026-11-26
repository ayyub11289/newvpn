/**
 * Fetches official sing-box (Windows amd64) binary and wintun.dll into resources/bin/.
 * Run: npm run fetch-core
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, '../resources/bin');
fs.mkdirSync(binDir, { recursive: true });

async function downloadFile(url, dest) {
  console.log(`[VEIL] Downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'VEIL-VPN-Fetcher/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`[VEIL] Saved -> ${dest} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function main() {
  const singBoxPath = path.join(binDir, 'sing-box.exe');
  if (fs.existsSync(singBoxPath)) {
    console.log('[VEIL] sing-box.exe already exists in resources/bin/. Skipping.');
  } else {
    console.log('[VEIL] Querying latest sing-box release from GitHub...');
    const relRes = await fetch('https://api.github.com/repos/SagerNet/sing-box/releases/latest', {
      headers: { 'User-Agent': 'VEIL-VPN-Fetcher/1.0' }
    });
    if (!relRes.ok) throw new Error(`Failed to fetch sing-box release info: HTTP ${relRes.status}`);
    const release = await relRes.json();
    const asset = (release.assets || []).find(
      (a) => a.name.includes('windows-amd64') && a.name.endsWith('.zip') && !a.name.includes('legacy')
    );
    if (!asset) throw new Error('Could not find windows-amd64.zip asset in sing-box release.');

    const zipPath = path.join(binDir, asset.name);
    await downloadFile(asset.browser_download_url, zipPath);

    const extractDir = path.join(binDir, '_extract_sb');
    fs.rmSync(extractDir, { recursive: true, force: true });
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);

    const entries = fs.readdirSync(extractDir, { recursive: true });
    const found = entries.find((e) => String(e).endsWith('sing-box.exe'));
    if (!found) throw new Error('sing-box.exe not found inside archive.');

    fs.copyFileSync(path.join(extractDir, String(found)), singBoxPath);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    console.log('[VEIL] sing-box.exe ready!');
  }

  const wintunPath = path.join(binDir, 'wintun.dll');
  if (!fs.existsSync(wintunPath)) {
    const wtZip = path.join(binDir, 'wintun-0.14.1.zip');
    await downloadFile('https://www.wintun.net/builds/wintun-0.14.1.zip', wtZip);
    const wtDir = path.join(binDir, '_extract_wt');
    fs.rmSync(wtDir, { recursive: true, force: true });
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${wtZip}' -DestinationPath '${wtDir}' -Force"`);
    const dllSrc = path.join(wtDir, 'wintun', 'bin', 'amd64', 'wintun.dll');
    if (fs.existsSync(dllSrc)) {
      fs.copyFileSync(dllSrc, wintunPath);
      console.log('[VEIL] wintun.dll ready!');
    }
    fs.rmSync(wtDir, { recursive: true, force: true });
    fs.rmSync(wtZip, { force: true });
  } else {
    console.log('[VEIL] wintun.dll already exists in resources/bin/. Skipping.');
  }

  console.log('[VEIL] Core engine binaries are ready in resources/bin/');
}

main().catch((err) => {
  console.error('[VEIL] Core download failed:', err.message);
  console.error('You can manually place sing-box.exe and wintun.dll into resources/bin/.');
  process.exit(1);
});
