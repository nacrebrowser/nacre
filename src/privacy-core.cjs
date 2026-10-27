'use strict';

const crypto = require('node:crypto');

function registrableDomain(host, getDomain) {
  const normalized = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized || normalized.length > 253 || /[^a-z0-9.:[\]-]/i.test(normalized)) return '';
  return String(getDomain(normalized) || normalized).toLowerCase();
}

function socksToken(domain, sessionSecret) {
  if (!domain || !Buffer.isBuffer(sessionSecret) || sessionSecret.length < 32) throw new TypeError('Identifiant SOCKS invalide.');
  return crypto.createHmac('sha256', sessionSecret).update(String(domain).toLowerCase()).digest('hex').slice(0, 48);
}

function isValidCircuitLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= 16;
}

function isAllowedPermissionMode(value) {
  return value === 'allow' || value === 'deny' || value === 'ask';
}

// Host keys are read as own properties only: a host such as "constructor" must not
// resolve to Object.prototype.constructor (the built-in Object function).
function permissionModeFor(sitePermissions, host, permission) {
  if (!sitePermissions || !Object.hasOwn(sitePermissions, host)) return 'deny';
  const entry = sitePermissions[host];
  if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, permission)) return 'deny';
  const value = entry[permission];
  return isAllowedPermissionMode(value) ? value : 'deny';
}

function setPermissionPolicy(sitePermissions, host, permission, mode) {
  if (host === '__proto__') return sitePermissions;
  if (!Object.hasOwn(sitePermissions, host) || !sitePermissions[host] || typeof sitePermissions[host] !== 'object') {
    sitePermissions[host] = Object.create(null);
  }
  sitePermissions[host][permission] = mode;
  return sitePermissions;
}

function validateBridgeLines(mode, value) {
  if (!['obfs4', 'snowflake', 'custom'].includes(mode)) return { valid: false, lines: [], error: 'Type de pont invalide.' };
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return mode === 'custom' ? { valid: false, lines, error: 'Saisis au moins une ligne de pont.' } : { valid: true, lines: [], error: '' };
  if (lines.length > 8 || lines.some((line) => line.length > 1024 || /[\u0000-\u001f\u007f]/.test(line))) return { valid: false, lines: [], error: 'Les ponts sont trop nombreux ou contiennent des caractères invalides.' };
  for (const line of lines) {
    const kind = line.split(/\s+/, 1)[0];
    const expected = mode === 'custom' ? ['obfs4', 'snowflake'] : [mode];
    const address = line.split(/\s+/)[1] || '';
    const addressMatch = /^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i.exec(address);
    if (!expected.includes(kind) || !addressMatch || Number(addressMatch[1]) < 1 || Number(addressMatch[1]) > 65535) return { valid: false, lines: [], error: 'Chaque ligne doit commencer par le type et une adresse IP/nom d’hôte avec port valides.' };
    const extra = line.split(/\s+/).slice(2);
    if (extra.some((token) => !/^[A-F0-9]{40}$/i.test(token) && !/^(?:cert|iat-mode|fingerprint|url|fronts|ice|utls-imitate|ver)=\S+$/.test(token))) return { valid: false, lines: [], error: 'Un pont contient une option non reconnue.' };
    if (kind === 'obfs4' && (!/\b[A-F0-9]{40}\b/i.test(line) || !/\bcert=[A-Za-z0-9+/=]+/.test(line) || !/\biat-mode=[01]\b/.test(line))) return { valid: false, lines: [], error: 'Une ligne obfs4 doit inclure son fingerprint, son certificat et iat-mode.' };
    if (kind === 'snowflake' && (!/\bfingerprint=[A-F0-9]{40}\b/i.test(line) || !/\burl=https:\/\//.test(line) || !/\bfronts=/.test(line) || !/\bice=/.test(line))) return { valid: false, lines: [], error: 'Une ligne Snowflake doit inclure son fingerprint, url, fronts et ice.' };
  }
  return { valid: true, lines, error: '' };
}

function validateSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const valid = new Set(['searchEngine', 'customSearchUrl', 'releaseRepository', 'startupMode', 'startupPages', 'theme', 'accent', 'defaultZoom', 'fontSize', 'showBookmarksBar', 'httpsOnly', 'clearOnQuit', 'blockTrackers', 'blockThirdPartyCookies', 'cookiePolicy', 'sendGpc', 'sendDnt', 'askDownloadLocation', 'openDownloadsAfter', 'antiFingerprint', 'torBridgeMode', 'torBridgeLines', 'adBlockEnabled', 'adBlockMode', 'adBlockWeeklyUpdates', 'adBlockListStates', 'adBlockCustomLists', 'adBlockCustomFilters', 'adBlockSiteExceptions', 'webglMode', 'verticalTabs', 'phishingGuardEnabled', 'phishingBlocklist', 'iconTorBackground', 'suspendInactiveTabs', 'suspendAfterMinutes', 'home', 'secureDnsMode']);
  valid.add('darkBackground');
  return Object.keys(payload).every((key) => valid.has(key));
}

function shouldFailClosed(torConfigured, runtimeReady) {
  return Boolean(torConfigured) && !Boolean(runtimeReady);
}

function torStoppedErrorUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return 'nacre://error/?reason=tor-stopped';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'nacre://error/?reason=tor-stopped';
    return 'nacre://error/?reason=tor-stopped&url=' + encodeURIComponent(url.href);
  } catch { return 'nacre://error/?reason=tor-stopped'; }
}

