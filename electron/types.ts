export type TunnelStatus = 'disconnected' | 'connecting' | 'connected';
export type ProtocolMode = 'wireguard' | 'stealth' | 'openvpn';
export type TakeoverMode = 'system-proxy' | 'tun';

export interface VpnNode {
  id: string;
  code: string;
  country: string;
  city: string;
  host: string;
  port: number;
  asn: string;
  ip: string;
  lon: number;
  lat: number;
  ping: number;
  load: number;
  tags: string[];
  fav: boolean;
  source: 'demo' | 'subscription' | 'wireguard';
  protocolType: 'wireguard' | 'vless' | 'trojan' | 'shadowsocks' | 'vmess' | 'hysteria2' | 'socks' | 'demo';
  outbound?: Record<string, unknown>;
}

export interface SplitAppRule {
  id: string;
  name: string;
  proc: string;
  executables: string[];
  mode: 'proxy' | 'bypass';
}

export interface SecurityToggle {
  id: 'killswitch' | 'netshield' | 'pqkem' | 'lan';
  title: string;
  desc: string;
  enabled: boolean;
}

export interface AutoPilotRule {
  id: 'wifi' | 'ai-route' | 'media-4k' | 'cn-direct';
  title: string;
  desc: string;
  enabled: boolean;
}

export interface ConnectRequest {
  node: VpnNode;
  entryNode?: VpnNode;
  multiHop: boolean;
  protocol: ProtocolMode;
  takeoverMode: TakeoverMode;
  security: SecurityToggle[];
  autopilot: AutoPilotRule[];
  splitApps: SplitAppRule[];
}

export interface CoreCapabilities {
  hasSingBox: boolean;
  hasWintun: boolean;
  isAdmin: boolean;
  platform: string;
  binDir: string;
  engineMode: 'live' | 'demo';
}

export interface TelemetrySnapshot {
  status: TunnelStatus;
  handshakeStep: number;
  engineMode: 'live' | 'demo';
  downMBps: number;
  upMBps: number;
  totalGB: number;
  uptimeSeconds: number;
  blockedCount: number;
  activeIp: string;
  activePing: number;
  activeNodeId: string;
  wifiSsid: string | null;
  wifiOpen: boolean;
  error?: string;
}

export interface LeakAuditItem {
  id: string;
  title: string;
  detail: string;
  status: 'pass' | 'warn' | 'idle';
  badge: string;
}

export interface ImportResult {
  ok: boolean;
  nodes: VpnNode[];
  message: string;
}
