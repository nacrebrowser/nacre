'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_SITE_PRESETS, normalizeTrustedSites, presetDomains, enabledPresets, isTrustedDomain, normalizeTrustedSecret, createTrustedSecret, trustedFingerprintSeed, trustedOrigins } = require('../src/trusted-sites.cjs');

test('trusted site lists are validated, deduplicated and bounded', () => {
  assert.deepEqual(normalizeTrustedSites(['Netflix.com', 'www.netflix.com', 'localhost', '__proto__', 5, 'a..b', 'disneyplus.com']), ['netflix.com', 'disneyplus.com']);
  assert.deepEqual(normalizeTrustedSites('netflix.com'), []);
  assert.equal(normalizeTrustedSites(Array.from({ length: 300 }, (_, i) => `site${i}.test`)).length, 200);
});

test('presets map to all of their sign-in domains', () => {
  assert.deepEqual(presetDomains(['disney', 'unknown']), ['disneyplus.com', 'disney.com', 'bamgrid.com']);
  assert.deepEqual(enabledPresets(['netflix.com', 'disneyplus.com']), ['netflix']);
  assert.ok(TRUSTED_SITE_PRESETS.every((preset) => normalizeTrustedSites(preset.domains).length === preset.domains.length));
  assert.equal(isTrustedDomain('NETFLIX.com', ['netflix.com']), true);
  assert.equal(isTrustedDomain('evil.com', ['netflix.com']), false);
});

test('fingerprint seeds are stable per site and differ across workspaces', () => {
  const secret = createTrustedSecret();
  assert.equal(normalizeTrustedSecret(secret), secret);
  assert.equal(normalizeTrustedSecret('xyz'), '');
  const first = trustedFingerprintSeed(secret, 'personal', 'netflix.com');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(trustedFingerprintSeed(secret, 'personal', 'NETFLIX.com'), first);
  assert.notEqual(trustedFingerprintSeed(secret, 'work', 'netflix.com'), first);
  assert.notEqual(trustedFingerprintSeed(secret, 'personal', 'disneyplus.com'), first);
  assert.throws(() => trustedFingerprintSeed('', 'personal', 'netflix.com'), TypeError);
});

test('origins kept on quit cover trusted cookie hosts only', () => {
  const primary = (host) => host.split('.').slice(-2).join('.');
  const origins = trustedOrigins(['netflix.com'], ['.netflix.com', 'assets.netflix.com', '.tracker.test', ''], primary);
  assert.deepEqual(origins.sort(), ['https://assets.netflix.com', 'https://netflix.com', 'https://www.netflix.com']);
  assert.deepEqual(trustedOrigins([], ['.netflix.com'], primary), []);
});
