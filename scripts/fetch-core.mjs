/**
 * Fetches pinned official sing-box (Windows amd64) binary and wintun.dll into resources/bin/
 * and verifies pre-recorded SHA-256 checksums for BOTH downloaded archives and extracted binaries.
 * Aborts immediately (exit code 1) on any SHA-256 mismatch.
 * Run: npm run fetch-core
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, '../resources/bin');

export const PINNED_CORES = {
  singBox: {
    version: '1.14.4',
    archiveName: 'sing-box-1.14.4-windows-amd64.zip',
    url: 'https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-windows-amd64.zip',
    archiveSha256: '99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df',
    binaryName: 'sing-box.exe',
    binarySha256: '8f30682ee198855440d2a7fe070d5d3653793b2d01bb8c85eea88f93bbe7c8b9'
  },
  wintun: {
    version: '0.14.1',
    archiveName: 'wintun-0.14.1.zip',
    url: 'https://www.wintun.net/builds/wintun-0.14.1.zip',
    archiveSha256: '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51',
    binaryName: 'wintun.dll',
    binarySha256: 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce'
  }
};

export function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toLowerCase();
}

export function verifyFileSha256(filePath, expectedSha256, label) {
  const actual = computeFileSha256(filePath);
  const expected = expectedSha256.toLowerCase();
  if (actual !== expected) {
    throw new Error(
      `SHA-256 verification FAILED for ${label}: expected ${expected}, got ${actual}. Aborting build.`
    );
  }
  return actual;
}

function extractZip(zipPath, extractDir) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' });
}

async function downloadFile(url, dest) {
  console.log(`[VEIL] Downloading ${url}`);
  const headers = { 'User-Agent': 'VEIL-VPN-Fetcher/1.2' };
  if (url.includes('github.com') && process.env.GH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`[VEIL] Saved -> ${dest} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function ensureSingBox() {
  const spec = PINNED_CORES.singBox;
  const singBoxPath = path.join(binDir, spec.binaryName);

  if (fs.existsSync(singBoxPath)) {
    verifyFileSha256(singBoxPath, spec.binarySha256, `cached ${spec.binaryName} v${spec.version}`);
    console.log(`[VEIL] Verified existing ${spec.binaryName} v${spec.version} (SHA-256 OK).`);
    return;
  }

  const zipPath = path.join(binDir, spec.archiveName);
  const extractDir = path.join(binDir, '_extract_sb');
  try {
    await downloadFile(spec.url, zipPath);
    verifyFileSha256(zipPath, spec.archiveSha256, spec.archiveName);
    console.log(`[VEIL] Verified ${spec.archiveName} SHA-256 OK.`);

    extractZip(zipPath, extractDir);
    const entries = fs.readdirSync(extractDir, { recursive: true });
    const found = entries.find((e) => String(e).endsWith(spec.binaryName));
    if (!found) throw new Error(`${spec.binaryName} not found inside ${spec.archiveName}.`);

    const extractedBin = path.join(extractDir, String(found));
    verifyFileSha256(extractedBin, spec.binarySha256, `${spec.binaryName} v${spec.version}`);
    fs.copyFileSync(extractedBin, singBoxPath);
    console.log(`[VEIL] ${spec.binaryName} v${spec.version} verified and ready!`);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

async function ensureWintun() {
  const spec = PINNED_CORES.wintun;
  const wintunPath = path.join(binDir, spec.binaryName);

  if (fs.existsSync(wintunPath)) {
    verifyFileSha256(wintunPath, spec.binarySha256, `cached ${spec.binaryName} v${spec.version}`);
    console.log(`[VEIL] Verified existing ${spec.binaryName} v${spec.version} (SHA-256 OK).`);
    return;
  }

  const wtZip = path.join(binDir, spec.archiveName);
  const wtDir = path.join(binDir, '_extract_wt');
  try {
    await downloadFile(spec.url, wtZip);
    verifyFileSha256(wtZip, spec.archiveSha256, spec.archiveName);
    console.log(`[VEIL] Verified ${spec.archiveName} SHA-256 OK.`);

    extractZip(wtZip, wtDir);
    const dllSrc = path.join(wtDir, 'wintun', 'bin', 'amd64', spec.binaryName);
    if (!fs.existsSync(dllSrc)) {
      throw new Error(`${spec.binaryName} (amd64) not found inside ${spec.archiveName}.`);
    }

    verifyFileSha256(dllSrc, spec.binarySha256, `${spec.binaryName} v${spec.version}`);
    fs.copyFileSync(dllSrc, wintunPath);
    console.log(`[VEIL] ${spec.binaryName} v${spec.version} verified and ready!`);
  } finally {
    fs.rmSync(wtDir, { recursive: true, force: true });
    fs.rmSync(wtZip, { force: true });
  }
}

export async function main() {
  fs.mkdirSync(binDir, { recursive: true });
  await ensureSingBox();
  await ensureWintun();
  console.log('[VEIL] All pinned core binaries verified with SHA-256 in resources/bin/.');
}

const isEntrypoint = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('[VEIL] Core fetch/verification failed:', err.message);
    process.exit(1);
  });
}
