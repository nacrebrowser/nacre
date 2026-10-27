# Attack tests (development only)

These tools try to break Nacre's defences on purpose. They only target local fixtures, loopback servers, `.invalid` hostnames and reserved documentation addresses, never public hosts.

```powershell
node scripts/net-audit.cjs
node scripts/red-team/mutation-check.cjs
```

The tests in `fixtures/` also run with `pnpm test`.

## What is tested

| Attack | Result | Test |
|---|---|---|
| Reach another internal file through `nacre://` with dot segments, encoded or double-encoded separators, backslashes or NUL | Blocked | `fixtures/protocol-paths.test.cjs` |
| A web page fetches, frames or opens a `nacre://` page | Blocked in the fixture | `scripts/net-audit.cjs` |
| A page navigates or opens `file:`, UNC paths, OS protocol handlers, `javascript:` or internal pages | Blocked | `fixtures/navigation-attacks.test.cjs` |
| A page-triggered download of a code-running file type opens automatically | Blocked | `fixtures/payload-attacks.test.cjs` |
| A site permission saved under `__proto__` or `constructor` pollutes inherited keys | Blocked | `fixtures/permission-pollution.test.cjs` |
| Bidi control characters in file names, trailing-dot hosts, extra bridge options | Blocked | `test/security-regressions.test.cjs` |
| Third-party cookies sent when the request initiator is missing | Blocked | `test/network-security.test.cjs` |
| Page requests bypass the configured SOCKS proxy, or a closed proxy falls back to direct traffic | No requested destination bypassed the proxy | `scripts/net-audit.cjs` |

`mutation-check.cjs` deliberately breaks eight safeguards (fail-closed proxy, IPC sender check, internal CSP, permission deny, Tor hash check, download TLS check, cookie rule, file name sanitiser) in a throwaway copy of the source, and checks that the tests catch each one.

## Limits

In the network fixture, Chromium still attempts an IPv6 UDP connection outside the proxy. NetLog records the attempt, but it does not show whether a packet actually left the machine. A Windows packet capture of the full app is still needed.

These fixtures are not the full app: they do not cover Tor itself, real websites, fingerprinting sites, installer permissions or every IPC call in a live Electron process. See the [threat model](../../docs/security/THREAT_MODEL.md).

NetLog files are written to `.cache/net-audit/`. Don't share them: they can contain sensitive network details.
