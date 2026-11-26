import React, { useMemo, useState } from 'react';
import { TunnelStatus, VpnNode } from '../types';

interface NodesViewProps {
  nodes: VpnNode[];
  activeNodeId: string;
  status: TunnelStatus;
  subscriptionCount: number;
  refreshingAllSubs: boolean;
  onSelectNode: (id: string) => void;
  onToggleFav: (id: string) => void;
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
  onPingAll,
  onRefreshAllSubs,
  onOpenImport,
  getEffectivePing
}) => {
  const [filter, setFilter] = useState<'all' | 'asia' | 'streaming' | 'privacy' | 'fav' | 'custom'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      if (filter === 'fav' && !n.fav) return false;
      if (filter === 'custom' && n.source === 'demo') return false;
      if (!['all', 'fav', 'custom'].includes(filter) && !n.tags.includes(filter)) return false;
      if (q && !`${n.city} ${n.country} ${n.code} ${n.host} ${n.asn}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, filter, search]);

  const filterTabs: Array<{ id: typeof filter; label: string }> = [
    { id: 'all', label: '全部节点' },
    { id: 'custom', label: '已导入自有节点' },
    { id: 'asia', label: '亚太低延迟' },
    { id: 'streaming', label: 'AI / 流媒体解锁' },
    { id: 'privacy', label: '隐私避风港' },
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

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((n) => {
            const isCurrent = n.id === activeNodeId;
            const ping = getEffectivePing(n);
            const pingColor = ping < 0 ? 'var(--error)' : ping < 60 ? 'var(--success)' : ping < 175 ? 'var(--warning)' : 'var(--muted-foreground)';
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
                      <div className="text-xs font-mono text-[var(--muted-foreground)] truncate">{n.host}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFav(n.id)}
                    className={`text-sm leading-none px-1.5 py-1 rounded cursor-pointer ${
                      n.fav ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)] opacity-45 hover:opacity-100'
                    }`}
                  >
                    ★
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-medium" style={{ color: pingColor }}>
                      {ping < 0 ? '超时' : `${ping} ms`}
                    </span>
                    <span className="text-[var(--muted-foreground)]">· 负载 {n.load}%</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded-md glass-surface text-xs font-mono text-[var(--muted-foreground)]">
                    {n.source === 'demo' ? '演示节点' : n.protocolType.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${n.load}%`,
                        background: n.load > 65 ? 'var(--warning)' : 'var(--primary)'
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectNode(n.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition ${
                      isCurrent && status === 'connected'
                        ? 'glass-surface text-[var(--foreground)]'
                        : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'
                    }`}
                  >
                    {isCurrent && status === 'connected' ? '当前连接' : '飞跃连接'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};
