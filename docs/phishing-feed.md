# Bundled phishing list

Nacre ships a list of about 520,000 suspicious hostnames and checks every navigation against it on your PC. Nothing is sent to the list providers when you browse. A match shows a warning you can read and dismiss: it is a signal, not proof that a site is malicious.

## Sources

| Source | License |
|---|---|
| [phishunt.io](https://phishunt.io/feed.txt) | [CC0-1.0](https://phishunt.io/tos/) |
| [Phishing.Database](https://github.com/Phishing-Database/Phishing.Database), active domains | [MIT](https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE) |
| [PhishDestroy](https://phishdestroy.io/dataset), DNS-active dataset | CC0-1.0 |

Settings › Phishing shows each source's size and date. The list is updated with each Nacre release, not in the background.

Some other lists were left out on purpose: Phishing Army does not pass on its upstream providers' redistribution rights, CERT Polska expects refreshes every few minutes, and URL feeds such as PhishTank or OpenPhish flag single pages that should not block a whole shared domain.

## Matching and false positives

Only hostnames are stored: no paths, query strings or IP addresses. A listed host also matches its subdomains. Shared hosting roots such as `github.io` or `vercel.app` are excluded, so one bad page cannot block every site hosted there.

False positives are still possible. If a legitimate site is flagged, report it in an [issue](https://github.com/nacrebrowser/nacre/issues). You can also add your own blocked domains in Settings › Phishing.

## Rebuilding the list

```powershell
pnpm run prepare:phishing
```

This downloads the approved sources (`scripts/phishing-sources.cjs`) over HTTPS from an allowlist of hosts, pins GitHub sources to an exact commit, and records each source's revision, SHA-256, date and count in `src/phishing-domains.json`. If any source fails, the existing list is kept.
