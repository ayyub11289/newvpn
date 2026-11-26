import yaml from 'js-yaml';
import { VpnNode } from '../types';
import { matchGeoFromLabel } from './geoMatcher';

function makeId(prefix: string, idx: number, name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase() || 'node';
  return `${prefix}-${idx}-${clean}-${Date.now().toString(36).slice(-4)}`;
}

function tryDecodeBase64(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('://') || trimmed.includes('proxies:') || trimmed.includes('[Interface]')) {
    return trimmed;
  }
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    if (decoded.includes('://') || decoded.includes('proxies:')) {
      return decoded;
    }
  } catch {
    // not base64
  }
  return trimmed;
}

/**
 * Builds a sing-box 1.11–1.14 compliant WireGuard endpoint specification.
 */
function buildWireGuardEndpointSpec(opts: {
  host: string;
  port: number;
  addresses: string[];
  privateKey: string;
  publicKey: string;
  preSharedKey?: string;
  mtu?: number;
}): Record<string, unknown> {
  const peer: Record<string, unknown> = {
    address: opts.host,
    port: opts.port,
    public_key: opts.publicKey,
    allowed_ips: ['0.0.0.0/0', '::/0']
  };
  if (opts.preSharedKey) {
    peer.pre_shared_key = opts.preSharedKey;
  }

  return {
    type: 'wireguard',
    tag: 'proxy',
    address: opts.addresses,
    private_key: opts.privateKey,
    mtu: opts.mtu || 1420,
    peers: [peer]
  };
}

export function parseWireGuardConf(raw: string, customName?: string): VpnNode[] {
  const lines = raw.split(/\r?\n/);
  let section = '';
  const iface: Record<string, string> = {};
  const peer: Record<string, string> = {};

  for (const line of lines) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    if (clean.startsWith('[') && clean.endsWith(']')) {
      section = clean.slice(1, -1).toLowerCase();
      continue;
    }
    const eq = clean.indexOf('=');
    if (eq === -1) continue;
    const key = clean.slice(0, eq).trim().toLowerCase();
    const val = clean.slice(eq + 1).trim();
    if (section === 'interface') iface[key] = val;
    else if (section === 'peer') peer[key] = val;
  }

  if (!iface.privatekey || !peer.publickey || !peer.endpoint) {
    return [];
  }

  const endpoint = peer.endpoint;
  const lastColon = endpoint.lastIndexOf(':');
  const host = lastColon > 0 ? endpoint.slice(0, lastColon).replace(/^\[|\]$/g, '') : endpoint;
  const port = lastColon > 0 ? Number(endpoint.slice(lastColon + 1)) || 51820 : 51820;
  const label = customName || `WireGuard · ${host}`;
  const geo = matchGeoFromLabel(label);
  const localAddresses = (iface.address || '10.66.66.2/32')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const outbound = buildWireGuardEndpointSpec({
    host,
    port,
    addresses: localAddresses,
    privateKey: iface.privatekey,
    publicKey: peer.publickey,
    preSharedKey: peer.presharedkey,
    mtu: Number(iface.mtu) || 1420
  });

  return [
    {
      id: makeId('wg', 0, label),
      code: geo.code,
      country: geo.country,
      city: label,
      host,
      port,
      asn: 'WireGuard Endpoint',
      ip: host,
      lon: geo.lon,
      lat: geo.lat,
      ping: 42,
      load: 18,
      tags: Array.from(new Set([...geo.tags, 'privacy'])),
      fav: true,
      source: 'wireguard',
      protocolType: 'wireguard',
      outbound
    }
  ];
}

