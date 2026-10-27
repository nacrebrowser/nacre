'use strict';

const { getDomain } = require('tldts-experimental');
const { validHost } = require('./site-cookie-controls.cjs');

// Curated, offline attribution. A name match identifies a possible technology,
// not the owner of the site setting the cookie. Sources and review date are
// documented in docs/security/PROTECTION_ATTRIBUTION.md.
const DOMAIN_OWNERS = new Map([
  ['google.com', ['Google', 'Google']],
  ['google-analytics.com', ['Google', 'Google Analytics']],
  ['doubleclick.net', ['Google', 'DoubleClick']],
  ['googlesyndication.com', ['Google', 'Google Ads']],
  ['googleadservices.com', ['Google', 'Google Ads']],
  ['facebook.com', ['Meta', 'Facebook']],
  ['facebook.net', ['Meta', 'Meta Pixel']],
  ['instagram.com', ['Meta', 'Instagram']],
  ['clarity.ms', ['Microsoft', 'Microsoft Clarity']],
  ['bing.com', ['Microsoft', 'Microsoft Advertising']],
  ['microsoft.com', ['Microsoft', 'Microsoft']],
  ['linkedin.com', ['LinkedIn', 'LinkedIn']],
  ['licdn.com', ['LinkedIn', 'LinkedIn']]
]);
const SIGNATURES = [
  [/^_ga(?:_[A-Za-z0-9]+)?$|^_gid$|^_gat(?:_[A-Za-z0-9_]+)?$/, 'Google', 'Google Analytics', 'analytics'],
  [/^_gcl_[A-Za-z0-9_]+$/, 'Google', 'Google Ads', 'advertising'],
  [/^_fbp$|^_fbc$/, 'Meta', 'Meta Pixel', 'advertising'],
  [/^_clck$|^_clsk$/, 'Microsoft', 'Microsoft Clarity', 'analytics'],
  [/^_uetvid$|^_uetsid$/, 'Microsoft', 'Microsoft Advertising', 'advertising'],
  [/^li_fat_id$/, 'LinkedIn', 'LinkedIn Insight Tag', 'advertising']
];
const ACTIONS = new Set(['request-blocked', 'cookie-send-blocked', 'cookie-set-blocked', 'cookie-purged', 'request-allowed', 'request-redirected', 'request-rewritten', 'http-blocked']);
const REASONS = new Set(['filter-rule', 'strict-mode', 'site-exception', 'blocking-disabled', 'filter-exception', 'no-matching-rule', 'cookie-policy', 'https-only', 'cookie-purge', 'unknown']);
const RESOURCE_TYPES = new Set(['mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr', 'ping', 'cspReport', 'media', 'webSocket', 'other']);
const SOURCES = Object.freeze({
  Google: 'https://policies.google.com/technologies/cookies?hl=en-us',
  Meta: 'https://github.com/facebook/facebook-for-woocommerce/blob/main/facebook-commerce-pixel-event.php',
  Microsoft: 'https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies',
  LinkedIn: 'https://www.linkedin.com/legal/l/cookie-table'
});
const MICROSOFT_ADS_SOURCE = 'https://help.ads.microsoft.com/apex/index/3/en-in/53056';
const MAX_ENTRIES = 200;

function normalizeHost(value) {
  if (typeof value !== 'string' || value.length > 255) return '';
  const host = value.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  return validHost(host) ? host : '';
}

function safeCookieName(value) {
  return typeof value === 'string' && value.length <= 80 && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,80}$/.test(value) ? value : '';
}

function cookieNamesFromHeader(value, response = false) {
  const names = new Set();
  const headers = Array.isArray(value) ? value.slice(0, 40) : [value];
  for (const header of headers) {
    if (typeof header !== 'string') continue;
    const text = header.slice(0, 16384);
    for (const pair of (response ? [text.split(';', 1)[0]] : text.split(';').slice(0, 40))) {
      const equal = pair.indexOf('=');
      const name = equal > 0 ? safeCookieName(pair.slice(0, equal).trim()) : '';
      if (name) names.add(name);
      if (names.size >= 40) return [...names];
    }
  }
  return [...names];
}

function attribution(host, name = '') {
  const normalized = normalizeHost(host);
  const domain = getDomain(normalized, { allowPrivateDomains: true }) || normalized;
  const owner = DOMAIN_OWNERS.get(domain);
  const signature = SIGNATURES.find(([pattern]) => pattern.test(name));
  // Conflicting names must not override the observed destination's owner.
  if (owner) return { company: owner[0], service: signature && signature[1] === owner[0] ? signature[2] : owner[1], basis: 'domain', purpose: signature && signature[1] === owner[0] ? signature[3] : 'unknown' };
  if (signature) return { company: signature[1], service: signature[2], basis: 'signature', purpose: signature[3] };
  return { company: '', service: '', basis: 'unknown', purpose: 'unknown' };
}

// Opaque engine identifier only: never stringify a filter, which can contain
// user-entered domains, paths or query parameters.
function filterIdentifier(filter) {
  try {
    const id = filter && typeof filter.getId === 'function' ? filter.getId() : null;
    return Number.isSafeInteger(id) && id >= 0 && id <= 0xffffffff ? 'f-' + id.toString(16).padStart(8, '0') : '';
  } catch { return ''; }
}

function decisionFor(action) {
  return action === 'request-allowed' ? 'allowed' : ['request-redirected', 'request-rewritten'].includes(action) ? 'modified' : 'blocked';
}

