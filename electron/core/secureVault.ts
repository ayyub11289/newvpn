import fs from 'node:fs';
import path from 'node:path';
import { VaultState } from '../types';
import { restrictFilePermissions } from './secretRedactor';

export interface VaultCryptoProvider {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

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

const ENCRYPTION_UNAVAILABLE_WARNING =
  '系统加密存储（DPAPI）当前不可用：为避免明文落盘，订阅与节点凭据仅保留在本次会话内存中，不会以明文写入磁盘。';

function getElectronSafeStorageProvider(): VaultCryptoProvider {
  return {
    isEncryptionAvailable: () => {
      try {
        // Lazy require so unit tests can run SecureVault outside Electron runtime
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron') as { safeStorage?: VaultCryptoProvider };
        return Boolean(electron.safeStorage?.isEncryptionAvailable());
      } catch {
        return false;
      }
    },
    encryptString: (plainText: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as { safeStorage: VaultCryptoProvider };
      return electron.safeStorage.encryptString(plainText);
    },
    decryptString: (encrypted: Buffer) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as { safeStorage: VaultCryptoProvider };
      return electron.safeStorage.decryptString(encrypted);
    }
  };
}

/**
 * Windows DPAPI-backed encrypted storage via Electron safeStorage.
 * - Preserves existing encrypted (VEIL1) vaults and transparently upgrades legacy VEIL0 files when DPAPI is available.
 * - NEVER silently writes plaintext credentials to disk when OS encryption is unavailable; keeps state in memory and surfaces a clear warning.
 */
export class SecureVault {
  private filePath: string;
  private state: VaultState;
  private cryptoProvider: VaultCryptoProvider;

  constructor(userDataDir: string, cryptoProvider?: VaultCryptoProvider) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.filePath = path.join(userDataDir, 'vault.enc');
    this.cryptoProvider = cryptoProvider ?? getElectronSafeStorageProvider();
    this.state = this.loadFromDisk();
  }

  private canEncrypt(): boolean {
    try {
      return this.cryptoProvider.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private writeEncryptedToDisk(stateToSave: VaultState): void {
    const cleanPayload: VaultState = {
      ...stateToSave,
      encryptedAtRest: true
    };
    delete cleanPayload.storageWarning;
    const cipher = this.cryptoProvider.encryptString(JSON.stringify(cleanPayload));
    fs.writeFileSync(this.filePath, Buffer.concat([Buffer.from('VEIL1', 'ascii'), cipher]));
    restrictFilePermissions(this.filePath);
  }

  private loadFromDisk(): VaultState {
    const canEnc = this.canEncrypt();
    if (!fs.existsSync(this.filePath)) {
      return {
        ...DEFAULT_VAULT,
        encryptedAtRest: canEnc,
        storageWarning: canEnc ? undefined : ENCRYPTION_UNAVAILABLE_WARNING
      };
    }
    try {
      const raw = fs.readFileSync(this.filePath);
      const header = raw.subarray(0, 5).toString('ascii');
      let jsonStr = '';
      let migratedLegacyPlaintext = false;

      if (header === 'VEIL1') {
        if (!canEnc) {
          return {
            ...DEFAULT_VAULT,
            encryptedAtRest: false,
            storageWarning: '检测到已加密的凭据库，但当前系统 DPAPI 解密不可用；未覆盖磁盘数据。'
          };
        }
        jsonStr = this.cryptoProvider.decryptString(raw.subarray(5));
      } else if (header === 'VEIL0') {
        jsonStr = raw.subarray(5).toString('utf8');
        migratedLegacyPlaintext = true;
      } else {
        return {
          ...DEFAULT_VAULT,
          encryptedAtRest: canEnc,
          storageWarning: canEnc ? undefined : ENCRYPTION_UNAVAILABLE_WARNING
        };
      }

      const parsed = JSON.parse(jsonStr) as Partial<VaultState>;
      const loaded: VaultState = {
        ...DEFAULT_VAULT,
        ...parsed,
        customNodes: Array.isArray(parsed.customNodes) ? parsed.customNodes : [],
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        encryptedAtRest: canEnc,
        storageWarning: canEnc
          ? undefined
          : '已读取历史未加密数据，但系统加密当前不可用：不会继续以明文落盘保存新变更。'
      };

      // Upgrade legacy VEIL0 plaintext file immediately to DPAPI VEIL1 when encryption is available
      if (migratedLegacyPlaintext && canEnc) {
        this.writeEncryptedToDisk(loaded);
      }

      return loaded;
    } catch {
      return {
        ...DEFAULT_VAULT,
        encryptedAtRest: canEnc,
        storageWarning: canEnc ? undefined : ENCRYPTION_UNAVAILABLE_WARNING
      };
    }
  }

  getState(): VaultState {
    return this.state;
  }

  update(patch: Partial<VaultState>): VaultState {
    const encrypted = this.canEncrypt();
    const nextState: VaultState = {
      ...this.state,
      ...patch,
      encryptedAtRest: encrypted,
      storageWarning: encrypted ? undefined : ENCRYPTION_UNAVAILABLE_WARNING
    };

    if (encrypted) {
      try {
        this.writeEncryptedToDisk(nextState);
        this.state = nextState;
      } catch {
        this.state = {
          ...nextState,
          encryptedAtRest: false,
          storageWarning: 'DPAPI 加密写入失败：已拒绝明文落盘，当前修改仅保留在内存中。'
        };
      }
    } else {
      // Explicitly do NOT write plaintext credentials to disk
      this.state = nextState;
    }

    return this.state;
  }
}
