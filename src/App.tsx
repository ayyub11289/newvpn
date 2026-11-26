import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoPilotRule,
  CoreCapabilities,
  LeakAuditItem,
  MapProjection,
  NavTab,
  ProtocolMode,
  SecurityToggle,
  SplitAppRule,
  SubscriptionProfile,
  TakeoverMode,
  TunnelStatus,
  UpdateState,
  VpnNode
} from './types';
import {
  DEFAULT_AUTOPILOT,
  DEFAULT_SECURITY,
  DEFAULT_SPLIT_APPS
} from './data/worldBitmap';
import { soundEngine } from './audio/soundEngine';
import { TitleBar } from './components/TitleBar';
import { PowerDial } from './components/PowerDial';
import { SpatialGlobe } from './components/SpatialGlobe';
import { TelemetrySpline } from './components/TelemetrySpline';
import { CommandItem, CommandPalette } from './components/CommandPalette';
import { SubscriptionModal } from './components/SubscriptionModal';
import { NodesView } from './views/NodesView';
import { SecurityView } from './views/SecurityView';
import { DiagnosticsView } from './views/DiagnosticsView';

const KEY_HASHES = ['9f8a…4e2c', '3c71…b809', 'e412…7d9a', '7a05…c31f'];
const HISTORY_LEN = 50;
const LEGACY_NODES_KEY = 'veil_custom_nodes';
const LEGACY_SUBS_KEY = 'veil_subscriptions_v1';

