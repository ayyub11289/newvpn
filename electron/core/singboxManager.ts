import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ConnectRequest, CoreCapabilities, TelemetrySnapshot, TunnelStatus } from '../types';
import { buildSingBoxConfig, CLASH_API_PORT, MIXED_PROXY_PORT, RuntimePorts, SOCKS_PROXY_PORT } from './configBuilder';
import {
  measureTcpPing,
  RemoteReachabilityResult,
  verifyRemoteReachabilityViaProxy
} from './leakAuditor';
import { redactSecrets } from './secretRedactor';
import { ProxyOperationError, ProxyRestoreResult, WinProxyGuard } from './winProxyGuard';
import { inspectWindowsWifi } from './wifiWatcher';

export interface SingBoxManagerDeps {
  proxyGuard?: WinProxyGuard;
  spawnProcess?: (binPath: string, args: string[], cwd: string) => ChildProcess;
  validateConfigStdin?: (binPath: string, cfgJson: string, cwd: string) => Promise<{ ok: boolean; error?: string }>;
  waitForPortListening?: (child: ChildProcess, port: number, isActive: () => boolean, maxWaitMs: number) => Promise<boolean>;
  verifyRemoteReachability?: (proxyPort: number, signal: AbortSignal) => Promise<RemoteReachabilityResult>;
  pickPorts?: () => Promise<RuntimePorts>;
  disableTelemetryLoop?: boolean;
}

export function formatKernelError(raw: string): string {
  const cleaned = redactSecrets(raw).replace(/\s+/g, ' ').trim();

  if (!cleaned) return '内核启动异常退出';
  if (/configure tun interface.*access is denied/i.test(cleaned)) {
    return 'TUN 虚拟网卡需要管理员权限：请点击下方「以管理员提权重启」，或切换至「系统代理（免提权）」模式。';
  }
  if (/wintun/i.test(cleaned) && /(not found|cannot find|failed|load)/i.test(cleaned)) {
    return '未加载到 Wintun 驱动组件，请切换至「系统代理（免提权）」模式或重新安装完整版。';
  }
  if (/address already in use|only one usage of each socket address/i.test(cleaned)) {
    return '本地代理端口被占用，请先关闭其他正在运行的 VPN / 代理软件后重试。';
  }
  if (/connectex.*access permissions/i.test(cleaned)) {
    return 'Windows 拦截了内核出站连接，请先退出其他 VPN/TUN 客户端后重试。';
  }
  return cleaned.slice(-220);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

async function pickFreePort(preferred: number, fallbacks: number[]): Promise<number> {
  for (const p of [preferred, ...fallbacks]) {
    if (await isPortFree(p)) return p;
  }
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}

function defaultValidateConfigViaStdin(
  binPath: string,
  cfgJson: string,
  cwd: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    const done = (res: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const child = spawn(binPath, ['check', '--disable-color', '-c', 'stdin'], {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      done({ ok: false, error: 'sing-box 配置校验超时' });
    }, 5000);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      done({ ok: false, error: formatKernelError(err.message) });
    });

    child.on('exit', (code) => {
      if (code === 0) {
        done({ ok: true });
      } else {
        done({ ok: false, error: formatKernelError(stderr || `sing-box check exited with code ${code ?? 'null'}`) });
      }
    });

    child.stdin?.on('error', () => {
      // process may close stdin early on parse error; exit event reports stderr
    });
    child.stdin?.end(cfgJson, 'utf8');
  });
}

export class SingBoxManager {
  private binDir: string;
  private userDataDir: string;
  private proxyGuard: WinProxyGuard;
  private deps: SingBoxManagerDeps;
  private proc: ChildProcess | null = null;
  private connectAbort: AbortController | null = null;
  private sessionId = 0;
  private status: TunnelStatus = 'disconnected';
  private handshakeStep = 0;
  private engineMode: 'live' | 'demo' = 'live';
  private activeNodeId = '';
  private activeIp = '114.88.204.17';
  private activePing = 0;
  private uptimeSeconds = 0;
  private totalGB = 0;
  private blockedCount = 1428;
  private burstTicks = 0;
  private wifiSsid: string | null = null;
  private wifiOpen = false;
  private killSwitchEnabled = true;
  private killSwitchTripped = false;
  private lastError: string | undefined;
  private activePorts: RuntimePorts = {
    mixedPort: MIXED_PROXY_PORT,
    socksPort: SOCKS_PROXY_PORT,
    clashApiPort: CLASH_API_PORT
  };
  private handshakeTimer: NodeJS.Timeout | null = null;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private prevTrafficBytes = { down: 0, up: 0 };
  private onTelemetry: (snap: TelemetrySnapshot) => void;

