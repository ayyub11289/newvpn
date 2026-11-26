import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { restrictFilePermissions } from './secretRedactor';

const execFileAsync = promisify(execFile);

export interface ProxySnapshot {
  proxyEnable: number;
  proxyServer: string;
  proxyOverride: string;
  appliedByVeil: boolean;
}

export interface ProxyRestoreResult {
  ok: boolean;
  restored: boolean;
  error?: string;
}

export interface ProxyRegistryOps {
  platform: NodeJS.Platform;
  queryValue: (valueName: string) => Promise<string>;
  setValue: (valueName: string, type: 'REG_DWORD' | 'REG_SZ', data: string) => Promise<void>;
  notifyWinInet: () => void;
  checkAdmin: () => Promise<boolean>;
}

export class ProxyOperationError extends Error {
  readonly rollbackAttempted: boolean;
  readonly rollbackSucceeded: boolean;
  readonly rollbackError?: string;

  constructor(
    message: string,
    opts: { rollbackAttempted: boolean; rollbackSucceeded: boolean; rollbackError?: string }
  ) {
    super(message);
    this.name = 'ProxyOperationError';
    this.rollbackAttempted = opts.rollbackAttempted;
    this.rollbackSucceeded = opts.rollbackSucceeded;
    this.rollbackError = opts.rollbackError;
  }
}

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function defaultRegQueryValue(valueName: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', REG_PATH, '/v', valueName], {
      windowsHide: true,
      timeout: 3000
    });
    const line = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().startsWith(valueName.toLowerCase()));
    if (!line) return '';
    const match = line.match(/REG_\w+\s+(.*)$/i);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

async function defaultRegSetValue(valueName: string, type: 'REG_DWORD' | 'REG_SZ', data: string): Promise<void> {
  await execFileAsync('reg.exe', ['add', REG_PATH, '/v', valueName, '/t', type, '/d', data, '/f'], {
    windowsHide: true,
    timeout: 4000
  });
}

/**
 * Builds the PowerShell command that broadcasts INTERNET_OPTION_SETTINGS_CHANGED (39)
 * and INTERNET_OPTION_REFRESH (37) via wininet.dll.
 * Uses PowerShell single-quoted string for $sig so C# double quotes require no escaping.
 */
export function buildWinInetNotifyScript(): string {
  return [
    `$sig = '[DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);';`,
    `$t = Add-Type -MemberDefinition $sig -Name WinInetNotify -Namespace Veil -PassThru -ErrorAction Stop;`,
    `$t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null;`,
    `$t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null;`
  ].join(' ');
}

/**
 * Best-effort WinINet broadcast so running browsers pick up proxy changes immediately.
 * Runs asynchronously and never blocks connection startup.
 */
function defaultNotifyWinInetAsync(): void {
  if (process.platform !== 'win32') return;
  const script = buildWinInetNotifyScript();
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 20000 },
    () => {
      // Non-fatal best-effort broadcast
    }
  );
}

