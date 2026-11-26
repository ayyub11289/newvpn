# VEIL VPN — Windows 11 Desktop Client

A Windows 11 desktop VPN & proxy client featuring an optical frosted-glass interface, interactive 3D orthographic dot-matrix globe with camera fly-to, tactile hardware acoustics, system tray floating widget, and a pinned `sing-box 1.14.4` + `Wintun 0.14.1` core architecture.

## Security & Architecture Scope

- **Verified "Protected" State**:
  - Real nodes require a present `sing-box.exe` binary and valid outbound spec; missing cores always report an explicit error instead of silently falling back to demo mode.
  - VEIL only reports **Protected / 已保护** after the local proxy port is listening **and** an end-to-end remote reachability probe through the active proxy succeeds.
- **Credentials & Zero-Disk Runtime Config**:
  - Saved subscriptions and node credentials are encrypted at rest via Windows DPAPI (`safeStorage`, `VEIL1` format) with restricted file permissions. If OS encryption is unavailable, VEIL keeps credentials in memory only and warns the user rather than silently writing plaintext to disk.
  - Runtime `sing-box` configuration is validated (`check -c stdin`) and launched (`run -c stdin`) strictly over standard input — no plaintext runtime config file is written to disk.
  - Logs and error messages redact subscription URL tokens, UUIDs, passwords, and WireGuard private keys.
- **Honest Network Takeover & Kill Switch Boundaries**:
  - **System Proxy Mode (No Admin Required)**: Manages Windows HKCU `Internet Settings` with immediate rollback on partial write failure and WinINet live refresh. **Scope**: covers only applications that respect Windows system proxy settings; raw-socket, UDP, or proxy-bypassing applications are not covered. When Kill Switch is enabled and `sing-box` crashes, the dead local proxy address is retained to block proxy-aware apps until manually restored.
  - **TUN Virtual NIC Mode (`Wintun`, Admin Required)**: Uses `sing-box` `auto_route` and `strict_route` while the kernel process is running. **Scope limitation**: `strict_route` does **not** provide an OS-independent firewall kill-switch after `sing-box` crashes or is forcibly terminated; once the process ends, IPv4/IPv6/DNS routes fall back to the default adapter.
  - **Diagnostics Transparency**: Audit results explicitly distinguish **Live Probes (实测探针)** from **Config-Only Checks (仅配置检查)**.

## Signed Windows Releases & Supply-Chain Hardening

- `scripts/fetch-core.mjs` pins exact versions (`sing-box 1.14.4`, `Wintun 0.14.1`) and verifies pre-recorded **SHA-256** checksums on both downloaded archives and extracted binaries, aborting immediately on mismatch.
- `.github/workflows/release-win.yml` requires Windows Authenticode signing credentials via GitHub Secrets and **refuses to publish unsigned official releases**:
  - `WIN_CSC_LINK`: Base64-encoded `.pfx`/`.p12` code-signing certificate (or HTTPS URL).
  - `WIN_CSC_KEY_PASSWORD`: Certificate private key password.
  - `WIN_PUBLISHER_NAME`: Exact Subject CN of the signing certificate (embedded into `electron-builder` for `electron-updater` `verifyUpdateCodeSignature` publisher identity checks).

## Local Development & Verification

```powershell
# 1. Install dependencies
npm.cmd install

# 2. Fetch & SHA-256 verify pinned sing-box.exe & wintun.dll into resources/bin/
npm.cmd run fetch-core

# 3. Typecheck, build, verify sing-box 1.14 config schemas & run security regression tests
npm.cmd run typecheck
npm.cmd run build
npm.cmd run verify-core-config
npm.cmd test

# 4. Start desktop client
npm.cmd start
```
