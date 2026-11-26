import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_AUTOPILOT, DEFAULT_DEMO_NODES, DEFAULT_SECURITY, DEFAULT_SPLIT_APPS } from '../data/worldBitmap';
import { TelemetrySnapshot, VaultState, VpnNode } from '../types';
import { soundEngine } from '../audio/soundEngine';

function fmtDuration(sec: number): string {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const TrayPopoverView: React.FC = () => {
  const [vault, setVault] = useState<VaultState>({
    customNodes: [],
    subscriptions: [],
    activeNodeId: null,
    entryNodeId: null,
    multiHop: false,
    protocol: 'wireguard',
    takeoverMode: 'system-proxy',
    encryptedAtRest: true
  });

  const [snap, setSnap] = useState<TelemetrySnapshot>({
    status: 'disconnected',
    handshakeStep: 0,
    engineMode: 'demo',
    downMBps: 0,
    upMBps: 0,
    totalGB: 0,
    uptimeSeconds: 0,
    blockedCount: 1428,
    activeIp: '114.88.204.17',
    activePing: 34,
    activeNodeId: 'jp-tyo',
    wifiSsid: null,
    wifiOpen: false,
    killSwitchTripped: false
  });

  useEffect(() => {
    if (!window.veilAPI) return;
    void window.veilAPI.getVault().then((v) => setVault(v));
    const unsubTel = window.veilAPI.onTelemetry((next) => setSnap(next));
    const unsubVault = window.veilAPI.onVaultChanged((v) => setVault(v));
    return () => {
      unsubTel();
      unsubVault();
    };
  }, []);

  // Always prioritize real imported nodes from encrypted vault over demo nodes
  const allNodes = useMemo<VpnNode[]>(() => {
    return vault.customNodes.length > 0 ? [...vault.customNodes, ...DEFAULT_DEMO_NODES] : DEFAULT_DEMO_NODES;
  }, [vault.customNodes]);

  const activeNode = useMemo(() => {
    const preferredId = vault.activeNodeId || snap.activeNodeId;
    return allNodes.find((n) => n.id === preferredId) || allNodes[0];
  }, [allNodes, vault.activeNodeId, snap.activeNodeId]);

  const entryNode = useMemo(() => {
    return allNodes.find((n) => n.id === vault.entryNodeId) || allNodes[Math.min(6, allNodes.length - 1)];
  }, [allNodes, vault.entryNodeId]);

  const connectNode = (target: VpnNode) => {
    void window.veilAPI?.updateVault({ activeNodeId: target.id });
    void window.veilAPI?.connect({
      node: target,
      entryNode,
      multiHop: vault.multiHop,
      protocol: vault.protocol,
      takeoverMode: vault.takeoverMode,
      security: DEFAULT_SECURITY,
      autopilot: DEFAULT_AUTOPILOT,
      splitApps: DEFAULT_SPLIT_APPS
    });
  };

  const handleToggle = () => {
    if (snap.status === 'connected' || snap.status === 'connecting') {
      soundEngine.playDisconnect();
      void window.veilAPI?.disconnect();
    } else {
      soundEngine.playStep(0);
      connectNode(activeNode);
    }
  };

  const quickList = useMemo(() => {
    return (vault.customNodes.length > 0 ? vault.customNodes : DEFAULT_DEMO_NODES).slice(0, 4);
  }, [vault.customNodes]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-3 flex flex-col justify-between relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-16 -left-16 w-64 h-64 rounded-full opacity-25"
        style={{
          filter: 'blur(64px)',
          background: snap.killSwitchTripped
            ? 'var(--error)'
            : snap.status === 'connected'
            ? 'var(--success)'
            : 'var(--primary)'
        }}
      />

      <div className="glass-surface rounded-2xl p-4 flex flex-col gap-3 flex-1 relative z-10">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">VEIL VPN</span>
            <span className="font-mono px-1.5 py-0.5 rounded glass-well text-[var(--muted-foreground)]">
              {snap.engineMode === 'live' ? 'LIVE' : 'DEMO'}
            </span>
          </div>
          <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
            {snap.status === 'connected' ? fmtDuration(snap.uptimeSeconds) : '--:--:--'}
          </span>
        </div>

        {snap.killSwitchTripped && (
          <div className="p-2.5 rounded-xl border border-[var(--error)] bg-[var(--secondary)] text-xs flex items-center justify-between gap-2">
            <span className="text-[var(--error)] font-medium">内核异常退出，网络锁已阻断回退</span>
            <button
              type="button"
              onClick={() => void window.veilAPI?.clearKillSwitch()}
              className="px-2 py-1 rounded-lg bg-[var(--error)] text-white text-xs shrink-0 cursor-pointer"
            >
              恢复网络
            </button>
          </div>
        )}

        <div className="flex items-center gap-3.5 py-1">
          <button
            type="button"
            onClick={handleToggle}
            className="power-dome w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 hover:scale-[1.04] active:scale-[0.97] transition cursor-pointer"
          >
            <svg
              className="w-7 h-7"
              style={{
                color:
                  snap.status === 'connected'
                    ? 'var(--success)'
                    : snap.status === 'connecting'
                    ? 'var(--warning)'
                    : 'var(--muted-foreground)'
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {snap.status === 'connected'
                ? '加密隧道已保护'
                : snap.status === 'connecting'
                ? '正在建立隧道...'
                : '当前未连接'}
            </div>
            <div className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
              {activeNode.country} · {activeNode.city}
            </div>
            <div className="text-xs font-mono text-[var(--muted-foreground)] mt-0.5">
              {activeNode.source === 'demo' ? '演示节点' : activeNode.protocolType.toUpperCase()} · {snap.activeIp}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="glass-well rounded-xl p-2.5">
            <div className="text-[var(--muted-foreground)]">实时下行</div>
            <div className="font-mono tabular-nums text-sm font-semibold mt-0.5">{snap.downMBps.toFixed(1)} MB/s</div>
          </div>
          <div className="glass-well rounded-xl p-2.5">
            <div className="text-[var(--muted-foreground)]">实时上行</div>
            <div className="font-mono tabular-nums text-sm font-semibold mt-0.5">{snap.upMBps.toFixed(1)} MB/s</div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--muted-foreground)]">
            {vault.customNodes.length > 0 ? '自有节点快捷切线' : '演示节点（请先在主界面导入订阅）'}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {quickList.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  soundEngine.playTick(960);
                  connectNode(n);
                }}
                className={`px-2.5 py-2 rounded-xl text-xs font-medium text-left transition cursor-pointer flex items-center justify-between ${
                  n.id === activeNode.id
                    ? 'glass-surface font-semibold'
                    : 'glass-well text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <span className="truncate">{n.code} {n.city.split(' ')[0]}</span>
                <span className="font-mono opacity-75">{n.ping}ms</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => window.veilAPI?.windowControl('show-main')}
          className="mt-auto w-full py-2 rounded-xl glass-well text-xs font-medium text-[var(--foreground)] hover:opacity-90 transition cursor-pointer"
        >
          展开 VEIL 完整控制台 ↗
        </button>
      </div>
    </div>
  );
};