async function defaultCheckAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await execFileAsync('net', ['session'], { windowsHide: true, timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export class WinProxyGuard {
  private backupFile: string;
  private active = false;
  private ops: ProxyRegistryOps;

  constructor(userDataDir: string, ops?: Partial<ProxyRegistryOps>) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.backupFile = path.join(userDataDir, 'proxy-backup.json');
    this.ops = {
      platform: ops?.platform ?? process.platform,
      queryValue: ops?.queryValue ?? defaultRegQueryValue,
      setValue: ops?.setValue ?? defaultRegSetValue,
      notifyWinInet: ops?.notifyWinInet ?? defaultNotifyWinInetAsync,
      checkAdmin: ops?.checkAdmin ?? defaultCheckAdmin
    };
  }

  getBackupFilePath(): string {
    return this.backupFile;
  }

  async isAdmin(): Promise<boolean> {
    return this.ops.checkAdmin();
  }

  async recoverIfDirty(): Promise<ProxyRestoreResult> {
    if (this.ops.platform !== 'win32') return { ok: true, restored: false };
    if (!fs.existsSync(this.backupFile)) return { ok: true, restored: false };
    try {
      const data = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')) as ProxySnapshot;
      if (data.appliedByVeil) {
        await this.restoreFromSnapshot(data);
      }
      fs.unlinkSync(this.backupFile);
      this.active = false;
      return { ok: true, restored: true };
    } catch (err) {
      return {
        ok: false,
        restored: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  private async readCurrentProxy(): Promise<ProxySnapshot> {
    const [enableRaw, server, override] = await Promise.all([
      this.ops.queryValue('ProxyEnable'),
      this.ops.queryValue('ProxyServer'),
      this.ops.queryValue('ProxyOverride')
    ]);
    const proxyEnable = enableRaw.startsWith('0x') ? parseInt(enableRaw, 16) : Number(enableRaw) || 0;
    return {
      proxyEnable: proxyEnable ? 1 : 0,
      proxyServer: server,
      proxyOverride: override,
      appliedByVeil: true
    };
  }

  /**
   * Applies Windows HKCU system proxy settings.
   * If ANY registry write step fails, immediately rolls back to the pre-change snapshot
   * and throws a ProxyOperationError clearly indicating whether rollback succeeded or failed.
   */
  async enableSystemProxy(port: number): Promise<void> {
    if (this.ops.platform !== 'win32') return;

    let snap: ProxySnapshot;
    const hadExistingBackup = fs.existsSync(this.backupFile);
    if (hadExistingBackup) {
      snap = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')) as ProxySnapshot;
    } else {
      snap = await this.readCurrentProxy();
      fs.writeFileSync(this.backupFile, JSON.stringify(snap, null, 2));
      restrictFilePermissions(this.backupFile);
    }

    const override = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;192.168.*;<local>';
    try {
      // Write server and override before enabling ProxyEnable to minimize half-configured window
      await this.ops.setValue('ProxyServer', 'REG_SZ', `127.0.0.1:${port}`);
      await this.ops.setValue('ProxyOverride', 'REG_SZ', override);
      await this.ops.setValue('ProxyEnable', 'REG_DWORD', '1');
      this.ops.notifyWinInet();
      this.active = true;
    } catch (writeErr) {
      const writeMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      try {
        await this.restoreFromSnapshot(snap);
        if (!hadExistingBackup && fs.existsSync(this.backupFile)) {
          fs.unlinkSync(this.backupFile);
        }
        this.active = false;
        throw new ProxyOperationError(
          `写入 Windows 系统代理失败 (${writeMsg})；已自动恢复原系统代理设置。`,
          { rollbackAttempted: true, rollbackSucceeded: true }
        );
      } catch (rbErr) {
        if (rbErr instanceof ProxyOperationError) throw rbErr;
        const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
        throw new ProxyOperationError(
          `写入 Windows 系统代理失败 (${writeMsg})，且自动恢复原代理设置失败 (${rbMsg})，请手动检查 Windows 代理设置。`,
          { rollbackAttempted: true, rollbackSucceeded: false, rollbackError: rbMsg }
        );
      }
    }
  }

  async disableSystemProxy(): Promise<ProxyRestoreResult> {
    if (this.ops.platform !== 'win32') return { ok: true, restored: false };
    if (!this.active && !fs.existsSync(this.backupFile)) return { ok: true, restored: false };

    try {
      if (fs.existsSync(this.backupFile)) {
        const snap = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')) as ProxySnapshot;
        await this.restoreFromSnapshot(snap);
        fs.unlinkSync(this.backupFile);
      } else {
        await this.restoreFromSnapshot({ proxyEnable: 0, proxyServer: '', proxyOverride: '', appliedByVeil: false });
      }
      this.active = false;
      return { ok: true, restored: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, restored: false, error: msg };
    }
  }

  private async restoreFromSnapshot(snap: ProxySnapshot): Promise<void> {
    const errors: string[] = [];
    // Attempt every key so one failure does not leave ProxyEnable stuck at 1
    const steps: Array<[string, 'REG_DWORD' | 'REG_SZ', string]> = [
      ['ProxyEnable', 'REG_DWORD', snap.proxyEnable ? '1' : '0'],
      ['ProxyServer', 'REG_SZ', snap.proxyServer || ''],
      ['ProxyOverride', 'REG_SZ', snap.proxyOverride || '']
    ];
    for (const [key, type, val] of steps) {
      try {
        await this.ops.setValue(key, type, val);
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.ops.notifyWinInet();
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }
}
