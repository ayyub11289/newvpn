import { ConnectRequest, VpnNode } from '../types';

export const MIXED_PROXY_PORT = 7890;
export const SOCKS_PROXY_PORT = 7891;
export const CLASH_API_PORT = 19090;

/**
 * Normalizes legacy WireGuard outbound specs (e.g. from older saved vaults)
 * into sing-box 1.11–1.14 native `endpoints` format.
 */
function normalizeWireGuardEndpoint(spec: Record<string, unknown>, tag: string): Record<string, unknown> {
  if (Array.isArray(spec.peers)) {
    return { ...spec, type: 'wireguard', tag };
  }
  // Migrate legacy fields: server/server_port/local_address/peer_public_key
  const localAddr = Array.isArray(spec.local_address)
    ? spec.local_address
    : [String(spec.local_address || '10.66.66.2/32')];

  const peer: Record<string, unknown> = {
    address: String(spec.server || ''),
    port: Number(spec.server_port || 51820),
    public_key: String(spec.peer_public_key || ''),
    allowed_ips: ['0.0.0.0/0', '::/0']
  };
  if (spec.pre_shared_key) {
    peer.pre_shared_key = String(spec.pre_shared_key);
  }

  return {
    type: 'wireguard',
    tag,
    address: localAddr,
    private_key: String(spec.private_key || ''),
    mtu: Number(spec.mtu || 1420),
    peers: [peer]
  };
}

function addNodeToConfig(
  node: VpnNode,
  tag: string,
  detourTag: string | undefined,
  endpoints: Array<Record<string, unknown>>,
  outbounds: Array<Record<string, unknown>>
): void {
  const raw = node.outbound
    ? { ...node.outbound }
    : {
        type: 'socks',
        server: node.host,
        server_port: node.port || 443
      };

  if (raw.type === 'wireguard') {
    const ep = normalizeWireGuardEndpoint(raw, tag);
    if (detourTag) ep.detour = detourTag;
    endpoints.push(ep);
  } else {
    const ob: Record<string, unknown> = { ...raw, tag };
    if (detourTag) ob.detour = detourTag;
    outbounds.push(ob);
  }
}

/**
 * Compiles UI tunnel state into a strictly valid sing-box 1.14+ JSON configuration:
 * - No removed `block` / `dns` outbounds (uses Route Rule Actions: sniff, hijack-dns, reject)
 * - New typed DNS server schema (`type: "https"`, `server`, `server_port`, `path`)
 * - TUN `address: [...]` array instead of removed `inet4_address`
 * - WireGuard placed in top-level `endpoints` instead of removed `wireguard` outbound
 */
export interface RuntimePorts {
  mixedPort: number;
  socksPort: number;
  clashApiPort: number;
}

export function buildSingBoxConfig(
  req: ConnectRequest,
  ports: RuntimePorts = { mixedPort: MIXED_PROXY_PORT, socksPort: SOCKS_PROXY_PORT, clashApiPort: CLASH_API_PORT }
): Record<string, unknown> {
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
      listen_port: ports.mixedPort
    },
    {
      type: 'socks',
      tag: 'socks-in',
      listen: '127.0.0.1',
      listen_port: ports.socksPort
    }
  ];

  if (req.takeoverMode === 'tun') {
    inbounds.unshift({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'Ethernet-Net0',
      address: ['172.24.88.1/30'],
      mtu: req.protocol === 'stealth' ? 1380 : 1420,
      auto_route: true,
      strict_route: killSwitch,
      stack: 'system'
    });
  }

  const endpoints: Array<Record<string, unknown>> = [];
  const outbounds: Array<Record<string, unknown>> = [];

  const useMultiHop =
    req.multiHop &&
    Boolean(req.entryNode) &&
    req.entryNode!.id !== req.node.id &&
    Boolean(req.entryNode!.outbound);

  if (useMultiHop && req.entryNode) {
    addNodeToConfig(req.node, 'proxy', 'entry-hop', endpoints, outbounds);
    addNodeToConfig(req.entryNode, 'entry-hop', undefined, endpoints, outbounds);
  } else {
    addNodeToConfig(req.node, 'proxy', undefined, endpoints, outbounds);
  }

  outbounds.push({ type: 'direct', tag: 'direct' });

  // sing-box 1.11–1.14 Route Rule Actions
  const routeRules: Array<Record<string, unknown>> = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' }
  ];

  if (lanBypass) {
    routeRules.push({ ip_is_private: true, outbound: 'direct' });
  }

  if (netShield) {
    routeRules.push({
      domain_suffix: [
        'doubleclick.net',
        'googlesyndication.com',
        'adservice.google.com',
        'analytics.tiktok.com',
        'telemetry.microsoft.com'
      ],
      action: 'reject'
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

  const bypassProcs = req.splitApps.filter((a) => a.mode === 'bypass').flatMap((a) => a.executables);
  const proxyProcs = req.splitApps.filter((a) => a.mode === 'proxy').flatMap((a) => a.executables);

  if (bypassProcs.length > 0) {
    routeRules.push({ process_name: bypassProcs, outbound: 'direct' });
  }
  if (proxyProcs.length > 0) {
    routeRules.push({ process_name: proxyProcs, outbound: 'proxy' });
  }

  const config: Record<string, unknown> = {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        {
          type: 'https',
          tag: 'dns-remote',
          server: '1.1.1.1',
          server_port: 443,
          path: '/dns-query',
          detour: 'proxy'
        },
        {
          type: 'https',
          tag: 'dns-direct',
          server: '223.5.5.5',
          server_port: 443,
          path: '/dns-query'
        }
      ],
      rules: cnDirect
        ? [{ domain_suffix: ['cn', 'qq.com', 'alipay.com'], server: 'dns-direct' }]
        : [],
      final: 'dns-remote',
      strategy: 'prefer_ipv4'
    },
    inbounds,
    outbounds,
    route: {
      rules: routeRules,
      final: 'proxy',
      auto_detect_interface: req.takeoverMode === 'tun',
      default_domain_resolver: 'dns-direct'
    },
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${ports.clashApiPort}`,
        secret: ''
      }
    }
  };

  if (endpoints.length > 0) {
    config.endpoints = endpoints;
  }

  return config;
}
