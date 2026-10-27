# Local diagnostics

Settings → About → Run all local diagnostics opens `nacre://leak-tests/#run`. Results remain in the page. No external test opens automatically and no terminal command is exposed to website code.

The page measures JavaScript execution, access to privileged globals, WebGL/WebGL2, Canvas readback, available audio/WebRTC APIs, language, timezone, CPU count and device-memory hints. A dedicated worker measures its own APIs. The iframe attempt may be refused by internal resource isolation; this is shown as `Could not start`, not as a failure.

## Verdict vocabulary

The page never reduces every observation to “works” or “problem”. Each row has one of these statuses:

- **Verified (`PASS`)** — a measurement ran and matched its expectation. The row includes the measured values as proof.
- **Measured failure (`FAIL`)** — a measurement ran and contradicted its expectation in a realm where the protection should apply (for example the top-level page reports `hardwareConcurrency=16` instead of `8`).
- **Could not start (`NOT_STARTED`)** — the probe could not be created, timed out or returned no usable result. Nothing was measured; this is not a failure.
- **Not run (`NOT_RUN`)** — the check was deliberately not executed, for example the optional external check is unchecked or the source regression suite is not available in a packed page.
- **Limited coverage (`LIMITED`)** — the check ran but its scope cannot support a pass/fail claim. This is used for the one-pixel Canvas probe, iframe/worker fingerprint surfaces outside the preload, the absent independent DNS observer, and the untested live kill-switch disconnection.
- **Measured (`MEASURED`)** — a neutral observation, for example `IsTor=false` when Tor was not expected.
- **Not applicable (`NOT_APPLICABLE`)** — the check does not apply to the current configuration.

The summary counts each state separately. A `LIMITED` row is not a pass and is not a measured protection failure.

## What the realm checks prove

- **Page** (`https` document): Node/process isolation, WebGL/WebGL2 absence, language and CPU normalization are enforced by the page preload and are reported as `PASS` or `FAIL` with measured values.
- **iframe and worker**: Node/process and WebGL are expected to be isolated. Language and `hardwareConcurrency` are not covered by the top-level fingerprint preload; the page records the measured native value and labels the row `LIMITED`. This prevents a known coverage gap from being presented as either a successful protection or a page regression.
- **Canvas**: the page samples exactly one pixel. A changed pixel is useful evidence but cannot certify canvas protection; the row is always `LIMITED` and states the sampled value. A page Canvas `FAIL` is therefore never emitted from this one-pixel probe.
- **Tor Project check**: the optional external check contacts one endpoint after native confirmation. A measured `IsTor` value is `PASS`/`FAIL` when Tor is expected and `MEASURED` otherwise. An unchecked option is `NOT_RUN`; a timeout or missing endpoint answer is `NOT_STARTED`.
- **DNS and kill switch**: no independent DNS observer or live disconnection is integrated. Both are `LIMITED`, not passes.

## Build report

The diagnostics page also renders the bundled `src/release-validation.json` report. Each build check shows its command, exit code and output SHA-256. A successful row says “Verified with evidence”; a failed row says “Measured failure”; a launch crash or timeout says “Could not start”; a check absent from the run says “Not run”; declared scope limits appear as `LIMITED` rows. A stale, invalid or missing report is `NOT_RUN`, never `PASS`. See [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md) for the capture commands and the evidence schema.

## Reproducing the page check

```powershell
node scripts/verify-diagnostics-runtime.cjs
```

The fixture builds the real `main.cjs`, opens `nacre://leak-tests/`, runs the local and external paths against an intercepted HTTPS endpoint, and asserts the rendered `data-status` values, the build rows, consent behaviour and raw-JSON collapse. It uses a disposable profile and prints the environment limitation for `--no-sandbox`.

## Release checks

The full set of release checks, and how the bundled report is produced, is described in [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md).