function parseSingleUri(uri: string, idx: number): VpnNode | null {
  try {
    const trimmed = uri.trim();
    if (trimmed.startsWith('vmess://')) {
      const b64 = trimmed.slice(8);
      const cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, string | number>;
      const name = String(cfg.ps || cfg.add || `VMess #${idx + 1}`);
      const host = String(cfg.add || '');
      const port = Number(cfg.port) || 443;
      if (!host) return null;
      const geo = matchGeoFromLabel(name);
      const outbound: Record<string, unknown> = {
        type: 'vmess',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid: String(cfg.id || ''),
        alter_id: Number(cfg.aid || 0),
        security: String(cfg.scy || 'auto')
      };
      if (cfg.tls === 'tls') {
        outbound.tls = { enabled: true, server_name: String(cfg.sni || cfg.host || host) };
      }
      if (cfg.net === 'ws') {
        outbound.transport = {
          type: 'ws',
          path: String(cfg.path || '/'),
          headers: cfg.host ? { Host: String(cfg.host) } : undefined
        };
      }
      return {
        id: makeId('sub', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: 'VMess Node',
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 55 + (idx % 5) * 14,
        load: 25 + (idx % 4) * 9,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType: 'vmess',
        outbound
      };
    }

    const url = new URL(trimmed);
    const scheme = url.protocol.replace(':', '').toLowerCase();
    const name = decodeURIComponent(url.hash.replace(/^#/, '')) || `${scheme.toUpperCase()} · ${url.hostname}`;
    const host = url.hostname;
    const port = Number(url.port) || 443;
    const geo = matchGeoFromLabel(`${name} ${host}`);

    if (scheme === 'vless') {
      const sni = url.searchParams.get('sni') || host;
      const security = url.searchParams.get('security') || 'tls';
      const pbk = url.searchParams.get('pbk');
      const sid = url.searchParams.get('sid') || '';
      const fp = url.searchParams.get('fp') || 'chrome';
      const flow = url.searchParams.get('flow') || undefined;
      const type = url.searchParams.get('type') || 'tcp';

      const outbound: Record<string, unknown> = {
        type: 'vless',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid: decodeURIComponent(url.username),
        ...(flow ? { flow } : {})
      };

      if (security === 'tls' || security === 'reality') {
        const tlsObj: Record<string, unknown> = {
          enabled: true,
          server_name: sni,
          utls: { enabled: true, fingerprint: fp }
        };
        if (security === 'reality' && pbk) {
          tlsObj.reality = { enabled: true, public_key: pbk, short_id: sid };
        }
        outbound.tls = tlsObj;
      }

      if (type === 'ws') {
        outbound.transport = {
          type: 'ws',
          path: url.searchParams.get('path') || '/',
          headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined
        };
      } else if (type === 'grpc') {
        outbound.transport = {
          type: 'grpc',
          service_name: url.searchParams.get('serviceName') || ''
        };
      }

      return {
        id: makeId('sub', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: security === 'reality' ? 'VLESS Reality' : 'VLESS TLS',
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 44 + (idx % 6) * 12,
        load: 22 + (idx % 5) * 8,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType: 'vless',
        outbound
      };
    }

    if (scheme === 'trojan') {
      const sni = url.searchParams.get('sni') || host;
      const outbound: Record<string, unknown> = {
        type: 'trojan',
        tag: 'proxy',
        server: host,
        server_port: port,
        password: decodeURIComponent(url.username),
        tls: { enabled: true, server_name: sni }
      };
      return {
        id: makeId('sub', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: 'Trojan TLS',
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 48 + (idx % 5) * 11,
        load: 26 + (idx % 4) * 7,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType: 'trojan',
        outbound
      };
    }

    if (scheme === 'hysteria2' || scheme === 'hy2') {
      const sni = url.searchParams.get('sni') || host;
      const insecure = url.searchParams.get('insecure') === '1' || url.searchParams.get('insecure') === 'true';
      const obfsType = url.searchParams.get('obfs');
      const obfsPassword = url.searchParams.get('obfs-password') || url.searchParams.get('obfs_password');
      const outbound: Record<string, unknown> = {
        type: 'hysteria2',
        tag: 'proxy',
        server: host,
        server_port: port,
        password: decodeURIComponent(url.username),
        tls: { enabled: true, server_name: sni, insecure }
      };
      if (obfsType && obfsPassword) {
        outbound.obfs = { type: obfsType, password: decodeURIComponent(obfsPassword) };
      }
      return {
        id: makeId('sub', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: obfsType ? `Hysteria2 (${obfsType})` : 'Hysteria2 QUIC',
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 36 + (idx % 5) * 9,
        load: 19 + (idx % 4) * 8,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType: 'hysteria2',
        outbound
      };
    }

    if (scheme === 'ss') {
      let method = 'aes-256-gcm';
      let password = '';
      if (url.password) {
        method = decodeURIComponent(url.username);
        password = decodeURIComponent(url.password);
      } else {
        const decodedCred = Buffer.from(decodeURIComponent(url.username), 'base64').toString('utf8');
        const colon = decodedCred.indexOf(':');
        if (colon > 0) {
          method = decodedCred.slice(0, colon);
          password = decodedCred.slice(colon + 1);
        }
      }
      const outbound: Record<string, unknown> = {
        type: 'shadowsocks',
        tag: 'proxy',
        server: host,
        server_port: port,
        method,
        password
      };
      return {
        id: makeId('sub', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: `SS (${method})`,
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 40 + (idx % 5) * 10,
        load: 24 + (idx % 5) * 8,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType: 'shadowsocks',
        outbound
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseClashYaml(raw: string): VpnNode[] {
  const doc = yaml.load(raw) as { proxies?: Array<Record<string, unknown>> } | null;
  if (!doc || !Array.isArray(doc.proxies)) return [];

  const nodes: VpnNode[] = [];
  doc.proxies.forEach((p, idx) => {
    const name = String(p.name || `Node #${idx + 1}`);
    const host = String(p.server || '');
    const port = Number(p.port) || 443;
    const type = String(p.type || '').toLowerCase();
    if (!host) return;

    const geo = matchGeoFromLabel(`${name} ${host}`);
    let outbound: Record<string, unknown> | undefined;
    let protocolType: VpnNode['protocolType'] = 'shadowsocks';

    if (type === 'ss') {
      protocolType = 'shadowsocks';
      outbound = {
        type: 'shadowsocks',
        tag: 'proxy',
        server: host,
        server_port: port,
        method: String(p.cipher || 'aes-256-gcm'),
        password: String(p.password || '')
      };
    } else if (type === 'trojan') {
      protocolType = 'trojan';
      outbound = {
        type: 'trojan',
        tag: 'proxy',
        server: host,
        server_port: port,
        password: String(p.password || ''),
        tls: { enabled: true, server_name: String(p.sni || host), insecure: Boolean(p['skip-cert-verify']) }
      };
    } else if (type === 'vless') {
      protocolType = 'vless';
      outbound = {
        type: 'vless',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid: String(p.uuid || ''),
        tls: p.tls ? { enabled: true, server_name: String(p.servername || host) } : undefined
      };
    } else if (type === 'vmess') {
      protocolType = 'vmess';
      outbound = {
        type: 'vmess',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid: String(p.uuid || ''),
        alter_id: Number(p.alterId || 0),
        security: String(p.cipher || 'auto'),
        tls: p.tls ? { enabled: true, server_name: String(p.servername || host) } : undefined
      };
    } else if (type === 'hysteria2') {
      protocolType = 'hysteria2';
      outbound = {
        type: 'hysteria2',
        tag: 'proxy',
        server: host,
        server_port: port,
        password: String(p.password || ''),
        tls: { enabled: true, server_name: String(p.sni || host), insecure: Boolean(p['skip-cert-verify']) }
      };
      if (p.obfs && p['obfs-password']) {
        outbound.obfs = { type: String(p.obfs), password: String(p['obfs-password']) };
      }
    } else if (type === 'wireguard') {
      protocolType = 'wireguard';
      outbound = buildWireGuardEndpointSpec({
        host,
        port,
        addresses: [String(p.ip || '10.66.66.2/32')],
        privateKey: String(p['private-key'] || ''),
        publicKey: String(p['public-key'] || ''),
        preSharedKey: p['pre-shared-key'] ? String(p['pre-shared-key']) : undefined,
        mtu: Number(p.mtu || 1420)
      });
    }

    if (outbound) {
      nodes.push({
        id: makeId('clash', idx, name),
        code: geo.code,
        country: geo.country,
        city: name,
        host,
        port,
        asn: `Clash · ${type.toUpperCase()}`,
        ip: host,
        lon: geo.lon,
        lat: geo.lat,
        ping: 38 + (idx % 6) * 13,
        load: 20 + (idx % 5) * 9,
        tags: geo.tags,
        fav: false,
        source: 'subscription',
        protocolType,
        outbound
      });
    }
  });

  return nodes;
}

function parseCustomNodeJson(raw: string, label?: string): VpnNode[] {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || typeof obj.server !== 'string') return [];

    const host = obj.server.trim();
    const baseRemark = label || String(obj.remark || host);
    const geo = matchGeoFromLabel(`${baseRemark} ${host}`);
    const results: VpnNode[] = [];

    // VLESS Reality multi-port block
    if (typeof obj.uuid === 'string' && Array.isArray(obj.ports)) {
      const sni = String(obj.sni || 'www.apple.com');
      const fp = String(obj.fingerprint || 'chrome');
      const pbk = typeof obj.publicKey === 'string' ? obj.publicKey : '';
      const sid = typeof obj.shortId === 'string' ? obj.shortId : '';
      const flow = typeof obj.flow === 'string' ? obj.flow : undefined;

      obj.ports.forEach((pVal, idx) => {
        const port = Number(pVal);
        if (!port) return;
        const name = `${baseRemark} · VLESS-${port}`;
        const tlsObj: Record<string, unknown> = {
          enabled: true,
          server_name: sni,
          utls: { enabled: true, fingerprint: fp }
        };
        if (pbk) {
          tlsObj.reality = { enabled: true, public_key: pbk, short_id: sid };
        }
        const outbound: Record<string, unknown> = {
          type: 'vless',
          tag: 'proxy',
          server: host,
          server_port: port,
          uuid: obj.uuid,
          ...(flow ? { flow } : {}),
          tls: tlsObj
        };
        results.push({
          id: makeId('json', idx, name),
          code: geo.code,
          country: geo.country,
          city: name,
          host,
          port,
          asn: pbk ? 'VLESS Reality' : 'VLESS TLS',
          ip: host,
          lon: geo.lon,
          lat: geo.lat,
          ping: 45,
          load: 20,
          tags: Array.from(new Set([...geo.tags, 'streaming'])),
          fav: idx === 0,
          source: 'subscription',
          protocolType: 'vless',
          outbound
        });
      });
    }

    // Optional nested Hysteria2 block
    if (obj.hysteria2 && typeof obj.hysteria2 === 'object') {
      const hy = obj.hysteria2 as Record<string, unknown>;
      const port = Number(hy.port);
      if (port && typeof hy.password === 'string') {
        const name = `${baseRemark} · Hysteria2-${port}`;
        const outbound: Record<string, unknown> = {
          type: 'hysteria2',
          tag: 'proxy',
          server: host,
          server_port: port,
          password: hy.password,
          tls: {
            enabled: true,
            server_name: String(hy.sni || 'www.bing.com'),
            insecure: Boolean(hy.insecure)
          }
        };
        if (typeof hy.obfs === 'string' && typeof hy.obfs_password === 'string') {
          outbound.obfs = { type: hy.obfs, password: hy.obfs_password };
        }
        results.push({
          id: makeId('json-hy2', results.length, name),
          code: geo.code,
          country: geo.country,
          city: name,
          host,
          port,
          asn: hy.obfs ? `Hysteria2 (${String(hy.obfs)})` : 'Hysteria2 QUIC',
          ip: host,
          lon: geo.lon,
          lat: geo.lat,
          ping: 38,
          load: 18,
          tags: Array.from(new Set([...geo.tags, 'streaming'])),
          fav: true,
          source: 'subscription',
          protocolType: 'hysteria2',
          outbound
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

export function parseSubscriptionContent(rawText: string, label?: string): VpnNode[] {
  const decoded = tryDecodeBase64(rawText);

  if (decoded.trimStart().startsWith('{')) {
    const jsonNodes = parseCustomNodeJson(decoded, label);
    if (jsonNodes.length > 0) return jsonNodes;
  }

  if (decoded.includes('[Interface]') && decoded.includes('[Peer]')) {
    return parseWireGuardConf(decoded, label);
  }

  if (decoded.includes('proxies:')) {
    const clashNodes = parseClashYaml(decoded);
    if (clashNodes.length > 0) return clashNodes;
  }

  const lines = decoded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nodes: VpnNode[] = [];
  lines.forEach((line, idx) => {
    if (/^(vless|vmess|trojan|ss|hysteria2|hy2):\/\//i.test(line)) {
      const parsed = parseSingleUri(line, idx);
      if (parsed) nodes.push(parsed);
    }
  });
  return nodes;
}

export async function fetchSubscriptionFromUrl(url: string): Promise<VpnNode[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url.trim(), {
      headers: { 'User-Agent': 'clash-verge/v2.0.0 VEIL-VPN/1.1' },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return parseSubscriptionContent(text);
  } finally {
    clearTimeout(timeout);
  }
}
