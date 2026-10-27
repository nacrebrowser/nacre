# Tracking link cleaning

`src/tracking-links.cjs` exports `cleanTrackingLink(url, { enabled })`. It returns `{ url, changed, reasons }`. When enabled, the cleaner can unwrap up to five nested redirect links and then applies the browser's existing tracking-parameter removal policy to the destination. `enabled: false` returns the input unchanged.

Unwrapping is limited to these exact formats:

- `google.com` and `www.google.com`, plus the listed country hosts in the module, on the exact `/url` path with exactly one `q` or `url` target parameter.
- `l.facebook.com` and `lm.facebook.com` on the exact `/l.php` path with exactly one `u` target parameter.

Each target must be an absolute HTTP or HTTPS URL with no username or password. The cleaner rejects oversized input, limits wrapper depth to five passes, and refuses ambiguous or invalid targets. It does not unwrap generic redirect endpoints. It preserves links with redirect-flow parameters, login or payment path segments, or signing and authentication parameters, including nested destinations with those markers. Ordinary query values such as `q`, `page`, `sort`, and `ref` remain intact unless they match the established tracking-removal policy.

`reasons` contains stable codes without copying any target URL or query value: `wrapper:google`, `wrapper:facebook`, `tracking-parameters-removed`, `disabled`, `invalid-input`, `invalid-url`, `unsupported-scheme`, `credentials`, `url-too-long`, `invalid-wrapper-target`, `wrapper-cycle`, `wrapper-depth-limit`, and `protected-url`.
