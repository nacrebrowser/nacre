# Changelog

## 1.0.0

First public release.

- Tor built in and on by default, with obfs4 and Snowflake bridges. Direct mode and manual proxies are available. If Tor stops, pages stop loading instead of falling back to a direct connection.
- Ad and tracker blocking with per-site controls, and a dashboard showing what was blocked and why.
- Local phishing warnings from heuristics and a bundled public list.
- Tracking-link cleanup when opening or copying links.
- Workspaces with separate cookies and storage, private tabs, "forget this site when its last tab closes", clear on quit, and a Panic button.
- Trusted sites (streaming services, or "Stay signed in on this site") keep a stable fingerprint and their sign-in between launches. Blocking and phishing checks still apply.
- Optional password-protected vault for settings and bookmarks.
- First-run screen: one-click bookmark import from Chrome, Edge, Brave, Vivaldi, Opera and Firefox, read locally.
- Home page with up to 20 shortcuts, site icons fetched only through Tor, and a custom wallpaper.
- Reader view, local QR-code sharing, split view, vertical tabs, command palette, per-site zoom and tab suspension.
- 20 interface languages, chosen from the Windows language list on first run, plus custom languages you can translate yourself.
- Secure DNS through Quad9 in direct mode, with an automatic fallback for networks that block it.
- Local diagnostics page and a privacy check of your settings.
- Windows installer with a Tor or Standard choice, and a portable version.
- Released under the MPL-2.0 license.

Known limits: fingerprinting protection is partial, the installer is not signed yet, and DRM video (Netflix, Disney+…) does not play yet.

## Before 1.0

Nacre went through private test versions from 0.3 to 0.9.6. They built the Tor integration, the ad blocker, the security hardening of Electron, the interface translations and the design that became 1.0.0.
