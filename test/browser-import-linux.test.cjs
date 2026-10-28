'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findBrowserSources, describeSources } = require('../src/browser-import.cjs');

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

test('Linux sources cover ~/.config, snap and Flatpak locations and never Windows paths', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-import-linux-'));
  try {
    const bookmarks = JSON.stringify({ roots: {} });
    write(path.join(home, '.config', 'google-chrome', 'Default', 'Bookmarks'), bookmarks);
    write(path.join(home, '.config', 'google-chrome', 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Perso' } } } }));
    write(path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'Profile 2', 'Bookmarks'), bookmarks);
    write(path.join(home, 'snap', 'chromium', 'common', 'chromium', 'Default', 'Bookmarks'), bookmarks);
    write(path.join(home, '.config', 'opera', 'Bookmarks'), bookmarks);
    write(path.join(home, '.mozilla', 'firefox', 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n');
    write(path.join(home, '.mozilla', 'firefox', 'abcd.default-release', 'places.sqlite'), 'x');
    write(path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox', 'efgh.default', 'places.sqlite'), 'x');
    // Firefox's own folders hold no places.sqlite: they are not profiles.
    write(path.join(home, '.mozilla', 'firefox', 'Crash Reports', 'InstallTime20261001'), 'x');
    // A Windows-style tree under the same root must be ignored on Linux.
    write(path.join(home, 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'), bookmarks);

    const sources = findBrowserSources({ HOME: home, LOCALAPPDATA: path.join(home, 'Local') }, 'linux');
    assert.deepEqual(describeSources(sources).map(({ id, profile }) => `${id}|${profile}`).sort(), [
      'brave:Profile 2|Profile 2',
      'chrome:Default|Perso',
      'chromium-snap:Default|Default',
      'firefox-snap:efgh.default|efgh.default',
      'firefox:abcd.default-release|default-release',
      'opera:default|'
    ]);
    assert.ok(sources.every((source) => source.file.startsWith(home + path.sep)));
    assert.deepEqual(findBrowserSources({ HOME: home }, 'darwin'), [], 'unsupported platforms list nothing');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Firefox profiles registered in profiles.ini are found, relative or absolute, never outside by a relative path', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-import-ini-'));
  try {
    const root = path.join(home, '.mozilla', 'firefox');
    const elsewhere = path.join(home, 'Documents', 'Firefox Work é');
    write(path.join(root, 'profiles', 'perso', 'places.sqlite'), 'x');
    write(path.join(elsewhere, 'places.sqlite'), 'x');
    write(path.join(home, 'escape', 'places.sqlite'), 'x');
    write(path.join(root, 'profiles.ini'), [
      '[Profile0]', 'Name=Perso', 'IsRelative=1', 'Path=profiles/perso', '',
      '[Profile1]', 'Name=Work', 'IsRelative=0', `Path=${elsewhere}`, '',
      '[Profile2]', 'Name=Escape', 'IsRelative=1', 'Path=../../escape', ''
    ].join('\n'));
    const found = describeSources(findBrowserSources({ HOME: home }, 'linux')).map(({ id, profile }) => `${id}|${profile}`).sort();
    assert.equal(found.length, 2);
    assert.ok(found.includes('firefox:perso|Perso'));
    assert.ok(found.some((item) => /^firefox:[0-9a-f]{12}\|Work$/.test(item)), 'a folder name with spaces and accents gets an opaque id');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
