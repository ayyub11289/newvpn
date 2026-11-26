import React from 'react';
import { CoreCapabilities, NavTab, TunnelStatus } from '../types';

interface TitleBarProps {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
  status: TunnelStatus;
  multiHop: boolean;
  activeIp: string;
  ipMasked: boolean;
  onToggleIpMask: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  lightMode: boolean;
  onToggleTheme: () => void;
  onOpenCmdk: () => void;
  onOpenImport: () => void;
  capabilities: CoreCapabilities;
  nodeCount: number;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  tab,
  onTabChange,
  status,
  multiHop,
  activeIp,
  ipMasked,
  onToggleIpMask,
  soundEnabled,
  onToggleSound,
  lightMode,
  onToggleTheme,
  onOpenCmdk,
  onOpenImport,
  capabilities,
  nodeCount
}) => {
  const maskedIp = ipMasked ? activeIp.split('.').slice(0, 2).join('.') + '.•••.•••' : activeIp;
  const dotColor =
    status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--error)';
  const statusLabel =
    status === 'connected'
      ? multiHop
        ? '双重跳板已保护'
        : '隧道已保护'
      : status === 'connecting'
      ? '正在握手...'
      : '未受保护';

  const tabs: Array<{ id: NavTab; label: string; count?: number }> = [
    { id: 'overview', label: '连接中枢' },
    { id: 'nodes', label: '全球节点', count: nodeCount },
    { id: 'security', label: '安全与自控' },
    { id: 'diagnostics', label: '链路诊断' }
  ];

  return (
    <header className="glass-surface spotlight-card app-drag rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
      {/* Brand + Live LED */}
      <div className="relative z-10 flex items-center gap-3 app-no-drag">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--border)] shadow-sm"
          style={{
            background: 'linear-gradient(145deg, var(--primary), color-mix(in srgb, var(--primary) 68%, #000))',
            color: 'var(--primary-foreground)'
          }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">VEIL</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded-md glass-well text-[var(--muted-foreground)]">
              WIN11 · {capabilities.engineMode === 'live' ? 'LIVE CORE' : 'SANDBOX'}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium glass-well">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: dotColor,
                  boxShadow: status !== 'disconnected' ? `0 0 8px ${dotColor}` : 'none'
                }}
              />
              <span>{statusLabel}</span>
            </span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            sing-box 加密内核 · {capabilities.isAdmin ? '管理员已就绪 (支持 TUN)' : '标准模式 (免提权代理)'}
          </p>
        </div>
      </div>

      {/* 4-Tab Nav */}
      <nav aria-label="主导航" className="relative z-10 app-no-drag flex items-center p-1 rounded-xl glass-well gap-1">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                active
                  ? 'glass-surface text-[var(--foreground)] font-semibold'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <span>{t.label}</span>
              {typeof t.count === 'number' && <span className="font-mono opacity-70">{t.count}</span>}
            </button>
          );
        })}
      </nav>

      {/* Right Tools + Native Win11 Window Controls */}
      <div className="relative z-10 app-no-drag flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenImport}
          className="px-2.5 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium hover:opacity-90 transition cursor-pointer"
        >
          + 导入节点
        </button>

        <button
          type="button"
          onClick={onOpenCmdk}
          className="px-2.5 py-1.5 rounded-xl glass-well text-xs font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition cursor-pointer"
          title="命令面板 (Ctrl + K)"
        >
          ⌘K
        </button>

        <button
          type="button"
          onClick={onToggleSound}
          className="px-2.5 py-1.5 rounded-xl glass-well text-xs font-medium text-[var(--foreground)] hover:opacity-90 transition cursor-pointer"
          style={{ opacity: soundEnabled ? 1 : 0.6 }}
          title="切换硬件微音效"
        >
          {soundEnabled ? '音效开' : '静音'}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="px-2.5 py-1.5 rounded-xl glass-well text-xs font-medium text-[var(--foreground)] hover:opacity-90 transition cursor-pointer"
          title="切换深色 / 浅色毛玻璃"
        >
          {lightMode ? '深色' : '浅色'}
        </button>

        <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-well text-xs">
          <span className="font-mono tabular-nums font-medium">{maskedIp}</span>
          <button
            type="button"
            onClick={onToggleIpMask}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
            title="隐藏/显示 IP"
          >
            👁
          </button>
        </div>

        {/* Native Win11 Window Chrome Buttons */}
        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-[var(--border)]">
          <button
            type="button"
            onClick={() => window.veilAPI?.windowControl('minimize')}
            className="w-7 h-7 rounded-lg glass-well text-xs flex items-center justify-center hover:opacity-80 cursor-pointer"
            title="最小化"
          >
            ─
          </button>
          <button
            type="button"
            onClick={() => window.veilAPI?.windowControl('maximize')}
            className="w-7 h-7 rounded-lg glass-well text-xs flex items-center justify-center hover:opacity-80 cursor-pointer"
            title="最大化 / 还原"
          >
            □
          </button>
          <button
            type="button"
            onClick={() => window.veilAPI?.windowControl('hide-to-tray')}
            className="w-7 h-7 rounded-lg glass-well text-xs flex items-center justify-center hover:bg-[var(--error)] hover:text-white transition cursor-pointer"
            title="最小化到任务栏托盘"
          >
            ✕
          </button>
        </div>
      </div>
    </header>
  );
};
