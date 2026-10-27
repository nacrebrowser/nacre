'use strict';

const crypto = require('node:crypto');
const { parseFeed, fetchApprovedFeed, MAX_FEED_BYTES } = require('./download-phishing-feed.cjs');
const { MAX_ENTRIES, MAX_SNAPSHOT_BYTES, isUsableFeedHost } = require('../src/phishing-policy.cjs');
const SOURCES = Object.freeze([
  Object.freeze({ id: 'phishunt', name: 'phishunt.io', url: 'https://phishunt.io/feed.txt', format: 'text', license: 'CC0-1.0', licenseUrl: 'https://phishunt.io/tos/' }),
  Object.freeze({ id: 'phishing-database', name: 'Phishing.Database', repo: 'Phishing-Database/Phishing.Database', ref: 'master', file: 'phishing-domains-ACTIVE.txt', format: 'text', license: 'MIT', licenseUrl: 'https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE' }),
  Object.freeze({ id: 'phishdestroy-live', name: 'PhishDestroy DNS-active', repo: 'phishdestroy/destroylist', ref: 'main', file: 'dns/active_domains.json', format: 'json', license: 'CC0-1.0', licenseUrl: 'https://phishdestroy.io/dataset' })
]);

function sourceUrl(source) {
  return source.url || `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${source.file}`;
}
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }

function createMergedSnapshot(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length !== SOURCES.length || new Set(inputs.map(input => input.id)).size !== SOURCES.length) throw new Error('All approved phishing sources are required.');
  const updatedAt = validDate(options.updatedAt || new Date().toISOString());
  if (!updatedAt) throw new Error('Invalid build timestamp.');
  const merged = new Set();
  const sources = [];
  for (const source of SOURCES) {
    const input = inputs.find(input => input.id === source.id);
    if (!input || typeof input.text !== 'string') throw new Error('Missing approved feed: ' + source.id);
    if (Buffer.byteLength(input.text) > MAX_FEED_BYTES) throw new Error('Source exceeds byte limit.');
    let text = input.text;
    if (source.format === 'json') {
      const values = JSON.parse(text);
      if (!Array.isArray(values) || values.length > MAX_ENTRIES || values.some(value => typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('Invalid JSON domain feed.');
      text = values.join('\n');
    }
    const parsed = parseFeed(text);
    const domains = parsed.filter(isUsableFeedHost);
    if (!domains.length) throw new Error('No usable domains in source: ' + source.id);
    for (const host of domains) merged.add(host);
    if (merged.size > MAX_ENTRIES) throw new Error('Merged phishing feed exceeds domain limit.');
    sources.push({
      id: source.id, name: source.name, sourceUrl: sourceUrl(source),
      downloadUrl: input.revision ? `https://raw.githubusercontent.com/${source.repo}/${input.revision}/${source.file}` : sourceUrl(source),
      license: source.license, licenseUrl: source.licenseUrl,
      revision: input.revision || null, sourceLastModified: validDate(input.sourceLastModified),
      fetchedAt: updatedAt, rawBytes: Buffer.byteLength(input.text),
      sha256: crypto.createHash('sha256').update(input.text).digest('hex'),
      entryCount: domains.length, excludedUnsafeRoots: parsed.length - domains.length
    });
  }
  const domains = [...merged].sort();
  const result = {
    schemaVersion: 2, source: sources.map(source => source.name).join(' + '),
    sourceUrl: 'https://github.com/Phishing-Database/Phishing.Database',
    license: 'CC0-1.0 AND MIT', licenseUrl: 'https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE',
    attribution: 'phishunt.io; Phishing.Database contributors; PhishDestroy. See sources for licenses and provenance.',
    updatedAt, sourceLastModified: null, sources, entryCount: domains.length, domains
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_SNAPSHOT_BYTES) throw new Error('Merged snapshot exceeds byte limit.');
  return result;
}

async function downloadSnapshot(fetchImpl = fetch) {
  const inputs = [];
  for (const source of SOURCES) {
    let url = sourceUrl(source), revision = null, sourceLastModified = null;
    if (source.repo) {
      // Resolve and pin the exact content revision. A fresh download must not
      // turn an older upstream file into a supposedly fresh threat list.
      const metadataUrl = `https://api.github.com/repos/${source.repo}/commits?path=${encodeURIComponent(source.file)}&sha=${source.ref}&per_page=1`;
      const metadata = JSON.parse((await fetchApprovedFeed(metadataUrl, fetchImpl)).text);
      revision = metadata?.[0]?.sha;
      sourceLastModified = validDate(metadata?.[0]?.commit?.committer?.date);
      if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision) || !sourceLastModified) throw new Error('Invalid source revision: ' + source.id);
      url = `https://raw.githubusercontent.com/${source.repo}/${revision}/${source.file}`;
    }
    const response = await fetchApprovedFeed(url, fetchImpl);
    inputs.push({ id: source.id, text: response.text, revision, sourceLastModified: sourceLastModified || response.sourceLastModified });
  }
  return createMergedSnapshot(inputs);
}
module.exports = { SOURCES, createMergedSnapshot, downloadSnapshot };
