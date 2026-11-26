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

const REG_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 8000 }
  );
  return stdout.trim();
}

const REFRESH_WININET_PS = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class WinInet {
  [DllImport("wininet.dll", SetLastError = true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`;

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
    const script = `
      $p = Get-ItemProperty -Path '${REG_KEY}' -ErrorAction SilentlyContinue
      @{
        proxyEnable = if ($null -ne $p.ProxyEnable) { [int]$p.ProxyEnable } else { 0 }
        proxyServer = if ($null -ne $p.ProxyServer) { [string]$p.ProxyServer } else { '' }
        proxyOverride = if ($null -ne $p.ProxyOverride) { [string]$p.ProxyOverride } else { '' }
      } | ConvertTo-Json -Compress
    `;
    try {
      const raw = await runPs(script);
      const parsed = JSON.parse(raw) as Partial<ProxySnapshot>;
      return {
        proxyEnable: Number(parsed.proxyEnable || 0),
        proxyServer: String(parsed.proxyServer || ''),
        proxyOverride: String(parsed.proxyOverride || ''),
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
    const script = `
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyEnable -Value 1
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyServer -Value '127.0.0.1:${port}'
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyOverride -Value '${override}'
      ${REFRESH_WININET_PS}
    `;
    await runPs(script);
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
    const safeServer = snap.proxyServer.replace(/'/g, "''");
    const safeOverride = snap.proxyOverride.replace(/'/g, "''");
    const script = `
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyEnable -Value ${snap.proxyEnable ? 1 : 0}
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyServer -Value '${safeServer}'
      Set-ItemProperty -Path '${REG_KEY}' -Name ProxyOverride -Value '${safeOverride}'
      ${REFRESH_WININET_PS}
    `;
    await runPs(script);
  }
}
