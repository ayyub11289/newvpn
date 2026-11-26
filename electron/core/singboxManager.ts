import { ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { ConnectRequest, CoreCapabilities, TelemetrySnapshot, TunnelStatus } from '../types';
import { buildSingBoxConfig, CLASH_API_PORT, MIXED_PROXY_PORT, RuntimePorts, SOCKS_PROXY_PORT } from './configBuilder';
import { measureTcpPing } from './leakAuditor';
import { WinProxyGuard } from './winProxyGuard';
import { inspectWindowsWifi } from './wifiWatcher';

const execFileAsync = promisify(execFile);

function formatKernelError(raw: string): string {
  const cleaned = raw
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\[[0-9;]{1,6}m/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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

export class SingBoxManager {
  private binDir: string;
  private userDataDir: string;
  private proxyGuard: WinProxyGuard;
  private proc: ChildProcess | null = null;
  private sessionId = 0;
  private status: TunnelStatus = 'disconnected';
  private handshakeStep = 0;
  private engineMode: 'live' | 'demo' = 'demo';
  private activeNodeId = 'jp-tyo';
  private activeIp = '114.88.204.17';
  private activePing = 34;
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

  constructor(binDir: string, userDataDir: string, onTelemetry: (snap: TelemetrySnapshot) => void) {
    this.binDir = binDir;
    this.userDataDir = userDataDir;
    this.proxyGuard = new WinProxyGuard(userDataDir);
    this.onTelemetry = onTelemetry;
  }

  getSingBoxPath(): string {
    return path.join(this.binDir, 'sing-box.exe');
  }

  getWintunPath(): string {
    return path.join(this.binDir, 'wintun.dll');
  }

  private getTempConfigPath(): string {
    return path.join(this.userDataDir, 'sing-box.runtime.json');
  }

  private cleanupTempConfig(): void {
    try {
      const cfgPath = this.getTempConfigPath();
      if (fs.existsSync(cfgPath)) {
        fs.unlinkSync(cfgPath);
      }
      // Also remove legacy filename from v1.0.0 if present
      const legacyPath = path.join(this.userDataDir, 'sing-box.config.json');
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
    } catch {
      // ignore cleanup errors
    }
  }

  getActivePorts(): RuntimePorts {
    return this.activePorts;
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

  async init(): Promise<void> {
    this.cleanupTempConfig();
    await this.proxyGuard.recoverIfDirty();
    this.startTelemetryLoop();
  }

  triggerBurst(): void {
    this.burstTicks = 8;
  }

  private emit(downMBps = 0, upMBps = 0): void {
    this.onTelemetry({
      status: this.status,
      handshakeStep: this.handshakeStep,
      engineMode: this.engineMode,
      downMBps,
      upMBps,
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
    });
  }

  /**
   * Validates generated JSON with `sing-box check -c <path>` before spawning.
   */
  private async validateConfigWithBinary(cfgPath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await execFileAsync(this.getSingBoxPath(), ['check', '-c', cfgPath], {
        cwd: this.binDir,
        windowsHide: true,
        timeout: 5000
      });
      return { ok: true };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return { ok: false, error: formatKernelError(e.stderr || e.message || 'sing-box check failed') };
    }
  }

  /**
   * Waits until the spawned process is still alive AND 127.0.0.1:7890 is listening.
   */
  private async waitForCoreReady(child: ChildProcess, mySession: number, port: number, maxWaitMs = 4500): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (mySession !== this.sessionId) return false;
      if (child.exitCode !== null || child.killed) return false;
      const ping = await measureTcpPing('127.0.0.1', port, 350);
      if (mySession !== this.sessionId) return false;
      if (child.exitCode !== null || child.killed) return false;
      if (ping >= 0) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  async connect(req: ConnectRequest): Promise<void> {
    // Advance session token FIRST so any old process's async exit handler is ignored
    const mySession = ++this.sessionId;
    if (this.handshakeTimer) {
      clearInterval(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    await this.stopProcessOnly();

    this.killSwitchEnabled = req.security.find((s) => s.id === 'killswitch')?.enabled ?? true;
    this.killSwitchTripped = false;
    this.lastError = undefined;
    this.activeNodeId = req.node.id;
    this.activeIp = req.node.ip || req.node.host;
    this.activePing = req.node.ping;
    this.status = 'connecting';
    this.handshakeStep = 0;
    this.prevTrafficBytes = { down: 0, up: 0 };

    const hasBin = fs.existsSync(this.getSingBoxPath());
    const canRunLive = hasBin && req.node.source !== 'demo' && Boolean(req.node.outbound);
    this.engineMode = canRunLive ? 'live' : 'demo';

    this.emit(0, 0);

    if (canRunLive) {
      const mixedPort = await pickFreePort(MIXED_PROXY_PORT, [17890, 27890, 37890]);
      const socksPort = await pickFreePort(SOCKS_PROXY_PORT, [17891, 27891, 37891]);
      const clashApiPort = await pickFreePort(CLASH_API_PORT, [19190, 19290, 19390]);
      this.activePorts = { mixedPort, socksPort, clashApiPort };
      if (mySession !== this.sessionId) return;

      const cfgObj = buildSingBoxConfig(req, this.activePorts);
      const cfgPath = this.getTempConfigPath();
      fs.mkdirSync(this.userDataDir, { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(cfgObj, null, 2), 'utf8');

      // Step 1: Pre-flight schema check via real sing-box binary
      this.handshakeStep = 1;
      this.emit(0, 0);
      const checkRes = await this.validateConfigWithBinary(cfgPath);
      if (mySession !== this.sessionId) return;

      if (!checkRes.ok) {
        this.cleanupTempConfig();
        this.status = 'disconnected';
        this.lastError = `内核配置校验失败: ${checkRes.error}`;
        await this.proxyGuard.disableSystemProxy();
        this.emit(0, 0);
        return;
      }

      // Step 2: Spawn sing-box and verify liveness + listening port
      let stderrTail = '';
      const child = spawn(this.getSingBoxPath(), ['run', '-c', cfgPath], {
        cwd: this.binDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.proc = child;

      child.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf8').trim();
        if (msg) stderrTail = formatKernelError(msg);
      });

      child.on('exit', (code, signal) => {
        // Guard against stale exit callbacks from previous sessions when switching nodes
        if (mySession !== this.sessionId) return;
        this.proc = null;
        this.cleanupTempConfig();

        const wasRunning = this.status === 'connected' || this.status === 'connecting';
        this.status = 'disconnected';

        if (wasRunning) {
          this.lastError = stderrTail || `sing-box 意外退出 (code=${code ?? 'null'}, signal=${signal ?? 'none'})`;
          if (this.killSwitchEnabled && req.takeoverMode === 'system-proxy') {
            // Do NOT restore plaintext proxy when Kill Switch is armed on unexpected core crash:
            // keep system proxy pointing at dead 127.0.0.1:7890 to block proxy-aware apps from plaintext fallback.
            this.killSwitchTripped = true;
          } else {
            void this.proxyGuard.disableSystemProxy();
          }
        }
        this.emit(0, 0);
      });

      this.handshakeStep = 2;
      this.emit(0, 0);

      const isReady = await this.waitForCoreReady(child, mySession, this.activePorts.mixedPort, 4500);
      if (mySession !== this.sessionId) return;

      if (!isReady) {
        await this.stopProcessOnly();
        this.cleanupTempConfig();
        this.status = 'disconnected';
        this.lastError = stderrTail || `sing-box 启动超时或提前退出，未监听 127.0.0.1:${this.activePorts.mixedPort}`;
        await this.proxyGuard.disableSystemProxy();
        this.emit(0, 0);
        return;
      }

      try {
        if (req.takeoverMode === 'system-proxy') {
          await this.proxyGuard.enableSystemProxy(this.activePorts.mixedPort);
        } else {
          await this.proxyGuard.disableSystemProxy();
        }
      } catch (err) {
        if (mySession !== this.sessionId) return;
        await this.stopProcessOnly();
        this.cleanupTempConfig();
        this.status = 'disconnected';
        this.lastError = `设置 Windows 系统代理失败: ${err instanceof Error ? err.message : String(err)}`;
        this.emit(0, 0);
        return;
      }

      if (mySession !== this.sessionId || child.exitCode !== null) return;
      this.status = 'connected';
      this.uptimeSeconds = 0;
      this.emit(0, 0);
      return;
    }

    // Demo Sandbox Handshake (never touches system proxy or writes credentials)
    this.handshakeTimer = setInterval(() => {
      if (mySession !== this.sessionId) {
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
  }

  async disconnect(): Promise<void> {
    this.sessionId++;
    if (this.handshakeTimer) {
      clearInterval(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    await this.stopProcessOnly();
    this.cleanupTempConfig();
    await this.proxyGuard.disableSystemProxy();
    this.status = 'disconnected';
    this.killSwitchTripped = false;
    this.lastError = undefined;
    this.emit(0, 0);
  }

  async clearKillSwitchAndRestore(): Promise<void> {
    this.killSwitchTripped = false;
    this.lastError = undefined;
    await this.proxyGuard.disableSystemProxy();
    this.emit(0, 0);
  }

  private async stopProcessOnly(): Promise<void> {
    if (this.proc) {
      const target = this.proc;
      this.proc = null;
      try {
        target.kill('SIGTERM');
      } catch {
        // ignore
      }
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
        } else {
          const burst = this.burstTicks > 0 ? 50 + Math.random() * 24 : 0;
          if (this.burstTicks > 0) this.burstTicks--;
          down = Number((12.4 + Math.random() * 9.2 + burst).toFixed(1));
          up = Number((2.1 + Math.random() * 2.5 + burst * 0.22).toFixed(1));
        }

        this.totalGB = Number((this.totalGB + (down + up) / 1024).toFixed(2));
        if (this.engineMode === 'demo' && Math.random() > 0.45) {
          this.blockedCount += Math.floor(Math.random() * 3) + 1;
        }
      }

      this.emit(down, up);
    }, 1000);
  }

  async shutdown(): Promise<void> {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    await this.disconnect();
  }
}
