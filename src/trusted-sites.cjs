'use strict';

// "Stay signed in" sites. On a trusted site Nacre keeps the same anti-
// fingerprint values from one launch to the next (so the service does not see
// a new device each time), lets the site use its own sign-in cookies across
// its domains, and keeps its data when "clear on quit" runs. Ad and tracker
// blocking, phishing checks and HTTPS-only stay active. Private tabs never use
// trusted-site exceptions.

const crypto = require('node:crypto');

const MAX_TRUSTED_SITES = 200;

// Sign-in often happens on a sister domain, so each preset lists all of them.
const TRUSTED_SITE_PRESETS = Object.freeze([
  { id: 'netflix', name: 'Netflix', domains: ['netflix.com'] },
  { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'google.com'] },
  { id: 'disney', name: 'Disney+', domains: ['disneyplus.com', 'disney.com', 'bamgrid.com'] },
  { id: 'prime', name: 'Prime Video', domains: ['primevideo.com', 'amazon.com', 'amazon.fr'] },
  { id: 'canal', name: 'Canal+', domains: ['canalplus.com'] },
  { id: 'max', name: 'Max', domains: ['max.com'] },
  { id: 'crunchyroll', name: 'Crunchyroll', domains: ['crunchyroll.com'] },
  { id: 'twitch', name: 'Twitch', domains: ['twitch.tv'] },
  { id: 'spotify', name: 'Spotify', domains: ['spotify.com'] },
  { id: 'deezer', name: 'Deezer', domains: ['deezer.com'] },
  { id: 'apple', name: 'Apple TV+', domains: ['apple.com'] }
].map((preset) => Object.freeze({ ...preset, domains: Object.freeze(preset.domains) })));

function validDomain(value) {
  return typeof value === 'string' && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/.test(value);
}

function normalizeTrustedSites(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const domain = typeof item === 'string' ? item.trim().toLowerCase().replace(/^www\./, '') : '';
    if (validDomain(domain) && !result.includes(domain)) result.push(domain);
    if (result.length >= MAX_TRUSTED_SITES) break;
  }
  return result;
}

function presetDomains(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return TRUSTED_SITE_PRESETS.filter((preset) => wanted.has(preset.id)).flatMap((preset) => preset.domains);
}

// Presets whose domains are all trusted, for the interface checkboxes.
function enabledPresets(list) {
  const trusted = new Set(list);
  return TRUSTED_SITE_PRESETS.filter((preset) => preset.domains.every((domain) => trusted.has(domain))).map((preset) => preset.id);
}

function isTrustedDomain(domain, list) {
  return typeof domain === 'string' && Array.isArray(list) && list.includes(domain.toLowerCase());
}

function normalizeTrustedSecret(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
}

function createTrustedSecret(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('hex');
}

// Stable per-workspace, per-site value: two workspaces still look unrelated.
function trustedFingerprintSeed(secret, workspaceId, domain) {
  if (!normalizeTrustedSecret(secret)) throw new TypeError('Secret de site de confiance invalide.');
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(String(workspaceId) + '\n' + domain.toLowerCase()).digest('hex');
}

// Origins to keep when "clear on quit" runs: the registrable domain, www and
// every host that currently holds a cookie for a trusted domain.
function trustedOrigins(list, cookieHosts = [], primaryDomain = (host) => host) {
  if (!Array.isArray(list) || !list.length) return [];
  const origins = new Set();
  for (const domain of list) for (const host of [domain, 'www.' + domain]) origins.add('https://' + host);
  for (const raw of cookieHosts) {
    const host = typeof raw === 'string' ? raw.replace(/^\./, '').toLowerCase() : '';
    if (host && validDomain(host) && list.includes(primaryDomain(host))) origins.add('https://' + host);
  }
  return Array.from(origins);
}

module.exports = {
  MAX_TRUSTED_SITES,
  TRUSTED_SITE_PRESETS,
  normalizeTrustedSites,
  presetDomains,
  enabledPresets,
  isTrustedDomain,
  normalizeTrustedSecret,
  createTrustedSecret,
  trustedFingerprintSeed,
  trustedOrigins
};
