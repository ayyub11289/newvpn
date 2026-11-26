import React, { useState } from 'react';
import { CoreCapabilities, VpnNode } from '../types';

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  capabilities: CoreCapabilities;
  onImported: (nodes: VpnNode[], msg: string) => void;
  onOpenBinFolder: () => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  open,
  onClose,
  capabilities,
  onImported,
  onOpenBinFolder
}) => {
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [rawText, setRawText] = useState('');
  const [wgLabel, setWgLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!open) return null;

  const handleImportUrl = async () => {
    if (!urlInput.trim()) return;
    if (!window.veilAPI) {
      setFeedback('请在 Electron 桌面端内使用订阅拉取功能');
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await window.veilAPI.importFromUrl(urlInput.trim());
      if (res.ok) {
        onImported(res.nodes, res.message);
        setUrlInput('');
        onClose();
      } else {
        setFeedback(res.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImportText = async () => {
    if (!rawText.trim()) return;
    if (!window.veilAPI) {
      setFeedback('请在 Electron 桌面端内解析配置');
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await window.veilAPI.importFromText(rawText.trim(), wgLabel.trim() || undefined);
      if (res.ok) {
        onImported(res.nodes, res.message);
        setRawText('');
        setWgLabel('');
        onClose();
      } else {
        setFeedback(res.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.48)', backdropFilter: 'blur(8px)' }}
    >
      <div className="glass-hud w-full max-w-xl rounded-2xl p-5 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">导入真实订阅 / WireGuard 节点</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              支持 Clash YAML、Base64/URI (VLESS/Trojan/SS/Hysteria2/VMess) 与 WireGuard .conf
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg glass-well text-xs flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Core Binary Status Notice */}
        <div className="p-3 rounded-xl glass-well flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: capabilities.hasSingBox ? 'var(--success)' : 'var(--warning)' }}
            />
            <span>
              内核状态：
              {capabilities.hasSingBox
                ? 'sing-box.exe 已就绪（真实代理转发可用）'
                : '尚未放置 sing-box.exe（运行 npm run fetch-core 或手动放入 bin 目录）'}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenBinFolder}
            className="text-[var(--link)] hover:underline cursor-pointer shrink-0"
          >
            打开 bin 目录 →
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="grid grid-cols-2 p-1 rounded-xl glass-well gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`py-1.5 rounded-lg font-medium transition cursor-pointer ${
              mode === 'url' ? 'glass-surface text-[var(--foreground)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
          >
            订阅链接导入 (URL)
          </button>
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`py-1.5 rounded-lg font-medium transition cursor-pointer ${
              mode === 'text' ? 'glass-surface text-[var(--foreground)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
          >
            粘贴 WireGuard .conf / 节点 URI
          </button>
        </div>

        {mode === 'url' ? (
          <div className="flex flex-col gap-3">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/api/v1/client/subscribe?token=..."
              className="w-full px-3.5 py-2.5 rounded-xl text-xs glass-well text-[var(--foreground)] placeholder-[var(--placeholder)] outline-none"
            />
            <button
              type="button"
              disabled={loading}
              onClick={handleImportUrl}
              className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
            >
              {loading ? '正在拉取并解析经纬度...' : '拉取订阅并投射到 3D 地球仪'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <input
              type="text"
              value={wgLabel}
              onChange={(e) => setWgLabel(e.target.value)}
              placeholder="可选节点名称（例如：日本 东京 WireGuard，用于自动匹配地球坐标）"
              className="w-full px-3.5 py-2 rounded-xl text-xs glass-well text-[var(--foreground)] placeholder-[var(--placeholder)] outline-none"
            />
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="粘贴 [Interface] / [Peer] WireGuard 配置、Clash YAML 或 vless:// / trojan:// / ss:// / hy2:// 链接..."
              className="w-full px-3.5 py-2.5 rounded-xl text-xs font-mono glass-well text-[var(--foreground)] placeholder-[var(--placeholder)] outline-none resize-none"
            />
            <button
              type="button"
              disabled={loading}
              onClick={handleImportText}
              className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
            >
              {loading ? '解析中...' : '解析并添加节点'}
            </button>
          </div>
        )}

        {feedback && <p className="text-xs text-[var(--warning)]">{feedback}</p>}
      </div>
    </div>
  );
};
