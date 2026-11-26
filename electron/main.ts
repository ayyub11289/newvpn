import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray
} from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SingBoxManager } from './core/singboxManager';
import { fetchSubscriptionFromUrl, parseSubscriptionContent } from './core/subscriptionParser';
import { measureTcpPing, runRealLeakAudit } from './core/leakAuditor';
import { AppUpdaterController } from './core/updater';
import { SecureVault } from './core/secureVault';
import { ConnectRequest, TakeoverMode, TelemetrySnapshot, TunnelStatus, UpdateState, VaultState } from './types';

let mainWindow: BrowserWindow | null = null;
let trayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let manager: SingBoxManager | null = null;
let updater: AppUpdaterController | null = null;
let vault: SecureVault | null = null;
let isQuitting = false;
let latestTelemetry: TelemetrySnapshot | null = null;

// --- Pure-JS RGBA PNG Generator for Crisp Status-Colored System Tray Icons ---
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createTrayIcon(status: TunnelStatus): Electron.NativeImage {
  const size = 32;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const color =
    status === 'connected'
      ? [34, 197, 94]
      : status === 'connecting'
      ? [245, 158, 11]
      : [148, 163, 184];

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const dist = Math.hypot(dx, dy);
      const px = rowOffset + 1 + x * 4;

      if (dist <= 13.5) {
        // Outer dark shield disc + bright inner optical ring
        const isRing = dist > 7.8 && dist <= 11.2;
        const isCore = dist <= 5.2;
        if (isRing || isCore) {
          raw[px] = color[0];
          raw[px + 1] = color[1];
          raw[px + 2] = color[2];
          raw[px + 3] = 255;
        } else {
          raw[px] = 15;
          raw[px + 1] = 23;
          raw[px + 2] = 42;
          raw[px + 3] = 240;
        }
      } else {
        raw[px + 3] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(raw)),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
  return nativeImage.createFromBuffer(png);
}

function getBinDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin');
  }
  return path.join(app.getAppPath(), 'resources', 'bin');
}

function getRendererUrl(hash = ''): string {
  const devUrl = process.env.VEIL_DEV_URL;
  if (devUrl) {
    return `${devUrl}${hash}`;
  }
  const indexHtml = path.join(app.getAppPath(), 'dist', 'index.html');
  return `file://${indexHtml.replace(/\\/g, '/')}${hash}`;
}

function getAppIconPath(): string | undefined {
  const p = path.join(app.getAppPath(), 'resources', 'icon.ico');
  return fs.existsSync(p) ? p : undefined;
}

function createMainWindow(): void {
  const startHidden = process.argv.includes('--hidden');
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    title: 'VEIL VPN',
    icon: getAppIconPath(),
    backgroundColor: '#090d16',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) {
      mainWindow?.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  void mainWindow.loadURL(getRendererUrl());
}

