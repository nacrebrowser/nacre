# Local browser profiles

`src/local-profiles.cjs` stores the selected browser profile and gives each profile a separate Electron `userData` directory. Settings, bookmarks, saved site exceptions, and persistent browser sessions then stay with that profile because Electron stores them beneath its `userData` path.

The built-in **Personal** profile points at the browser's existing user data folder. The module never copies or removes that data. New profiles such as **Work** and **Shared** get folders named with random 24-character hexadecimal IDs; their display names are never used as path components. Removing a profile retires its registry entry and leaves its folder and contents in place. A retired profile can be restored with the same ID and data.

By default, the registry and new profile folders live under an application-specific sibling directory named `<appName>-profiles` in Electron's `appData` directory. This keeps the registry outside the active profile, including the preserved legacy folder. Callers can provide explicit paths, but the module rejects a registry or new profile root that overlaps the default profile folder.

## Startup integration

Create and initialize the store before Electron emits `ready`, then set `userData` to the selected path:

```js
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createLocalProfiles } = require('./local-profiles.cjs');
const { configuredUserDataPath } = require('./profile-location.cjs');

const defaultProfilePath = configuredUserDataPath({
  portable: process.env.NACRE_PORTABLE_MODE === '1',
  executablePath: app.getPath('exe'),
  appDataPath: app.getPath('appData'),
  readFileSync: fs.readFileSync.bind(fs)
}) || path.join(app.getPath('appData'), 'Nacre');
const localProfiles = createLocalProfiles({
  appDataPath: app.getPath('appData'),
  defaultProfilePath
});
const selectedProfile = localProfiles.initialize();
fs.mkdirSync(selectedProfile.path, { recursive: true });
app.setPath('userData', selectedProfile.path);
```

The example uses `configuredUserDataPath` to retain an existing portable or user-chosen profile folder as Personal. Keep profile selection before `app.whenReady()` so Chromium creates its storage beneath the chosen directory from its first launch operation.

## Store API

- `initialize()` loads or creates the registry and returns the profile selected for this launch.
- `listProfiles({ includeRetired: true })` includes entries that were removed from the active list.
- `createProfile(name)` creates a separate folder and registry entry. It does not select the new profile.
- `selectProfile(id)` persists the next-launch selection and returns its profile record. The running Electron process keeps using the path chosen at startup; restart to activate the new selection.
- `removeProfile(id)` retires an inactive profile. Personal and the profile currently in use cannot be removed.
- `restoreProfile(id)` reactivates a retired entry while keeping its original folder and data.
- `getSelectedProfile()` and `getRunningProfile()` distinguish the saved next-launch choice from the current process.
- `getProfilePath(id)` returns a path for an active profile. The path is derived from its validated ID, never read from the registry.

Registry writes use a temporary file in the registry directory and rename it into place. On managed Windows folders that reject rename, the module falls back to a direct file write so profile selection remains available. An unreadable registry fails startup rather than silently selecting a different profile. Malformed or unsupported registry content is preserved as a `profiles.json.corrupt-*` recovery copy before a fresh Personal-only registry is written.
