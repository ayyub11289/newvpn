import React from 'react';
import { CoreCapabilities, ProtocolMode, TakeoverMode, TunnelStatus, VpnNode } from '../types';

interface PowerDialProps {
  status: TunnelStatus;
  handshakeStep: number;
  uptimeSeconds: number;
  keyHash: string;
  keyRotateSeconds: number;
  activeNode: VpnNode;
  entryNode: VpnNode;
  entryCandidates: VpnNode[];
  effectivePing: number;
  protocol: ProtocolMode;
  takeoverMode: TakeoverMode;
  multiHop: boolean;
  blockedCount: number;
  capabilities: CoreCapabilities;
  lastError?: string;
  onToggleConnect: () => void;
  onChangeProtocol: (p: ProtocolMode) => void;
  onChangeTakeover: (m: TakeoverMode) => void;
  onToggleMultiHop: () => void;
  onChangeEntryNode: (id: string) => void;
  onOpenNodes: () => void;
  onOpenDiagnostics: () => void;
  onRelaunchAdmin: () => void;
}

const PROTO_META: Record<ProtocolMode, { badge: string; mtu: string }> = {
  wireguard: { badge: 'WG · ChaCha20', mtu: 'MTU 1420' },
  stealth: { badge: 'TLS-Stealth · 混淆', mtu: 'MTU 1380' },
  openvpn: { badge: 'OpenVPN DCO · UDP', mtu: 'MTU 1400' }
};