function createProtectionActivity({ scope = 'normal' } = {}) {
  if (!['normal', 'private'].includes(scope)) throw new TypeError('Invalid activity scope');
  const records = new Map();
  let total = 0;
  let droppedGroups = 0;
  function record({ host, site = '', cookieName = '', action, tabId = null, private: privateMode = false, reason = '', resourceType = 'other', thirdParty = null, ruleId = '' }, now = Date.now()) {
    if (Boolean(privateMode) !== (scope === 'private') || !ACTIONS.has(action)) return false;
    host = normalizeHost(host); site = normalizeHost(site);
    cookieName = safeCookieName(cookieName);
    tabId = Number.isSafeInteger(tabId) && tabId > 0 ? tabId : null;
    if (!host || (action.startsWith('cookie-') && !cookieName)) return false;
    reason = REASONS.has(reason) ? reason : action === 'cookie-purged' ? 'cookie-purge' : action.startsWith('cookie-') ? 'cookie-policy' : action === 'http-blocked' ? 'https-only' : 'unknown';
    resourceType = RESOURCE_TYPES.has(resourceType) ? resourceType : 'other';
    thirdParty = typeof thirdParty === 'boolean' ? thirdParty : null;
    ruleId = ['filter-rule', 'filter-exception'].includes(reason) && typeof ruleId === 'string' && /^f-[0-9a-f]{8}$/.test(ruleId) ? ruleId : '';
    now = Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000 ? now : Date.now();
    // JSON keys cannot collide through a separator in an untrusted cookie name.
    const key = JSON.stringify([tabId, host, site, cookieName, action, reason, resourceType, thirdParty, ruleId]);
    let entry = records.get(key);
    if (!entry) {
      if (records.size >= MAX_ENTRIES) { records.delete(records.keys().next().value); droppedGroups++; }
      const identified = attribution(host, cookieName);
      const sourceUrl = identified.service === 'Microsoft Advertising' ? MICROSOFT_ADS_SOURCE : SOURCES[identified.company] || '';
      entry = { tabId, host, site, cookieName, action, ...identified, decision: decisionFor(action), reason, resourceType, thirdParty, ruleId, sourceUrl, sourceReviewedAt: sourceUrl ? '2026-10-21' : '', count: 0, firstSeen: now, lastSeen: now };
    }
    entry.count = Math.min(Number.MAX_SAFE_INTEGER, entry.count + 1);
    entry.firstSeen = Math.min(entry.firstSeen, now);
    entry.lastSeen = Math.max(entry.lastSeen, now);
    records.delete(key); records.set(key, entry);
    total = Math.min(Number.MAX_SAFE_INTEGER, total + 1);
    return true;
  }
  return {
    record,
    clear() { records.clear(); total = 0; droppedGroups = 0; },
    snapshot() {
      const entries = [...records.values()].reverse().sort((a,b) => b.lastSeen-a.lastSeen).map(entry => ({ ...entry }));
      const summary = { blocked: 0, allowed: 0, modified: 0 };
      for (const entry of entries) summary[entry.decision] = Math.min(Number.MAX_SAFE_INTEGER, summary[entry.decision] + entry.count);
      return { available: true, scope, total, limit: MAX_ENTRIES, droppedGroups, summary, entries };
    }
  };
}

function createTransparencyReport(activity) {
  // Reconstruct from the same fixed schema instead of serializing caller fields.
  const scope = activity?.scope === 'private' ? 'private' : 'normal';
  const journal = createProtectionActivity({ scope });
  for (const item of Array.isArray(activity?.entries) ? activity.entries.slice(0, MAX_ENTRIES).reverse() : []) {
    if (!item || typeof item !== 'object') continue;
    journal.record({ ...item, private: scope === 'private' }, item.lastSeen);
  }
  const cleaned = journal.snapshot();
  // Reapply only validated aggregate metadata. Never accept a renderer report.
  cleaned.total = Number.isSafeInteger(activity?.total) && activity.total >= 0 ? activity.total : cleaned.total;
  cleaned.entries = cleaned.entries.map(entry => {
    const original = activity.entries.find(item => item && item.host === entry.host && item.site === entry.site && item.cookieName === entry.cookieName && item.action === entry.action && item.reason === entry.reason && item.ruleId === entry.ruleId && item.resourceType === entry.resourceType && item.tabId === entry.tabId && item.thirdParty === entry.thirdParty);
    if (original && Number.isSafeInteger(original.count) && original.count > 0) entry.count = original.count;
    if (original && Number.isSafeInteger(original.firstSeen) && original.firstSeen >= 0 && original.firstSeen <= entry.lastSeen) entry.firstSeen = original.firstSeen;
    return entry;
  });
  const summary = { blocked: 0, allowed: 0, modified: 0 };
  for (const entry of cleaned.entries) summary[entry.decision] = Math.min(Number.MAX_SAFE_INTEGER, summary[entry.decision] + entry.count);
  const droppedGroups = Number.isSafeInteger(activity?.droppedGroups) && activity.droppedGroups >= 0 ? activity.droppedGroups : 0;
  return JSON.stringify({ schema: 'nacre.transparency.v1', scope: cleaned.scope, total: cleaned.total, limit: MAX_ENTRIES, droppedGroups, summary, entries: cleaned.entries }, null, 2);
}

module.exports = { createProtectionActivity, attribution, cookieNamesFromHeader, filterIdentifier, createTransparencyReport, MAX_ENTRIES };
