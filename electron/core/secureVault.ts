import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { VaultState } from '../types';

const DEFAULT_VAULT: VaultState = {
  customNodes: [],
  subscriptions: [],
  activeNodeId: null,
  entryNodeId: null,
  multiHop: false,
  protocol: 'wireguard',
  takeoverMode: 'system-proxy',
  encryptedAtRest: false
};

/**
 * Windows DPAPI-backed encrypted storage via Electron safeStorage.
 * Stores subscription credentials, WireGuard private keys, and active client state
 * centrally in the main process so both Main Window and Tray Popover stay in sync
 * without writing sensitive keys in plaintext localStorage.
 */
export class SecureVault {
  private filePath: string;
  private state: VaultState;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.filePath = path.join(userDataDir, 'vault.enc');
    this.state = this.loadFromDisk();
  }

  private canEncrypt(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private loadFromDisk(): VaultState {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_VAULT, encryptedAtRest: this.canEncrypt() };
    }
    try {
      const raw = fs.readFileSync(this.filePath);
      const header = raw.subarray(0, 5).toString('ascii');
      let jsonStr = '';
      let encryptedAtRest = false;

      if (header === 'VEIL1' && this.canEncrypt()) {
        jsonStr = safeStorage.decryptString(raw.subarray(5));
        encryptedAtRest = true;
      } else if (header === 'VEIL0') {
        jsonStr = raw.subarray(5).toString('utf8');
      } else {
        return { ...DEFAULT_VAULT, encryptedAtRest: this.canEncrypt() };
      }

      const parsed = JSON.parse(jsonStr) as Partial<VaultState>;
      return {
        ...DEFAULT_VAULT,
        ...parsed,
        customNodes: Array.isArray(parsed.customNodes) ? parsed.customNodes : [],
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        encryptedAtRest
      };
    } catch {
      return { ...DEFAULT_VAULT, encryptedAtRest: this.canEncrypt() };
    }
  }

  getState(): VaultState {
    return this.state;
  }

  update(patch: Partial<VaultState>): VaultState {
    const encrypted = this.canEncrypt();
    this.state = {
      ...this.state,
      ...patch,
      encryptedAtRest: encrypted
    };

    const payload = JSON.stringify(this.state);
    if (encrypted) {
      const cipher = safeStorage.encryptString(payload);
      fs.writeFileSync(this.filePath, Buffer.concat([Buffer.from('VEIL1', 'ascii'), cipher]));
    } else {
      fs.writeFileSync(this.filePath, Buffer.concat([Buffer.from('VEIL0', 'ascii'), Buffer.from(payload, 'utf8')]));
    }
    return this.state;
  }
}
