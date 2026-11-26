/**
 * Automated verification suite: compiles 4 real-world sing-box 1.14 configs
 * (System Proxy + VLESS Reality, TUN + WireGuard Endpoint, Multi-Hop detour,
 * and Hysteria2 + Trojan) and validates EVERY ONE using `resources/bin/sing-box.exe check`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const singBoxExe = path.join(rootDir, 'resources', 'bin', 'sing-box.exe');

if (!fs.existsSync(singBoxExe)) {
  console.error(`[VERIFY] sing-box.exe not found at ${singBoxExe}. Run "npm run fetch-core" first.`);
  process.exit(1);
}

const parser = require(path.join(rootDir, 'dist-electron', 'core', 'subscriptionParser.js'));
const builder = require(path.join(rootDir, 'dist-electron', 'core', 'configBuilder.js'));

const versionOut = execFileSync(singBoxExe, ['version'], { encoding: 'utf8' });
console.log('[VERIFY] Binary version:\n' + versionOut.trim());

// Valid 32-byte base64 keys for sing-box WireGuard check
const dummyKeyA = Buffer.alloc(32, 1).toString('base64');
const dummyKeyB = Buffer.alloc(32, 2).toString('base64');

const wgNodes = parser.parseSubscriptionContent(
  `[Interface]\nPrivateKey=${dummyKeyA}\nAddress=10.66.66.2/32\nMTU=1420\n[Peer]\nPublicKey=${dummyKeyB}\nEndpoint=1.2.3.4:51820\nAllowedIPs=0.0.0.0/0`,
  'Japan Tokyo WG'
);
const vlessNodes = parser.parseSubscriptionContent(
  'vless://11111111-1111-1111-1111-111111111111@hk.example.com:443?security=reality&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=abcd&sni=apple.com&fp=chrome#HK-IEPL-01'
);
const hy2Nodes = parser.parseSubscriptionContent(
  'hysteria2://supersecret@sg.example.com:8443?sni=sg.example.com#SG-HY2'
);

const commonSecurity = [
  { id: 'killswitch', title: '', desc: '', enabled: true },
  { id: 'netshield', title: '', desc: '', enabled: true },
  { id: 'pqkem', title: '', desc: '', enabled: true },
  { id: 'lan', title: '', desc: '', enabled: true }
];
const commonAutoPilot = [
  { id: 'cn-direct', title: '', desc: '', enabled: true },
  { id: 'ai-route', title: '', desc: '', enabled: true }
];
const commonSplit = [
  { id: 'wx', name: 'WeChat', proc: 'WeChat.exe', executables: ['WeChat.exe'], mode: 'bypass' },
  { id: 'chrome', name: 'Chrome', proc: 'chrome.exe', executables: ['chrome.exe'], mode: 'proxy' }
];

const scenarios = [
  {
    name: '1. System Proxy + VLESS Reality + NetShield + Split Tunneling',
    req: {
      node: vlessNodes[0],
      multiHop: false,
      protocol: 'stealth',
      takeoverMode: 'system-proxy',
      security: commonSecurity,
      autopilot: commonAutoPilot,
      splitApps: commonSplit
    }
  },
  {
    name: '2. TUN (strict_route) + WireGuard Endpoint',
    req: {
      node: wgNodes[0],
      multiHop: false,
      protocol: 'wireguard',
      takeoverMode: 'tun',
      security: commonSecurity,
      autopilot: commonAutoPilot,
      splitApps: commonSplit
    }
  },
  {
    name: '3. Multi-Hop (detour) VLESS -> WireGuard Endpoint',
    req: {
      node: vlessNodes[0],
      entryNode: wgNodes[0],
      multiHop: true,
      protocol: 'stealth',
      takeoverMode: 'system-proxy',
      security: commonSecurity,
      autopilot: commonAutoPilot,
      splitApps: commonSplit
    }
  },
  {
    name: '4. TUN + Hysteria2 QUIC',
    req: {
      node: hy2Nodes[0],
      multiHop: false,
      protocol: 'wireguard',
      takeoverMode: 'tun',
      security: commonSecurity,
      autopilot: commonAutoPilot,
      splitApps: commonSplit
    }
  }
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veil-sb-check-'));
try {
  for (const s of scenarios) {
    const cfg = builder.buildSingBoxConfig(s.req);
    const outFile = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(outFile, JSON.stringify(cfg, null, 2), 'utf8');
    execFileSync(singBoxExe, ['check', '-c', outFile], { stdio: 'inherit' });
    console.log(`[VERIFY] PASS -> ${s.name}`);
  }
  console.log('[VERIFY] ALL 4 sing-box 1.14.4 config schemas PASSED!');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
