import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VpnNode } from '../types';

export interface CommandItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  nodes: VpnNode[];
  actions: CommandItem[];
  onSelectNode: (id: string) => void;
  getEffectivePing: (n: VpnNode) => number;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  nodes,
  actions,
  onSelectNode,
  getEffectivePing
}) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => {
    const nodeCmds: CommandItem[] = nodes.map((n) => ({
      id: `node-${n.id}`,
      label: `飞跃连接至 ${n.country} · ${n.city}`,
      hint: `${n.code} · ${getEffectivePing(n)} ms`,
      run: () => onSelectNode(n.id)
    }));
    const all = [...actions, ...nodeCmds];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(q));
  }, [actions, nodes, query, onSelectNode, getEffectivePing]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % Math.max(1, items.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
      } else if (e.key === 'Enter' && items[selectedIdx]) {
        e.preventDefault();
        const target = items[selectedIdx];
        onClose();
        target.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, selectedIdx, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(6px)' }}
    >
      <div className="glass-hud w-full max-w-lg rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2.5">
          <svg className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            placeholder="输入城市切换节点，或搜索命令 (如: 双跳 / 自检 / 复制代理 / 导入)..."
            className="w-full bg-transparent text-xs text-[var(--foreground)] placeholder-[var(--placeholder)] outline-none"
          />
          <span className="text-xs font-mono px-1.5 py-0.5 rounded glass-well text-[var(--muted-foreground)]">ESC</span>
        </div>

        <div className="max-h-72 overflow-y-auto p-2 flex flex-col gap-1">
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onClose();
                item.run();
              }}
              className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-3 text-left transition cursor-pointer ${
                idx === selectedIdx
                  ? 'glass-surface font-semibold text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <span>{item.label}</span>
              <span className="font-mono opacity-75 shrink-0">{item.hint}</span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">未匹配到对应节点或指令</div>
          )}
        </div>
      </div>
    </div>
  );
};