function createTrayPopoverWindow(): void {
  trayWindow = new BrowserWindow({
    width: 368,
    height: 410,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: false,
    backgroundColor: '#0c111d',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  trayWindow.on('blur', () => {
    trayWindow?.hide();
  });

  void trayWindow.loadURL(getRendererUrl('#tray'));
}

function toggleTrayPopover(): void {
  if (!trayWindow) return;
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  const winBounds = trayWindow.getBounds();
  const x = Math.round(workArea.x + workArea.width - winBounds.width - 14);
  const y = Math.round(workArea.y + workArea.height - winBounds.height - 12);
  trayWindow.setPosition(x, y, false);
  trayWindow.show();
  trayWindow.focus();
}

function setupTray(): void {
  tray = new Tray(createTrayIcon('disconnected'));
  tray.setToolTip('VEIL VPN — Windows 11 加密网络客户端');

  tray.on('click', () => {
    toggleTrayPopover();
  });

  tray.on('double-click', () => {
    trayWindow?.hide();
    mainWindow?.show();
    mainWindow?.focus();
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 VEIL 主控制台',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: '打开悬浮快捷小窗',
      click: () => toggleTrayPopover()
    },
    { type: 'separator' },
    {
      label: '复制终端代理环境变量',
      click: () => {
        clipboard.writeText(
          'export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7891'
        );
      }
    },
    { type: 'separator' },
    {
      label: '安全断开并退出 VEIL',
      click: async () => {
        isQuitting = true;
        await manager?.shutdown();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function broadcastTelemetry(snap: TelemetrySnapshot): void {
  latestTelemetry = snap;
  if (tray) {
    tray.setImage(createTrayIcon(snap.status));
    const statusLabel =
      snap.status === 'connected' ? '已保护' : snap.status === 'connecting' ? '握手中' : '未连接';
    tray.setToolTip(`VEIL VPN · ${statusLabel} (${snap.activeIp})`);
  }
  mainWindow?.webContents.send('tunnel:telemetry', snap);
  trayWindow?.webContents.send('tunnel:telemetry', snap);
}

function broadcastVault(state: VaultState): void {
  mainWindow?.webContents.send('vault:changed', state);
  trayWindow?.webContents.send('vault:changed', state);
}

function registerIpc(): void {
  ipcMain.handle('core:capabilities', async () => {
    return manager!.getCapabilities();
  });

  ipcMain.handle('vault:get', () => {
    return vault!.getState();
  });

  ipcMain.handle('vault:update', (_e, patch: Partial<VaultState>) => {
    const next = vault!.update(patch);
    broadcastVault(next);
    return next;
  });

  ipcMain.handle('tunnel:connect', async (_e, req: ConnectRequest) => {
    await manager!.connect(req);
  });

  ipcMain.handle('tunnel:disconnect', async () => {
    await manager!.disconnect();
  });

  ipcMain.handle('tunnel:clear-killswitch', async () => {
    await manager!.clearKillSwitchAndRestore();
  });

  ipcMain.handle('tunnel:burst', () => {
    manager!.triggerBurst();
  });

  ipcMain.handle('sub:import-url', async (_e, url: string) => {
    try {
      const nodes = await fetchSubscriptionFromUrl(url);
      if (nodes.length === 0) {
        return { ok: false, nodes: [], message: '未解析到有效节点，请检查订阅格式 (Clash/Base64/URI)' };
      }
      return { ok: true, nodes, message: `成功导入 ${nodes.length} 个订阅节点并映射至 3D 地球仪` };
    } catch (err) {
      return {
        ok: false,
        nodes: [],
        message: `订阅拉取失败: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  });

  ipcMain.handle('sub:import-text', (_e, text: string, label?: string) => {
    const nodes = parseSubscriptionContent(text, label);
    if (nodes.length === 0) {
      return { ok: false, nodes: [], message: '未识别到有效节点或 WireGuard 配置' };
    }
    return { ok: true, nodes, message: `成功导入 ${nodes.length} 个配置节点` };
  });

  ipcMain.handle('diag:leak-audit', async (_e, takeoverMode: TakeoverMode, netShield: boolean, killSwitch: boolean) => {
    const connected = latestTelemetry?.status === 'connected';
    const mode = latestTelemetry?.engineMode ?? 'demo';
    const ports = manager!.getActivePorts();
    return runRealLeakAudit({
      connected,
      engineMode: mode,
      takeoverMode,
      netShieldEnabled: netShield,
      killSwitchEnabled: killSwitch,
      mixedPort: ports.mixedPort,
      clashApiPort: ports.clashApiPort
    });
  });

  ipcMain.handle('diag:ping-node', async (_e, host: string, port: number) => {
    return measureTcpPing(host, port || 443);
  });

  ipcMain.handle('core:open-bin-dir', async () => {
    const dir = getBinDir();
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('app:relaunch-admin', () => {
    if (process.platform !== 'win32') return false;
    try {
      const exe = process.execPath;
      const args = process.argv.slice(1).map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
      const psCmd = args
        ? `Start-Process -FilePath '${exe}' -ArgumentList ${args} -Verb RunAs`
        : `Start-Process -FilePath '${exe}' -Verb RunAs`;
      execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true }, () => {
        isQuitting = true;
        app.quit();
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:copy-text', (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('app:get-autostart', () => {
    return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  });

  ipcMain.handle('app:set-autostart', (_e, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--hidden']
    });
    return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  });

  ipcMain.handle('app:get-update-state', () => {
    return updater!.getState();
  });

  ipcMain.handle('app:check-updates', async () => {
    return updater!.checkForUpdates();
  });

  ipcMain.handle('app:download-update', async () => {
    await updater!.downloadOrOpenRelease();
  });

  ipcMain.handle('app:install-update', async () => {
    isQuitting = true;
    await updater!.quitAndInstall();
  });

  ipcMain.handle('window:control', (_e, action: string) => {
    if (action === 'minimize') mainWindow?.minimize();
    else if (action === 'maximize') {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize();
      else mainWindow?.maximize();
    } else if (action === 'hide-to-tray') {
      mainWindow?.hide();
    } else if (action === 'show-main') {
      trayWindow?.hide();
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

app.whenReady().then(async () => {
  const binDir = getBinDir();
  fs.mkdirSync(binDir, { recursive: true });

  vault = new SecureVault(app.getPath('userData'));
  manager = new SingBoxManager(binDir, app.getPath('userData'), broadcastTelemetry);
  await manager.init();

  updater = new AppUpdaterController(
    (st: UpdateState) => {
      mainWindow?.webContents.send('app:update-state', st);
    },
    async () => {
      await manager?.shutdown();
    }
  );

  registerIpc();
  createMainWindow();
  createTrayPopoverWindow();
  setupTray();

  // Silent background release check 8 seconds after startup
  setTimeout(() => {
    void updater?.checkForUpdates();
  }, 8000);

  // Global Win11 Hotkey: Ctrl+Shift+V toggles VEIL Studio Window
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  powerMonitor.on('suspend', () => {
    mainWindow?.webContents.send('app:quick-action', 'system-suspend');
  });

  powerMonitor.on('resume', () => {
    mainWindow?.webContents.send('app:quick-action', 'system-resume');
  });
});

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    globalShortcut.unregisterAll();
    await manager?.shutdown();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
