import { execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { LeakAuditItem, TakeoverMode } from '../types';
import { CLASH_API_PORT, MIXED_PROXY_PORT } from './configBuilder';

const execFileAsync = promisify(execFile);

export interface RemoteReachabilityResult {
  ok: boolean;
  exitIp?: string;
  probeTarget?: string;
  latencyMs?: number;
  reason?: string;
}

export function measureTcpPing(host: string, port: number, timeoutMs = 2200): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (val: number) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(val);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(Math.max(1, Math.round(performance.now() - start))));
    socket.on('timeout', () => finish(-1));
    socket.on('error', () => finish(-1));
  });
}

/**
 * Validates that a raw HTTP/1.x response from Cloudflare /cdn-cgi/trace over HTTPS
 * has HTTP 200 status and authentic trace fields (ip= plus ts= or fl=).
 */
export function parseCloudflareTraceResponse(rawHttp: string): { ok: boolean; exitIp?: string; reason?: string } {
  const splitIdx = rawHttp.indexOf('\r\n\r\n');
  const head = splitIdx >= 0 ? rawHttp.slice(0, splitIdx) : rawHttp;
  const body = splitIdx >= 0 ? rawHttp.slice(splitIdx + 4) : '';
  const statusLine = head.split('\r\n')[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\b/i);
  if (!statusMatch || statusMatch[1] !== '200') {
    return { ok: false, reason: `Cloudflare Trace 返回异常状态 (${statusLine || 'empty'})` };
  }
  const ipMatch = body.match(/^ip=([0-9a-fA-F.:]+)$/m);
  const hasTraceField = /^(?:fl|ts|visit_scheme)=.+$/m.test(body);
  if (!ipMatch || !hasTraceField) {
    return { ok: false, reason: '远端响应不包含预期 Cloudflare Trace 结构' };
  }
  return { ok: true, exitIp: ipMatch[1].trim() };
}

/**
 * Validates that a raw HTTP/1.x response from https://www.gstatic.com/generate_204
 * strictly returns HTTP 204 No Content with an empty body (rejecting 200/3xx redirects or captive portals).
 */
export function isValidHttps204Response(rawHttp: string): { ok: boolean; reason?: string } {
  const splitIdx = rawHttp.indexOf('\r\n\r\n');
  if (splitIdx < 0) {
    return { ok: false, reason: 'HTTPS 204 响应不完整' };
  }
  const head = rawHttp.slice(0, splitIdx);
  const body = rawHttp.slice(splitIdx + 4);
  const statusLine = head.split('\r\n')[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\b/i);
  if (!statusMatch) {
    return { ok: false, reason: `HTTPS 204 状态行无效 (${statusLine || 'empty'})` };
  }
  if (statusMatch[1] !== '204') {
    return { ok: false, reason: `期望 HTTPS 204 No Content，实际返回 HTTP ${statusMatch[1]}` };
  }
  if (body.length > 0) {
    return { ok: false, reason: 'HTTPS 204 响应包含非空响应体' };
  }
  return { ok: true };
}

/**
 * Probes Cloudflare Trace strictly over HTTPS through the local HTTP CONNECT proxy (127.0.0.1:<port>)
 * to verify real end-to-end encrypted tunnel connectivity and retrieve the remote exit IP.
 */
