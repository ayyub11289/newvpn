# VEIL VPN — Windows 11 Desktop Client

A Windows 11 desktop VPN & proxy client featuring an optical frosted-glass interface, interactive 3D orthographic dot-matrix globe with camera fly-to, tactile hardware acoustics, system tray floating widget, and a `sing-box` + `Wintun` core architecture.

## Highlights

- **Optical Frosted Glass UI & Win11 Native Chrome**: Pinned frameless Windows 11 Mica/Acrylic titlebar, cursor-tracking specular sheen, 60-tick machined power core, and Dark/Light theme switching.
- **Interactive 3D Globe & 2D Map**: Drag-to-rotate 3D orthographic dot-matrix globe with lofted great-circle encrypted arcs, comet packets, and automatic geo-coordinate mapping for imported nodes.
- **Persistent Subscriptions & WireGuard Importer**: Saves subscription URLs locally with one-click refresh; supports Clash YAML, Base64/URI (`vless://`, `trojan://`, `ss://`, `vmess://`, `hysteria2://`), and standard WireGuard `.conf` files.
- **Dual Network Takeover Modes**:
  - **System Proxy Mode (No Admin Required)**: Manages Windows `Internet Settings` registry + WinINet live refresh, exposes `127.0.0.1:7890` (HTTP) and `127.0.0.1:7891` (SOCKS5), and automatically restores original proxy settings on exit or crash recovery.
  - **TUN Virtual NIC Mode (`Wintun`)**: Compiles Layer-3 virtual adapter config with per-process split tunneling (`process_name`), Multi-Hop (`detour`), NetShield DNS blocking, and strict-route Kill Switch.
- **Cloud Auto-Build, Auto-Update & Launch at Startup**:
  - GitHub Actions workflow (`.github/workflows/release-win.yml`) automatically bundles `sing-box.exe` + `wintun.dll` into ready-to-run Windows `.exe` Installers & Portable builds on GitHub Releases.
  - Built-in `electron-updater` checks GitHub Releases automatically and supports one-click in-app updates while preserving all user subscriptions and rules in `%APPDATA%`.
  - Native Windows 11 silent launch-at-startup (`--hidden` to system tray).

## Downloading Ready-to-Use Windows 11 Builds (No Node.js Required)

1. Open the **Actions** tab on GitHub → select **Build & Release VEIL VPN (Windows 11)** → click **Run workflow** (or push a version tag like `v1.0.0`).
2. Once finished, download `VEIL-VPN-*-win-x64-nsis.exe` (Installer) or `VEIL-VPN-*-win-x64-portable.exe` (Portable) from the **Releases** page.
3. Run the `.exe` on any Windows 10/11 PC and click **`+ 导入节点`** to paste your subscription URL or WireGuard `.conf`.

## Local Development

```powershell
# 1. Install dependencies
npm.cmd install

# 2. (Optional) Fetch official sing-box.exe & wintun.dll into resources/bin/
npm.cmd run fetch-core

# 3. Build & start desktop client
npm.cmd run build
npm.cmd start

# 4. Build local Windows .exe installer & portable package into release/
npm.cmd run dist:win
```