function fmtDuration(sec: number): string {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function fmtShort(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export const PowerDial: React.FC<PowerDialProps> = ({
  status,
  handshakeStep,
  uptimeSeconds,
  keyHash,
  keyRotateSeconds,
  activeNode,
  entryNode,
  entryCandidates,
  effectivePing,
  protocol,
  takeoverMode,
  multiHop,
  blockedCount,
  capabilities,
  lastError,
  onToggleConnect,
  onChangeProtocol,
  onChangeTakeover,
  onToggleMultiHop,
  onChangeEntryNode,
  onOpenNodes,
  onOpenDiagnostics,
  onRelaunchAdmin
}) => {
  const totalTicks = 60;
  const litCount =
    status === 'connected' ? totalTicks : status === 'connecting' ? Math.floor(((handshakeStep + 1) / 3) * totalTicks) : 0;

  const activeStroke =
    status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--primary)' : 'var(--border)';

  const stepText = [
    '1/3 正在编译防泄露配置并执行密钥协商...',
    '2/3 挂载本地隧道接口与系统路由守卫...',
    `3/3 验证至 ${activeNode.city} 的加密出口...`
  ][Math.min(2, handshakeStep)];

  return (
    <section className="lg:col-span-4 flex flex-col gap-3.5">
      {/* Machined Connection Core Card */}
      <div className="glass-surface spotlight-card rounded-2xl p-5 flex flex-col items-center text-center overflow-hidden">
        <div className="relative z-10 w-full flex items-center justify-between text-xs mb-2">
          <span className="font-mono px-2.5 py-0.5 rounded-lg glass-well text-[var(--muted-foreground)]">
            {PROTO_META[protocol].badge}
          </span>
          <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
            {status === 'connected' ? fmtDuration(uptimeSeconds) : '--:--:--'}
          </span>
        </div>

        {/* 60-Tick Optical Dial + Convex Power Dome */}
        <div className="relative z-10 my-2 flex items-center justify-center w-44 h-44">
          {status === 'connected' && (
            <div
              className="absolute inset-3 rounded-full halo-breathing pointer-events-none"
              style={{ background: 'var(--success)', filter: 'blur(16px)' }}
            />
          )}
          <div className="power-bezel absolute inset-3 rounded-full pointer-events-none" />

          <svg className="absolute inset-0 w-44 h-44 pointer-events-none" viewBox="0 0 176 176" fill="none">
            {Array.from({ length: totalTicks }).map((_, i) => {
              const rad = (((i / totalTicks) * 360 - 90) * Math.PI) / 180;
              const isMajor = i % 5 === 0;
              const rOuter = 84;
              const rInner = isMajor ? 76.5 : 79.5;
              const isLit = i < litCount;
              return (
                <line
                  key={i}
                  x1={(88 + Math.cos(rad) * rInner).toFixed(1)}
                  y1={(88 + Math.sin(rad) * rInner).toFixed(1)}
                  x2={(88 + Math.cos(rad) * rOuter).toFixed(1)}
                  y2={(88 + Math.sin(rad) * rOuter).toFixed(1)}
                  stroke={isLit ? activeStroke : 'var(--border)'}
                  strokeWidth={isMajor ? 1.8 : 1.1}
                  strokeLinecap="round"
                  opacity={isLit ? (isMajor ? 0.95 : 0.65) : isMajor ? 0.55 : 0.28}
                />
              );
            })}
          </svg>

          <svg
            className={`absolute inset-2 w-40 h-40 pointer-events-none transition-opacity ${
              status === 'connecting' ? 'orbit-spin opacity-100' : 'opacity-0'
            }`}
            viewBox="0 0 160 160"
            fill="none"
          >
            <circle cx="80" cy="80" r="74" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="68 160" strokeLinecap="round" />
          </svg>

          <button
            type="button"
            onClick={onToggleConnect}
            aria-label="切换 VPN 连接"
            className="power-dome relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center gap-1.5 hover:scale-[1.03] active:scale-[0.97] transition-all cursor-pointer"
          >
            <svg
              className="w-8 h-8 transition-colors"
              style={{
                color:
                  status === 'connected'
                    ? 'var(--success)'
                    : status === 'connecting'
                    ? 'var(--primary)'
                    : 'var(--muted-foreground)'
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              {status === 'connected' ? '点击断开' : status === 'connecting' ? '取消连接' : '一键连接'}
            </span>
          </button>
        </div>

        <div className="relative z-10 mt-1 space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            {status === 'connected'
              ? multiHop
                ? '双重加密跳板运行中'
                : '加密隧道已建立'
              : status === 'connecting'
              ? '正在建立安全隧道...'
              : '当前网络未加密'}
          </h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            {status === 'connected'
              ? multiHop
                ? `流量经 ${entryNode.country} 入口中转至 ${activeNode.city}`
                : takeoverMode === 'tun'
                ? 'Wintun 虚拟网卡已接管全系统 TCP/UDP 流量'
                : 'Win11 系统代理已接管'
              : status === 'connecting'
              ? stepText
              : '点击上方机械旋钮即可接管系统网络'}
          </p>
          {status === 'disconnected' && lastError && (
            <div className="mt-2 px-3 py-2 rounded-xl border border-[var(--error)] bg-[var(--secondary)] text-left text-xs text-[var(--error)] break-all">
              连接失败：{lastError}
            </div>
          )}
        </div>

        {/* Ephemeral Key Strip */}
        <div className="relative z-10 w-full mt-3.5 px-3 py-2 rounded-xl glass-well flex items-center justify-between text-xs font-mono">
          <span className="text-[var(--muted-foreground)]">
            会话公钥 <span className="text-[var(--foreground)]">{keyHash}</span>
          </span>
          <span className="tabular-nums text-[var(--muted-foreground)]">
            {status === 'connected' ? `轮换 ${fmtShort(keyRotateSeconds)}` : '待机中'}
          </span>
        </div>

        {/* Active Node Summary */}
        <div className="relative z-10 w-full mt-3.5 pt-3.5 border-t border-[var(--card-border)] flex flex-col gap-2 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">当前出口节点</span>
            <button type="button" onClick={onOpenNodes} className="text-xs text-[var(--link)] hover:underline cursor-pointer">
              全部节点 →
            </button>
          </div>
          <div className="p-3 rounded-xl glass-well flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg glass-surface font-mono text-xs font-semibold flex items-center justify-center shrink-0">
                {activeNode.code}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">
                  {activeNode.country} · {activeNode.city}
                </div>
                <div className="text-xs font-mono text-[var(--muted-foreground)] truncate">
                  {activeNode.host} · {effectivePing} ms
                </div>
              </div>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md glass-surface shrink-0">
              负载 {activeNode.load}%
            </span>
          </div>
        </div>
      </div>

      {/* Takeover Mode, Protocol & Multi-Hop Card */}
      <div className="glass-surface spotlight-card rounded-2xl p-4 flex flex-col gap-3 flex-1">
        {/* Win11 Takeover Mode Switcher */}
        <div className="relative z-10 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">接管模式 · WIN11</span>
            {!capabilities.isAdmin && takeoverMode === 'tun' && (
              <button type="button" onClick={onRelaunchAdmin} className="text-[var(--warning)] hover:underline cursor-pointer">
                需管理员提权 →
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 p-1 rounded-xl glass-well gap-1">
            <button
              type="button"
              onClick={() => onChangeTakeover('system-proxy')}
              className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                takeoverMode === 'system-proxy'
                  ? 'glass-surface text-[var(--foreground)] font-semibold'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              系统代理 (免提权)
            </button>
            <button
              type="button"
              onClick={() => onChangeTakeover('tun')}
              className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                takeoverMode === 'tun'
                  ? 'glass-surface text-[var(--foreground)] font-semibold'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              TUN 虚拟网卡
            </button>
          </div>
        </div>

        {/* Protocol Switcher */}
        <div className="relative z-10 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">隧道协议</span>
            <span className="font-mono text-[var(--muted-foreground)]">{PROTO_META[protocol].mtu}</span>
          </div>
          <div className="grid grid-cols-3 p-1 rounded-xl glass-well gap-1">
            {(['wireguard', 'stealth', 'openvpn'] as ProtocolMode[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChangeProtocol(p)}
                className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  protocol === p
                    ? 'glass-surface text-[var(--foreground)] font-semibold'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {p === 'wireguard' ? 'WireGuard' : p === 'stealth' ? 'Stealth 混淆' : 'OpenVPN'}
              </button>
            ))}
          </div>
        </div>

        {/* Multi-Hop Relay */}
        <div className="relative z-10 p-3 rounded-xl glass-well flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <span>双重跳板 (Multi-Hop)</span>
                <span className="px-1.5 py-0.5 rounded text-xs font-mono glass-surface text-[var(--muted-foreground)]">
                  detour
                </span>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">入口中转后再连出口，彻底隔离身份</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={multiHop}
              onClick={onToggleMultiHop}
              className="veil-switch"
            />
          </div>

          {multiHop && (
            <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--muted-foreground)]">入口跳板</span>
              <select
                value={entryNode.id}
                onChange={(e) => onChangeEntryNode(e.target.value)}
                className="bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs outline-none cursor-pointer max-w-[175px]"
              >
                {entryCandidates.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.code} {n.country} · {n.city}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Micro-Telemetry */}
        <div className="relative z-10 mt-auto grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-xl glass-well flex flex-col gap-0.5">
            <span className="text-[var(--muted-foreground)]">已拦截追踪器</span>
            <span className="font-mono tabular-nums text-sm font-semibold">{blockedCount.toLocaleString()}</span>
          </div>
          <div className="p-2.5 rounded-xl glass-well flex flex-col gap-0.5">
            <span className="text-[var(--muted-foreground)]">零泄露健康度</span>
            <button
              type="button"
              onClick={onOpenDiagnostics}
              className="text-left font-mono text-sm font-semibold hover:underline cursor-pointer"
              style={{ color: status === 'connected' ? 'var(--success)' : 'var(--muted-foreground)' }}
            >
              {status === 'connected' ? '4/4 PASS →' : '待连接 →'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
