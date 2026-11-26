import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UpdateState } from '../types';

const REPO_OWNER = 'ayyub11289';
const REPO_NAME = 'newvpn';

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class AppUpdaterController {
  private state: UpdateState;
  private onChange: (s: UpdateState) => void;
  private onBeforeInstall: () => Promise<void>;

  constructor(onChange: (s: UpdateState) => void, onBeforeInstall: () => Promise<void>) {
    this.onChange = onChange;
    this.onBeforeInstall = onBeforeInstall;
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
      progress: 0,
      message: '当前已是最新状态'
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.emit({ status: 'checking', message: '正在连接 GitHub Releases 检查新版本...' });
    });

    autoUpdater.on('update-available', (info) => {
      this.emit({
        status: 'available',
        latestVersion: info.version,
        releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${info.version}`,
        message: `发现新版本 v${info.version}，可一键下载升级`
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.emit({
        status: 'up-to-date',
        latestVersion: info.version,
        message: `当前已是最新版本 (v${this.state.currentVersion})`
      });
    });

    autoUpdater.on('download-progress', (p) => {
      this.emit({
        status: 'downloading',
        progress: Math.round(p.percent),
        message: `正在后台下载安装包 ${Math.round(p.percent)}%...`
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.emit({
        status: 'downloaded',
        latestVersion: info.version,
        progress: 100,
        message: `v${info.version} 已下载就绪，点击重启即可完成覆盖更新`
      });
    });

    autoUpdater.on('error', (err) => {
      this.emit({
        status: 'error',
        message: `自动更新通道暂不可用 (${err.message.slice(0, 70)})`
      });
    });
  }

  getState(): UpdateState {
    return this.state;
  }

  private emit(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  async checkForUpdates(): Promise<UpdateState> {
    this.emit({ status: 'checking', progress: 0, message: '正在检测 GitHub Releases 新版本...' });

    // Packaged NSIS builds use native electron-updater differential flow
    if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
      try {
        await autoUpdater.checkForUpdates();
        return this.state;
      } catch {
        // Fallback to GitHub REST API below
      }
    }

    // Fallback (dev mode or portable exe): query GitHub Releases REST API directly
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
        headers: { 'User-Agent': `VEIL-VPN/${this.state.currentVersion}` },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.status === 404) {
        this.emit({
          status: 'up-to-date',
          latestVersion: this.state.currentVersion,
          message: `当前 v${this.state.currentVersion}（仓库尚未发布首个 Release）`
        });
        return this.state;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const rel = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (rel.tag_name || this.state.currentVersion).replace(/^v/i, '');
      const url = rel.html_url || this.state.releaseUrl;

      if (compareSemver(latest, this.state.currentVersion) > 0) {
        this.emit({
          status: 'available',
          latestVersion: latest,
          releaseUrl: url,
          message: `发现新版本 v${latest}（当前 v${this.state.currentVersion}）`
        });
      } else {
        this.emit({
          status: 'up-to-date',
          latestVersion: latest,
          releaseUrl: url,
          message: `当前已是最新版本 (v${this.state.currentVersion})`
        });
      }
    } catch (err) {
      this.emit({
        status: 'error',
        message: `检查更新失败: ${err instanceof Error ? err.message : String(err)}`
      });
    }
    return this.state;
  }

  async downloadOrOpenRelease(): Promise<void> {
    if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
      try {
        this.emit({ status: 'downloading', progress: 1, message: '正在拉取新版本安装包...' });
        await autoUpdater.downloadUpdate();
        return;
      } catch {
        // fallback to browser release download
      }
    }
    await shell.openExternal(this.state.releaseUrl);
  }

  async quitAndInstall(): Promise<void> {
    await this.onBeforeInstall();
    // Silent one-click replacement + automatic relaunch
    autoUpdater.quitAndInstall(true, true);
  }
}
