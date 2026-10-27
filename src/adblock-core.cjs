'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LISTS = Object.freeze([
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', license: 'GPL-3.0-or-later / CC BY-SA 3.0', enabled: true },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', license: 'GPL-3.0-or-later / CC BY-SA 3.0', enabled: true },
  { id: 'ubo-filters', name: 'uBlock filters', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt', license: 'GPL-3.0-or-later', enabled: true },
  { id: 'ubo-privacy', name: 'uBlock filters – Privacy', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt', license: 'GPL-3.0-or-later', enabled: true },
  { id: 'ubo-unbreak', name: 'uBlock filters – Unbreak', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt', license: 'GPL-3.0-or-later', enabled: true },
  { id: 'ubo-badware', name: 'uBlock filters – Badware', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt', license: 'GPL-3.0-or-later', enabled: true },
  { id: 'ubo-quick-fixes', name: 'uBlock filters – Quick fixes', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt', license: 'GPL-3.0-or-later', enabled: true },
  { id: 'peter-lowe', name: "Peter Lowe's list", url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext', license: 'McRae GPL v4.r53 (conditions à examiner)', enabled: true },
  { id: 'easylist-fr', name: 'Liste FR + EasyList', url: 'https://easylist-downloads.adblockplus.org/liste_fr+easylist.txt', license: 'GPL-3.0 / CC BY-SA (version de la liste à confirmer)', enabled: true },
  { id: 'fanboy-annoyance', name: 'Fanboy Annoyances (cookies, pop-ups)', url: 'https://easylist.to/easylist/fanboy-annoyance.txt', license: 'CC BY 3.0 (à confirmer sur la version téléchargée)', enabled: false }
]);

const MAX_LIST_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_LIST_BYTES = 40 * 1024 * 1024;
const MAX_CUSTOM_RULE_BYTES = 512 * 1024;
const MAX_FILTER_RULES = 300_000;
const MAX_FILTER_LINE_BYTES = 64 * 1024;
// Tor circuits can be slow, especially for the larger EasyList/uAssets files.
const FILTER_FETCH_TIMEOUT_MS = 180_000;

function safeFilterListUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || !host || host === 'localhost' || /\.(?:local|localhost|internal|test|invalid)$/.test(host)) return null;
    if (net.isIP(host)) return null;
    return url.href;
  } catch { return null; }
}

async function readFilterResponseText(response, maxBytes = MAX_LIST_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_LIST_BYTES) throw new RangeError('Invalid filter response byte limit.');
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    // text()/arrayBuffer() allocate the whole response before any size check.
    throw new Error('Filter response has no readable byte stream.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('La liste dépasse la taille maximale autorisée.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { try { reader.releaseLock(); } catch {} }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function validateFilterListText(input, { minRules = 5, maxBytes = MAX_LIST_BYTES } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('La liste est vide.');
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes > maxBytes) throw new Error('La liste dépasse la taille maximale autorisée.');
  const text = input.replace(/^\uFEFF/, '');
  if (/^\s*(?:<!doctype\s+html|<html|\{\s*"(?:error|message|status)")/i.test(text)) throw new Error('La réponse reçue n’est pas une liste de filtres.');
  if (/\0/.test(text)) throw new Error('La liste contient un caractère nul.');
  const rawLines = text.split(/\r?\n/);
  if (rawLines.some((line) => Buffer.byteLength(line, 'utf8') > MAX_FILTER_LINE_BYTES)) throw new Error('Une règle de la liste dépasse la taille maximale autorisée.');
  const lines = rawLines.map((line) => line.trim()).filter((line) => line && !line.startsWith('!') && !line.startsWith('#') && !line.startsWith('[Adblock'));
  const plausible = lines.filter((line) => /^(?:@@)?(?:\|\||\||\/|[a-z0-9_*.-]+##|#@#|#\?#|#\$#|#%#|\/\^|\^|\*)/i.test(line));
  if (plausible.length > MAX_FILTER_RULES) throw new Error('La liste contient trop de règles.');
  if (plausible.length < minRules || plausible.length / Math.max(1, lines.length) < 0.5) throw new Error('Le format de la liste n’a pas passé le contrôle de cohérence.');
  return { text, bytes, rules: plausible.length, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

function validateCustomFilters(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_CUSTOM_RULE_BYTES) return null;
  const lines = value.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('!') && !line.startsWith('# '));
  if (lines.length > 5000 || lines.some((line) => Buffer.byteLength(line, 'utf8') > MAX_FILTER_LINE_BYTES)) return null;
  return lines.join('\n');
}

function validateAdblockSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const allowed = new Set(['adBlockEnabled', 'adBlockMode', 'adBlockWeeklyUpdates', 'adBlockListStates', 'adBlockCustomLists', 'adBlockCustomFilters', 'adBlockSiteExceptions', 'webglMode']);
  return Object.keys(payload).every((key) => allowed.has(key));
}

function shouldUpdateViaTor(torConfigured, runtimeReady, processAlive = true) {
  return Boolean(torConfigured && runtimeReady && processAlive);
}

function shouldBlockStrictThirdParty(mode, thirdParty, resourceType, hasException = false) {
  return mode === 'strict' && Boolean(thirdParty) && !hasException && ['script', 'subFrame'].includes(String(resourceType));
}

function verifyAdvertisedDigest(text, headers) {
  const advertised = headers && (headers.get('content-digest') || headers.get('digest'));
  if (!advertised) return { verified: false, sha256: crypto.createHash('sha256').update(text).digest('hex') };
  const match = /(?:sha-256|sha256)\s*=\s*(?::([^:]+):|([^,;\s]+))/i.exec(advertised);
  if (!match) throw new Error('L’en-tête de somme de contrôle du serveur n’est pas pris en charge.');
  const expected = Buffer.from(match[1] || match[2], 'base64').toString('hex').toLowerCase();
  const actual = crypto.createHash('sha256').update(text).digest('hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new Error('La somme SHA-256 fournie par le serveur ne correspond pas à la liste.');
  return { verified: true, sha256: actual };
}

function updateBlockerFromSources(engine, sourceTexts, customFilters = '') {
  // Keep each list's parser state (notably uBlock's !#if regions) intact. A
  // single combined update can exceed V8's argument limit inside Ghostery's
  // push.apply calls when several large lists are enabled.
  for (const text of [...(Array.isArray(sourceTexts) ? sourceTexts : []), customFilters]) {
    const added = String(text || '').split(/\r?\n/);
    if (added.some((line) => line.trim())) engine.updateFromDiff({ added });
  }
  return engine;
}

function persistFilterSnapshot(directory, serialized, metadata, sources, fileSystem = fs, integrity = null) {
  const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');
  const engineFile = `engine-${sha256}.bin`;
  const metadataFile = `meta-${sha256}.json`;
  const sourcesFile = `sources-${sha256}.json`;
  fileSystem.mkdirSync(directory, { recursive: true });
  const hashes = Object.create(null);
  for (const [file, contents] of [[engineFile, serialized], [metadataFile, JSON.stringify(metadata, null, 2) + '\n'], [sourcesFile, JSON.stringify(sources)]]) {
    hashes[file] = crypto.createHash('sha256').update(contents).digest('hex');
    const temporary = path.join(directory, file + '.tmp');
    fileSystem.writeFileSync(temporary, contents);
    fileSystem.renameSync(temporary, path.join(directory, file));
  }
  const pointer = { engineFile, metadataFile, sourcesFile, sha256, hashes };
  const pointerTemporary = path.join(directory, 'active.json.tmp');
  fileSystem.writeFileSync(pointerTemporary, (integrity ? integrity.seal('filter-manifest', pointer) : JSON.stringify(pointer)) + '\n');
  fileSystem.renameSync(pointerTemporary, path.join(directory, 'active.json'));
  return pointer;
}

function recordBlockedRequest(counters, host, resourceType, now = Date.now()) {
  if (!host) return;
  const type = String(resourceType || 'other').slice(0, 24);
  const site = String(host).toLowerCase().slice(0, 253);
  counters.total = (counters.total || 0) + 1;
  counters.byType ||= {};
  counters.bySite ||= {};
  counters.byType[type] = (counters.byType[type] || 0) + 1;
  if (!counters.bySite[site] && Object.keys(counters.bySite).length >= 500) {
    const oldest = Object.keys(counters.bySite)[0];
    delete counters.bySite[oldest];
  }
  const entry = counters.bySite[site] ||= { total: 0, byType: {} };
  entry.total += 1;
  entry.byType[type] = (entry.byType[type] || 0) + 1;
  counters.lastUpdated = now;
}

function normalizeListStates(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(DEFAULT_LISTS.map((list) => [list.id, {
    enabled: typeof input[list.id]?.enabled === 'boolean' ? input[list.id].enabled : list.enabled,
    updatedAt: typeof input[list.id]?.updatedAt === 'string' ? input[list.id].updatedAt : ''
  }]));
}

function updateDue(lastUpdatedAt, now = Date.now(), intervalMs = 7 * 24 * 60 * 60 * 1000) {
  const stamp = Date.parse(lastUpdatedAt || '');
  return !Number.isFinite(stamp) || now - stamp >= intervalMs;
}

function isYouTubeHost(host) {
  return typeof host === 'string' && /^(?:[a-z0-9-]+\.)*(?:youtube|youtube-nocookie)\.com\.?$/i.test(host);
}

function reloadYouTubeTabs(tabs) {
  let reloaded = 0;
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    let host = '';
    try { host = new URL(tab.url).hostname; } catch {}
    const contents = tab.pageView && tab.pageView.webContents;
    if (tab.internal || !isYouTubeHost(host) || !contents || contents.isDestroyed()) continue;
    try {
      contents.reload();
      reloaded += 1;
    } catch {}
  }
  return reloaded;
}

module.exports = {
  DEFAULT_LISTS,
  MAX_LIST_BYTES,
  MAX_TOTAL_LIST_BYTES,
  MAX_CUSTOM_RULE_BYTES,
  MAX_FILTER_RULES,
  MAX_FILTER_LINE_BYTES,
  FILTER_FETCH_TIMEOUT_MS,
  safeFilterListUrl,
  readFilterResponseText,
  validateFilterListText,
  validateCustomFilters,
  validateAdblockSettingsPayload,
  shouldUpdateViaTor,
  shouldBlockStrictThirdParty,
  verifyAdvertisedDigest,
  updateBlockerFromSources,
  persistFilterSnapshot,
  recordBlockedRequest,
  normalizeListStates,
  updateDue,
  isYouTubeHost,
  reloadYouTubeTabs
};
