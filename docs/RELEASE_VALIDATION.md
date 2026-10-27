# Release validation report

The release-validation page distinguishes checks captured during a release build from diagnostics run on the device that is currently using Nacre. Build results are bundled in `src/release-validation.json`. A missing or invalid report is shown as `NOT_RUN` or `INVALID`; it is never treated as a pass. A report for another package version or source tree is shown as `STALE`.

## What each status means

Every captured stage keeps its real command, start/end timestamps, exit code, stdout/stderr SHA-256 hash and, for the Node suite, the six test counts. Statuses are derived from those captured values; they are never hand-entered.

| Status | Meaning |
| --- | --- |
| `PASS` | The command ran and completed successfully. For a check, exit code 0. For the test suite, exit 0 with at least one test and no failed, cancelled, skipped or todo tests. The row shows the command, exit code and output hash as proof. |
| `FAIL` | The command ran and produced a measured failure: a non-zero ordinary exit code, a failed/cancelled test, or a fingerprint mismatch in a realm where the protection is enforced. |
| `NOT_STARTED` | The command did not reach application code or produced no usable result: spawn error, timeout, signal, Windows NTSTATUS such as `0x80000003`, or an explicitly detected fixture-environment failure. This is **not** a measured failure. |
| `NOT_RUN` | The check was deliberately not executed (for example the optional external check was not selected, or source tests are not run by the packed page). It is not a pass. |
| `LIMITED` | The check ran but its scope cannot support a pass/fail claim: one-pixel Canvas sampling, iframe/worker fingerprint surfaces outside the preload, no independent DNS observer, no live kill-switch disconnection. The row states the measured value and the limit. |
| `MEASURED` | A neutral measurement that is neither a pass nor a failure (for example `IsTor=false` when Tor was not expected). |
| `NOT_APPLICABLE` | The check does not apply to the current configuration. |
| `INCOMPLETE` | The build report as a whole has at least one stage that is not `PASS`, but no measured `FAIL`. |

A report can therefore be `PASS`, `FAIL` or `INCOMPLETE`. It is never silently promoted to `PASS` because a stage was absent, stale, skipped or crashed.

## Report generation

The generator reads a JSON evidence file. The evidence schema has no status fields: the builder derives every status from real process results. Do not hand-enter `PASS` and do not replace old results manually.

```powershell
# 1. Run the Node suite first to confirm the checkout is healthy.
node --test --test-reporter=tap

# 2. Capture the suite and the Electron-backed checks.
#    This writes .cache/release-<nacreVersion>/evidence.json plus one log per check,
#    then atomically writes src/release-validation.json.
node scripts/capture-release-validation.cjs

# 3. Build the packaged application after the manifest exists.
node scripts/run-electron-builder.cjs --win --x64 --config build/electron-builder.dir.cjs

# 4. Capture the packaged-source comparison and packaged smoke test.
#    This appends the two real package checks and rebuilds the manifest.
node scripts/capture-packaged-validation.cjs
```

The capture commands record:

- the exact command line (`node …`), real start/end ISO timestamps, the real process exit code (including Windows NTSTATUS values such as `2147483651` = `0x80000003`, not a normalised `1`), signal, timeout flag and SHA-256 of the complete stdout/stderr;
- the Node TAP counts (`total`, `passed`, `failed`, `cancelled`, `skipped`, `todo`);
- `LIMITATION …` lines and `limits` arrays emitted by the check itself, attached to the producing check with its output hash.

`node scripts/build-release-validation-manifest.cjs <evidence.json> [src/release-validation.json]` can rebuild the manifest from an existing evidence file without rerunning anything. The builder refuses evidence from a different source tree or package version and atomically replaces the manifest.

## Evidence schema (version 2)

Top level: `format` (`nacre-release-validation-evidence`), `schemaVersion` (`2`), `releaseVersion`, `startedAt`, `finishedAt`, `source`, `testSuite`, `checks`, `limitations`.

- `source`: `{ algorithm: 'sha256-tree-v1', digest, files }` captured from `src` before the checks. `src/release-validation.json` is excluded from the digest.
- `testSuite`: command, timestamps, `exitCode` (integer or `null`), `signal`, `timedOut`, `environmentFailure`, `outputSha256`, and the six counts.
- Each check: unique lowercase `id`, command, timestamps, `exitCode`, `signal`, `timedOut`, `environmentFailure`, `outputSha256`.
- Each limitation: `{ checkId, statement }`, where `checkId` is `test-suite` or one of the captured checks.

`exitCode: null` means no exit code was observed. A value at or above `0x80000000` is a Windows failure status, not a normal measured failure; both derive `NOT_STARTED`.

## Sandbox limitation

On some Windows machines Electron 44 crashes with `STATUS_BREAKPOINT` (`0x80000003`) before any app code runs when the OS sandbox is on. The test fixtures therefore run with `--no-sandbox` and print a `LIMITATION` line saying so. They still exercise Nacre's `webPreferences`, preloads and IPC isolation, but not Chromium's OS-level sandbox. Fixture profiles are created under `.cache/` and deleted afterwards.

## Reading the bundled report

The diagnostics page renders the bundled report separately from the current-device probes. It shows:

- the report version, recording date and freshness (`CURRENT`, `STALE_VERSION`, `STALE_SOURCE`, `INVALID`, `NOT_RUN`);
- the Node suite counts, exit code and output hash;
- each release check with its status and proof;
- every captured coverage limitation as a `LIMITED` row with its output hash.

The evidence file is a build artifact and is not bundled. Keep it with the release records so reviewers can verify the captured commands and hashes. The application displays summaries and hashes only, never raw command output.

## Known limits

- The Node suite is not the whole product; a passing suite does not prove network isolation, installer lifecycle, or absence of leaks.
- The packaged checks compare `src` against the packaged ASAR and launch the packaged executable with a disposable profile. They do not replace a Windows install/uninstall or SmartScreen check.
- `--no-sandbox` means OS-sandbox isolation is not validated by these fixtures. This is recorded as a limitation on every affected check.
- A `LIMITED` Canvas row is not a canvas-protection certification; it samples one pixel.
