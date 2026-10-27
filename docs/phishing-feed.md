# Built-in phishing feeds

Nacre bundles **522,216 unique hostnames** in its 2026-10-26 snapshot (previous snapshot: 1,402). It merges domain feeds, removes duplicates and unsafe shared-service roots, and checks navigation locally. A feed match remains a reviewable warning, not a confirmed phishing finding. Nothing is sent to the feed providers while a page is checked, and the builder never visits any listed host.

| Source | Usable hosts before cross-source deduplication | Upstream data timestamp | Data licence |
|---|---:|---|---|
| [phishunt.io](https://phishunt.io/feed.txt) | 1,196 | 2026-10-26 17:38 UTC | [CC0-1.0](https://phishunt.io/tos/) |
| [Phishing.Database active domains](https://github.com/Phishing-Database/Phishing.Database) | 385,987 | 2026-10-02 15:30 UTC | [MIT](https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE) |
| [PhishDestroy DNS-active](https://phishdestroy.io/dataset) | 141,242 | 2026-10-26 17:36 UTC | CC0-1.0 for this data per the dataset page; repository tooling is separately MIT |

The October 2 source is older than the seven-day freshness window. A new download does not make old upstream data fresh. Settings show each source's count, actual data timestamp and freshness. Combined freshness conservatively uses the oldest source; the snapshot fetch date has a separate freshness value. DNS-active means DNS responded at the source's last check, not that every hostname still serves a phishing page today. Old snapshots remain usable offline with explicit stale status.

## Research and selection

Other sources were checked:

* [The Block List Project phishing list](https://blocklistproject.github.io/Lists/alt-version/phishing-nl.txt): about 190,000 entries, but the inspected file was last modified on 2026-07-06. It is not included just to inflate the count.
* [Phishing Army](https://phishing.army/): a current aggregated feed. Its [usage terms](https://phishing.army/license/) explicitly do not transfer upstream providers' redistribution rights. It is not bundled without resolving those separate terms.
* [CERT Polska](https://cert.pl/lista-ostrzezen/): active v2 data with six-month retention. Its integration guidance asks for five-minute refreshes and removal of delisted domains; the current release-bundled update model does not satisfy that cadence, so it is not added here.
* [PhishTank](https://www.phishtank.org/developer_info.php) and [OpenPhish](https://openphish.com/phishing_feeds.html): URL feeds need separate consideration of path-scoped compromises and distribution terms. Promoting a single malicious URL on a shared service to a whole-domain warning would be unsafe.

The official Phishing.Database download host `phish.co.za` returned HTTP 503 during this run. The publisher's GitHub repository was available and is used at an exact recorded commit. The snapshot records that it is older data, rather than pretending the mirror is current.

## Rebuilding

Run `npm run prepare:phishing` to refresh `src/phishing-domains.json`. `scripts/phishing-sources.cjs` defines the approved sources. GitHub feeds are resolved to a commit and downloaded at that immutable revision; metadata records the revision, raw-content SHA-256, upstream timestamp, fetch date, usable count and excluded-root count. A refresh replaces source contents rather than accumulating removed indicators forever.

Downloads use HTTPS, an explicit host allowlist, same-origin-only redirects (at most three), a 20-second request timeout and a 16 MiB response cap. UTF-8 decoding is strict. All three sources must be valid and nonempty. The union is capped at 1,000,000 hosts and the serialized snapshot at 64 MiB. Failure preserves the existing file; successful output is replaced atomically. No key, telemetry or background feed updater is added to the browser. Updates remain part of browser releases or a deliberate developer refresh.

## Matching and false positives

Only normalized ASCII hostnames are stored. URL paths, query strings, fragments, credentials and IP literals are not included. Matching is exact at hostname-label boundaries, including listed hosts' descendants. Public suffixes and shared hosting roots in the private PSL, such as `github.io` and `vercel.app`, cannot blanket-match tenants. Explicit roots for services sharing URL paths, including `sites.google.com`, `drive.google.com`, `docs.google.com`, Notion roots and common shorteners, are also excluded. A specific listed tenant such as `evil.vercel.app` still matches. These exclusions apply to public feeds; user-entered manual rules retain their behavior.

The imported datasets contained 151 otherwise syntactically valid public-suffix or shared-service roots that were excluded. This reduces one known class of false positives; it does not prove the remaining 522,216 entries are all malicious. The warning text no longer attributes every match to phishunt.io, and all 79 catalogues retain the existing warning key and placeholders.

The runtime uses a sorted string array and binary search, rather than duplicating the larger list into a permanent hash table. It does not use a Bloom filter, fuzzy match, DNS lookup or online reputation request. A larger useful list necessarily costs more memory than 1,402 entries; the index is kept in the main process, not copied into every tab.

An isolated Node 24.21.0 comparison loaded the same 522,216-host snapshot in three fresh processes per index type. With measurement-only GC, retained heap grew by 28.17 MiB for the sorted index versus 33.73 MiB for the previous Set design (capacity raised only in the reference fixture): 5.56 MiB less. Median 20,000 alternating positive/negative lookups took 38.47 ms versus 26.49 ms, approximately 0.6 microsecond more per lookup. This is a component measurement, not a new whole-browser RAM measurement; it must not be added to the earlier browser memory gains.

## Validation

**408 tests pass, zero failures or skips.** Focused tests cover merge/deduplication, malformed and oversized inputs, immutable GitHub revisions, HTTPS and redirect bounds, atomic failure preservation, sorted lookup edges, freshness, shared-service exclusions, normal official services and warning-only public matches.

`npm run verify:phishing` starts real production main/preloads in a disposable profile with the OS sandbox active and a closed network route. It verifies the settings count of 522,216, the three sources and their dates, and the warning page before navigating to a listed hostname. This runtime check passes; no listed site is contacted. Evidence is in `.cache/phishing-expansion/runtime.json` and `.cache/phishing-expansion/full-suite.json`.

Source licences and the Phishing.Database MIT copyright notice are preserved in `THIRD_PARTY_NOTICES.md`.

The GitHub source timestamps are file-commit dates, not individual-domain verification dates. The compact validation record is in `docs/phishing-feed-evidence.json`.
