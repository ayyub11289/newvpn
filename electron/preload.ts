import { contextBridge, ipcRenderer } from 'electron';
import {
  ConnectRequest,
  CoreCapabilities,
  ImportResult,
  LeakAuditItem,
  TelemetrySnapshot
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
  windowControl: (action: 'minimize' | 'maximize' | 'hide-to-tray' | 'show-main'): Promise<void> =>
    ipcRenderer.invoke('window:control', action),
  onTelemetry: (cb: (snap: TelemetrySnapshot) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, snap: TelemetrySnapshot) => cb(snap);
    ipcRenderer.on('tunnel:telemetry', handler);
    return () => ipcRenderer.removeListener('tunnel:telemetry', handler);
  },
  onQuickAction: (cb: (action: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: string) => cb(action);
    ipcRenderer.on('app:quick-action', handler);
    return () => ipcRenderer.removeListener('app:quick-action', handler);
  }
};

contextBridge.exposeInMainWorld('veilAPI', veilAPI);
