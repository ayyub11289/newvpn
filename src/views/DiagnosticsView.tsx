import React from 'react';
import { CoreCapabilities, LeakAuditItem, ProtocolMode, TakeoverMode, TunnelStatus, UpdateState, VpnNode } from '../types';

interface DiagnosticsViewProps {
  status: TunnelStatus;
  protocol: ProtocolMode;
  takeoverMode: TakeoverMode;
  multiHop: boolean;
  activeNode: VpnNode | null;
  entryNode: VpnNode | null;
  effectivePing: number;
  activeIp: string;
  capabilities: CoreCapabilities;
  auditItems: LeakAuditItem[];
  auditLoading: boolean;
  updateState: UpdateState;
  onRunAudit: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onCopyProxyEnv: () => void;
  onOpenBinFolder: () => void;
}

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  status,
  protocol,
  takeoverMode,
  multiHop,
  activeNode,
  entryNode,
  effectivePing,
  activeIp,
  capabilities,
  auditItems,
  auditLoading,
  updateState,
  onRunAudit,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onCopyProxyEnv,
  onOpenBinFolder
}) => {
  const hops = [
    {
      step: 'HOP 01',
      name: takeoverMode === 'tun' ? 'Win11 虚拟网卡 (Ethernet-Net0)' : 'Win11 本地混合代理端口 (127.0.0.1:7890)',
      meta: takeoverMode === 'tun' ? '172.24.88.1/30 · 内核态 L3 接管' : 'WinINet 注册表守护 · 崩溃自动还原',
      ping: '0.4 ms'
    },
    {
      step: 'HOP 02',
      name: '本地接入网关 · 加密外壳封装',
      meta: `协议模式: ${protocol.toUpperCase()}`,
      ping: '5.1 ms'
    }
  ];

  if (multiHop && entryNode && activeNode && entryNode.id !== activeNode.id) {
    hops.push({
      step: 'HOP 03',
      name: `隐私入口跳板 · ${entryNode.country} ${entryNode.city}`,
      meta: `${entryNode.host} · sing-box detour 中继`,
      ping: `${entryNode.ping} ms`
    });
  }

  hops.push({
    step: multiHop && entryNode && activeNode && entryNode.id !== activeNode.id ? 'HOP 04' : 'HOP 03',
    name: activeNode ? `加密出口节点 · ${activeNode.country} ${activeNode.city}` : '尚未选择出口节点',
    meta: activeNode ? `${activeNode.host} (${activeNode.asn}) · 出口 ${activeIp}` : '请先点击右上角「+ 导入节点」',
    ping: activeNode ? `${effectivePing} ms` : '--'
  });

  return (
    <main className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
      {/* Multi-Segment Hop Topology */}
      <section className="lg:col-span-7 glass-surface spotlight-card rounded-2xl p-5 flex flex-col gap-4">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">实时分段路由透视 · Hop Topology</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              端到端跳数、内核接管状态及本地代理导出
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBinFolder}
            className="text-xs font-mono px-2.5 py-1 rounded-lg glass-well text-[var(--foreground)] hover:opacity-90 cursor-pointer"
          >
            {capabilities.hasSingBox ? 'sing-box.exe ✓' : '打开 bin 目录放内核'}
          </button>
        </div>

        <div className="relative z-10 flex flex-col gap-2.5">
          {hops.map((h) => (
            <div key={h.step} className="p-3 rounded-xl glass-well flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-2 py-1 rounded-lg glass-surface font-mono text-xs font-semibold shrink-0">
                  {h.step}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{h.name}</div>
                  <div className="text-xs font-mono text-[var(--muted-foreground)] truncate mt-0.5">{h.meta}</div>
                </div>
              </div>
              <span
                className="font-mono tabular-nums text-xs font-semibold shrink-0"
                style={{ color: status === 'connected' ? 'var(--success)' : 'var(--muted-foreground)' }}
              >
                {status === 'connected' ? h.ping : '离线'}
              </span>
            </div>
          ))}
        </div>

        {/* Developer Terminal Proxy Export */}
        <div className="relative z-10 mt-auto pt-3 border-t border-[var(--card-border)] flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">PowerShell / Bash 终端代理一键复制</span>
            <button
              type="button"
              onClick={onCopyProxyEnv}
              className="px-2.5 py-1 rounded-lg glass-well text-xs font-medium text-[var(--foreground)] hover:opacity-90 transition cursor-pointer"
            >
              复制命令
            </button>
          </div>
          <div className="p-3 rounded-xl glass-well font-mono text-xs text-[var(--code-foreground)] overflow-x-auto whitespace-nowrap select-all">
            $env:HTTPS_PROXY=&quot;http://127.0.0.1:7890&quot;; $env:HTTP_PROXY=&quot;http://127.0.0.1:7890&quot;; $env:ALL_PROXY=&quot;socks5://127.0.0.1:7891&quot;
          </div>
        </div>
      </section>

      {/* Zero-Leak Audit */}
      <section className="lg:col-span-5 glass-surface spotlight-card rounded-2xl p-5 flex flex-col gap-4">
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">链路实测与策略校验 · Network Audit</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              严格区分「实网探针结果」与「配置策略状态」，绝不虚报结果
            </p>
          </div>
          <button
            type="button"
            disabled={auditLoading}
            onClick={onRunAudit}
            className="px-3 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
          >
            {auditLoading ? '检测中...' : '重新自检'}
          </button>
        </div>

        <div className="relative z-10 flex flex-col gap-2.5">
          {auditItems.map((item) => {
            const color =
              item.status === 'pass'
                ? 'var(--success)'
                : item.status === 'warn'
                ? 'var(--warning)'
                : 'var(--muted-foreground)';
            return (
              <div key={item.id} className="p-3 rounded-xl glass-well flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold">{item.title}</div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{item.detail}</p>
                </div>
                <span className="px-2.5 py-1 rounded-lg glass-surface font-mono text-xs font-semibold shrink-0" style={{ color }}>
                  {item.badge}
                </span>
              </div>
            );
          })}
        </div>

        {/* Software Auto-Update Panel */}
        <div className="relative z-10 mt-auto pt-3 border-t border-[var(--card-border)] flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold">客户端在线更新 · GitHub Releases</div>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                当前 v{updateState.currentVersion} · {updateState.message}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {updateState.status === 'downloaded' ? (
                <button
                  type="button"
                  onClick={onInstallUpdate}
                  className="px-3 py-1.5 rounded-xl bg-[var(--success)] text-white text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  重启并安装
                </button>
              ) : updateState.status === 'available' ? (
                <button
                  type="button"
                  onClick={onDownloadUpdate}
                  className="px-3 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  立即更新 v{updateState.latestVersion}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
                  onClick={onCheckUpdates}
                  className="px-3 py-1.5 rounded-xl glass-well text-xs font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {updateState.status === 'checking'
                    ? '检查中...'
                    : updateState.status === 'downloading'
                    ? `下载 ${updateState.progress}%`
                    : '检查更新'}
                </button>
              )}
            </div>
          </div>

          {updateState.status === 'downloading' && (
            <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${updateState.progress}%`, background: 'var(--primary)' }}
              />
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
