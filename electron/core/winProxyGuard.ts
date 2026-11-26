import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ProxySnapshot {
  proxyEnable: number;
  proxyServer: string;
  proxyOverride: string;
  appliedByVeil: boolean;
}

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function regQueryValue(valueName: string): Promise<string> {
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

async function regAdd(valueName: string, type: 'REG_DWORD' | 'REG_SZ', data: string): Promise<void> {
  await execFileAsync('reg.exe', ['add', REG_PATH, '/v', valueName, '/t', type, '/d', data, '/f'], {
    windowsHide: true,
    timeout: 4000
  });
}

/**
 * Best-effort WinINet broadcast so running browsers pick up the proxy immediately.
 * Runs asynchronously and NEVER throws or blocks connection startup.
 */
function notifyWinInetAsync(): void {
  if (process.platform !== 'win32') return;
  const script = [
    '$sig = "[DllImport(\\"wininet.dll\\")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);";',
    '$t = Add-Type -MemberDefinition $sig -Name WinInetNotify -Namespace Veil -PassThru -ErrorAction SilentlyContinue;',
    'if ($t) { $t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null; $t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null; }'
  ].join(' ');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 20000 },
    () => {
      // Non-fatal best-effort broadcast
    }
  );
}

export class WinProxyGuard {
  private backupFile: string;
  private active = false;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.backupFile = path.join(userDataDir, 'proxy-backup.json');
  }

  async isAdmin(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      await execFileAsync('net', ['session'], { windowsHide: true, timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async recoverIfDirty(): Promise<void> {
    if (process.platform !== 'win32') return;
    if (!fs.existsSync(this.backupFile)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')) as ProxySnapshot;
      if (data.appliedByVeil) {
        await this.restoreFromSnapshot(data);
      }
      fs.unlinkSync(this.backupFile);
    } catch {
      // Ignore recovery errors
    }
  }

  private async readCurrentProxy(): Promise<ProxySnapshot> {
    try {
      const [enableRaw, server, override] = await Promise.all([
        regQueryValue('ProxyEnable'),
        regQueryValue('ProxyServer'),
        regQueryValue('ProxyOverride')
      ]);
      const proxyEnable = enableRaw.startsWith('0x') ? parseInt(enableRaw, 16) : Number(enableRaw) || 0;
      return {
        proxyEnable: proxyEnable ? 1 : 0,
        proxyServer: server,
        proxyOverride: override,
        appliedByVeil: true
      };
    } catch {
      return { proxyEnable: 0, proxyServer: '', proxyOverride: '', appliedByVeil: true };
    }
  }

  async enableSystemProxy(port: number): Promise<void> {
    if (process.platform !== 'win32') return;
    if (!fs.existsSync(this.backupFile)) {
      const snap = await this.readCurrentProxy();
      fs.writeFileSync(this.backupFile, JSON.stringify(snap, null, 2));
    }

    const override = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;192.168.*;<local>';
    await regAdd('ProxyEnable', 'REG_DWORD', '1');
    await regAdd('ProxyServer', 'REG_SZ', `127.0.0.1:${port}`);
    await regAdd('ProxyOverride', 'REG_SZ', override);
    notifyWinInetAsync();
    this.active = true;
  }

  async disableSystemProxy(): Promise<void> {
    if (process.platform !== 'win32') return;
    if (!this.active && !fs.existsSync(this.backupFile)) return;
    try {
      if (fs.existsSync(this.backupFile)) {
        const snap = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')) as ProxySnapshot;
        await this.restoreFromSnapshot(snap);
        fs.unlinkSync(this.backupFile);
      } else {
        await this.restoreFromSnapshot({ proxyEnable: 0, proxyServer: '', proxyOverride: '', appliedByVeil: false });
      }
    } finally {
      this.active = false;
    }
  }

  private async restoreFromSnapshot(snap: ProxySnapshot): Promise<void> {
    await regAdd('ProxyEnable', 'REG_DWORD', snap.proxyEnable ? '1' : '0');
    await regAdd('ProxyServer', 'REG_SZ', snap.proxyServer || '');
    await regAdd('ProxyOverride', 'REG_SZ', snap.proxyOverride || '');
    notifyWinInetAsync();
  }
}
