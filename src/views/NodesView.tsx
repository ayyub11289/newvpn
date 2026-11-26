import React, { useMemo, useState } from 'react';
import { TunnelStatus, VpnNode } from '../types';

interface NodesViewProps {
  nodes: VpnNode[];
  activeNodeId: string | null;
  status: TunnelStatus;
  subscriptionCount: number;
  refreshingAllSubs: boolean;
  onSelectNode: (id: string) => void;
  onToggleFav: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onPingAll: () => void;
  onRefreshAllSubs: () => void;
  onOpenImport: () => void;
  getEffectivePing: (n: VpnNode) => number;
}

export const NodesView: React.FC<NodesViewProps> = ({
  nodes,
  activeNodeId,
  status,
  subscriptionCount,
  refreshingAllSubs,
  onSelectNode,
  onToggleFav,
  onDeleteNode,
  onPingAll,
  onRefreshAllSubs,
  onOpenImport,
  getEffectivePing
}) => {
  const [filter, setFilter] = useState<'all' | 'asia' | 'streaming' | 'privacy' | 'fav'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      if (filter === 'fav' && !n.fav) return false;
      if (!['all', 'fav'].includes(filter) && !n.tags.includes(filter)) return false;
      if (q && !`${n.city} ${n.country} ${n.code} ${n.host} ${n.asn}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, filter, search]);

  const filterTabs: Array<{ id: typeof filter; label: string }> = [
    { id: 'all', label: '全部节点' },
    { id: 'asia', label: '亚太' },
    { id: 'streaming', label: '流媒体 / AI' },
    { id: 'privacy', label: '隐私专线' },
    { id: 'fav', label: '★ 收藏' }
  ];

  return (
    <main className="flex flex-col gap-3.5">
      <section className="glass-surface spotlight-card rounded-2xl p-4 flex flex-col gap-4">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  filter === t.id
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm'
                    : 'glass-well text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {subscriptionCount > 0 && (
              <button
                type="button"
                disabled={refreshingAllSubs}
                onClick={onRefreshAllSubs}
                className="px-3 py-1.5 rounded-xl glass-well text-xs font-medium hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
              >
                {refreshingAllSubs ? '同步订阅中...' : `刷新订阅 (${subscriptionCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={onPingAll}
              className="px-3 py-1.5 rounded-xl glass-well text-xs font-medium hover:opacity-90 transition cursor-pointer"
            >
              实测 TCP 延迟
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="px-3 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium hover:opacity-90 transition cursor-pointer"
            >
              + 导入订阅 / WG
            </button>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索城市、国家或域名..."
              className="min-w-[200px] px-3.5 py-1.5 rounded-xl text-xs glass-well text-[var(--foreground)] placeholder-[var(--placeholder)] outline-none"
            />
          </div>
        </div>

        {nodes.length === 0 ? (
          <div className="relative z-10 py-14 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-2xl glass-well flex items-center justify-center text-lg">🌐</div>
            <div className="space-y-1">
              <div className="text-sm font-semibold">节点列表为空</div>
              <p className="text-xs text-[var(--muted-foreground)]">
                演示节点已移除，请导入你自己的订阅链接、节点 URI、WireGuard .conf 或 JSON 配置文件
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenImport}
              className="mt-1 px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 transition cursor-pointer"
            >
              + 立即导入真实节点
            </button>
          </div>
        ) : (
          <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((n) => {
              const isCurrent = n.id === activeNodeId;
              const ping = getEffectivePing(n);
              const pingColor =
                ping < 0
                  ? 'var(--error)'
                  : ping < 60
                  ? 'var(--success)'
                  : ping < 175
                  ? 'var(--warning)'
                  : 'var(--muted-foreground)';
              return (
                <div
                  key={n.id}
                  className={`p-3.5 rounded-2xl transition flex flex-col gap-3 ${
                    isCurrent ? 'glass-surface border-[var(--primary)]' : 'glass-well hover:opacity-95'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-xl glass-surface font-mono text-xs font-semibold flex items-center justify-center shrink-0">
                        {n.code}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {n.country} · {n.city}
                        </div>
                        <div className="text-xs font-mono text-[var(--muted-foreground)] truncate">
                          {n.host}:{n.port}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleFav(n.id)}
                        className={`text-sm leading-none px-1.5 py-1 rounded cursor-pointer ${
                          n.fav ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)] opacity-45 hover:opacity-100'
                        }`}
                        title="收藏节点"
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteNode(n.id)}
                        className="text-xs leading-none px-1.5 py-1 rounded text-[var(--muted-foreground)] hover:text-[var(--error)] cursor-pointer"
                        title="删除节点"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono tabular-nums font-medium" style={{ color: pingColor }}>
                      {ping < 0 ? '超时' : `${ping} ms`}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-md glass-surface text-xs font-mono text-[var(--muted-foreground)]">
                      {n.protocolType.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onSelectNode(n.id)}
                      className={`w-full py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                        isCurrent && status === 'connected'
                          ? 'glass-surface text-[var(--foreground)]'
                          : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'
                      }`}
                    >
                      {isCurrent && status === 'connected' ? '当前连接中' : '飞跃连接'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