export function probeExitIpViaProxy(
  proxyPort: number,
  timeoutMs = 5000,
  signal?: AbortSignal
): Promise<{ ok: boolean; exitIp?: string; latencyMs?: number; reason?: string }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, reason: '已取消连接探测' });
      return;
    }

    const startedAt = performance.now();
    let settled = false;
    let tlsSock: tls.TLSSocket | null = null;
    let rawSock: net.Socket | null = null;

    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: '1.1.1.1:443'
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        req.destroy();
      } catch {
        // ignore
      }
      try {
        tlsSock?.destroy();
      } catch {
        // ignore
      }
      try {
        rawSock?.destroy();
      } catch {
        // ignore
      }
    };

    const done = (val: { ok: boolean; exitIp?: string; latencyMs?: number; reason?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onAbort = () => done({ ok: false, reason: '连接已取消' });
    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => done({ ok: false, reason: '经代理访问 https://1.1.1.1 超时' }), timeoutMs);

    req.on('connect', (res, socket) => {
      rawSock = socket;
      if (res.statusCode !== 200) {
        done({ ok: false, reason: `本地代理 CONNECT 返回 HTTP ${res.statusCode ?? 'unknown'}` });
        return;
      }
      tlsSock = tls.connect({ socket, servername: '1.1.1.1', rejectUnauthorized: true }, () => {
        tlsSock?.write('GET /cdn-cgi/trace HTTP/1.1\r\nHost: 1.1.1.1\r\nConnection: close\r\n\r\n');
      });
      let rawResp = '';
      tlsSock.on('data', (chunk) => {
        rawResp += chunk.toString('utf8');
      });
      tlsSock.on('end', () => {
        const parsed = parseCloudflareTraceResponse(rawResp);
        if (parsed.ok) {
          done({
            ok: true,
            exitIp: parsed.exitIp,
            latencyMs: Math.max(1, Math.round(performance.now() - startedAt))
          });
        } else {
          done({ ok: false, reason: parsed.reason });
        }
      });
      tlsSock.on('error', (err) => {
        done({ ok: false, reason: `远端 TLS 握手失败 (${err.message})` });
      });
    });

    req.on('error', (err) => {
      done({ ok: false, reason: `本地代理连接异常 (${err.message})` });
    });
    req.end();
  });
}

/**
 * Fallback HTTPS 204 reachability probe strictly over HTTP CONNECT + verified TLS
 * to https://www.gstatic.com/generate_204 (rejects plaintext HTTP, 200 HTML, and 3xx redirects).
 */
export function probeHttps204ViaProxy(
  proxyPort: number,
  targetHost = 'www.gstatic.com',
  targetPath = '/generate_204',
  timeoutMs = 4500,
  signal?: AbortSignal
): Promise<{ ok: boolean; latencyMs?: number; reason?: string }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, reason: '已取消连接探测' });
      return;
    }

    const startedAt = performance.now();
    let settled = false;
    let tlsSock: tls.TLSSocket | null = null;
    let rawSock: net.Socket | null = null;

    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:443`
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        req.destroy();
      } catch {
        // ignore
      }
      try {
        tlsSock?.destroy();
      } catch {
        // ignore
      }
      try {
        rawSock?.destroy();
      } catch {
        // ignore
      }
    };

    const done = (val: { ok: boolean; latencyMs?: number; reason?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onAbort = () => done({ ok: false, reason: '连接已取消' });
    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => done({ ok: false, reason: `经代理访问 https://${targetHost} 超时` }), timeoutMs);

    req.on('connect', (res, socket) => {
      rawSock = socket;
      if (res.statusCode !== 200) {
        done({ ok: false, reason: `本地代理 CONNECT ${targetHost}:443 返回 HTTP ${res.statusCode ?? 'unknown'}` });
        return;
      }
      tlsSock = tls.connect({ socket, servername: targetHost, rejectUnauthorized: true }, () => {
        tlsSock?.write(`GET ${targetPath} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`);
      });
      let rawResp = '';
      tlsSock.on('data', (chunk) => {
        rawResp += chunk.toString('utf8');
      });
      tlsSock.on('end', () => {
        const verified = isValidHttps204Response(rawResp);
        if (verified.ok) {
          done({ ok: true, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) });
        } else {
          done({ ok: false, reason: verified.reason });
        }
      });
      tlsSock.on('error', (err) => {
        done({ ok: false, reason: `备用 HTTPS TLS 握手失败 (${err.message})` });
      });
    });

    req.on('error', (err) => {
      done({ ok: false, reason: `经代理连接 https://${targetHost} 失败 (${err.message})` });
    });
    req.end();
  });
}

/**
 * Verifies that remote internet destinations are actually reachable over verified HTTPS
 * through the active proxy port before VEIL transitions to "connected / 已保护".
 */
