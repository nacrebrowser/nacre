# Contributing

Thanks for your interest in Nacre.

- **Bugs and ideas**: open an issue. Leave out anything personal (history, cookies, IP addresses, profile files).
- **Code**: open an issue first for anything larger than a small fix, so we can agree on the approach.

Before sending a change:

```powershell
pnpm test
pnpm run security-check
```

If you touch Tor or the network code, also run `pnpm run verify:tor`. If you touch packaging, run `pnpm run build:windows`.

In the pull request, say what changes for the user and whether it affects privacy (new connections, new stored data).

By contributing, you agree that your code is released under the [MPL-2.0](LICENSE.md).
