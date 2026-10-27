# Nacre

A privacy-focused web browser for Windows, built on Electron and Chromium.

Nacre routes your browsing through Tor by default, blocks ads and trackers, and keeps everything on your PC: no account, no sync, no telemetry.

**Status: beta (1.0.0).** It works for everyday browsing, but the installer is not signed yet and some protections are partial. Don't use it for anything where your safety depends on anonymity: use [Tor Browser](https://www.torproject.org/) for that.

https://github.com/user-attachments/assets/ee91cc40-786c-449c-a132-e4016a3b8ba4

![Nacre home page](docs/screenshots/home.png)

| Site protection | Network and Tor settings | Menu |
|---|---|---|
| ![Site protection panel](docs/screenshots/protection.png) | ![Network and Tor settings](docs/screenshots/settings.png) | ![Main menu](docs/screenshots/menu.png) |

## Features

- **Tor built in**, on by default, with bridge support. Direct mode and manual proxies are available too.
- **Ad and tracker blocking**, with per-site controls and a view of what was blocked and why.
- **Phishing warnings** from local checks and a bundled list. The addresses you visit are not sent anywhere.
- **Tracking-link cleanup**: removes tracking parameters from links.
- **Workspaces**: each one has its own separate cookies and storage.
- **Private tabs**, "forget this site when its last tab closes", and clear on quit.
- **Password-protected profiles** for settings and bookmarks.
- **Bookmark import** from Chrome, Edge, Brave, Vivaldi, Opera and Firefox, read locally.
- **20 interface languages**, plus your own if yours is missing.

See [PRIVACY.md](PRIVACY.md) for exactly what is stored and what goes over the network.

## Install

Download `Nacre Setup 1.0.0.exe` from the [releases page](https://github.com/nacrebrowser/nacre/releases) and run it. You can choose the install folder and whether Tor is on by default.

Windows will say "Windows protected your PC" because the installer is not signed yet. Click **More info**, then **Run anyway**. You can check the file against `SHA256SUMS-1.0.0.txt`:

```powershell
Get-FileHash "Nacre Setup 1.0.0.exe"
```

A portable version is also available: unzip `Nacre 1.0.0 Portable.zip` and run `Nacre Portable.cmd`. Your data stays in the `NacreData` folder next to it.

## Build from source

You need Windows x64, Node.js 24 and pnpm.

```powershell
pnpm install
pnpm start
```

`pnpm start` downloads the pinned Tor bundle on first run.

```powershell
pnpm test
pnpm run build:windows
```

The build writes the installer, the portable zip and the checksums to `dist\`.

## Documentation

- [Privacy](PRIVACY.md)
- [Security and threat model](docs/security/THREAT_MODEL.md)
- [Testing a beta](docs/TESTERS.md)
- [Translations](docs/LOCALIZATION.md)
- [Profiles](docs/LOCAL_PROFILES.md), [diagnostics](docs/DIAGNOSTICS.md), [phishing list](docs/phishing-feed.md)
- [Changelog](CHANGELOG.md)

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). Until signing is active, Windows builds are unsigned.

- Committers and reviewers: [NacreDev](https://github.com/nacrebrowser)
- Approvers: [NacreDev](https://github.com/nacrebrowser)

Signed builds are produced by GitHub Actions from this repository. What Nacre stores and sends over the network is described in the [privacy policy](PRIVACY.md).

## Support Nacre

Nacre is free and has no ads or tracking. If it is useful to you, you can support its development with a [donation on PayPal](https://paypal.me/donNacre).

## License

Nacre is released under the [Mozilla Public License 2.0](LICENSE.md). Bundled components (Tor, filter lists, Electron) keep their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
