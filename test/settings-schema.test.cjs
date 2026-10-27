'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SCALAR_SETTINGS, coerceSetting, normalizeStoredScalars, applyScalarPatch, scalarDefaults } = require('../src/settings-schema.cjs');
const { validateSettingsPayload } = require('../src/privacy-core.cjs');

test('stored profiles fall back to defaults for missing or invalid scalar values', () => {
  const result = normalizeStoredScalars({ theme: 'neon', fontSize: '18', defaultZoom: 333, sendGpc: 'yes', secureDnsMode: 'off', accent: '#ABCDEF' });
  assert.equal(result.theme, 'dark');
  assert.equal(result.fontSize, 18);
  assert.equal(result.defaultZoom, 100);
  assert.equal(result.sendGpc, true);
  assert.equal(result.secureDnsMode, 'automatic');
  assert.equal(result.accent, '#ABCDEF');
  assert.deepEqual(normalizeStoredScalars(null), scalarDefaults());
});

test('stored booleans keep their documented defaults', () => {
  const result = normalizeStoredScalars({});
  assert.equal(result.httpsOnly, true);
  assert.equal(result.clearOnQuit, false);
  assert.equal(result.showBookmarksBar, true);
  assert.equal(result.sendDnt, false);
  assert.equal(result.verticalTabs, false);
  assert.equal(normalizeStoredScalars({ httpsOnly: false, verticalTabs: true }).httpsOnly, false);
});

test('preference updates apply only valid scalar values', () => {
  const next = applyScalarPatch({ theme: 'dark', fontSize: 16, secureDnsMode: 'automatic' }, { theme: 'light', fontSize: 13, secureDnsMode: 'strict', unknown: 1 });
  assert.deepEqual(next, { theme: 'light', fontSize: 16, secureDnsMode: 'strict' });
  assert.equal(coerceSetting('fontSize', '').ok, false);
  assert.equal(coerceSetting('fontSize', null).ok, false);
  assert.equal(coerceSetting('nope', true).ok, false);
});

test('every schema key is accepted by the IPC payload allowlist', () => {
  for (const key of Object.keys(SCALAR_SETTINGS)) {
    assert.equal(validateSettingsPayload({ [key]: SCALAR_SETTINGS[key].default }), true, key);
  }
});

test('main process loads and updates scalar settings through the schema', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /\.\.\.normalizeStoredScalars\(stored\)/);
  assert.match(main, /applyScalarPatch\(next, payload\)/);
});

test('profiles that kept the pre-0.9.5 default accent move to the new palette', () => {
  assert.equal(normalizeStoredScalars({ accent: '#4e8064' }).accent, SCALAR_SETTINGS.accent.default);
  assert.equal(normalizeStoredScalars({ accent: '#4E8064' }).accent, SCALAR_SETTINGS.accent.default);
  assert.equal(normalizeStoredScalars({ accent: '#123456' }).accent, '#123456');
});
