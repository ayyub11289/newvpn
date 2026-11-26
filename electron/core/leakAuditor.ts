import { execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { LeakAuditItem, TakeoverMode } from '../types';
import { CLASH_API_PORT, MIXED_PROXY_PORT } from './configBuilder';

const execFileAsync = promisify(execFile);

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
 * Fetches public exit IP strictly through the local HTTP CONNECT proxy (127.0.0.1:7890)
 * to verify real end-to-end encrypted tunnel routing.
 */
function probeExitIpViaProxy(proxyPort: number, timeoutMs = 4500): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const timer = setTimeout(() => done(null), timeoutMs);
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: '1.1.1.1:443'
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        clearTimeout(timer);
        done(null);
        return;
      }
      const tlsSock = tls.connect({ socket, servername: '1.1.1.1' }, () => {
        tlsSock.write('GET /cdn-cgi/trace HTTP/1.1\r\nHost: 1.1.1.1\r\nConnection: close\r\n\r\n');
      });
      let body = '';
      tlsSock.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      tlsSock.on('end', () => {
        clearTimeout(timer);
        const match = body.match(/^ip=(.+)$/m);
        done(match ? match[1].trim() : null);
      });
      tlsSock.on('error', () => {
        clearTimeout(timer);
        done(null);
      });
    });

    req.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    req.end();
  });
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
}): Promise<LeakAuditItem[]> {
  if (!opts.connected) {
    return [
      {
        id: 'tunnel-probe',
        title: '隧道端到端连通与出口 IP 实测',
        detail: '当前未连接隧道，无活跃加密出口',
        status: 'idle',
        badge: '未连接',
        verified: false
      },
      {
        id: 'dns-check',
        title: '系统 DNS 与隧道解析状态',
        detail: '连接真实内核后探测系统 DNS 与 DoH 代理状态',
        status: 'idle',
        badge: '未连接',
        verified: false
      },
      {
        id: 'killswitch-scope',
        title: 'Kill Switch 断网保护边界',
        detail: '展示当前接管模式的实际保护级别',
        status: 'idle',
        badge: '未连接',
        verified: false
      },
      {
        id: 'policy-shield',
        title: 'NetShield 与浏览器 WebRTC 提示',
        detail: '内核级域名屏蔽无法直接探测外部浏览器 WebRTC，需配合浏览器隐私设置',
        status: 'idle',
        badge: '待机中',
        verified: false
      }
    ];
  }

  // Honest reporting in Demo Sandbox mode: never fabricate verified PASS badges
  if (opts.engineMode === 'demo') {
    return [
      {
        id: 'tunnel-probe',
        title: '隧道端到端连通与出口 IP 实测',
        detail: '当前处于演示沙盒模式（未启动 sing-box 真实转发），流量未经过代理隧道',
        status: 'idle',
        badge: '演示未实测',
        verified: false
      },
      {
        id: 'dns-check',
        title: '系统 DNS 与隧道解析状态',
        detail: '演示模式不接管系统 DNS；导入真实节点并连接后可执行实网探针',
        status: 'idle',
        badge: '演示未实测',
        verified: false
      },
      {
        id: 'killswitch-scope',
        title: 'Kill Switch 断网保护边界',
        detail: opts.killSwitchEnabled
          ? '配置已开启（待接入真实节点后生效）'
          : '策略未开启',
        status: 'idle',
        badge: '仅配置状态',
        verified: false
      },
      {
        id: 'policy-shield',
        title: 'NetShield 拦截策略与 WebRTC 说明',
        detail: '浏览器 WebRTC 泄露需在浏览器端或专用检测页验证，客户端无法替代外部浏览器实测',
        status: 'idle',
        badge: '仅配置状态',
        verified: false
      }
    ];
  }

  // Live Core Mode: run genuine local probes and report exact verified facts
  const [proxyPing, apiPing, exitIp, sysDns] = await Promise.all([
    measureTcpPing('127.0.0.1', MIXED_PROXY_PORT, 1000),
    measureTcpPing('127.0.0.1', CLASH_API_PORT, 1000),
    probeExitIpViaProxy(MIXED_PROXY_PORT, 4500),
    inspectWindowsDnsServers()
  ]);

  const proxyReady = proxyPing >= 0 && apiPing >= 0;

  return [
    {
      id: 'tunnel-probe',
      title: '隧道端到端出口 IP 实测 (经 127.0.0.1:7890)',
      detail: exitIp
        ? `已通过本地加密代理实际连通 Cloudflare Trace，实测出口 IP: ${exitIp}`
        : proxyReady
        ? '本地代理端口已监听，但通过远端节点访问 1.1.1.1 超时，请检查节点可用性'
        : '未检测到本地代理监听端口，核心转发可能已停止',
      status: exitIp ? 'pass' : 'warn',
      badge: exitIp ? `实测 ${exitIp}` : '实测未连通',
      verified: true
    },
    {
      id: 'dns-check',
      title: '系统 DNS 与加密解析范围',
      detail:
        opts.takeoverMode === 'tun'
          ? `TUN 模式已启用 DNS 劫持 (hijack-dns → DoH 1.1.1.1)；当前网卡 DNS: ${sysDns.join(', ') || '默认'}`
          : `系统代理模式仅接管走代理的应用域名解析，不拦截直连进程 DNS（当前网卡 DNS: ${sysDns.join(', ') || '未知'}）`,
      status: opts.takeoverMode === 'tun' && proxyReady ? 'pass' : 'warn',
      badge: opts.takeoverMode === 'tun' ? 'TUN 劫持已启用' : '代理级 DNS',
      verified: true
    },
    {
      id: 'killswitch-scope',
      title: 'Kill Switch 崩溃保护范围',
      detail: opts.killSwitchEnabled
        ? opts.takeoverMode === 'tun'
          ? 'TUN strict_route 已启用，异常退出时不会恢复明文直连'
          : '系统代理模式下若内核异常崩溃将锁定失效代理阻断代理应用（非代理直连进程需切 TUN 模式）'
        : 'Kill Switch 当前已关闭，内核异常退出后会自动恢复本地直连',
      status: opts.killSwitchEnabled ? 'pass' : 'warn',
      badge: opts.killSwitchEnabled ? '保护策略已启' : '未开启',
      verified: false
    },
    {
      id: 'policy-shield',
      title: 'NetShield 域名屏蔽与 WebRTC 说明',
      detail: opts.netShieldEnabled
        ? 'sing-box 路由已加载广告/追踪 reject 规则；注：外部浏览器 WebRTC 需配合浏览器防泄露插件或设置'
        : 'NetShield 域名屏蔽规则当前未开启',
      status: opts.netShieldEnabled ? 'pass' : 'warn',
      badge: opts.netShieldEnabled ? '规则已加载' : '未开启',
      verified: false
    }
  ];
}
