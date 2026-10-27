# Threat model

Nacre is an Electron/Chromium browser for Windows. Web pages run in their own views. Nacre's own pages (`nacre://`) and the main process are privileged. A bundled Tor client routes browsing by default.

## Who we defend against

- **Websites and trackers.** They run JavaScript, embed frames, redirect, and try to fingerprint or follow you across sites. They may also try to reach `nacre://` pages or Nacre's internal messaging (IPC) to gain privileges.
- **Your network and internet provider.** With Tor on, they see that you use Tor (or a bridge), when, and how much, but not which sites. In direct mode, they see the IP addresses you connect to.
- **Tor exit relays.** They can see unencrypted HTTP traffic and its destination. HTTPS-only mode is on by default for this reason.

## Out of scope

- Malware already running on your PC. It can read your profile, your screen and your keystrokes. Nacre is not a sandbox.
- A global adversary correlating Tor traffic.
- Identifying yourself to a site, for example by signing in.
- Unknown vulnerabilities in Chromium, Electron or Tor. Nacre follows their updates.

## What we protect

1. Your IP address and DNS lookups, from the sites you visit.
2. Nacre's privileged pages and main-process functions, from web content.
3. Proxy credentials and the Tor control cookie.
4. Bookmarks, settings, permissions and site data on disk.
5. The integrity of the Tor binaries, filter lists and the installer.

## Rules the code follows

- Web pages get no access to Node.js or Electron APIs.
- Every privileged IPC handler checks that the request comes from a trusted `nacre://` frame. A test checks every handler for this.
- Websites cannot navigate to, embed, or fetch `nacre://` pages.
- Sessions set to Tor fail closed: if Tor stops, pages stop loading instead of falling back to a direct connection.
- Network requests from the main process go through the browsing session's proxy.
- Tor and filter downloads are checked against pinned hashes.
- A protection is only described as working when code and a test show it.

## Known gaps

- Fingerprinting protection does not cover workers, OffscreenCanvas or every frame. GPU details can leak when WebGL is turned on.
- In test fixtures, Chromium has attempted an IPv6 UDP connection outside the proxy. No Windows packet capture of the full app has confirmed or ruled out a leak yet.
- The installer is not signed.

Report problems as described in [SECURITY.md](../../SECURITY.md).