function torStartupResumeUrl(tab) {
  const webUrl = (value) => {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : '';
    } catch { return ''; }
  };
  if (!tab || typeof tab !== 'object') return '';
  return webUrl(tab.torResumeUrl) || (!tab.internal ? webUrl(tab.url) : '');
}

function stripTrackingParameters(value) {
  const url = new URL(value);
  const exact = new Set([
    // Advertising and campaign click identifiers.
    'fbclid', 'gclid', 'dclid', 'gclsrc', 'msclkid', 'gbraid', 'wbraid', 'twclid',
    'ttclid', 'li_fat_id', 'igshid', 'epik', 's_kwcid', 'ef_id', 'wickedid',
    'yclid', 'rb_clickid', 'mkt_tok',
    // Mail, CRM and analytics identifiers.
    'mc_cid', 'mc_eid', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id',
    '_hsenc', '_hsmi', 'hsctatracking', 'elqtrackid', 'elqtrack', 's_cid', 'sc_cid'
  ]);
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || exact.has(lower)) url.searchParams.delete(key);
  }
  return url.href;
}

function createCircuitBudget(limit = 16) {
  if (!isValidCircuitLimit(limit)) throw new TypeError('La limite de circuits doit être comprise entre 1 et 16.');
  const entries = new Map();
  return {
    ensure(token, onEvict = () => {}) {
      const existing = entries.get(token);
      if (existing) { existing.usedAt = Date.now(); existing.onEvict = onEvict; return true; }
      if (entries.size >= limit) {
        const candidate = [...entries.entries()].filter(([, entry]) => entry.active === 0).sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
        if (!candidate) return false;
        entries.delete(candidate[0]);
        try { candidate[1].onEvict(candidate[0]); } catch {}
      }
      entries.set(token, { active: 0, usedAt: Date.now(), onEvict });
      return true;
    },
    enter(token) { const entry = entries.get(token); if (!entry) return false; entry.active += 1; entry.usedAt = Date.now(); return true; },
    leave(token) { const entry = entries.get(token); if (entry) { entry.active = Math.max(0, entry.active - 1); entry.usedAt = Date.now(); } },
    release(token) { const entry = entries.get(token); if (!entry) return; entries.delete(token); try { entry.onEvict(token); } catch {} },
    get size() { return entries.size; },
    clear() { for (const [token, entry] of entries) { try { entry.onEvict(token); } catch {} } entries.clear(); }
  };
}

module.exports = { registrableDomain, socksToken, isValidCircuitLimit, isAllowedPermissionMode, permissionModeFor, setPermissionPolicy, validateBridgeLines, validateSettingsPayload, shouldFailClosed, torStoppedErrorUrl, torStartupResumeUrl, stripTrackingParameters, createCircuitBudget };
