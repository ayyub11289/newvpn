import { ConnectRequest } from '../types';

export const MIXED_PROXY_PORT = 7890;
export const SOCKS_PROXY_PORT = 7891;
export const CLASH_API_PORT = 19090;

/**
 * Compiles UI tunnel state into a production sing-box v1.11+ JSON configuration.
 */
export function buildSingBoxConfig(req: ConnectRequest): Record<string, unknown> {
  const killSwitch = req.security.find((s) => s.id === 'killswitch')?.enabled ?? true;
  const netShield = req.security.find((s) => s.id === 'netshield')?.enabled ?? true;
  const lanBypass = req.security.find((s) => s.id === 'lan')?.enabled ?? true;
  const cnDirect = req.autopilot.find((r) => r.id === 'cn-direct')?.enabled ?? true;
  const aiRoute = req.autopilot.find((r) => r.id === 'ai-route')?.enabled ?? true;

  const inbounds: Array<Record<string, unknown>> = [
    {
      type: 'mixed',
      tag: 'mixed-in',
      listen: '127.0.0.1',
      listen_port: MIXED_PROXY_PORT,
      sniff: true,
      sniff_override_destination: true
    },
    {
      type: 'socks',
      tag: 'socks-in',
      listen: '127.0.0.1',
      listen_port: SOCKS_PROXY_PORT,
      sniff: true
    }
  ];

  if (req.takeoverMode === 'tun') {
    inbounds.unshift({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'VEIL-Tunnel',
      inet4_address: '172.19.0.1/30',
      mtu: req.protocol === 'stealth' ? 1380 : 1420,
      auto_route: true,
      strict_route: killSwitch,
      stack: 'system',
      sniff: true
    });
  }

  const outbounds: Array<Record<string, unknown>> = [];

  const mainOutbound: Record<string, unknown> = req.node.outbound
    ? { ...req.node.outbound, tag: 'proxy' }
    : {
        type: 'socks',
        tag: 'proxy',
        server: req.node.host,
        server_port: req.node.port || 443
      };

  // Multi-Hop chaining via sing-box `detour`
  if (req.multiHop && req.entryNode && req.entryNode.id !== req.node.id && req.entryNode.outbound) {
    const entryOutbound: Record<string, unknown> = {
      ...req.entryNode.outbound,
      tag: 'entry-hop'
    };
    mainOutbound.detour = 'entry-hop';
    outbounds.push(mainOutbound, entryOutbound);
  } else {
    outbounds.push(mainOutbound);
  }

  outbounds.push(
    { type: 'direct', tag: 'direct' },
    { type: 'block', tag: 'block' },
    { type: 'dns', tag: 'dns-out' }
  );

  // Build Route Rules
  const routeRules: Array<Record<string, unknown>> = [{ protocol: 'dns', outbound: 'dns-out' }];

  if (lanBypass) {
    routeRules.push({ ip_is_private: true, outbound: 'direct' });
  }

  if (netShield) {
    routeRules.push({
      domain_suffix: ['doubleclick.net', 'googlesyndication.com', 'adservice.google.com', 'analytics.tiktok.com', 'telemetry.microsoft.com'],
      outbound: 'block'
    });
  }

  if (aiRoute) {
    routeRules.push({
      domain_suffix: ['openai.com', 'anthropic.com', 'claude.ai', 'github.com', 'googleapis.com', 'chatgpt.com'],
      outbound: 'proxy'
    });
  }

  if (cnDirect) {
    routeRules.push({
      domain_suffix: ['gov.cn', 'icbc.com.cn', 'cmbchina.com', 'alipay.com', 'weixin.qq.com', 'qq.com', '12306.cn'],
      outbound: 'direct'
    });
  }

  // Per-App Process Split Tunneling (effective in TUN mode)
  const bypassProcs = req.splitApps.filter((a) => a.mode === 'bypass').flatMap((a) => a.executables);
  const proxyProcs = req.splitApps.filter((a) => a.mode === 'proxy').flatMap((a) => a.executables);

  if (bypassProcs.length > 0) {
    routeRules.push({ process_name: bypassProcs, outbound: 'direct' });
  }
  if (proxyProcs.length > 0) {
    routeRules.push({ process_name: proxyProcs, outbound: 'proxy' });
  }

  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { tag: 'dns-remote', address: 'https://1.1.1.1/dns-query', detour: 'proxy' },
        { tag: 'dns-direct', address: 'https://223.5.5.5/dns-query', detour: 'direct' }
      ],
      rules: cnDirect ? [{ domain_suffix: ['cn', 'qq.com', 'alipay.com'], server: 'dns-direct' }] : [],
      final: 'dns-remote',
      strategy: 'prefer_ipv4'
    },
    inbounds,
    outbounds,
    route: {
      rules: routeRules,
      final: 'proxy',
      auto_detect_interface: true
    },
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${CLASH_API_PORT}`,
        secret: ''
      }
    }
  };
}
