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
  TakeoverMode,
  TunnelStatus,
  VpnNode
} from './types';
import {
  DEFAULT_AUTOPILOT,
  DEFAULT_DEMO_NODES,
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

export const App: React.FC = () => {
  const [nodes, setNodes] = useState<VpnNode[]>(() => {
    try {
      const saved = localStorage.getItem('veil_custom_nodes');
      if (saved) {
        const parsed = JSON.parse(saved) as VpnNode[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [...parsed, ...DEFAULT_DEMO_NODES];
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_DEMO_NODES;
  });

  const [tab, setTab] = useState<NavTab>('overview');
  const [projection, setProjection] = useState<MapProjection>('globe');
  const [status, setStatus] = useState<TunnelStatus>('disconnected');
  const [handshakeStep, setHandshakeStep] = useState(0);
  const [activeNodeId, setActiveNodeId] = useState(nodes[0].id);
  const [entryNodeId, setEntryNodeId] = useState('ch-zrh');
  const [multiHop, setMultiHop] = useState(false);
  const [protocol, setProtocol] = useState<ProtocolMode>('wireguard');
  const [takeoverMode, setTakeoverMode] = useState<TakeoverMode>('system-proxy');
  const [ipMasked, setIpMasked] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lightMode, setLightMode] = useState(false);
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

  const [auditItems, setAuditItems] = useState<LeakAuditItem[]>([
    { id: 'dns', title: 'DNS 隧道内解析校验', detail: '连接隧道后自动校验 DoH 解析通道', status: 'idle', badge: '未连接' },
    { id: 'webrtc', title: 'WebRTC 真实内网探测拦截', detail: '校验 STUN 候选地址屏蔽状态', status: 'idle', badge: '未连接' },
    { id: 'ipv6', title: 'IPv6 双栈旁路阻断验证', detail: '确保双栈流量不绕过本地隧道', status: 'idle', badge: '未连接' },
    { id: 'pq', title: '后量子前向保密握手校验', detail: '校验 X25519 + ML-KEM 混合握手', status: 'idle', badge: '未连接' }
  ]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const activeNode = useMemo(() => nodes.find((n) => n.id === activeNodeId) || nodes[0], [nodes, activeNodeId]);
  const entryNode = useMemo(() => nodes.find((n) => n.id === entryNodeId) || nodes[Math.min(6, nodes.length - 1)], [nodes, entryNodeId]);

  const getEffectivePing = useCallback(
    (node: VpnNode) => {
      if (!multiHop || node.id === entryNode.id) return node.ping;
      return Math.round(entryNode.ping * 0.85 + node.ping * 0.65);
    },
    [multiHop, entryNode]
  );

  // Sync light/dark theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('light', lightMode);
    document.documentElement.classList.toggle('dark', !lightMode);
  }, [lightMode]);

  // Cursor-tracking spotlight on all .spotlight-card panels
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

  // Refresh Electron capabilities
  const refreshCapabilities = useCallback(async () => {
    if (!window.veilAPI) return;
    const cap = await window.veilAPI.getCapabilities();
    setCapabilities(cap);
  }, []);

  useEffect(() => {
    void refreshCapabilities();
  }, [refreshCapabilities]);

  // Subscribe to Electron Main Process telemetry stream
  const prevStatusRef = useRef<TunnelStatus>('disconnected');
  useEffect(() => {
    if (!window.veilAPI) return;
    const unsub = window.veilAPI.onTelemetry((snap) => {
      if (snap.status === 'connected' && prevStatusRef.current !== 'connected') {
        soundEngine.playConnected();
        setKeyIdx((k) => k + 1);
        setKeyRotateSeconds(180);
      } else if (snap.status === 'connecting' && snap.handshakeStep !== handshakeStep) {
        soundEngine.playStep(snap.handshakeStep);
      }
      prevStatusRef.current = snap.status;

      setStatus(snap.status);
      setHandshakeStep(snap.handshakeStep);
      setCapabilities((prev) => ({ ...prev, engineMode: snap.engineMode }));
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
      if (snap.error) {
        showToast(`内核提示: ${snap.error}`);
      }
    });
    return unsub;
  }, [handshakeStep, showToast]);

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
        await window.veilAPI.connect({
          node: targetNode,
          entryNode,
          multiHop: mh,
          protocol: pr,
          takeoverMode: tm,
          security,
          autopilot,
          splitApps
        });
      } else {
        // Fallback when opened in plain Vite browser without Electron
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
    } else {
      await connectWithNode(activeNode);
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
      const pq = security.find((s) => s.id === 'pqkem')?.enabled ?? true;
      if (window.veilAPI) {
        const res = await window.veilAPI.runLeakAudit(netShield, pq);
        setAuditItems(res);
      }
      if (status === 'connected') {
        soundEngine.playConnected();
        showToast('零泄露安全自检完成');
      } else {
        showToast('当前未连接，建议连接隧道后再次校验');
      }
    } finally {
      setAuditLoading(false);
    }
  }, [security, status, showToast]);

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

  const handleImported = useCallback(
    (imported: VpnNode[], msg: string) => {
      soundEngine.playConnected();
      setNodes((prev) => {
        const merged = [...imported, ...prev];
        const customOnly = merged.filter((n) => n.source !== 'demo');
        try {
          localStorage.setItem('veil_custom_nodes', JSON.stringify(customOnly));
        } catch {
          // ignore
        }
        return merged;
      });
      if (imported[0]) {
        setActiveNodeId(imported[0].id);
      }
      void refreshCapabilities();
      showToast(msg);
    },
    [refreshCapabilities, showToast]
  );

  // Global Ctrl/Cmd + K listener
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
        label: '导入订阅链接或 WireGuard .conf 配置',
        hint: 'Import',
        run: () => setImportOpen(true)
      },
      {
        id: 'toggle-mh',
        label: multiHop ? '关闭 Multi-Hop 双重跳板' : '开启 Multi-Hop 双重跳板 (detour)',
        hint: '2x Relay',
        run: () => {
          setMultiHop((v) => !v);
          showToast(!multiHop ? '已开启双重跳板' : '已切换为单跳模式');
        }
      },
      {
        id: 'run-audit',
        label: '执行 DNS / WebRTC / IPv6 零泄露安全自检',
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
    [status, multiHop, projection, handleToggleConnect, handleRunAudit, handleCopyProxyEnv, showToast]
  );

  return (
    <div className="h-screen overflow-hidden flex flex-col relative">
      {/* Ambient Atmospheric Refraction Orbs */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="ambient-orb-1 absolute -top-24 -left-16 w-[450px] h-[450px] rounded-full opacity-25"
          style={{
            background:
              status === 'connected'
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
              effectivePing={getEffectivePing(activeNode)}
              protocol={protocol}
              takeoverMode={takeoverMode}
              multiHop={multiHop}
              blockedCount={blockedCount}
              capabilities={capabilities}
              onToggleConnect={() => void handleToggleConnect()}
              onChangeProtocol={(p) => {
                soundEngine.playTick(900);
                setProtocol(p);
                if (status === 'connected') void connectWithNode(activeNode, { protocol: p });
              }}
              onChangeTakeover={(m) => {
                soundEngine.playTick(920);
                setTakeoverMode(m);
                if (status === 'connected') void connectWithNode(activeNode, { takeoverMode: m });
              }}
              onToggleMultiHop={() => {
                soundEngine.playTick(880);
                const next = !multiHop;
                setMultiHop(next);
                if (status === 'connected') void connectWithNode(activeNode, { multiHop: next });
              }}
              onChangeEntryNode={(id) => {
                soundEngine.playTick(880);
                setEntryNodeId(id);
              }}
              onOpenNodes={() => {
                soundEngine.playTick(880);
                setTab('nodes');
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
                getEffectivePing={getEffectivePing}
              />

              <TelemetrySpline
                downHistory={downHistory}
                upHistory={upHistory}
                downSpeed={downSpeed}
                upSpeed={upSpeed}
                totalGB={totalGB}
                effectivePing={getEffectivePing(activeNode)}
                status={status}
                lightMode={lightMode}
                onTriggerBurst={() => {
                  soundEngine.playTick(980);
                  if (status !== 'connected') {
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
            activeNodeId={activeNode.id}
            status={status}
            onSelectNode={handleSelectNode}
            onToggleFav={(id) => {
              soundEngine.playTick(1040);
              setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, fav: !n.fav } : n)));
            }}
            onPingAll={() => void handlePingAll()}
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
              showToast('检测到未加密热点 "Airport_Free_WiFi"，Auto-Pilot 已自动接管加密隧道');
              void connectWithNode(activeNode);
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
            effectivePing={getEffectivePing(activeNode)}
            activeIp={activeIp}
            capabilities={capabilities}
            auditItems={auditItems}
            auditLoading={auditLoading}
            onRunAudit={() => void handleRunAudit()}
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
        onImported={handleImported}
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