export async function verifyRemoteReachabilityViaProxy(
  proxyPort: number,
  signal?: AbortSignal,
  timeoutMs = 5500
): Promise<RemoteReachabilityResult> {
  const cf = await probeExitIpViaProxy(proxyPort, timeoutMs, signal);
  if (cf.ok) {
    return {
      ok: true,
      exitIp: cf.exitIp,
      probeTarget: 'https://1.1.1.1/cdn-cgi/trace',
      latencyMs: cf.latencyMs
    };
  }
  if (signal?.aborted) {
    return { ok: false, reason: '连接已取消' };
  }

  const gstatic = await probeHttps204ViaProxy(
    proxyPort,
    'www.gstatic.com',
    '/generate_204',
    Math.min(timeoutMs, 4500),
    signal
  );
  if (gstatic.ok) {
    return {
      ok: true,
      probeTarget: 'https://www.gstatic.com/generate_204',
      latencyMs: gstatic.latencyMs
    };
  }

  return {
    ok: false,
    reason: cf.reason && gstatic.reason ? `${cf.reason}；备用 HTTPS 探测 ${gstatic.reason}` : cf.reason || gstatic.reason || '远端不可达'
  };
}

async function inspectWindowsDnsServers(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 } | Select-Object -ExpandProperty ServerAddresses -Unique) -join ","'
      ],
      { windowsHide: true, timeout: 3000 }
    );
    return stdout
      .trim()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export async function runRealLeakAudit(opts: {
  connected: boolean;
  engineMode: 'live' | 'demo';
  takeoverMode: TakeoverMode;
  netShieldEnabled: boolean;
  killSwitchEnabled: boolean;
  mixedPort?: number;
  clashApiPort?: number;
}): Promise<LeakAuditItem[]> {
  if (!opts.connected) {
    return [
      {
        id: 'tunnel-probe',
        title: '隧道端到端连通与出口 IP 实测',
        detail: '当前未连接隧道，无活跃加密出口',
        status: 'idle',
        badge: '未连接',
        verified: false,
        checkType: 'live-probe'
      },
      {
        id: 'dns-check',
        title: '系统网卡 DNS 与解析范围',
        detail: '连接真实内核后读取 Windows 网卡 DNS 并说明当前接管范围',
        status: 'idle',
        badge: '未连接',
        verified: false,
        checkType: 'config-only'
      },
      {
        id: 'killswitch-scope',
        title: '断线保护 (Kill Switch) 覆盖边界',
        detail: '仅检查客户端策略配置；展示系统代理模式与 TUN 模式的真实保护上限',
        status: 'idle',
        badge: '仅检查了配置',
        verified: false,
        checkType: 'config-only'
      },
      {
        id: 'policy-shield',
        title: 'NetShield 规则与浏览器 WebRTC 说明',
        detail: '仅检查内核路由规则开关；外部浏览器 WebRTC 泄露需在浏览器侧实测',
        status: 'idle',
        badge: '仅检查了配置',
        verified: false,
        checkType: 'config-only'
      }
    ];
  }

  // Honest reporting in explicit Demo Sandbox mode: never fabricate verified PASS badges
  if (opts.engineMode === 'demo') {
    return [
      {
        id: 'tunnel-probe',
        title: '隧道端到端连通与出口 IP 实测',
        detail: '当前处于显式演示沙盒模式（未启动 sing-box 真实转发），流量未经过代理隧道',
        status: 'warn',
        badge: '演示未加密',
        verified: false,
        checkType: 'live-probe'
      },
      {
        id: 'dns-check',
        title: '系统网卡 DNS 与解析范围',
        detail: '演示模式不接管系统 DNS；导入真实节点并连接后可执行实网探针',
        status: 'idle',
        badge: '演示未实测',
        verified: false,
        checkType: 'config-only'
      },
      {
        id: 'killswitch-scope',
        title: '断线保护 (Kill Switch) 覆盖边界',
        detail: opts.killSwitchEnabled
          ? '演示模式下不生效；接入真实节点后按当前接管模式生效'
          : '策略未开启',
        status: 'idle',
        badge: '仅检查了配置',
        verified: false,
        checkType: 'config-only'
      },
      {
        id: 'policy-shield',
        title: 'NetShield 拦截策略与 WebRTC 说明',
        detail: '浏览器 WebRTC 泄露需在浏览器端或专用检测页验证，客户端无法替代外部浏览器实测',
        status: 'idle',
        badge: '仅检查了配置',
        verified: false,
        checkType: 'config-only'
      }
    ];
  }

  // Live Core Mode: run genuine local + remote probes and clearly separate live probes from config-only checks
  const pMixed = opts.mixedPort ?? MIXED_PROXY_PORT;
  const pApi = opts.clashApiPort ?? CLASH_API_PORT;
  const [proxyPing, apiPing, remoteProbe, sysDns] = await Promise.all([
    measureTcpPing('127.0.0.1', pMixed, 1000),
    measureTcpPing('127.0.0.1', pApi, 1000),
    verifyRemoteReachabilityViaProxy(pMixed, undefined, 5000),
    inspectWindowsDnsServers()
  ]);

  const proxyReady = proxyPing >= 0 && apiPing >= 0;

  return [
    {
      id: 'tunnel-probe',
      title: `隧道端到端远端连通实测 (经 127.0.0.1:${pMixed})`,
      detail: remoteProbe.ok
        ? remoteProbe.exitIp
          ? `实测通过：经本地加密代理连通 ${remoteProbe.probeTarget}，实测出口 IP: ${remoteProbe.exitIp} (${remoteProbe.latencyMs ?? 0} ms)`
          : `实测通过：经本地加密代理连通 ${remoteProbe.probeTarget} (${remoteProbe.latencyMs ?? 0} ms)`
        : proxyReady
        ? `实测失败：本地端口已监听，但经远端节点探测外网失败（${remoteProbe.reason ?? '超时'}）`
        : '实测失败：未检测到本地代理监听端口，核心转发可能已停止',
      status: remoteProbe.ok ? 'pass' : 'warn',
      badge: remoteProbe.ok ? (remoteProbe.exitIp ? `实测通过 · ${remoteProbe.exitIp}` : '实测通过') : '实测未连通',
      verified: true,
      checkType: 'live-probe'
    },
    {
      id: 'dns-check',
      title: '系统 DNS 与隧道解析范围',
      detail:
        opts.takeoverMode === 'tun'
          ? `仅检查了配置与网卡 DNS（未执行独立外网 DNS 泄露实测）：TUN 配置启用了 hijack-dns → DoH 1.1.1.1；当前 Windows 网卡 DNS: ${sysDns.join(', ') || '默认'}`
          : `系统代理模式仅覆盖遵循 Windows 系统代理的应用域名解析，不拦截直连进程或自定义 UDP DNS（当前网卡 DNS: ${sysDns.join(', ') || '未知'}）`,
      status: 'warn',
      badge: opts.takeoverMode === 'tun' ? '仅检查了配置 (TUN)' : '仅覆盖代理应用',
      verified: false,
      checkType: 'config-only'
    },
    {
      id: 'killswitch-scope',
      title: '断线保护 (Kill Switch) 真实保护边界',
      detail: opts.killSwitchEnabled
        ? opts.takeoverMode === 'tun'
          ? 'TUN strict_route 仅在 sing-box 进程运行期间防止绕过；若内核崩溃或被强制结束，本客户端目前不提供独立于内核的系统防火墙阻断，IPv4/IPv6/DNS 将回退默认网卡。'
          : '系统代理模式下若内核异常崩溃，将保留失效代理地址以阻断遵循 Windows 系统代理（WinINet）的应用；不覆盖忽略系统代理的直连软件、原始 socket 或 UDP 流量。'
        : 'Kill Switch 当前已关闭，内核异常退出后会自动恢复原系统代理设置。',
      status: 'warn',
      badge: opts.killSwitchEnabled ? '仅检查了配置 (有限保护)' : '未开启',
      verified: false,
      checkType: 'config-only'
    },
    {
      id: 'policy-shield',
      title: 'NetShield 域名屏蔽与 WebRTC 说明',
      detail: opts.netShieldEnabled
        ? '仅检查了配置：sing-box 路由已加载广告/追踪 reject 规则；外部浏览器 WebRTC 泄露需在浏览器侧启用防泄露策略并实测。'
        : 'NetShield 域名屏蔽规则当前未开启。',
      status: opts.netShieldEnabled ? 'idle' : 'warn',
      badge: opts.netShieldEnabled ? '仅检查了配置' : '未开启',
      verified: false,
      checkType: 'config-only'
    }
  ];
}
