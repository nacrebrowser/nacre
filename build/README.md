# Windows build configuration

Run build commands from the repository root:

- `pnpm run build:windows`: unpack Electron, build the native NSIS setup, portable ZIP and checksums.
- `pnpm run build:windows:signed`: signed NSIS build with the required signing environment.

`electron-builder.dir.cjs` loads package settings and the fuse hook. `electron-builder.setup.cjs` adds the current native installer template. `electron-builder.signed.cjs` adds signing requirements.

Generated output belongs in `dist/`; builder tools and temporary files belong in `.cache/`. Neither directory is source code.