export const App: React.FC = () => {
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionProfile[]>([]);
  const [encryptedVault, setEncryptedVault] = useState(true);

  const [refreshingSubId, setRefreshingSubId] = useState<string | null>(null);
  const [refreshingAllSubs, setRefreshingAllSubs] = useState(false);

  const [tab, setTab] = useState<NavTab>('overview');
  const [projection, setProjection] = useState<MapProjection>('globe');
  const [status, setStatus] = useState<TunnelStatus>('disconnected');
  const [handshakeStep, setHandshakeStep] = useState(0);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(null);
  const [multiHop, setMultiHop] = useState(false);
  const [protocol, setProtocol] = useState<ProtocolMode>('wireguard');
  const [takeoverMode, setTakeoverMode] = useState<TakeoverMode>('system-proxy');
  const [ipMasked, setIpMasked] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lightMode, setLightMode] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [killSwitchTripped, setKillSwitchTripped] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [keyRotateSeconds, setKeyRotateSeconds] = useState(180);
  const [keyIdx, setKeyIdx] = useState(0);
  const [blockedCount, setBlockedCount] = useState(1428);
  const [totalGB, setTotalGB] = useState(0);
  const [downSpeed, setDownSpeed] = useState(0);
  const [upSpeed, setUpSpeed] = useState(0);
  const [activeIp, setActiveIp] = useState('114.88.204.17');
  const [wifiSsid, setWifiSsid] = useState<string | null>(null);
  const [downHistory, setDownHistory] = useState<number[]>(() => Array(HISTORY_LEN).fill(0));
  const [upHistory, setUpHistory] = useState<number[]>(() => Array(HISTORY_LEN).fill(0));

  const [autopilot, setAutopilot] = useState<AutoPilotRule[]>(DEFAULT_AUTOPILOT);
  const [security, setSecurity] = useState<SecurityToggle[]>(DEFAULT_SECURITY);
  const [splitApps, setSplitApps] = useState<SplitAppRule[]>(DEFAULT_SPLIT_APPS);

  const [capabilities, setCapabilities] = useState<CoreCapabilities>({
    hasSingBox: false,
    hasWintun: false,
    isAdmin: false,
    platform: 'win32',
    binDir: '',
    engineMode: 'demo'
  });

  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    currentVersion: '1.2.0',
    latestVersion: null,
    releaseUrl: 'https://github.com/ayyub11289/newvpn/releases',
    progress: 0,
    message: '点击检查 GitHub Releases 新版本'
  });

  const [auditItems, setAuditItems] = useState<LeakAuditItem[]>([
    { id: 'tunnel-probe', title: '隧道端到端连通与出口 IP 实测', detail: '连接真实内核后经 127.0.0.1:7890 实测公网出口 IP', status: 'idle', badge: '待检测', verified: false },
    { id: 'dns-check', title: '系统 DNS 与隧道解析状态', detail: '检测当前接管模式下的实际 DNS 范围', status: 'idle', badge: '待检测', verified: false },
    { id: 'killswitch-scope', title: 'Kill Switch 断网保护边界', detail: '展示当前接管模式的崩溃阻断范围', status: 'idle', badge: '待检测', verified: false },
    { id: 'policy-shield', title: 'NetShield 与浏览器 WebRTC 说明', detail: '展示内核路由规则与外部浏览器防护边界', status: 'idle', badge: '待检测', verified: false }
  ]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const activeNode = useMemo<VpnNode | null>(
    () => (nodes.length === 0 ? null : nodes.find((n) => n.id === activeNodeId) || nodes[0]),
    [nodes, activeNodeId]
  );
  const entryNode = useMemo<VpnNode | null>(
    () => (nodes.length === 0 ? null : nodes.find((n) => n.id === entryNodeId) || nodes[0]),
    [nodes, entryNodeId]
  );

  const getEffectivePing = useCallback(
    (node: VpnNode) => {
      if (!multiHop || !entryNode || node.id === entryNode.id) return node.ping;
      return Math.round(entryNode.ping * 0.85 + node.ping * 0.65);
    },
    [multiHop, entryNode]
  );

  useEffect(() => {
    document.documentElement.classList.toggle('light', lightMode);
    document.documentElement.classList.toggle('dark', !lightMode);
  }, [lightMode]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest('.spotlight-card') as HTMLElement | null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      card.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Load encrypted DPAPI vault & migrate any legacy plaintext localStorage data once
  const refreshSystemState = useCallback(async () => {
    if (!window.veilAPI) return;
    const [cap, auto, upd, vault] = await Promise.all([
      window.veilAPI.getCapabilities(),
      window.veilAPI.getAutoStart(),
      window.veilAPI.getUpdateState(),
      window.veilAPI.getVault()
    ]);

    setCapabilities(cap);
    setAutoStart(auto);
    setUpdateState(upd);
    setEncryptedVault(vault.encryptedAtRest);

    let customNodes = vault.customNodes;
    let subs = vault.subscriptions;

    // One-time silent migration from v1.0.0 plaintext localStorage to DPAPI vault
    try {
      const legacyNodesRaw = localStorage.getItem(LEGACY_NODES_KEY);
      const legacySubsRaw = localStorage.getItem(LEGACY_SUBS_KEY);
      if (legacyNodesRaw || legacySubsRaw) {
        if (customNodes.length === 0 && legacyNodesRaw) {
          const parsed = JSON.parse(legacyNodesRaw) as VpnNode[];
          if (Array.isArray(parsed)) customNodes = parsed;
        }
        if (subs.length === 0 && legacySubsRaw) {
          const parsedS = JSON.parse(legacySubsRaw) as SubscriptionProfile[];
          if (Array.isArray(parsedS)) subs = parsedS;
        }
        await window.veilAPI.updateVault({ customNodes, subscriptions: subs });
        localStorage.removeItem(LEGACY_NODES_KEY);
        localStorage.removeItem(LEGACY_SUBS_KEY);
      }
    } catch {
      // ignore migration errors
    }

    setNodes(customNodes);
    setSubscriptions(subs);
    if (vault.activeNodeId && customNodes.some((n) => n.id === vault.activeNodeId)) {
      setActiveNodeId(vault.activeNodeId);
    } else if (customNodes[0]) {
      setActiveNodeId(customNodes[0].id);
    } else {
      setActiveNodeId(null);
    }
    if (vault.entryNodeId) setEntryNodeId(vault.entryNodeId);
    setMultiHop(vault.multiHop);
    setProtocol(vault.protocol);
    setTakeoverMode(vault.takeoverMode);
  }, []);

  useEffect(() => {
    void refreshSystemState();
  }, [refreshSystemState]);

  // Keep synced when Tray Popover modifies active node or vault
  useEffect(() => {
    if (!window.veilAPI) return;
    return window.veilAPI.onVaultChanged((v) => {
      setEncryptedVault(v.encryptedAtRest);
      setSubscriptions(v.subscriptions);
      setNodes(v.customNodes);
      setActiveNodeId(v.activeNodeId || v.customNodes[0]?.id || null);
      if (v.entryNodeId) setEntryNodeId(v.entryNodeId);
      setMultiHop(v.multiHop);
      setProtocol(v.protocol);
      setTakeoverMode(v.takeoverMode);
    });
  }, []);

  useEffect(() => {
    if (!window.veilAPI) return;
    return window.veilAPI.onUpdateState((next) => {
      setUpdateState(next);
      if (next.status === 'available' && next.latestVersion) {
        showToast(`发现 VEIL VPN 新版本 v${next.latestVersion}，可在「链路诊断」一键升级`);
      } else if (next.status === 'downloaded') {
        soundEngine.playConnected();
        showToast('新版本下载完成，点击「重启并安装」即可升级');
      }
    });
  }, [showToast]);

  const prevStatusRef = useRef<TunnelStatus>('disconnected');
  const prevStepRef = useRef<number>(0);
  const lastErrorRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!window.veilAPI) return;
    return window.veilAPI.onTelemetry((snap) => {
      if (snap.status === 'connected' && prevStatusRef.current !== 'connected') {
        soundEngine.playConnected();
        setKeyIdx((k) => k + 1);
        setKeyRotateSeconds(180);
      } else if (snap.status === 'connecting' && snap.handshakeStep !== prevStepRef.current) {
        soundEngine.playStep(snap.handshakeStep);
      }
      prevStatusRef.current = snap.status;
      prevStepRef.current = snap.handshakeStep;

      setStatus(snap.status);
      setHandshakeStep(snap.handshakeStep);
      setKillSwitchTripped(snap.killSwitchTripped);
      setCapabilities((prev) => (prev.engineMode === snap.engineMode ? prev : { ...prev, engineMode: snap.engineMode }));
      setDownSpeed(snap.downMBps);
      setUpSpeed(snap.upMBps);
      setTotalGB(snap.totalGB);
      setUptimeSeconds(snap.uptimeSeconds);
      setBlockedCount(snap.blockedCount);
      setActiveIp(snap.activeIp);
      setWifiSsid(snap.wifiSsid);
      setDownHistory((prev) => [...prev.slice(1), snap.downMBps]);
      setUpHistory((prev) => [...prev.slice(1), snap.upMBps]);

      if (snap.status === 'connected') {
        setKeyRotateSeconds((prev) => (prev <= 1 ? 180 : prev - 1));
      }
      if (snap.error && snap.error !== lastErrorRef.current) {
        lastErrorRef.current = snap.error;
        setLastError(snap.error);
        showToast(`连接失败: ${snap.error}`);
      } else if (!snap.error) {
        lastErrorRef.current = undefined;
        setLastError(undefined);
      }
    });
  }, [showToast]);

  const connectWithNode = useCallback(
    async (
      targetNode: VpnNode,
      opts?: { multiHop?: boolean; protocol?: ProtocolMode; takeoverMode?: TakeoverMode }
    ) => {
      const mh = opts?.multiHop ?? multiHop;
      const pr = opts?.protocol ?? protocol;
      const tm = opts?.takeoverMode ?? takeoverMode;

      if (tm === 'tun' && !capabilities.isAdmin && capabilities.hasSingBox) {
        showToast('TUN 虚拟网卡需要管理员权限，请点击「需管理员提权」或切回系统代理模式');
      }

      soundEngine.playStep(0);
      setActiveNodeId(targetNode.id);

      if (window.veilAPI) {
        await window.veilAPI.updateVault({
          activeNodeId: targetNode.id,
          multiHop: mh,
          protocol: pr,
          takeoverMode: tm
        });
        await window.veilAPI.connect({
          node: targetNode,
          entryNode: entryNode || undefined,
          multiHop: mh,
          protocol: pr,
          takeoverMode: tm,
          security,
          autopilot,
          splitApps
        });
      } else {
        setStatus('connected');
        setActiveIp(targetNode.ip);
        soundEngine.playConnected();
      }
    },
    [multiHop, protocol, takeoverMode, capabilities, entryNode, security, autopilot, splitApps, showToast]
  );

  const handleToggleConnect = useCallback(async () => {
    if (status === 'connected' || status === 'connecting') {
      soundEngine.playDisconnect();
      if (window.veilAPI) await window.veilAPI.disconnect();
      else setStatus('disconnected');
    } else if (activeNode) {
      await connectWithNode(activeNode);
    } else {
      setImportOpen(true);
    }
  }, [status, activeNode, connectWithNode]);

  const handleSelectNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (!target) return;
      setTab('overview');
      void connectWithNode(target);
    },
    [nodes, connectWithNode]
  );

  const handleRunAudit = useCallback(async () => {
    setAuditLoading(true);
    soundEngine.playTick(960);
    try {
      const netShield = security.find((s) => s.id === 'netshield')?.enabled ?? true;
      const killSwitch = security.find((s) => s.id === 'killswitch')?.enabled ?? true;
      if (window.veilAPI) {
        const res = await window.veilAPI.runLeakAudit(takeoverMode, netShield, killSwitch);
        setAuditItems(res);
      }
      if (status === 'connected') {
        soundEngine.playConnected();
        showToast('链路实测与策略校验完成');
      } else {
        showToast('当前未连接，请连接真实节点后执行实测');
      }
    } finally {
      setAuditLoading(false);
    }
  }, [security, takeoverMode, status, showToast]);

  const handleCopyProxyEnv = useCallback(() => {
    const cmd = '$env:HTTPS_PROXY="http://127.0.0.1:7890"; $env:HTTP_PROXY="http://127.0.0.1:7890"; $env:ALL_PROXY="socks5://127.0.0.1:7891"';
    if (window.veilAPI) void window.veilAPI.copyText(cmd);
    else void navigator.clipboard?.writeText(cmd);
    soundEngine.playTick(1120);
    showToast('PowerShell 终端代理命令已复制到剪贴板 ✓');
  }, [showToast]);

  const handlePingAll = useCallback(async () => {
    if (!window.veilAPI) return;
    soundEngine.playTick(980);
    showToast('正在并行实测节点 TCP 握手延迟...');
    const updated = await Promise.all(
      nodes.map(async (n) => {
        if (n.source === 'demo') return n;
        const ms = await window.veilAPI!.pingNode(n.host, n.port);
        return { ...n, ping: ms };
      })
    );
    setNodes(updated);
    showToast('节点实测延迟已刷新 ✓');
  }, [nodes, showToast]);

  const persistVaultNodes = useCallback(async (allNodes: VpnNode[], subs: SubscriptionProfile[], newActiveId?: string) => {
    const customOnly = allNodes.filter((n) => n.source !== 'demo');
    if (window.veilAPI) {
      await window.veilAPI.updateVault({
        customNodes: customOnly,
        subscriptions: subs,
        ...(newActiveId ? { activeNodeId: newActiveId } : {})
      });
    }
  }, []);

  const handleImportedUrl = useCallback(
    async (url: string, name: string, imported: VpnNode[], msg: string) => {
      soundEngine.playConnected();
      const existing = subscriptions.find((s) => s.url === url);
      const subId = existing ? existing.id : `sub_${Date.now().toString(36)}`;
      const nowStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const nextSub: SubscriptionProfile = {
        id: subId,
        name,
        url,
        nodeCount: imported.length,
        updatedAt: nowStr
      };
      const nextSubs = [nextSub, ...subscriptions.filter((s) => s.id !== subId)];
      const tagged = imported.map((n, idx) => ({ ...n, id: `${subId}::${idx}::${n.id}` }));
      const kept = nodes.filter((n) => !n.id.startsWith(`${subId}::`));
      const merged = [...tagged, ...kept];
      setSubscriptions(nextSubs);
      setNodes(merged);
      const firstId = tagged[0]?.id;
      if (firstId) setActiveNodeId(firstId);
      await persistVaultNodes(merged, nextSubs, firstId);
      showToast(`${msg}（已 DPAPI 加密保存并同步至托盘）`);
    },
    [subscriptions, nodes, persistVaultNodes, showToast]
  );

  const handleImportedText = useCallback(
    async (imported: VpnNode[], msg: string) => {
      soundEngine.playConnected();
      const merged = [...imported, ...nodes];
      setNodes(merged);
      const firstId = imported[0]?.id;
      if (firstId) setActiveNodeId(firstId);
      await persistVaultNodes(merged, subscriptions, firstId);
      showToast(`${msg}（已 DPAPI 加密保存并同步至托盘）`);
    },
    [nodes, subscriptions, persistVaultNodes, showToast]
  );

  const handleRefreshSub = useCallback(
    async (sub: SubscriptionProfile) => {
      if (!window.veilAPI) return;
      setRefreshingSubId(sub.id);
      soundEngine.playTick(960);
      try {
        const res = await window.veilAPI.importFromUrl(sub.url);
        if (res.ok) {
          const nowStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const nextSubs = subscriptions.map((s) =>
            s.id === sub.id ? { ...s, nodeCount: res.nodes.length, updatedAt: nowStr } : s
          );
          const tagged = res.nodes.map((n, idx) => ({ ...n, id: `${sub.id}::${idx}::${n.id}` }));
          const kept = nodes.filter((n) => !n.id.startsWith(`${sub.id}::`));
          const merged = [...tagged, ...kept];
          setSubscriptions(nextSubs);
          setNodes(merged);
          await persistVaultNodes(merged, nextSubs);
          soundEngine.playConnected();
          showToast(`已刷新「${sub.name}」(${res.nodes.length} 个节点)`);
        } else {
          showToast(res.message);
        }
      } finally {
        setRefreshingSubId(null);
      }
    },
    [subscriptions, nodes, persistVaultNodes, showToast]
  );

  const handleRefreshAllSubs = useCallback(async () => {
    if (!window.veilAPI || subscriptions.length === 0) return;
    setRefreshingAllSubs(true);
    soundEngine.playTick(980);
    try {
      for (const sub of subscriptions) {
        await handleRefreshSub(sub);
      }
    } finally {
      setRefreshingAllSubs(false);
    }
  }, [subscriptions, handleRefreshSub]);

  const handleRemoveSub = useCallback(
    async (id: string) => {
      soundEngine.playTick(760);
      const nextSubs = subscriptions.filter((s) => s.id !== id);
      const kept = nodes.filter((n) => !n.id.startsWith(`${id}::`));
      setSubscriptions(nextSubs);
      setNodes(kept);
      await persistVaultNodes(kept, nextSubs);
      showToast('已删除该订阅及其关联节点');
    },
    [subscriptions, nodes, persistVaultNodes, showToast]
  );

  const handleToggleAutoStart = useCallback(async () => {
    soundEngine.playTick(900);
    const next = !autoStart;
    if (window.veilAPI) {
      const actual = await window.veilAPI.setAutoStart(next);
      setAutoStart(actual);
      showToast(actual ? '已开启 Windows 11 开机静默自启动' : '已关闭开机自启动');
    } else {
      setAutoStart(next);
    }
  }, [autoStart, showToast]);

  const handleCheckUpdates = useCallback(async () => {
    soundEngine.playTick(940);
    if (!window.veilAPI) return;
    const st = await window.veilAPI.checkForUpdates();
    setUpdateState(st);
    showToast(st.message);
  }, [showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        soundEngine.playTick(1020);
        setCmdkOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cmdActions: CommandItem[] = useMemo(
    () => [
      {
        id: 'toggle-conn',
        label: status === 'connected' ? '断开当前 VPN 加密隧道' : '立即建立 VPN 加密隧道',
        hint: 'Power Toggle',
        run: () => void handleToggleConnect()
      },
      {
        id: 'open-import',
        label: '订阅管理 / 导入 WireGuard .conf 配置',
        hint: 'Import',
        run: () => setImportOpen(true)
      },
      {
        id: 'refresh-subs',
        label: `一键刷新全部已保存订阅 (${subscriptions.length})`,
        hint: 'Sync Nodes',
        run: () => void handleRefreshAllSubs()
      },
      {
        id: 'check-update',
        label: '检查 VEIL 客户端 GitHub Releases 新版本',
        hint: `v${updateState.currentVersion}`,
        run: () => {
          setTab('diagnostics');
          void handleCheckUpdates();
        }
      },
      {
        id: 'toggle-mh',
        label: multiHop ? '关闭 Multi-Hop 双重跳板' : '开启 Multi-Hop 双重跳板 (detour)',
        hint: '2x Relay',
        run: () => {
          const next = !multiHop;
          setMultiHop(next);
          void window.veilAPI?.updateVault({ multiHop: next });
          showToast(next ? '已开启双重跳板' : '已切换为单跳模式');
        }
      },
      {
        id: 'run-audit',
        label: '执行隧道实网出口与策略校验',
        hint: 'Diagnostics',
        run: () => {
          setTab('diagnostics');
          void handleRunAudit();
        }
      },
      {
        id: 'copy-env',
        label: '复制 PowerShell 终端代理环境变量',
        hint: 'Clipboard',
        run: handleCopyProxyEnv
      },
      {
        id: 'toggle-proj',
        label: projection === 'globe' ? '切换地图为 2D 全景平面视图' : '切换地图为 3D 交互地球仪视图',
        hint: 'Spatial',
        run: () => {
          setProjection((p) => (p === 'globe' ? 'flat' : 'globe'));
          setTab('overview');
        }
      }
    ],
    [
      status,
      subscriptions.length,
      updateState.currentVersion,
      multiHop,
      projection,
      handleToggleConnect,
      handleRefreshAllSubs,
      handleCheckUpdates,
      handleRunAudit,
      handleCopyProxyEnv,
      showToast
    ]
  );

  return (
    <div className="h-screen overflow-hidden flex flex-col relative">
      {/* Ambient Atmospheric Refraction Orbs */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="ambient-orb-1 absolute -top-24 -left-16 w-[450px] h-[450px] rounded-full opacity-25"
          style={{
            background: killSwitchTripped
              ? 'var(--error)'
              : status === 'connected'
              ? 'var(--success)'
              : status === 'connecting'
              ? 'var(--warning)'
              : 'var(--primary)'
          }}
        />
        <div
          className="ambient-orb-2 absolute top-1/3 -right-20 w-[490px] h-[490px] rounded-full opacity-20"
          style={{ background: 'var(--primary)' }}
        />
        <div
          className="ambient-orb-1 absolute -bottom-32 left-1/3 w-[380px] h-[380px] rounded-full opacity-15"
          style={{ background: 'var(--accent)' }}
        />
        <div className="noise-overlay absolute inset-0" />
      </div>

      {/* Fixed Top Window TitleBar */}
      <div className="relative z-30 shrink-0 px-3 md:px-4 pt-3 md:pt-4 pb-2">
        <div className="max-w-7xl mx-auto">
          <TitleBar
            tab={tab}
            onTabChange={(t) => {
              soundEngine.playTick(900);
              setTab(t);
            }}
            status={status}
            multiHop={multiHop}
            activeIp={activeIp}
            ipMasked={ipMasked}
            onToggleIpMask={() => {
              soundEngine.playTick(840);
              setIpMasked((v) => !v);
            }}
            soundEnabled={soundEnabled}
            onToggleSound={() => {
              const next = !soundEnabled;
              soundEngine.enabled = next;
              setSoundEnabled(next);
              if (next) soundEngine.playTick(1050);
              showToast(next ? '硬件触感微音效已开启' : '微音效已静音');
            }}
            lightMode={lightMode}
            onToggleTheme={() => {
              soundEngine.playTick(920);
              setLightMode((v) => !v);
            }}
            onOpenCmdk={() => {
              soundEngine.playTick(1020);
              setCmdkOpen(true);
            }}
            onOpenImport={() => {
              soundEngine.playTick(960);
              setImportOpen(true);
            }}
            capabilities={capabilities}
            nodeCount={nodes.length}
          />
        </div>
      </div>

      {/* Independent Scrollable Content Viewport */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 md:px-4 pt-1.5 pb-4">
        <div className="max-w-7xl mx-auto flex flex-col gap-3.5">
          {killSwitchTripped && (
            <div className="glass-surface rounded-2xl px-4 py-3 border-[var(--error)] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--error)', boxShadow: '0 0 10px var(--error)' }} />
                <div>
                  <div className="font-semibold text-[var(--error)]">Kill Switch 已触发：内核意外退出，系统代理已锁定防止明文回退</div>
                  <div className="text-[var(--muted-foreground)] mt-0.5">
                    请重新连接节点，或点击右侧按钮手动解除网络锁以恢复本地直连上网。
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void window.veilAPI?.clearKillSwitch()}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--error)] text-white font-semibold hover:opacity-90 cursor-pointer shrink-0"
              >
                解除网络锁并恢复本地网络
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
              <PowerDial
                status={status}
                handshakeStep={handshakeStep}
                uptimeSeconds={uptimeSeconds}
                keyHash={KEY_HASHES[keyIdx % KEY_HASHES.length]}
                keyRotateSeconds={keyRotateSeconds}
                activeNode={activeNode}
                entryNode={entryNode}
                entryCandidates={nodes.slice(0, 10)}
                effectivePing={activeNode ? getEffectivePing(activeNode) : 0}
                protocol={protocol}
                takeoverMode={takeoverMode}
                multiHop={multiHop}
                blockedCount={blockedCount}
                capabilities={capabilities}
                lastError={lastError}
                onToggleConnect={() => void handleToggleConnect()}
                onChangeProtocol={(p) => {
                  soundEngine.playTick(900);
                  setProtocol(p);
                  void window.veilAPI?.updateVault({ protocol: p });
                  if (status === 'connected' && activeNode) void connectWithNode(activeNode, { protocol: p });
                }}
                onChangeTakeover={(m) => {
                  soundEngine.playTick(920);
                  setTakeoverMode(m);
                  void window.veilAPI?.updateVault({ takeoverMode: m });
                  if (status === 'connected' && activeNode) void connectWithNode(activeNode, { takeoverMode: m });
                }}
                onToggleMultiHop={() => {
                  soundEngine.playTick(880);
                  const next = !multiHop;
                  setMultiHop(next);
                  void window.veilAPI?.updateVault({ multiHop: next });
                  if (status === 'connected' && activeNode) void connectWithNode(activeNode, { multiHop: next });
                }}
                onChangeEntryNode={(id) => {
                  soundEngine.playTick(880);
                  setEntryNodeId(id);
                  void window.veilAPI?.updateVault({ entryNodeId: id });
                }}
                onOpenNodes={() => {
                  soundEngine.playTick(880);
                  setTab('nodes');
                }}
                onOpenImport={() => {
                  soundEngine.playTick(960);
                  setImportOpen(true);
                }}
                onOpenDiagnostics={() => {
                  soundEngine.playTick(920);
                  setTab('diagnostics');
                  void handleRunAudit();
                }}
                onRelaunchAdmin={() => {
                  void window.veilAPI?.relaunchElevated();
                }}
              />

              <section className="lg:col-span-8 flex flex-col gap-3.5">
                <SpatialGlobe
                  nodes={nodes}
                  activeNode={activeNode}
                  entryNode={entryNode}
                  multiHop={multiHop}
                  status={status}
                  projection={projection}
                  lightMode={lightMode}
                  onChangeProjection={(p) => {
                    soundEngine.playTick(940);
                    setProjection(p);
                  }}
                  onSelectNode={handleSelectNode}
                  onOpenImport={() => setImportOpen(true)}
                  getEffectivePing={getEffectivePing}
                />

                <TelemetrySpline
                  downHistory={downHistory}
                  upHistory={upHistory}
                  downSpeed={downSpeed}
                  upSpeed={upSpeed}
                  totalGB={totalGB}
                  effectivePing={activeNode ? getEffectivePing(activeNode) : 0}
                  status={status}
                  lightMode={lightMode}
                  onTriggerBurst={() => {
                    soundEngine.playTick(980);
                    if (!activeNode) {
                      setImportOpen(true);
                    } else if (status !== 'connected') {
                      void connectWithNode(activeNode);
                    } else {
                      void window.veilAPI?.triggerBurst();
                      showToast('正在执行加密隧道峰值吞吐压测...');
                    }
                  }}
                />
              </section>
            </main>
          )}

          {tab === 'nodes' && (
            <NodesView
              nodes={nodes}
              activeNodeId={activeNode?.id ?? null}
              status={status}
              subscriptionCount={subscriptions.length}
              refreshingAllSubs={refreshingAllSubs}
              onSelectNode={handleSelectNode}
              onToggleFav={(id) => {
                soundEngine.playTick(1040);
                setNodes((prev) => {
                  const next = prev.map((n) => (n.id === id ? { ...n, fav: !n.fav } : n));
                  void persistVaultNodes(next, subscriptions);
                  return next;
                });
              }}
              onDeleteNode={(id) => {
                soundEngine.playTick(760);
                setNodes((prev) => {
                  const next = prev.filter((n) => n.id !== id);
                  const nextActive = activeNodeId === id ? next[0]?.id ?? null : activeNodeId;
                  setActiveNodeId(nextActive);
                  void persistVaultNodes(next, subscriptions, nextActive ?? undefined);
                  return next;
                });
                showToast('已删除该节点');
              }}
              onPingAll={() => void handlePingAll()}
              onRefreshAllSubs={() => void handleRefreshAllSubs()}
              onOpenImport={() => setImportOpen(true)}
              getEffectivePing={getEffectivePing}
            />
          )}

          {tab === 'security' && (
            <SecurityView
              autopilot={autopilot}
              security={security}
              splitApps={splitApps}
              wifiSsid={wifiSsid}
              autoStart={autoStart}
              encryptedVault={encryptedVault}
              onToggleAutoStart={() => void handleToggleAutoStart()}
              onToggleAutoPilot={(id) => {
                soundEngine.playTick(920);
                setAutopilot((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
              }}
              onToggleSecurity={(id) => {
                soundEngine.playTick(860);
                setSecurity((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
              }}
              onToggleSplitApp={(id) => {
                soundEngine.playTick(780);
                setSplitApps((prev) =>
                  prev.map((a) => (a.id === id ? { ...a, mode: a.mode === 'proxy' ? 'bypass' : 'proxy' } : a))
                );
              }}
              onSimulateWifi={() => {
                setTab('overview');
                if (activeNode) {
                  showToast('检测到未加密热点 "Airport_Free_WiFi"，Auto-Pilot 已自动接管加密隧道');
                  void connectWithNode(activeNode);
                } else {
                  showToast('请先导入真实节点以启用 Auto-Pilot 自动接管');
                  setImportOpen(true);
                }
              }}
            />
          )}

          {tab === 'diagnostics' && (
            <DiagnosticsView
              status={status}
              protocol={protocol}
              takeoverMode={takeoverMode}
              multiHop={multiHop}
              activeNode={activeNode}
              entryNode={entryNode}
              effectivePing={activeNode ? getEffectivePing(activeNode) : 0}
              activeIp={activeIp}
              capabilities={capabilities}
              auditItems={auditItems}
              auditLoading={auditLoading}
              updateState={updateState}
              onRunAudit={() => void handleRunAudit()}
              onCheckUpdates={() => void handleCheckUpdates()}
              onDownloadUpdate={() => void window.veilAPI?.downloadUpdate()}
              onInstallUpdate={() => void window.veilAPI?.installUpdate()}
              onCopyProxyEnv={handleCopyProxyEnv}
              onOpenBinFolder={() => void window.veilAPI?.openBinFolder()}
            />
          )}
        </div>
      </div>

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        nodes={nodes}
        actions={cmdActions}
        onSelectNode={handleSelectNode}
        getEffectivePing={getEffectivePing}
      />

      <SubscriptionModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        capabilities={capabilities}
        subscriptions={subscriptions}
        refreshingSubId={refreshingSubId}
        onImportedUrl={(u, n, list, m) => void handleImportedUrl(u, n, list, m)}
        onImportedText={(list, m) => void handleImportedText(list, m)}
        onRefreshSub={(sub) => void handleRefreshSub(sub)}
        onRemoveSub={(id) => void handleRemoveSub(id)}
        onOpenBinFolder={() => void window.veilAPI?.openBinFolder()}
      />

      {/* Frosted Toast Notification */}
      <div
        className={`pointer-events-none fixed bottom-5 right-5 z-50 transition-all duration-300 glass-hud rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2 ${
          toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} />
        <span>{toast ?? ''}</span>
      </div>
    </div>
  );
};
