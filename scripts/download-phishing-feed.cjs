'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');

const FEED_URL = 'https://phishunt.io/feed.txt';
const LICENSE = 'CC0-1.0';
const LICENSE_URL = 'https://phishunt.io/tos/';
const { MAX_ENTRIES } = require('../src/phishing-policy.cjs');
const MAX_FEED_BYTES = 16 * 1024 * 1024;
const MAX_LINE_LENGTH = 4096;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const line = value.trim();
  if (!line || line.startsWith('#') || line.startsWith('!')) return null;
  if (line.length > MAX_LINE_LENGTH || /[\u0000-\u001f\u007f\s]/.test(line)) return null;

  let parsed;
  try {
    const candidate = /^https?:\/\//i.test(line) ? line : `https://${line}`;
    parsed = new URL(candidate);
  } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;

  let host = domainToASCII(parsed.hostname.toLowerCase()).replace(/\.$/, '');
  if (!host || host.length > 253 || isIP(host) || !host.includes('.')) return null;
  const labels = host.split('.');
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return host;
}

function parseFeed(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('Phishing feed must be UTF-8 text.');
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_ENTRIES;
  if (maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new RangeError(`maxEntries must be between 1 and ${MAX_ENTRIES}.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_FEED_BYTES) throw new RangeError('Phishing feed exceeds the download size limit.');

  const domains = new Set();
  for (const line of text.split(/\r?\n/)) {
    const domain = normalizeDomain(line);
    if (!domain) continue;
    domains.add(domain);
    if (domains.size > maxEntries) throw new RangeError(`Phishing feed exceeds the ${maxEntries} domain limit.`);
  }
  return [...domains].sort();
}

function createSnapshot(text, options = {}) {
  const domains = parseFeed(text);
  if (!domains.length) throw new Error('Phishing feed contained no valid domains; refusing to write an empty snapshot.');
  const updatedAt = options.updatedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(updatedAt))) throw new TypeError('updatedAt must be a valid ISO timestamp.');
  const sourceLastModified = options.sourceLastModified && Number.isFinite(Date.parse(options.sourceLastModified))
    ? new Date(options.sourceLastModified).toISOString()
    : null;

  return {
    schemaVersion: 1,
    source: 'phishunt.io',
    sourceUrl: FEED_URL,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    attribution: 'Phishunt.io phishing intelligence feed; attribution appreciated.',
    updatedAt: new Date(updatedAt).toISOString(),
    sourceLastModified,
    entryCount: domains.length,
    domains
  };
}

async function readBoundedBody(response) {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_FEED_BYTES) {
    throw new RangeError('Phishing feed exceeds the download size limit.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FEED_BYTES) throw new RangeError('Phishing feed exceeds the download size limit.');
    chunks.push(buffer);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

async function fetchFeed(fetchImpl = fetch) {
  return fetchApprovedFeed(FEED_URL, fetchImpl);
}

async function fetchApprovedFeed(initialUrl, fetchImpl = fetch) {
  const approved = new URL(initialUrl);
  if (approved.protocol !== 'https:' || approved.username || approved.password || !['phishunt.io', 'raw.githubusercontent.com', 'api.github.com'].includes(approved.hostname)) throw new Error('Unapproved feed origin.');
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: { accept: approved.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'text/plain, application/json', 'user-agent': 'Nacre phishing feed builder' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects === MAX_REDIRECTS) throw new Error('Phishing feed exceeded the redirect limit.');
      const location = response.headers.get('location');
      if (!location) throw new Error('Phishing feed redirect did not include a destination.');
      const next = new URL(location, url);
      if (next.origin !== approved.origin || next.username || next.password) {
        throw new Error('Phishing feed redirected outside its approved HTTPS origin.');
      }
      url = next.href;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Phishing feed request failed with HTTP ${response.status}.`);
    }
    const text = await readBoundedBody(response);
    const lastModified = response.headers.get('last-modified');
    return { text, sourceLastModified: lastModified || null };
  }
  throw new Error('Phishing feed could not be fetched.');
}

async function downloadPhishingFeed(options = {}) {
  const snapshot = await require('./phishing-sources.cjs').downloadSnapshot(options.fetchImpl);
  const targetPath = options.targetPath || path.join(__dirname, '..', 'src', 'phishing-domains.json');
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > require('../src/phishing-policy.cjs').MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds byte limit.');

  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
  process.stdout.write(`Wrote ${snapshot.entryCount} phishing-domain entries to ${targetPath}\n`);
  process.stdout.write(`Source: ${snapshot.sourceUrl} (${snapshot.license}), fetched ${snapshot.updatedAt}\n`);
}

module.exports = {
  FEED_URL,
  LICENSE,
  MAX_ENTRIES,
  MAX_FEED_BYTES,
  normalizeDomain,
  parseFeed,
  createSnapshot,
  fetchFeed,
  fetchApprovedFeed,
  downloadPhishingFeed
};

if (require.main === module) {
  downloadPhishingFeed().catch((error) => {
    process.stderr.write(`Phishing feed download failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
