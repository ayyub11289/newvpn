import { contextBridge, ipcRenderer } from 'electron';
import {
  ConnectRequest,
  CoreCapabilities,
  ImportResult,
  LeakAuditItem,
  TelemetrySnapshot,
  UpdateState
} from './types';

const veilAPI = {
  getCapabilities: (): Promise<CoreCapabilities> => ipcRenderer.invoke('core:capabilities'),
  connect: (req: ConnectRequest): Promise<void> => ipcRenderer.invoke('tunnel:connect', req),
  disconnect: (): Promise<void> => ipcRenderer.invoke('tunnel:disconnect'),
  triggerBurst: (): Promise<void> => ipcRenderer.invoke('tunnel:burst'),
  importFromUrl: (url: string): Promise<ImportResult> => ipcRenderer.invoke('sub:import-url', url),
  importFromText: (text: string, label?: string): Promise<ImportResult> =>
    ipcRenderer.invoke('sub:import-text', text, label),
  runLeakAudit: (netShield: boolean, pq: boolean): Promise<LeakAuditItem[]> =>
    ipcRenderer.invoke('diag:leak-audit', netShield, pq),
  pingNode: (host: string, port: number): Promise<number> =>
    ipcRenderer.invoke('diag:ping-node', host, port),
  openBinFolder: (): Promise<void> => ipcRenderer.invoke('core:open-bin-dir'),
  relaunchElevated: (): Promise<boolean> => ipcRenderer.invoke('app:relaunch-admin'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('app:copy-text', text),
  getAutoStart: (): Promise<boolean> => ipcRenderer.invoke('app:get-autostart'),
  setAutoStart: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('app:set-autostart', enabled),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('app:get-update-state'),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('app:download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('app:install-update'),
  windowControl: (action: 'minimize' | 'maximize' | 'hide-to-tray' | 'show-main'): Promise<void> =>
    ipcRenderer.invoke('window:control', action),
  onTelemetry: (cb: (snap: TelemetrySnapshot) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, snap: TelemetrySnapshot) => cb(snap);
    ipcRenderer.on('tunnel:telemetry', handler);
    return () => ipcRenderer.removeListener('tunnel:telemetry', handler);
  },
  onUpdateState: (cb: (state: UpdateState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, st: UpdateState) => cb(st);
    ipcRenderer.on('app:update-state', handler);
    return () => ipcRenderer.removeListener('app:update-state', handler);
  },
  onQuickAction: (cb: (action: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: string) => cb(action);
    ipcRenderer.on('app:quick-action', handler);
    return () => ipcRenderer.removeListener('app:quick-action', handler);
  }
};

contextBridge.exposeInMainWorld('veilAPI', veilAPI);
