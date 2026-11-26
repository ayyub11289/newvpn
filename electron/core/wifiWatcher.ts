import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WifiStatus {
  ssid: string | null;
  auth: string;
  isOpen: boolean;
}

export async function inspectWindowsWifi(): Promise<WifiStatus> {
  if (process.platform !== 'win32') {
    return { ssid: null, auth: 'Unknown', isOpen: false };
  }
  try {
    const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], {
      windowsHide: true,
      timeout: 3000
    });
    const ssidMatch = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
    const authMatch = stdout.match(/^\s*(?:Authentication|身份验证)\s*:\s*(.+)$/m);
    const ssid = ssidMatch ? ssidMatch[1].trim() : null;
    const auth = authMatch ? authMatch[1].trim() : 'WPA2';
    const isOpen = Boolean(ssid) && /open|开放/i.test(auth);
    return { ssid, auth, isOpen };
  } catch {
    return { ssid: null, auth: 'Ethernet/Offline', isOpen: false };
  }
}
