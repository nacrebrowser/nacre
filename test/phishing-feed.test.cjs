'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  MAX_FRESH_AGE_MS,
  createPhishingFeed,
  getPhishingFeedStatus,
  matchPhishingHost,
  normalizeHost
} = require('../src/phishing-feed.cjs');
const { MAX_ENTRIES, createSnapshot, normalizeDomain, parseFeed } = require('../scripts/download-phishing-feed.cjs');

function snapshot(domains, updatedAt = '2026-10-23T00:00:00.000Z') {
  return {
    source: 'phishunt.io',
    sourceUrl: 'https://phishunt.io/feed.txt',
    license: 'CC0-1.0',
    licenseUrl: 'https://phishunt.io/tos/',
    attribution: 'Phishunt.io phishing intelligence feed; attribution appreciated.',
    updatedAt,
    domains
  };
}

test('feed parser extracts unique hostnames and drops URL paths and query values', () => {
  const domains = parseFeed([
    '# source comment',
    'https://Bad.Example/login?token=private',
    'http://bad.example/path-two',
    'https://sub.bad.example/a/long/path',
    'not a domain',
    'javascript:alert(1)',
    'https://user:secret@credential.example/path',
    '192.0.2.1'
  ].join('\n'));

  assert.deepEqual(domains, ['bad.example', 'sub.bad.example']);
  assert.equal(JSON.stringify(domains).includes('/login'), false);
  assert.equal(JSON.stringify(domains).includes('private'), false);
});

test('domain parser normalizes IDNs and rejects malformed hosts and IP addresses', () => {
  assert.equal(normalizeDomain('https://BÜCHER.example/path'), 'xn--bcher-kva.example');
  assert.equal(normalizeDomain('example..com'), null);
  assert.equal(normalizeDomain('https://user:secret@example.com'), null);
  assert.equal(normalizeDomain('https://192.0.2.1/path'), null);
  assert.equal(normalizeHost('bad.example.'), 'bad.example');
  assert.equal(normalizeHost('https://bad.example/path'), null);
  assert.equal(normalizeHost('bad.example/path'), null);
});

test('snapshot metadata records source, license and build-time timestamp', () => {
  const result = createSnapshot('https://bad.example/login\n', { updatedAt: '2026-10-23T12:30:00Z' });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.source, 'phishunt.io');
  assert.equal(result.license, 'CC0-1.0');
  assert.equal(result.updatedAt, '2026-10-23T12:30:00.000Z');
  assert.equal(result.entryCount, 1);
  assert.deepEqual(result.domains, ['bad.example']);
  assert.throws(() => createSnapshot('# empty\n'), /no valid domains/);
});

test('feed parser enforces the unique-domain cap and ignores duplicate URLs', () => {
  assert.deepEqual(parseFeed('a.example\nhttps://a.example/path\n', { maxEntries: 1 }), ['a.example']);
  assert.throws(() => parseFeed('a.example\nb.example\n', { maxEntries: 1 }), /domain limit/);
  assert.throws(() => parseFeed('a.example\n', { maxEntries: MAX_ENTRIES + 1 }), /maxEntries/);
});

test('host matcher checks exact hosts and suffix labels without reading URL paths', () => {
  const feed = createPhishingFeed(snapshot(['bad.example', 'nested.bad.example']));
  assert.deepEqual(feed.matchHost('bad.example', Date.parse('2026-10-23T00:00:01Z')).matched, true);
  assert.deepEqual(feed.matchHost('deep.bad.example', Date.parse('2026-10-23T00:00:01Z')).domain, 'bad.example');
  assert.equal(feed.matchHost('notbad.example').matched, false);
  assert.equal(feed.matchHost('bad.example/path').matched, false);
  assert.equal(feed.matchHost('https://bad.example/login').matched, false);
});

test('public suffix and shared hosting roots cannot blanket-match tenants', () => {
  const feed = createPhishingFeed(snapshot(['com', 'co.uk', 'github.io', 'vercel.app', 'known.github.io']));
  assert.equal(feed.matchHost('victim.com').matched, false);
  assert.equal(feed.matchHost('shop.co.uk').matched, false);
  assert.equal(feed.matchHost('another.github.io').matched, false);
  assert.equal(feed.matchHost('campaign.vercel.app').matched, false);
  assert.equal(feed.matchHost('deep.known.github.io').domain, 'known.github.io');
});

