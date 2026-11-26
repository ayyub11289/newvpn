import React from 'react';
import { AutoPilotRule, SecurityToggle, SplitAppRule } from '../types';

interface SecurityViewProps {
  autopilot: AutoPilotRule[];
  security: SecurityToggle[];
  splitApps: SplitAppRule[];
  wifiSsid: string | null;
  autoStart: boolean;
  encryptedVault: boolean;
  onToggleAutoStart: () => void;
  onToggleAutoPilot: (id: AutoPilotRule['id']) => void;
  onToggleSecurity: (id: SecurityToggle['id']) => void;
  onToggleSplitApp: (id: string) => void;
  onSimulateWifi: () => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  autopilot,
  security,
  splitApps,
  wifiSsid,
  autoStart,
  encryptedVault,
  onToggleAutoStart,
  onToggleAutoPilot,
  onToggleSecurity,
  onToggleSplitApp,
  onSimulateWifi
}) => {
  return (
    <main className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
      {/* Auto-Pilot Smart Rules */}
      <section className="lg:col-span-4 glass-surface spotlight-card rounded-2xl p-5 flex flex-col gap-4">
        <div className="relative z-10 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">场景自动化 · Auto-Pilot</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              当前无线网络：{wifiSsid ? wifiSsid : '以太网 / 未连接 Wi-Fi'}
            </p>
          </div>
          <button
            type="button"
            onClick={onSimulateWifi}
            className="px-2.5 py-1 rounded-lg glass-well text-xs font-medium text-[var(--link)] hover:underline shrink-0 cursor-pointer"
          >
            模拟陌生 Wi-Fi
          </button>
        </div>

        <div className="relative z-10 flex flex-col gap-2.5">
          {autopilot.map((rule) => (
            <div key={rule.id} className="p-3 rounded-xl glass-well flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">{rule.title}</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{rule.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                onClick={() => onToggleAutoPilot(rule.id)}
                className="veil-switch"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Zero-Trust Security Shield */}
      <section className="lg:col-span-4 glass-surface spotlight-card rounded-2xl p-5 flex flex-col gap-4">
        <div className="relative z-10 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">零信任护盾 · Security Shield</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              凭据存储：{encryptedVault ? 'Windows DPAPI 系统级加密 ✓' : '本地保护存储'}
            </p>
          </div>
        </div>
        <div className="relative z-10 flex flex-col divide-y divide-[var(--card-border)]">
          <div className="py-3 pt-1 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold">Windows 11 开机静默自启动</div>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                系统登录后自动静默驻留右下角托盘，不弹窗打扰
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoStart}
              onClick={onToggleAutoStart}
              className="veil-switch"
            />
          </div>
          {security.map((item) => (
            <div key={item.id} className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">{item.title}</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{item.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                onClick={() => onToggleSecurity(item.id)}
                className="veil-switch"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Per-App Split Tunneling */}
      <section className="lg:col-span-4 glass-surface spotlight-card rounded-2xl p-5 flex flex-col gap-4">
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">应用级分流 · Split Tunnel</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">点击切换「加密代理」与「本地直连」</p>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-lg glass-well text-[var(--muted-foreground)]">
            process_name
          </span>
        </div>
        <div className="relative z-10 flex flex-col gap-2.5">
          {splitApps.map((app) => {
            const isProxy = app.mode === 'proxy';
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => onToggleSplitApp(app.id)}
                className="w-full p-3 rounded-xl glass-well flex items-center justify-between gap-2 text-left hover:opacity-95 transition cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--foreground)] truncate">{app.name}</div>
                  <div className="text-xs font-mono text-[var(--muted-foreground)] truncate mt-0.5">{app.proc}</div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${
                    isProxy
                      ? 'glass-surface text-[var(--foreground)] font-semibold'
                      : 'border border-[var(--border)] text-[var(--muted-foreground)]'
                  }`}
                >
                  {isProxy ? '● 加密代理' : '○ 本地直连'}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
};
