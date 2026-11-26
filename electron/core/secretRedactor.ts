import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Redacts subscription tokens, passwords, UUIDs, WireGuard private keys, and URL credentials
 * so sensitive secrets never appear in logs, error toasts, or diagnostics.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  // 1. Strip ANSI escape sequences
  out = out.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[0-9;]{1,6}m/g, '');

  // 2. Redact credentials embedded in URLs / proxy URIs (scheme://userinfo@host)
  out = out.replace(
    /((?:https?|vless|vmess|trojan|ss|hysteria2|hy2|socks5?):\/\/)([^@\s/]+)@/gi,
    '$1[REDACTED]@'
  );

  // 3. Redact sensitive query parameters (?token=..., &password=..., &key=..., etc.)
  out = out.replace(
    /([?&](?:token|key|api_?key|secret|pass(?:word)?|auth|pwd|obfs[-_]?password|pbk|sid|spx|uuid)=)([^&\s#]+)/gi,
    '$1[REDACTED]'
  );

  // 4. Redact JSON secret fields
  out = out.replace(
    /("(?:private_key|pre_shared_key|password|uuid|secret|obfs_password|token|auth_str)"\s*:\s*")([^"]*)(")/gi,
    '$1[REDACTED]$3'
  );

  // 5. Redact WireGuard INI key assignments (PrivateKey = ..., PresharedKey = ...)
  out = out.replace(
    /\b(PrivateKey|PresharedKey|private_key|pre_shared_key)\s*[:=]\s*([^\s,;]+)/gi,
    '$1=[REDACTED]'
  );

  return out;
}

/**
 * Restricts a file on disk to current-user read/write only.
 * Uses icacls on Windows and chmod 0600 on POSIX. Best-effort without throwing on non-NTFS FS.
 */
export function restrictFilePermissions(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    if (process.platform === 'win32') {
      const user = process.env.USERNAME || process.env.USER;
      if (user) {
        execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:(R,W)`], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 3000
        });
      }
    } else {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Non-fatal on filesystems/environments that reject ACL updates
  }
}