test('freshness is explicit and does not suppress offline host matches', () => {
  const feed = createPhishingFeed(snapshot(['bad.example']));
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  assert.equal(feed.matchHost('bad.example', now + MAX_FRESH_AGE_MS).freshness.status, 'fresh');
  const stale = feed.matchHost('bad.example', now + MAX_FRESH_AGE_MS + 1);
  assert.equal(stale.freshness.status, 'stale');
  assert.equal(stale.freshness.stale, true);
  assert.equal(stale.matched, true);
  assert.equal(createPhishingFeed(snapshot(['bad.example'], '')).matchHost('bad.example').freshness.status, 'unknown');
});

test('bundled snapshot has bounded valid metadata and exposes local status', () => {
  const status = getPhishingFeedStatus(Date.now());
  assert.match(status.source, /phishunt.io.*Phishing.Database.*PhishDestroy/);
  assert.equal(status.license, 'CC0-1.0 AND MIT');
  assert.equal(status.sources.length, 3);
  assert.match(status.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(status.entryCount > 0);
  assert.ok(status.entryCount <= MAX_ENTRIES);
  assert.ok(status.entryCount > 100_000, 'bundled expansion is real, not just a larger configured cap');
  assert.equal(path.basename(require('../src/phishing-feed.cjs').SNAPSHOT_PATH), 'phishing-domains.json');
  const { readSnapshot } = require('../src/phishing-feed.cjs');
  assert.equal(matchPhishingHost(readSnapshot().domains[0]).matched, true);
  assert.equal(matchPhishingHost('example.invalid').matched, false);
});

test('sorted index handles unsorted duplicates, first/last elements and suffix boundaries', () => {
  const feed = createPhishingFeed(snapshot(['z.example', 'a.example', 'M.EXAMPLE', 'a.example', 'm.example']));
  assert.equal(feed.metadata.entryCount, 3);
  for (const host of ['a.example', 'm.example', 'z.example', 'deep.z.example']) assert.equal(feed.matchHost(host).matched, true, host);
  for (const host of ['aa.example', 'az.example', 'notm.example', 'z.example.other']) assert.equal(feed.matchHost(host).matched, false, host);
});

test('path-hosted public platforms cannot blanket-match unrelated users', () => {
  const feed = createPhishingFeed(snapshot(['sites.google.com', 'drive.google.com', 'notion.site', 'bit.ly', 'evil-tenant.vercel.app']));
  for (const host of ['sites.google.com', 'drive.google.com', 'notion.site', 'bit.ly', 'safe.vercel.app']) assert.equal(feed.matchHost(host).matched, false, host);
  assert.equal(feed.matchHost('evil-tenant.vercel.app').matched, true);
});

test('source age is not reset by downloading an older dataset today', () => {
  const feed = createPhishingFeed({ ...snapshot(['bad.example'], '2026-10-26T00:00:00Z'), sources: [{ id: 'old', sourceLastModified: '2026-10-02T00:00:00Z' }] });
  assert.equal(feed.matchHost('bad.example', Date.parse('2026-10-26T12:00:00Z')).freshness.status, 'stale');
});

test('expanded public feed still produces a reviewable warning and official services remain usable', () => {
  const { readSnapshot } = require('../src/phishing-feed.cjs');
  const { verdictFor } = require('../src/phishing-guard.cjs');
  const host = readSnapshot().domains[0];
  const verdict = verdictFor('https://' + host + '/');
  assert.equal(verdict.action, 'warn'); assert.equal(verdict.blocked, false); assert.ok(verdict.reasons.includes('public-feed'));
  for (const official of ['google.com', 'accounts.google.com', 'sites.google.com', 'github.com', 'microsoft.com', 'paypal.com', 'cloudflare.com', 'wikipedia.org']) assert.equal(matchPhishingHost(official).matched, false, official);
});
