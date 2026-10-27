'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findBrowserSources, describeSources, parseChromiumBookmarks, readSourceBookmarks, mergeBookmarks } = require('../src/browser-import.cjs');

const safeURL = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username ? url.href : ''; } catch { return ''; } };

function fakeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-import-test-'));
  const env = { LOCALAPPDATA: path.join(root, 'Local'), APPDATA: path.join(root, 'Roaming') };
  return { root, env };
}

const chromeData = {
  roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
      { type: 'url', name: 'Example', url: 'https://example.com/' },
      { type: 'folder', name: 'News', children: [{ type: 'url', name: 'Le Monde', url: 'https://www.lemonde.fr/' }] },
      { type: 'url', name: 'Script', url: 'javascript:alert(1)' }
    ] },
    other: { type: 'folder', name: 'Other', children: [{ type: 'url', name: '', url: 'https://other.test/' }] }
  }
};

test('Chromium bookmarks keep folders, drop roots and unsafe addresses', () => {
  const items = parseChromiumBookmarks(chromeData, safeURL);
  assert.deepEqual(items, [
    { title: 'Example', url: 'https://example.com/', folder: '' },
    { title: 'Le Monde', url: 'https://www.lemonde.fr/', folder: 'News' },
    { title: 'https://other.test/', url: 'https://other.test/', folder: '' }
  ]);
  assert.deepEqual(parseChromiumBookmarks({ roots: { bookmark_bar: { children: 'x' } } }, safeURL), []);
});

test('sources are found per profile and described without paths', () => {
  const { root, env } = fakeHome();
  try {
    const userData = path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
    for (const profile of ['Default', 'Profile 2', 'System Profile']) {
      fs.mkdirSync(path.join(userData, profile), { recursive: true });
      fs.writeFileSync(path.join(userData, profile, 'Bookmarks'), JSON.stringify(chromeData));
    }
    fs.writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 2': { name: 'Travail' } } } }));
    const opera = path.join(env.APPDATA, 'Opera Software', 'Opera Stable');
    fs.mkdirSync(opera, { recursive: true });
    fs.writeFileSync(path.join(opera, 'Bookmarks'), JSON.stringify(chromeData));
    const sources = findBrowserSources(env);
    assert.deepEqual(describeSources(sources), [
      { id: 'chrome:Default', browser: 'Google Chrome', profile: 'Default', kind: 'chromium' },
      { id: 'chrome:Profile 2', browser: 'Google Chrome', profile: 'Travail', kind: 'chromium' },
      { id: 'opera:default', browser: 'Opera', profile: '', kind: 'chromium' }
    ]);
    assert.equal(JSON.stringify(describeSources(sources)).includes(root.replace(/\\/g, '\\\\')), false);
    assert.equal(readSourceBookmarks(sources[1], safeURL).length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Firefox bookmarks are read from a copy, skipping tags', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { root, env } = fakeHome();
  try {
    const profile = path.join(env.APPDATA, 'Mozilla', 'Firefox', 'Profiles', 'abcd.default-release');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(env.APPDATA, 'Mozilla', 'Firefox', 'profiles.ini'), '[Profile0]\nName=default-release\nPath=Profiles/abcd.default-release\n');
    const file = path.join(profile, 'places.sqlite');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
      CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT);
      INSERT INTO moz_places VALUES (1, 'https://mozilla.org/'), (2, 'https://wiki.test/'), (3, 'place:sort=8');
      INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, ''), (3, 2, NULL, 1, 0, 'toolbar'), (4, 2, NULL, 1, 1, 'tags'),
        (10, 2, NULL, 3, 0, 'Docs'), (11, 1, 1, 3, 1, 'Mozilla'), (12, 1, 2, 10, 0, 'Wiki'), (13, 1, 3, 3, 2, 'Smart'),
        (20, 2, NULL, 4, 0, 'mytag'), (21, 1, 2, 20, 0, NULL);`);
    db.close();
    const [source] = findBrowserSources(env);
    assert.deepEqual(describeSources([source]), [{ id: 'firefox:abcd.default-release', browser: 'Mozilla Firefox', profile: 'default-release', kind: 'firefox' }]);
    const items = readSourceBookmarks(source, safeURL).sort((a, b) => a.url.localeCompare(b.url));
    assert.deepEqual(items, [
      { title: 'Mozilla', url: 'https://mozilla.org/', folder: '' },
      { title: 'Wiki', url: 'https://wiki.test/', folder: 'Docs' }
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('merge keeps existing bookmarks first, skips duplicates and respects the limit', () => {
  const existing = [{ title: 'A', url: 'https://a.test/', folder: '' }];
  const imported = [{ title: 'A2', url: 'https://a.test/', folder: '' }, { title: 'B', url: 'https://b.test/', folder: '' }, { title: 'C', url: 'https://c.test/', folder: '' }];
  const merged = mergeBookmarks(existing, imported, 2);
  assert.deepEqual(merged.bookmarks.map((item) => item.title), ['A', 'B']);
  assert.equal(merged.added, 1);
  assert.equal(merged.skipped, 2);
});
