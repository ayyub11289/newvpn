export type TunnelStatus = 'disconnected' | 'connecting' | 'connected';
export type ProtocolMode = 'wireguard' | 'stealth' | 'openvpn';
export type TakeoverMode = 'system-proxy' | 'tun';
export type NavTab = 'overview' | 'nodes' | 'security' | 'diagnostics';
export type MapProjection = 'globe' | 'flat';

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

export interface SubscriptionProfile {
  id: string;
  name: string;
  url: string;
  nodeCount: number;
  updatedAt: string;
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
  explicitDemo?: boolean;
}

export interface VaultState {
  customNodes: VpnNode[];
  subscriptions: SubscriptionProfile[];
  activeNodeId: string | null;
  entryNodeId: string | null;
  multiHop: boolean;
  protocol: ProtocolMode;
  takeoverMode: TakeoverMode;
  encryptedAtRest: boolean;
  storageWarning?: string;
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
  killSwitchTripped: boolean;
  error?: string;
}

export interface LeakAuditItem {
  id: string;
  title: string;
  detail: string;
  status: 'pass' | 'warn' | 'idle';
  badge: string;
  verified: boolean;
  checkType: 'live-probe' | 'config-only';
}

export interface ImportResult {
  ok: boolean;
  nodes: VpnNode[];
  message: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  progress: number;
  message: string;
}

export interface VeilBridgeAPI {
  getCapabilities: () => Promise<CoreCapabilities>;
  getVault: () => Promise<VaultState>;
  updateVault: (patch: Partial<VaultState>) => Promise<VaultState>;
  connect: (req: ConnectRequest) => Promise<void>;
  disconnect: () => Promise<void>;
  clearKillSwitch: () => Promise<void>;
  triggerBurst: () => Promise<void>;
  importFromUrl: (url: string) => Promise<ImportResult>;
  importFromText: (text: string, label?: string) => Promise<ImportResult>;
  runLeakAudit: (takeoverMode: TakeoverMode, netShield: boolean, killSwitch: boolean) => Promise<LeakAuditItem[]>;
  pingNode: (host: string, port: number) => Promise<number>;
  openBinFolder: () => Promise<void>;
  relaunchElevated: () => Promise<boolean>;
  copyText: (text: string) => Promise<void>;
  getAutoStart: () => Promise<boolean>;
  setAutoStart: (enabled: boolean) => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  windowControl: (action: 'minimize' | 'maximize' | 'hide-to-tray' | 'show-main') => Promise<void>;
  onTelemetry: (cb: (snap: TelemetrySnapshot) => void) => () => void;
  onVaultChanged: (cb: (vault: VaultState) => void) => () => void;
  onUpdateState: (cb: (state: UpdateState) => void) => () => void;
  onQuickAction: (cb: (action: string) => void) => () => void;
}

declare global {
  interface Window {
    veilAPI?: VeilBridgeAPI;
  }
}
