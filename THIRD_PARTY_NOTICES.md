# Third-party notices

Nacre's own code is released under the [MPL-2.0](LICENSE.md). The MPL applies file by file and does not relicense the components and data below, which keep their own licenses.

## Software

| Component | Version | License | Used for |
|---|---:|---|---|
| Electron | 44.9.3 | MIT | Desktop runtime with Chromium |
| Chromium | 152.0.7977.167 (bundled with Electron) | BSD-3-Clause and Chromium notices | Web rendering |
| Node.js | 24.22.0 (bundled with Electron) | MIT | Main process runtime |
| `@ghostery/adblocker-electron` | 2.20.1 | MPL-2.0 | Ad and tracker blocking engine |
| `@ghostery/adblocker` and `@ghostery/adblocker-electron-preload` | 2.20.1 | MPL-2.0 | Blocking engine dependencies |
| `tldts-experimental` | 7.4.18 | MIT | Registrable domain parsing |
| `qrcode-generator` | 2.0.4 | MIT | Local QR codes for sharing, in `src/vendor/` with `QRCODE_LICENSE.txt` |
| Tor Expert Bundle | 15.0.25 / Tor 0.4.9.14 | BSD-3-Clause for Tor; other notices included in the bundle | Tor network |
| Lyrebird | Included in the Tor bundle | See `vendor/tor/licenses/lyrebird.txt` | obfs4 and Snowflake bridges |
| Conjure client | Included in the Tor bundle | See `vendor/tor/licenses/conjure.txt` | Conjure bridges |

Build tools only, not shipped in the app: `electron-builder` 26.17.0 (MIT) and `@electron/fuses` 1.8.0 (MIT).

`SBOM.cdx.json` (CycloneDX 1.5, generated with `pnpm run sbom`) lists every npm package, Tor component and filter source with its declared license and hash.

## Filter lists

The bundled filter snapshot is Ghostery's `fromPrebuiltAdsAndTracking` configuration. `vendor/filters/metadata.json` lists its sources and SHA-256 hash.

- **EasyList and EasyPrivacy**: GPL-3.0 and/or CC BY-SA 3.0, depending on the list and version.
- **uBlock Origin resources (uAssets)**: GPL-3.0. See the [uAssets license](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE).
- **Peter Lowe's list**: McRae General Public License v4.r53, as stated on [pgl.yoyo.org](https://pgl.yoyo.org/).

These lists are only downloaded when you update filters, and are not in the bundled snapshot:

- **Liste FR + EasyList**: license of the downloaded version applies.
- **Fanboy Annoyances**: CC BY 3.0.

The lists are data distributed alongside Nacre, not part of its code. Their licenses, including share-alike terms, apply to the lists themselves. See [filter list licenses](https://github.com/gorhill/uBlock/wiki/Filter-list-licenses).

## Phishing list

The bundled list of suspicious domains (`src/phishing-domains.json`) merges:

- [phishunt.io](https://phishunt.io/tos/) — CC0-1.0
- [Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) — MIT
- [PhishDestroy DNS-active dataset](https://phishdestroy.io/dataset) — CC0-1.0

It gives warning signals, not confirmed phishing. Each source's revision, hash and date are recorded in the file.

### Phishing.Database — MIT License

Copyright (c) 2018-2025 Mitchell Krog - github.com/mitchellkrogza

Copyright (c) 2018-2025 Nissar Chababy - github.com/funilrys

Copyright (c) 2018-2025 Phishing.Database Contributors - github.com/Phishing-Database

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
