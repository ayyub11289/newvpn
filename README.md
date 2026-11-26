# VEIL VPN — Windows 11 Desktop Client

A Windows 11 desktop VPN & proxy client featuring an optical frosted-glass interface, interactive 3D orthographic dot-matrix globe with camera fly-to, tactile hardware acoustics, system tray floating widget, and a `sing-box` + `Wintun` core architecture.

## Highlights

- **Optical Frosted Glass UI & Win11 Native Chrome**: Frameless Windows 11 Mica/Acrylic aesthetic, cursor-tracking specular sheen, 60-tick machined power core, and Dark/Light theme switching.
- **Interactive 3D Globe & 2D Map**: Drag-to-rotate 3D orthographic dot-matrix globe with lofted great-circle encrypted arcs, comet packets, and automatic geo-coordinate mapping for imported nodes.
- **Real Subscription & WireGuard Importer**: Supports Clash YAML subscriptions, Base64/URI lists (`vless://`, `trojan://`, `ss://`, `vmess://`, `hysteria2://`), and standard WireGuard `.conf` files.
- **Dual Network Takeover Modes**:
  - **System Proxy Mode (No Admin Required)**: Manages Windows `Internet Settings` registry + WinINet live refresh, exposes `127.0.0.1:7890` (HTTP) and `127.0.0.1:7891` (SOCKS5), and automatically restores original proxy settings on exit or crash recovery.
  - **TUN Virtual NIC Mode (`Wintun`)**: Compiles Layer-3 virtual adapter config with per-process split tunneling (`process_name`), Multi-Hop (`detour`), NetShield DNS blocking, and strict-route Kill Switch.
- **System Tray Popover & `Ctrl+K` Command Palette**: Click the Windows 11 taskbar tray icon for a floating Mini-Widget; press `Ctrl+K` inside the app (or `Ctrl+Shift+V` globally) for instant control.

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. (Optional) Fetch official sing-box.exe & wintun.dll into resources/bin/
npm run fetch-core

# 3. Run in development mode on Windows 11
npm run dev

# 4. Build Windows 11 installer (.exe NSIS + Portable)
npm run dist:win
```

> Note: Without `resources/bin/sing-box.exe` or imported nodes, VEIL automatically runs in **Demo Sandbox Mode** so you can explore the full UI, 3D globe, tray popover, and diagnostics immediately. Place `sing-box.exe` (via `npm run fetch-core`) and import your subscription/WireGuard profile to switch seamlessly to **Live Kernel Mode**.
