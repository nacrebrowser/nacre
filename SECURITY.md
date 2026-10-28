# Security

## Reporting a vulnerability

Please don't post exploitable details in a public issue. Report them privately instead: on the [Security tab](https://github.com/nacrebrowser/nacre/security) of the repository, click **Report a vulnerability**.

Include:

- the Nacre version, operating system, and whether Tor was on;
- the shortest steps that reproduce the problem;
- what you expected and what happened.

Never include passwords, cookies, browsing data or a real profile folder.

## Supported versions

Only the latest release gets fixes.

## Update signing

Each release publishes `nacre-update.json` and `nacre-update.json.sig`. The manifest lists every file with its size and SHA-256; the signature file holds one or more Ed25519 signatures over the exact manifest bytes. Nacre installs an update only if:

- at least one signature comes from a manifest key built into Nacre (`src/update-keys.cjs`) that has not been revoked;
- the manifest has not expired and is not older than the newest one this installation has already seen;
- the downloaded file has exactly the announced size and SHA-256;
- every download step stays on `github.com/nacrebrowser/nacre/releases` and GitHub's release-asset hosts, over HTTPS.

All of this is checked again right before the installer starts.

**Keys.** A manifest key signs updates. A separate rescue key can only sign the revocation list (`nacre-key-revocation.json`). The list is cumulative, it holds every key ever revoked, and it is published with every later release, so a copy that was offline during a revocation still learns it. A revoked key is never accepted again by an installation that has seen the list. Private keys are kept offline, never in this repository.

**Rotation.** A new key is first shipped inside a release signed with the current key. For at least a year after that, each manifest is signed by both keys, so a copy of Nacre that skipped some versions can still update.

**What this does and does not protect against.** It stops someone without a signing key from replacing an update, for example by taking over the GitHub account or the download servers. It does not stop someone from blocking updates (Nacre only notices when the metadata expires), it does not help if a build is compromised before it is signed, and it does not help if the signing keys themselves are stolen.

## Scope

See the [threat model](docs/security/THREAT_MODEL.md) for what Nacre tries to protect against, and what it does not.