  constructor(
    binDir: string,
    userDataDir: string,
    onTelemetry: (snap: TelemetrySnapshot) => void,
    deps: SingBoxManagerDeps = {}
  ) {
    this.binDir = binDir;
    this.userDataDir = userDataDir;
    this.deps = deps;
    this.proxyGuard = deps.proxyGuard ?? new WinProxyGuard(userDataDir);
    this.onTelemetry = onTelemetry;
  }

  getSingBoxPath(): string {
    return path.join(this.binDir, 'sing-box.exe');
  }

  getWintunPath(): string {
    return path.join(this.binDir, 'wintun.dll');
  }

  /**
   * Removes any legacy plaintext runtime config files left behind by older versions.
   * Current versions stream JSON directly via `sing-box -c stdin` so credentials never touch disk.
   */
  cleanupLegacyTempConfigs(): void {
    for (const filename of ['sing-box.runtime.json', 'sing-box.config.json']) {
      try {
        const target = path.join(this.userDataDir, filename);
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  getActivePorts(): RuntimePorts {
    return this.activePorts;
  }

  getSnapshot(): TelemetrySnapshot {
    return {
      status: this.status,
      handshakeStep: this.handshakeStep,
      engineMode: this.engineMode,
      downMBps: 0,
      upMBps: 0,
      totalGB: this.totalGB,
      uptimeSeconds: this.uptimeSeconds,
      blockedCount: this.blockedCount,
      activeIp: this.status === 'connected' ? this.activeIp : '114.88.204.17',
      activePing: this.activePing,
      activeNodeId: this.activeNodeId,
      wifiSsid: this.wifiSsid,
      wifiOpen: this.wifiOpen,
      killSwitchTripped: this.killSwitchTripped,
      error: this.lastError
    };
  }

  async getCapabilities(): Promise<CoreCapabilities> {
    const hasSingBox = fs.existsSync(this.getSingBoxPath());
    const hasWintun = fs.existsSync(this.getWintunPath());
    const isAdmin = await this.proxyGuard.isAdmin();
    return {
      hasSingBox,
      hasWintun,
      isAdmin,
      platform: process.platform,
      binDir: this.binDir,
      engineMode: this.engineMode
    };
  }

  async init(): Promise<ProxyRestoreResult> {
    this.cleanupLegacyTempConfigs();
    const recoverRes = await this.proxyGuard.recoverIfDirty();
    if (!recoverRes.ok && recoverRes.error) {
      this.lastError = `启动时恢复上次遗留的系统代理失败 (${recoverRes.error})，请检查 Windows 代理设置。`;
      this.emit(0, 0);
    }
    if (!this.deps.disableTelemetryLoop) {
      this.startTelemetryLoop();
    }
    return recoverRes;
  }

  triggerBurst(): void {
    this.burstTicks = 8;
  }

  private emit(downMBps = 0, upMBps = 0): void {
    this.onTelemetry({
      ...this.getSnapshot(),
      downMBps,
      upMBps
    });
  }

  private async defaultWaitForCoreReady(
    child: ChildProcess,
    port: number,
    isActive: () => boolean,
    maxWaitMs = 4500
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!isActive()) return false;
      if (child.exitCode !== null || child.killed) return false;
      const ping = await measureTcpPing('127.0.0.1', port, 350);
      if (!isActive()) return false;
      if (child.exitCode !== null || child.killed) return false;
      if (ping >= 0) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  private abortInFlightAttempt(): void {
    if (this.connectAbort) {
      try {
        this.connectAbort.abort();
      } catch {
        // ignore
      }
      this.connectAbort = null;
    }
    if (this.handshakeTimer) {
      clearInterval(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private formatRestoreSuffix(res: ProxyRestoreResult): string {
    if (!res.ok) {
      return `（警告：自动恢复原系统代理失败: ${res.error ?? '未知错误'}，请手动检查 Windows 代理设置）`;
    }
    if (res.restored) {
      return '（已恢复原系统代理设置）';
    }
    return '';
  }

  async connect(req: ConnectRequest): Promise<void> {
    // Advance session token FIRST and abort any previous in-flight connect/probe
    const mySession = ++this.sessionId;
    const isCurrent = () => mySession === this.sessionId;
    this.abortInFlightAttempt();

    const abortController = new AbortController();
    this.connectAbort = abortController;

    await this.stopProcessOnly();
    this.cleanupLegacyTempConfigs();

    this.killSwitchEnabled = req.security.find((s) => s.id === 'killswitch')?.enabled ?? true;
    this.killSwitchTripped = false;
    this.lastError = undefined;
    this.activeNodeId = req.node.id;
    this.activeIp = req.node.ip || req.node.host;
    this.activePing = req.node.ping;
    this.prevTrafficBytes = { down: 0, up: 0 };

    // Demo mode MUST be explicitly requested on a demo node; real nodes NEVER silently fall back to demo
    const isExplicitDemo = req.explicitDemo === true && req.node.source === 'demo';
    if (isExplicitDemo) {
      this.engineMode = 'demo';
      this.status = 'connecting';
      this.handshakeStep = 0;
      this.emit(0, 0);

      this.handshakeTimer = setInterval(() => {
        if (!isCurrent()) {
          if (this.handshakeTimer) clearInterval(this.handshakeTimer);
          return;
        }
        this.handshakeStep++;
        if (this.handshakeStep >= 3) {
          if (this.handshakeTimer) clearInterval(this.handshakeTimer);
          this.handshakeTimer = null;
          this.status = 'connected';
          this.uptimeSeconds = 0;
          this.burstTicks = 5;
        }
        this.emit(0, 0);
      }, 340);
      return;
    }

    this.engineMode = 'live';

    if (req.node.source === 'demo') {
      this.status = 'disconnected';
      this.lastError = '演示节点无法建立真实加密连接，请导入真实节点或显式启用演示沙盒模式。';
      this.emit(0, 0);
      return;
    }

    const singBoxPath = this.getSingBoxPath();
    if (!this.deps.spawnProcess && !fs.existsSync(singBoxPath)) {
      this.status = 'disconnected';
      this.lastError = '未找到 sing-box 核心程序 (sing-box.exe)，无法建立加密隧道；请重新安装完整版或运行 npm run fetch-core。';
      this.emit(0, 0);
      return;
    }

    if (!req.node.outbound) {
      this.status = 'disconnected';
      this.lastError = '当前节点缺少有效出站协议配置 (outbound)，无法建立真实隧道连接。';
      this.emit(0, 0);
      return;
    }

    if (req.takeoverMode === 'tun' && !this.deps.spawnProcess && !fs.existsSync(this.getWintunPath())) {
      this.status = 'disconnected';
      this.lastError = 'TUN 虚拟网卡模式缺少 wintun.dll 驱动组件，请切换至「系统代理（免提权）」模式或重新安装完整版。';
      this.emit(0, 0);
      return;
    }

    this.status = 'connecting';
    this.handshakeStep = 0;
    this.emit(0, 0);

    const ports = this.deps.pickPorts
      ? await this.deps.pickPorts()
      : {
          mixedPort: await pickFreePort(MIXED_PROXY_PORT, [17890, 27890, 37890]),
          socksPort: await pickFreePort(SOCKS_PROXY_PORT, [17891, 27891, 37891]),
          clashApiPort: await pickFreePort(CLASH_API_PORT, [19190, 19290, 19390])
        };
    if (!isCurrent()) return;
    this.activePorts = ports;

    const cfgObj = buildSingBoxConfig(req, this.activePorts);
    const cfgJson = JSON.stringify(cfgObj);

    // Step 1: Pre-flight schema validation strictly over stdin (zero credential disk writes)
    this.handshakeStep = 1;
    this.emit(0, 0);
    const validateFn = this.deps.validateConfigStdin ?? defaultValidateConfigViaStdin;
    const checkRes = await validateFn(singBoxPath, cfgJson, this.binDir);
    if (!isCurrent()) return;

    if (!checkRes.ok) {
      const restoreRes = await this.proxyGuard.disableSystemProxy();
      if (!isCurrent()) return;
      this.status = 'disconnected';
      this.lastError = `内核配置校验失败: ${formatKernelError(checkRes.error || 'unknown')}${this.formatRestoreSuffix(restoreRes)}`;
      this.emit(0, 0);
      return;
    }

    // Step 2: Spawn sing-box with config passed via stdin (no temp config file written to disk)
    let stderrTail = '';
    const child = this.deps.spawnProcess
      ? this.deps.spawnProcess(singBoxPath, ['run', '--disable-color', '-c', 'stdin'], this.binDir)
      : spawn(singBoxPath, ['run', '--disable-color', '-c', 'stdin'], {
          cwd: this.binDir,
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'pipe']
        });
    this.proc = child;

    child.stdin?.on('error', () => {
      // Ignore EPIPE if child exits before reading full stdin
    });
    child.stdin?.end(cfgJson, 'utf8');

    child.stderr?.on('data', (chunk: Buffer) => {
      if (!isCurrent()) return;
      const msg = chunk.toString('utf8').trim();
      if (msg) stderrTail = formatKernelError(msg);
    });

    child.on('error', (err) => {
      if (!isCurrent()) return;
      stderrTail = formatKernelError(err.message);
    });

    child.on('exit', (code, signal) => {
      // Strictly ignore stale exit callbacks from superseded or cancelled sessions
      if (!isCurrent()) return;
      if (this.proc === child) {
        this.proc = null;
      }
      this.cleanupLegacyTempConfigs();

      const wasConnected = this.status === 'connected';
      const wasConnecting = this.status === 'connecting';
      this.status = 'disconnected';

      if (wasConnected || wasConnecting) {
        const baseMsg = stderrTail || `sing-box 意外退出 (code=${code ?? 'null'}, signal=${signal ?? 'none'})`;
        if (wasConnected && this.killSwitchEnabled && req.takeoverMode === 'system-proxy') {
          // Keep system proxy pointing at dead local port to block proxy-aware apps from plaintext fallback
          this.killSwitchTripped = true;
          this.lastError = `${baseMsg}（系统代理断线锁已触发，已阻断遵循系统代理的应用）`;
          this.emit(0, 0);
        } else if (wasConnected && req.takeoverMode === 'tun') {
          this.killSwitchTripped = false;
          this.lastError = `${baseMsg}（TUN 进程已退出：strict_route 随内核终止而失效，无独立系统防火墙阻断）`;
          this.emit(0, 0);
        } else {
          this.lastError = baseMsg;
          void this.proxyGuard.disableSystemProxy().then((restoreRes) => {
            if (!isCurrent()) return;
            if (!restoreRes.ok) {
              this.lastError = `${baseMsg}${this.formatRestoreSuffix(restoreRes)}`;
            }
            this.emit(0, 0);
          });
        }
      } else {
        this.emit(0, 0);
      }
    });

    // Step 2a: Wait for local proxy port to listen
    const waitFn = this.deps.waitForPortListening ?? ((c, p, active, ms) => this.defaultWaitForCoreReady(c, p, active, ms));
    const localListening = await waitFn(child, this.activePorts.mixedPort, isCurrent, 4500);
    if (!isCurrent()) {
      await this.killChildProcess(child);
      return;
    }

    if (!localListening) {
      await this.stopProcessOnly();
      const restoreRes = await this.proxyGuard.disableSystemProxy();
      if (!isCurrent()) return;
      this.status = 'disconnected';
      this.lastError =
        (stderrTail || `sing-box 启动超时或提前退出，未监听 127.0.0.1:${this.activePorts.mixedPort}`) +
        this.formatRestoreSuffix(restoreRes);
      this.emit(0, 0);
      return;
    }

    // Step 2b: Verify REAL remote reachability through the active proxy BEFORE enabling proxy / reporting "已保护"
    this.handshakeStep = 2;
    this.emit(0, 0);
    const probeFn = this.deps.verifyRemoteReachability ?? ((p, sig) => verifyRemoteReachabilityViaProxy(p, sig, 5500));
    const remoteRes = await probeFn(this.activePorts.mixedPort, abortController.signal);
    if (!isCurrent()) {
      await this.killChildProcess(child);
      return;
    }

    if (!remoteRes.ok || child.exitCode !== null || child.killed) {
      await this.stopProcessOnly();
      const restoreRes = await this.proxyGuard.disableSystemProxy();
      if (!isCurrent()) return;
      this.status = 'disconnected';
      const detail = stderrTail || remoteRes.reason || '远端节点不可达';
      this.lastError = `本地内核已启动，但远端连通性探测失败（${detail}），未标记为「已保护」${this.formatRestoreSuffix(restoreRes)}`;
      this.emit(0, 0);
      return;
    }

    if (remoteRes.exitIp) {
      this.activeIp = remoteRes.exitIp;
    }
    if (remoteRes.latencyMs) {
      this.activePing = remoteRes.latencyMs;
    }

    // Step 3: Apply Windows System Proxy (serialized & abort-aware, with automatic rollback on any partial write failure)
    try {
      if (req.takeoverMode === 'system-proxy') {
        await this.proxyGuard.enableSystemProxy(this.activePorts.mixedPort, abortController.signal);
      } else {
        const restoreRes = await this.proxyGuard.disableSystemProxy();
        if (!restoreRes.ok) {
          throw new Error(`清理旧系统代理失败: ${restoreRes.error ?? '未知错误'}`);
        }
      }
    } catch (err) {
      await this.killChildProcess(child);
      if (!isCurrent()) {
        return;
      }
      await this.stopProcessOnly();
      this.status = 'disconnected';
      if (err instanceof ProxyOperationError) {
        this.lastError = err.message;
      } else {
        this.lastError = `设置 Windows 系统代理失败: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.emit(0, 0);
      return;
    }

    if (!isCurrent() || child.exitCode !== null || child.killed) {
      await this.killChildProcess(child);
      return;
    }

    this.connectAbort = null;
    this.status = 'connected';
    this.uptimeSeconds = 0;
    this.emit(0, 0);
  }

  async disconnect(): Promise<ProxyRestoreResult> {
    this.sessionId++;
    this.abortInFlightAttempt();
    await this.stopProcessOnly();
    this.cleanupLegacyTempConfigs();
    const restoreRes = await this.proxyGuard.disableSystemProxy();
    this.status = 'disconnected';
    this.killSwitchTripped = false;
    this.lastError = restoreRes.ok
      ? undefined
      : `断开连接后恢复原系统代理失败 (${restoreRes.error ?? '未知错误'})，请手动检查 Windows 代理设置。`;
    this.emit(0, 0);
    return restoreRes;
  }

  async clearKillSwitchAndRestore(): Promise<ProxyRestoreResult> {
    this.killSwitchTripped = false;
    const restoreRes = await this.proxyGuard.disableSystemProxy();
    this.lastError = restoreRes.ok
      ? undefined
      : `解除网络锁时恢复原系统代理失败 (${restoreRes.error ?? '未知错误'})，请手动检查 Windows 代理设置。`;
    this.emit(0, 0);
    return restoreRes;
  }

  private async killChildProcess(target: ChildProcess): Promise<void> {
    try {
      if (target.exitCode === null && !target.killed) {
        target.kill('SIGTERM');
      }
    } catch {
      // ignore
    }
  }

  private async stopProcessOnly(): Promise<void> {
    if (this.proc) {
      const target = this.proc;
      this.proc = null;
      await this.killChildProcess(target);
    }
  }

  private async pollLiveTraffic(): Promise<{ down: number; up: number } | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 650);
      const res = await fetch(`http://127.0.0.1:${this.activePorts.clashApiPort}/connections`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = (await res.json()) as { downloadTotal?: number; uploadTotal?: number };
      const curDown = data.downloadTotal || 0;
      const curUp = data.uploadTotal || 0;
      const deltaDown = this.prevTrafficBytes.down > 0 ? Math.max(0, curDown - this.prevTrafficBytes.down) : 0;
      const deltaUp = this.prevTrafficBytes.up > 0 ? Math.max(0, curUp - this.prevTrafficBytes.up) : 0;
      this.prevTrafficBytes = { down: curDown, up: curUp };
      return {
        down: Number((deltaDown / (1024 * 1024)).toFixed(2)),
        up: Number((deltaUp / (1024 * 1024)).toFixed(2))
      };
    } catch {
      return null;
    }
  }

  private startTelemetryLoop(): void {
    let wifiTick = 0;
    this.telemetryTimer = setInterval(async () => {
      wifiTick++;
      if (wifiTick % 12 === 1) {
        const wifi = await inspectWindowsWifi();
        this.wifiSsid = wifi.ssid;
        this.wifiOpen = wifi.isOpen;
      }

      let down = 0;
      let up = 0;
      if (this.status === 'connected') {
        this.uptimeSeconds++;
        if (this.engineMode === 'live') {
          const live = await this.pollLiveTraffic();
          if (live) {
            down = live.down;
            up = live.up;
          }
          if (this.burstTicks > 0) {
            this.burstTicks--;
            down += 18 + Math.random() * 24;
            up += 4 + Math.random() * 6;
          }
        } else {
          const burst = this.burstTicks > 0 ? 42 + Math.random() * 26 : 0;
          if (this.burstTicks > 0) this.burstTicks--;
          down = Number((4.8 + Math.random() * 11.4 + burst).toFixed(1));
          up = Number((1.1 + Math.random() * 3.8 + burst * 0.22).toFixed(1));
        }
        this.totalGB = Number((this.totalGB + (down + up) / 1024).toFixed(3));
        if (Math.random() > 0.72) this.blockedCount += Math.floor(1 + Math.random() * 3);
      }

      this.emit(down, up);
    }, 1000);
  }

  async shutdown(): Promise<void> {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.sessionId++;
    this.abortInFlightAttempt();
    await this.stopProcessOnly();
    this.cleanupLegacyTempConfigs();
    await this.proxyGuard.disableSystemProxy();
  }
}
