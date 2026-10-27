'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');
const { MAX_ENTRIES, MAX_SNAPSHOT_BYTES, isUsableFeedHost } = require('./phishing-policy.cjs');
const MAX_HOST_LENGTH = 253;
const MAX_FRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_PATH = path.join(__dirname, 'phishing-domains.json');

function normalizeHost(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_HOST_LENGTH || /[\u0000-\u0020\u007f\/@?#:\\]/.test(raw)) return null;
  const ascii = domainToASCII(raw.toLowerCase()).replace(/\.$/, '');
  if (!ascii || ascii.length > MAX_HOST_LENGTH || isIP(ascii) || !ascii.includes('.')) return null;
  const labels = ascii.split('.');
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return ascii;
}

function readSnapshot(filePath = SNAPSHOT_PATH) {
  try {
    if (fs.statSync(filePath).size > MAX_SNAPSHOT_BYTES) throw new RangeError('Phishing snapshot exceeds byte limit.');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {
      schemaVersion: 1,
      source: 'phishunt.io',
      sourceUrl: 'https://phishunt.io/feed.txt',
      license: 'CC0-1.0',
      licenseUrl: 'https://phishunt.io/tos/',
      attribution: 'Phishunt.io phishing intelligence feed; attribution appreciated.',
      updatedAt: '',
      sourceLastModified: null,
      entryCount: 0,
      domains: []
    };
  }
}

function freshnessFor(updatedAt, now = Date.now()) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return { status: 'unknown', stale: true, ageMs: null, ageDays: null, maxAgeMs: MAX_FRESH_AGE_MS };
  }
  const ageMs = now - timestamp;
  if (ageMs < 0) {
    return { status: 'clock-skew', stale: true, ageMs, ageDays: ageMs / 86_400_000, maxAgeMs: MAX_FRESH_AGE_MS };
  }
  return {
    status: ageMs <= MAX_FRESH_AGE_MS ? 'fresh' : 'stale',
    stale: ageMs > MAX_FRESH_AGE_MS,
    ageMs,
    ageDays: ageMs / 86_400_000,
    maxAgeMs: MAX_FRESH_AGE_MS
  };
}

function feedFreshness(metadata, now) {
  const ages = metadata.sources.map(source => freshnessFor(source.sourceLastModified, now));
  return ages.find(age => ['unknown', 'clock-skew'].includes(age.status)) || ages.sort((a,b) => b.ageMs - a.ageMs)[0] || freshnessFor(metadata.updatedAt, now);
}

function createPhishingFeed(snapshot = readSnapshot()) {
  const input = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const rawDomains = Array.isArray(input.domains) ? input.domains : [];
  if (rawDomains.length > MAX_ENTRIES) throw new RangeError(`Phishing feed exceeds the ${MAX_ENTRIES} domain limit.`);

  // A sorted string index avoids a large permanent hash table for the expanded
  // feed. Comparisons remain exact: no probabilistic Bloom-filter matches.
  const domains = [];
  for (const value of rawDomains) {
    const host = normalizeHost(value);
    if (host) domains.push(host);
  }
  domains.sort();
  let count = 0;
  for (let index = 0; index < domains.length; index++) if (index === 0 || domains[index] !== domains[index - 1]) domains[count++] = domains[index];
  domains.length = count;
  // Hosts are ASCII, so code-unit order equals byte order. One buffer plus an
  // offset table keeps ~500k entries off the JavaScript heap (about 28 MiB as
  // separate strings, under 14 MiB packed).
  let total = 0;
  for (const host of domains) total += host.length;
  const bytes = Buffer.allocUnsafe(total);
  const offsets = new Uint32Array(count + 1);
  for (let index = 0, at = 0; index < count; index++) { offsets[index] = at; at += bytes.write(domains[index], at, 'latin1'); offsets[index + 1] = at; }
  domains.length = 0;
  function contains(host) {
    const key = Buffer.from(host, 'latin1');
    let low = 0, high = count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const order = key.compare(bytes, offsets[middle], offsets[middle + 1]);
      if (order === 0) return true;
      if (order > 0) low = middle + 1; else high = middle - 1;
    }
    return false;
  }
  const sources = Object.freeze((Array.isArray(input.sources) ? input.sources.slice(0, 8) : []).filter(source => source && typeof source === 'object').map(source => Object.freeze({
    id: typeof source.id === 'string' ? source.id : '', name: typeof source.name === 'string' ? source.name : '',
    sourceUrl: typeof source.sourceUrl === 'string' ? source.sourceUrl : '',
    license: typeof source.license === 'string' ? source.license : '',
    licenseUrl: typeof source.licenseUrl === 'string' ? source.licenseUrl : '',
    sourceLastModified: typeof source.sourceLastModified === 'string' ? source.sourceLastModified : '',
    fetchedAt: typeof source.fetchedAt === 'string' ? source.fetchedAt : '',
    entryCount: Number.isSafeInteger(source.entryCount) ? source.entryCount : 0
  })));

  const metadata = Object.freeze({
    source: typeof input.source === 'string' ? input.source : '',
    sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : '',
    license: typeof input.license === 'string' ? input.license : '',
    licenseUrl: typeof input.licenseUrl === 'string' ? input.licenseUrl : '',
    attribution: typeof input.attribution === 'string' ? input.attribution : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
    sourceLastModified: typeof input.sourceLastModified === 'string' ? input.sourceLastModified : null,
    entryCount: count,
    sources
  });

  function matchHost(value, now = Date.now()) {
    const host = normalizeHost(value);
    const freshness = feedFreshness(metadata, now);
    if (!host) return { matched: false, host: '', domain: '', freshness };

    let candidate = host;
    while (candidate) {
      if (contains(candidate) && isUsableFeedHost(candidate)) {
        return { matched: true, host, domain: candidate, freshness };
      }
      const dot = candidate.indexOf('.');
      if (dot < 0) break;
      candidate = candidate.slice(dot + 1);
    }
    return { matched: false, host, domain: '', freshness };
  }

  return Object.freeze({ metadata, matchHost });
}

const bundledFeed = createPhishingFeed();

function matchPhishingHost(host, now = Date.now()) {
  return bundledFeed.matchHost(host, now);
}

function getPhishingFeedStatus(now = Date.now()) {
  const sources = bundledFeed.metadata.sources.map(source => ({ ...source, freshness: freshnessFor(source.sourceLastModified, now) }));
  return { ...bundledFeed.metadata, sources, freshness: feedFreshness(bundledFeed.metadata, now), snapshotFreshness: freshnessFor(bundledFeed.metadata.updatedAt, now) };
}

module.exports = {
  MAX_ENTRIES,
  MAX_FRESH_AGE_MS,
  SNAPSHOT_PATH,
  normalizeHost,
  readSnapshot,
  freshnessFor,
  createPhishingFeed,
  matchPhishingHost,
  getPhishingFeedStatus
};
