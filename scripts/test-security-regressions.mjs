/**
 * Security & Reliability Regression Test Suite for VEIL VPN.
 * Runs against compiled dist-electron/core modules and scripts/fetch-core.mjs.
 * Usage: npm run build && npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { computeFileSha256, PINNED_CORES, verifyFileSha256 } from './fetch-core.mjs';

const require = createRequire(import.meta.url);
const { SingBoxManager } = require('../dist-electron/core/singboxManager.js');
const {
  WinProxyGuard,
  ProxyOperationError,
  buildWinInetNotifyScript
} = require('../dist-electron/core/winProxyGuard.js');
const { SecureVault } = require('../dist-electron/core/secureVault.js');
const { redactSecrets } = require('../dist-electron/core/secretRedactor.js');
const { runRealLeakAudit } = require('../dist-electron/core/leakAuditor.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFakeChild() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdout = new PassThrough();
  proc.exitCode = null;
  proc.killed = false;
  proc.stdinChunks = [];
  proc.stdin.on('data', (c) => proc.stdinChunks.push(c.toString('utf8')));
  proc.kill = (sig = 'SIGTERM') => {
    if (proc.exitCode !== null) return false;
    proc.killed = true;
    proc.exitCode = 0;
    queueMicrotask(() => proc.emit('exit', 0, sig));
    return true;
  };
  return proc;
}

function makeRealNode(id = 'node-a') {
  return {
    id,
    code: 'JP',
    country: '日本',
    city: `节点-${id}`,
    host: '203.0.113.10',
    port: 443,
    asn: 'TestNet',
    ip: '203.0.113.10',
    lon: 139.7,
    lat: 35.7,
    ping: 45,
    load: 15,
    tags: ['asia'],
    fav: false,
    source: 'subscription',
    protocolType: 'vless',
    outbound: {
      type: 'vless',
      server: '203.0.113.10',
      server_port: 443,
      uuid: '11111111-2222-3333-4444-555555555555'
    }
  };
}

function makeConnectReq(node, overrides = {}) {
  return {
    node,
    multiHop: false,
    protocol: 'wireguard',
    takeoverMode: 'system-proxy',
    security: [
      { id: 'killswitch', title: 'KS', desc: '', enabled: true },
      { id: 'netshield', title: 'NS', desc: '', enabled: true },
      { id: 'lan', title: 'LAN', desc: '', enabled: true }
    ],
    autopilot: [{ id: 'cn-direct', title: 'CN', desc: '', enabled: true }],
    splitApps: [],
    ...overrides
  };
}

function makeMockRegistry(initial = { ProxyEnable: '0x0', ProxyServer: '', ProxyOverride: '' }) {
  const store = { ...initial };
  const writes = [];
  let notifyCount = 0;
  return {
    store,
    writes,
    get notifyCount() {
      return notifyCount;
    },
    ops(overrides = {}) {
      return {
        platform: 'win32',
        queryValue: async (k) => store[k] ?? '',
        setValue: async (k, _type, v) => {
          writes.push({ key: k, value: v });
          store[k] = k === 'ProxyEnable' ? (v === '1' ? '0x1' : '0x0') : v;
        },
        notifyWinInet: () => {
          notifyCount++;
        },
        checkAdmin: async () => false,
        ...overrides
      };
    }
  };
}

// ============================================================================
// 1. Protected Status, Explicit Demo Mode, Remote Probe & Race Safety
// ============================================================================

test('1a. Real node with missing sing-box.exe errors explicitly and never falls back to demo', async () => {
  const binDir = makeTempDir('veil-nobin-');
  const dataDir = makeTempDir('veil-data-');
  const events = [];
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  const mgr = new SingBoxManager(binDir, dataDir, (s) => events.push(s), {
    proxyGuard: guard,
    disableTelemetryLoop: true
  });

  await mgr.connect(makeConnectReq(makeRealNode()));
  const snap = mgr.getSnapshot();

  assert.equal(snap.status, 'disconnected');
  assert.equal(snap.engineMode, 'live');
  assert.match(snap.error || '', /sing-box\.exe/);
  assert.equal(events.some((e) => e.status === 'connected'), false);
  assert.equal(reg.writes.length, 0);

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1b. Demo node requires explicitDemo=true; unflagged demo node is rejected', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const guard = new WinProxyGuard(dataDir, makeMockRegistry().ops());
  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true
  });

  const demoNode = { ...makeRealNode('demo-1'), source: 'demo', protocolType: 'demo', outbound: undefined };
  await mgr.connect(makeConnectReq(demoNode));
  assert.equal(mgr.getSnapshot().status, 'disconnected');
  assert.match(mgr.getSnapshot().error || '', /演示节点|显式/);

  await mgr.connect(makeConnectReq(demoNode, { explicitDemo: true }));
  assert.equal(mgr.getSnapshot().engineMode, 'demo');
  assert.equal(mgr.getSnapshot().status, 'connecting');
  await mgr.disconnect();

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1c. Local port listening but remote probe fails -> stays disconnected, does NOT enable proxy', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  let spawnedChild = null;
  let spawnedArgs = null;

  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true,
    pickPorts: async () => ({ mixedPort: 17890, socksPort: 17891, clashApiPort: 19190 }),
    validateConfigStdin: async () => ({ ok: true }),
    spawnProcess: (_bin, args) => {
      spawnedArgs = args;
      spawnedChild = makeFakeChild();
      return spawnedChild;
    },
    waitForPortListening: async () => true,
    verifyRemoteReachability: async () => ({ ok: false, reason: '经代理访问 1.1.1.1 超时' })
  });

  await mgr.connect(makeConnectReq(makeRealNode()));
  const snap = mgr.getSnapshot();

  assert.deepEqual(spawnedArgs, ['run', '--disable-color', '-c', 'stdin']);
  assert.equal(snap.status, 'disconnected');
  assert.match(snap.error || '', /远端连通性探测失败/);
  assert.equal(spawnedChild.killed, true);
  assert.equal(reg.writes.length, 0, 'System proxy must not be enabled when remote probe fails');
  assert.equal(fs.existsSync(path.join(dataDir, 'sing-box.runtime.json')), false, 'No runtime config file on disk');

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1d. Successful stdin config + remote reachability -> transitions to connected with verified exit IP', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  let child = null;

  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true,
    pickPorts: async () => ({ mixedPort: 17890, socksPort: 17891, clashApiPort: 19190 }),
    validateConfigStdin: async (_bin, cfgJson) => {
      assert.ok(cfgJson.includes('"11111111-2222-3333-4444-555555555555"'));
      return { ok: true };
    },
    spawnProcess: () => {
      child = makeFakeChild();
      return child;
    },
    waitForPortListening: async () => true,
    verifyRemoteReachability: async () => ({ ok: true, exitIp: '198.51.100.77', latencyMs: 32 })
  });

  await mgr.connect(makeConnectReq(makeRealNode()));
  const snap = mgr.getSnapshot();

  assert.equal(snap.status, 'connected');
  assert.equal(snap.activeIp, '198.51.100.77');
  assert.equal(reg.store.ProxyEnable, '0x1');
  assert.equal(reg.store.ProxyServer, '127.0.0.1:17890');
  assert.ok(child.stdinChunks.join('').includes('"mixed-in"'));
  assert.equal(fs.existsSync(path.join(dataDir, 'sing-box.runtime.json')), false);

  await mgr.disconnect();
  assert.equal(reg.store.ProxyEnable, '0x0');

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1e. Cancel (disconnect) during in-flight remote probe aborts cleanly and never becomes connected', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  let resolveProbe = null;
  let probeAborted = false;

  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true,
    pickPorts: async () => ({ mixedPort: 17890, socksPort: 17891, clashApiPort: 19190 }),
    validateConfigStdin: async () => ({ ok: true }),
    spawnProcess: () => makeFakeChild(),
    waitForPortListening: async () => true,
    verifyRemoteReachability: (_port, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          probeAborted = true;
        });
        resolveProbe = resolve;
      })
  });

  const connectPromise = mgr.connect(makeConnectReq(makeRealNode()));
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(mgr.getSnapshot().status, 'connecting');

  await mgr.disconnect();
  assert.equal(probeAborted, true);

  // Even if stale probe resolves ok afterwards, status must remain disconnected
  resolveProbe({ ok: true, exitIp: '198.51.100.99' });
  await connectPromise;
  assert.equal(mgr.getSnapshot().status, 'disconnected');
  assert.equal(reg.store.ProxyEnable, '0x0');

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1f. Rapid node switch (A -> B): stale probe and stale exit from A cannot overwrite B', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  const children = [];
  let resolveProbeA = null;

  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true,
    pickPorts: async () => ({ mixedPort: 17890, socksPort: 17891, clashApiPort: 19190 }),
    validateConfigStdin: async () => ({ ok: true }),
    spawnProcess: () => {
      const c = makeFakeChild();
      children.push(c);
      return c;
    },
    waitForPortListening: async () => true,
    verifyRemoteReachability: () => {
      if (children.length === 1) {
        return new Promise((resolve) => {
          resolveProbeA = resolve;
        });
      }
      return Promise.resolve({ ok: true, exitIp: '198.51.100.200' });
    }
  });

  const pA = mgr.connect(makeConnectReq(makeRealNode('node-A')));
  await new Promise((r) => setTimeout(r, 25));

  // Rapidly switch to Node B while A is still probing
  const pB = mgr.connect(makeConnectReq(makeRealNode('node-B')));
  await pB;
  assert.equal(mgr.getSnapshot().status, 'connected');
  assert.equal(mgr.getSnapshot().activeNodeId, 'node-B');
  assert.equal(mgr.getSnapshot().activeIp, '198.51.100.200');

  // Now simulate stale failure from A's probe AND delayed exit event from child A
  resolveProbeA({ ok: false, reason: 'stale A failure' });
  children[0].emit('exit', 1, null);
  await pA;

  assert.equal(mgr.getSnapshot().status, 'connected');
  assert.equal(mgr.getSnapshot().activeNodeId, 'node-B');
  assert.equal(mgr.getSnapshot().error, undefined);
  assert.equal(reg.store.ProxyEnable, '0x1');

  await mgr.disconnect();
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('1g. Unexpected crash while connected: system-proxy trips Kill Switch; TUN honestly reports no independent OS block', async () => {
  const binDir = makeTempDir('veil-bin-');
  const dataDir = makeTempDir('veil-data-');
  const reg = makeMockRegistry();
  const guard = new WinProxyGuard(dataDir, reg.ops());
  let currentChild = null;

  const mgr = new SingBoxManager(binDir, dataDir, () => {}, {
    proxyGuard: guard,
    disableTelemetryLoop: true,
    pickPorts: async () => ({ mixedPort: 17890, socksPort: 17891, clashApiPort: 19190 }),
    validateConfigStdin: async () => ({ ok: true }),
    spawnProcess: () => {
      currentChild = makeFakeChild();
      return currentChild;
    },
    waitForPortListening: async () => true,
    verifyRemoteReachability: async () => ({ ok: true, exitIp: '198.51.100.55' })
  });

  // System proxy crash -> Kill Switch tripped, dead proxy held
  await mgr.connect(makeConnectReq(makeRealNode('sys-node'), { takeoverMode: 'system-proxy' }));
  currentChild.exitCode = 1;
  currentChild.emit('exit', 1, null);
  assert.equal(mgr.getSnapshot().status, 'disconnected');
  assert.equal(mgr.getSnapshot().killSwitchTripped, true);
  assert.equal(reg.store.ProxyEnable, '0x1', 'Proxy remains locked until user clears Kill Switch');

  const clearRes = await mgr.clearKillSwitchAndRestore();
  assert.equal(clearRes.ok, true);
  assert.equal(reg.store.ProxyEnable, '0x0');

  // TUN crash -> does NOT falsely claim OS firewall kill-switch is blocking traffic
  await mgr.connect(makeConnectReq(makeRealNode('tun-node'), { takeoverMode: 'tun' }));
  currentChild.exitCode = 1;
  currentChild.emit('exit', 1, null);
  assert.equal(mgr.getSnapshot().status, 'disconnected');
  assert.equal(mgr.getSnapshot().killSwitchTripped, false);
  assert.match(mgr.getSnapshot().error || '', /strict_route.*无独立系统防火墙阻断/);

  fs.rmSync(binDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// 2. Windows System Proxy Rollback, WinINet Script Quoting & Honest Audit
// ============================================================================

test('2a. WinProxyGuard rolls back immediately when a partial registry write fails and reports success', async () => {
  const dataDir = makeTempDir('veil-proxy-');
  const reg = makeMockRegistry({
    ProxyEnable: '0x1',
    ProxyServer: '10.0.0.2:8080',
    ProxyOverride: 'intranet.local;<local>'
  });
  let failedOnce = false;

  const guard = new WinProxyGuard(
    dataDir,
    reg.ops({
      setValue: async (k, _type, v) => {
        if (!failedOnce && k === 'ProxyEnable' && v === '1') {
          failedOnce = true;
          throw new Error('Access is denied on ProxyEnable');
        }
        reg.writes.push({ key: k, value: v });
        reg.store[k] = k === 'ProxyEnable' ? (v === '1' ? '0x1' : '0x0') : v;
      }
    })
  );

  await assert.rejects(
    () => guard.enableSystemProxy(7890),
    (err) => {
      assert.ok(err instanceof ProxyOperationError);
      assert.equal(err.rollbackAttempted, true);
      assert.equal(err.rollbackSucceeded, true);
      assert.match(err.message, /已自动恢复原系统代理设置/);
      return true;
    }
  );

  assert.equal(reg.store.ProxyEnable, '0x1');
  assert.equal(reg.store.ProxyServer, '10.0.0.2:8080');
  assert.equal(reg.store.ProxyOverride, 'intranet.local;<local>');
  assert.equal(fs.existsSync(guard.getBackupFilePath()), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('2e. WinProxyGuard recoverIfDirty restores crashed session proxy and deletes backup only on success', async () => {
  const dataDir = makeTempDir('veil-recover-');
  const reg = makeMockRegistry({ ProxyEnable: '0x1', ProxyServer: '127.0.0.1:7890', ProxyOverride: '<local>' });
  const guard = new WinProxyGuard(dataDir, reg.ops());

  fs.writeFileSync(
    guard.getBackupFilePath(),
    JSON.stringify({ proxyEnable: 0, proxyServer: '', proxyOverride: '', appliedByVeil: true })
  );

  const res = await guard.recoverIfDirty();
  assert.equal(res.ok, true);
  assert.equal(res.restored, true);
  assert.equal(reg.store.ProxyEnable, '0x0');
  assert.equal(reg.store.ProxyServer, '');
  assert.equal(fs.existsSync(guard.getBackupFilePath()), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('2b. WinProxyGuard explicitly reports rollback failure and retains backup file when restore also fails', async () => {
  const dataDir = makeTempDir('veil-proxy-fail-');
  const reg = makeMockRegistry({ ProxyEnable: '0x0', ProxyServer: '', ProxyOverride: '' });
  let failAll = false;

  const guard = new WinProxyGuard(
    dataDir,
    reg.ops({
      setValue: async (k, _type, v) => {
        if (k === 'ProxyOverride') {
          failAll = true;
          throw new Error('Registry locked');
        }
        if (failAll) {
          throw new Error('Restore write blocked');
        }
        reg.store[k] = v;
      }
    })
  );

  await assert.rejects(
    () => guard.enableSystemProxy(7890),
    (err) => {
      assert.ok(err instanceof ProxyOperationError);
      assert.equal(err.rollbackAttempted, true);
      assert.equal(err.rollbackSucceeded, false);
      assert.match(err.message, /自动恢复原代理设置失败/);
      return true;
    }
  );

  assert.equal(fs.existsSync(guard.getBackupFilePath()), true, 'Backup retained for next-startup recovery');

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('2c. WinINet PowerShell notify script has valid single-quoted C# signature and executes on Windows', () => {
  const script = buildWinInetNotifyScript();
  assert.equal(script.includes('\\"'), false, 'Must not contain invalid PowerShell backslash-escaped quotes');
  assert.ok(script.includes(`'[DllImport("wininet.dll")]`));

  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 15000 }
    );
  }
});

test('2d. Leak audit distinguishes live-probe vs config-only and never marks config-only as verified', async () => {
  const items = await runRealLeakAudit({
    connected: true,
    engineMode: 'live',
    takeoverMode: 'tun',
    netShieldEnabled: true,
    killSwitchEnabled: true,
    mixedPort: 65500, // unused port so probe finishes fast
    clashApiPort: 65501
  });

  const tunnel = items.find((i) => i.id === 'tunnel-probe');
  const ks = items.find((i) => i.id === 'killswitch-scope');
  const ns = items.find((i) => i.id === 'policy-shield');

  assert.equal(tunnel.checkType, 'live-probe');
  assert.equal(ks.checkType, 'config-only');
  assert.equal(ks.verified, false);
  assert.match(ks.detail, /不提供独立于内核的系统防火墙阻断/);
  assert.equal(ns.checkType, 'config-only');
  assert.equal(ns.verified, false);
});

// ============================================================================
// 3. Credential Protection, DPAPI Migration & Secret Redaction
// ============================================================================

test('3a. SecureVault encrypts as VEIL1, migrates legacy VEIL0, and preserves subscriptions & nodes', () => {
  const dataDir = makeTempDir('veil-vault-');
  const fakeCrypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'ascii'),
    decryptString: (b) => Buffer.from(b.toString('ascii'), 'base64').toString('utf8')
  };

  // Seed a legacy VEIL0 plaintext file to verify migration preserves user data
  const legacyPayload = {
    customNodes: [makeRealNode('existing-1')],
    subscriptions: [{ id: 'sub1', name: 'MySub', url: 'https://sub.example/api?token=SUPERSECRET', nodeCount: 1, updatedAt: '12:00' }],
    activeNodeId: 'existing-1'
  };
  fs.writeFileSync(
    path.join(dataDir, 'vault.enc'),
    Buffer.concat([Buffer.from('VEIL0', 'ascii'), Buffer.from(JSON.stringify(legacyPayload), 'utf8')])
  );

  const vault = new SecureVault(dataDir, fakeCrypto);
  assert.equal(vault.getState().encryptedAtRest, true);
  assert.equal(vault.getState().storageWarning, undefined);
  assert.equal(vault.getState().customNodes.length, 1);
  assert.equal(vault.getState().subscriptions[0].url, 'https://sub.example/api?token=SUPERSECRET');

  // File on disk must now be upgraded to VEIL1 and must NOT contain plaintext token
  const rawDisk = fs.readFileSync(path.join(dataDir, 'vault.enc'));
  assert.equal(rawDisk.subarray(0, 5).toString('ascii'), 'VEIL1');
  assert.equal(rawDisk.toString('utf8').includes('SUPERSECRET'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('3b. SecureVault refuses silent plaintext write when DPAPI encryption is unavailable', () => {
  const dataDir = makeTempDir('veil-vault-noenc-');
  const unavailableCrypto = {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('unavailable');
    },
    decryptString: () => {
      throw new Error('unavailable');
    }
  };

  const vault = new SecureVault(dataDir, unavailableCrypto);
  const updated = vault.update({
    customNodes: [makeRealNode('secret-node')],
    subscriptions: [{ id: 's1', name: 'Sub', url: 'https://sub.example/?token=TOPSECRET999', nodeCount: 1, updatedAt: '12:00' }]
  });

  assert.equal(updated.encryptedAtRest, false);
  assert.ok(updated.storageWarning && updated.storageWarning.includes('不会以明文写入磁盘'));
  assert.equal(fs.existsSync(path.join(dataDir, 'vault.enc')), false, 'Must NOT silently write plaintext vault.enc');

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('3c. redactSecrets strips subscription tokens, UUIDs, passwords, and WireGuard private keys', () => {
  const sample =
    '\u001b[31mFATAL\u001b[0m fetch https://user:pw@sub.example/link?token=abc123&obfs-password=xyz ' +
    'vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443 ' +
    'PrivateKey = WGPRIVATEKEYBASE64= {"private_key":"WG2","password":"PASS2"}';

  const redacted = redactSecrets(sample);
  assert.equal(redacted.includes('\u001b['), false);
  assert.equal(redacted.includes('abc123'), false);
  assert.equal(redacted.includes('xyz'), false);
  assert.equal(redacted.includes('11111111-2222'), false);
  assert.equal(redacted.includes('WGPRIVATEKEYBASE64'), false);
  assert.equal(redacted.includes('WG2'), false);
  assert.equal(redacted.includes('PASS2'), false);
});

// ============================================================================
// 4. Supply-Chain SHA-256 Verification
// ============================================================================

test('4a. Core SHA-256 verifier accepts exact digest and aborts on tampered file', () => {
  const tmpDir = makeTempDir('veil-hash-');
  const f = path.join(tmpDir, 'sample.bin');
  fs.writeFileSync(f, 'veil-binary-payload');
  const realHash = computeFileSha256(f);

  assert.equal(verifyFileSha256(f, realHash, 'sample.bin'), realHash);
  assert.throws(
    () => verifyFileSha256(f, '0'.repeat(64), 'tampered.bin'),
    /SHA-256 verification FAILED/
  );

  // Also verify local pinned binaries if present in resources/bin/
  const sb = path.resolve('resources/bin/sing-box.exe');
  if (fs.existsSync(sb)) {
    verifyFileSha256(sb, PINNED_CORES.singBox.binarySha256, 'resources/bin/sing-box.exe');
    // Verify real sing-box binary validates config via stdin without writing any file to disk
    const sampleCfg = JSON.stringify({
      log: { level: 'warn' },
      inbounds: [{ type: 'mixed', tag: 'm', listen: '127.0.0.1', listen_port: 27999 }],
      outbounds: [{ type: 'direct', tag: 'direct' }]
    });
    execFileSync(sb, ['check', '--disable-color', '-c', 'stdin'], {
      input: sampleCfg,
      windowsHide: true,
      timeout: 5000
    });
  }
  const wt = path.resolve('resources/bin/wintun.dll');
  if (fs.existsSync(wt)) {
    verifyFileSha256(wt, PINNED_CORES.wintun.binarySha256, 'resources/bin/wintun.dll');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
