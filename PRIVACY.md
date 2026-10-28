# Privacy

This describes Nacre 1.0.0. Nacre is beta software: read the limits at the end before relying on it.

## The short version

- No account, no sync, no telemetry. Nacre has no server of its own.
- Everything Nacre stores stays on your PC.
- By default, browsing goes through Tor. Websites see a Tor exit address, not yours.
- Nacre only connects somewhere when you browse, or for the few background tasks listed below.

## What stays on your PC

Each profile has its own folder. In it, Nacre keeps:

- settings, bookmarks, home page shortcuts and site icons;
- cookies and site storage for normal tabs, until you clear them, until a "forget this site" rule removes them, or at exit if "Clear on quit" is on;
- your downloads, which stay where you saved them.

Nacre does not keep a browsing history between launches. Recently closed tabs are kept in memory only, and are gone when Nacre closes. Private tabs use in-memory sessions that are discarded when they close.

You can protect a profile with a password. The vault encrypts settings, bookmarks and the icon cache. It does not encrypt cookies, site storage, cache or downloaded files. If you forget the password, there is no recovery.

Deleting data is not forensic erasure: traces can remain on the disk.

## Network connections

**When you browse.** Websites and your search engine (DuckDuckGo by default) receive your requests, as with any browser.

- With Tor on (the default), tabs go through Tor. Websites see a Tor exit address. Your internet provider sees that you use Tor, but not which sites.
- In direct mode, websites see your real IP address. DNS goes to Quad9 over HTTPS, with a fallback to your network's DNS if Quad9 is blocked ("strict" mode turns the fallback off).
- With a manual proxy, traffic goes through that proxy.

If Tor is on but stops working, Nacre does not quietly switch to a direct connection: pages fail to load until Tor is back or you choose direct mode.

**In the background.** Nacre makes these connections on its own:

| What | When | Through |
| --- | --- | --- |
| Tor network | At startup, if Tor is on | Tor |
| Missing site icons | After a bookmark import, or when you add a shortcut without an icon (at most every 3 hours) | Tor only. If Tor is off, a temporary Tor process is started for this alone, then stopped. Not done when a manual proxy is set. |
| Update check | Once a day, a few minutes after startup (can be turned off in Settings › About) | Tor when Tor is on, with no direct fallback. Without Tor, only after you allow it once (GitHub then sees your IP address). GitHub receives requests for the release files only: no identifier, history or bookmarks. |

You can turn off the icon fetching in Settings › Privacy › "Fetch missing site icons through Tor".

**Only when you ask.** These never run on their own:

- updating the ad and tracker filter lists (through Tor);
- leak-test websites opened from the diagnostics page.

The phishing list is bundled with the app. Nacre does not send the addresses you visit to a reputation service: phishing checks and tracking-link cleanup run locally.

## What Nacre sends to websites

- A standard Chrome user agent, so Nacre looks like ordinary Chrome.
- The Global Privacy Control signal (on by default).
- Third-party cookies are blocked by default. HTTPS-only mode is on.
- Fingerprinting protections are on by default, and WebGL is off.

Trusted sites (for example streaming services you stay signed in to) keep a stable fingerprint between launches and keep their sign-in cookies across their own domains. Blocking, phishing checks and HTTPS-only still apply to them.

## Importing from another browser

Bookmark import reads the other browser's files locally. Nothing is sent anywhere. Only bookmarks and their icons are imported, not passwords, history or cookies.

## Limits

Be honest with yourself about what Nacre is:

- It is not Tor Browser. Tor Browser makes every user look the same; Nacre does not. Tor in Nacre hides your IP address, not who you are.
- It is not a VPN. Only Nacre's own browsing goes through Tor, not the rest of your PC.
- Fingerprinting protection is partial. Workers, some frames and OffscreenCanvas can still expose real values.
- No independent packet capture has yet confirmed that no traffic ever bypasses Tor.
- Signing in to a website tells that website who you are, whatever the network route.

Questions or concerns: see [SECURITY.md](SECURITY.md).
