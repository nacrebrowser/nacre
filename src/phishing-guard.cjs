'use strict';

// Local, deterministic phishing checks. Nothing in this module performs a
// network request or stores history: the same URL and list always produce the
// same verdict on this device.

const { getDomain } = require('tldts-experimental');
const { matchPhishingHost } = require('./phishing-feed.cjs');

const MAX_LIST_ENTRIES = 2000;
const MAX_ENTRY_LENGTH = 300;

const BRANDS = Object.freeze([
  'airbnb', 'amazon', 'apple', 'binance', 'coinbase', 'dhl', 'discord', 'dropbox',
  'facebook', 'github', 'google', 'instagram', 'linkedin', 'microsoft', 'netflix',
  'outlook', 'paypal', 'proton', 'revolut', 'spotify', 'steam', 'stripe',
  'telegram', 'tiktok', 'twitter', 'whatsapp', 'yahoo'
]);

// Official domains for the brands above. A brand token anywhere else is a
// strong impersonation signal; these entries are intentionally exact.
const OFFICIAL_DOMAINS = Object.freeze({
  airbnb: ['airbnb.com', 'airbnb.fr'],
  amazon: ['amazon.com', 'amazon.fr', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.it'],
  apple: ['apple.com', 'icloud.com'],
  binance: ['binance.com'],
  coinbase: ['coinbase.com'],
  dhl: ['dhl.com', 'dhl.fr', 'dhl.de'],
  discord: ['discord.com', 'discord.gg'],
  dropbox: ['dropbox.com'],
  facebook: ['facebook.com', 'fb.com'],
  github: ['github.com'],
  google: ['google.com', 'google.fr', 'google.co.uk', 'gmail.com', 'youtube.com'],
  instagram: ['instagram.com'],
  linkedin: ['linkedin.com'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'outlook.com', 'xbox.com'],
  netflix: ['netflix.com'],
  outlook: ['outlook.com', 'live.com'],
  paypal: ['paypal.com', 'paypal.me'],
  proton: ['proton.me', 'protonmail.com'],
  revolut: ['revolut.com'],
  spotify: ['spotify.com'],
  steam: ['steampowered.com', 'steamcommunity.com'],
  stripe: ['stripe.com'],
  telegram: ['telegram.org', 't.me'],
  tiktok: ['tiktok.com'],
  twitter: ['twitter.com', 'x.com'],
  whatsapp: ['whatsapp.com'],
  yahoo: ['yahoo.com', 'yahoo.fr']
});

const RISKY_TLDS = new Set([
  'buzz', 'cam', 'cf', 'cfd', 'click', 'country', 'cyou', 'fit', 'gq', 'lol',
  'ml', 'monster', 'mov', 'quest', 'rest', 'sbs', 'support', 'tk', 'top',
  'work', 'xyz', 'zip'
]);

const LOGIN_WORDS = new Set([
  'account', 'auth', 'banque', 'bank', 'confirm', 'connexion', 'login',
  'password', 'pay', 'secure', 'security', 'signin', 'support', 'update',
  'verification', 'verify', 'wallet'
]);

let listCache = { source: null, entries: [] };

function normalizeEntry(value) {
  let entry = String(value || '').trim().toLowerCase();
  if (!entry || entry.startsWith('#') || entry.startsWith('!')) return null;
  if (entry.length > MAX_ENTRY_LENGTH || /[\u0000-\u001f\u007f\s]/.test(entry)) return null;
  if (entry.startsWith('*.')) entry = entry.slice(2);
  if (entry.startsWith('||')) entry = entry.slice(2).replace(/\^$/, '');
  if (entry.startsWith('http://') || entry.startsWith('https://')) {
    try {
      const parsed = new URL(entry);
      if (parsed.username || parsed.password) return null;
      entry = parsed.hostname + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '');
    } catch { return null; }
  } else if (entry.includes('/')) {
    const [host, ...rest] = entry.split('/');
    if (!host) return null;
    entry = host + '/' + rest.join('/');
  }
  const slash = entry.indexOf('/');
  const host = (slash === -1 ? entry : entry.slice(0, slash)).replace(/\.$/, '');
  if (!host || host.length > 253 || !/^(?=.{1,253}$)[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith('.') || host.includes('..')) return null;
  return { host, path: slash === -1 ? '' : entry.slice(slash) };
}

function parseBlocklist(text) {
  const source = typeof text === 'string' ? text : '';
  if (listCache.source === source) return listCache.entries;
  const seen = new Set();
  const entries = [];
  for (const line of source.split(/\r?\n/)) {
    const entry = normalizeEntry(line);
    if (!entry) continue;
    const key = entry.host + entry.path;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= MAX_LIST_ENTRIES) break;
  }
  listCache = { source, entries: Object.freeze(entries) };
  return listCache.entries;
}

function hostMatches(host, rule) {
  return host === rule || host.endsWith('.' + rule);
}

function isIpLiteral(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((part) => Number(part) <= 255);
  }
  return host.includes(':');
}

function isPrivateAddress(host) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === '::1' || bare.startsWith('fc') || bare.startsWith('fd') || bare.startsWith('fe80:');
}

function officialFor(brand) {
  return OFFICIAL_DOMAINS[brand] || [];
}

function hostTokens(host) {
  return host.split(/[.-]/).filter(Boolean);
}

function isOfficialDomain(domain, brand) {
  return officialFor(brand).some((official) => domain === official || domain.endsWith('.' + official));
}

const COMMON_TLDS = new Set(['com', 'net', 'org', 'fr', 'de', 'co', 'uk', 'io', 'app', 'dev', 'info', 'biz', 'eu', 'ca', 'au', 'jp', 'br', 'mx', 'es', 'it', 'nl', 'be', 'ch', 'se', 'no', 'dk', 'fi', 'pl', 'pt', 'ru', 'cn', 'in', 'za', 'me']);

function brandReason(host, domain) {
  const tokens = hostTokens(host);
  const domainTokens = hostTokens(domain);
  const loginContext = tokens.some((token) => LOGIN_WORDS.has(token));
  for (const brand of BRANDS) {
    if (!tokens.includes(brand)) continue;
    if (isOfficialDomain(domain, brand)) return '';
    // A brand inside the registrable name (paypal-secure-login.com) is the
    // strongest signal. A brand used as a subdomain label is normal on shared
    // hosting, so only flag it when a TLD follows or a login word is present
    // (paypal.com.evil.example, login.paypal.evil.example).
    if (domainTokens.includes(brand)) return 'brand';
    if (loginContext) return 'brand';
    const index = tokens.indexOf(brand);
    if (index >= 0 && COMMON_TLDS.has(tokens[index + 1])) return 'brand';
  }
  return '';
}

function verdictFor(url, options = {}) {
  const disabled = options.enabled === false;
  const result = { action: 'allow', reasons: [], host: '', blocked: false };
  if (disabled || typeof url !== 'string' || url.length > 8192) return result;
  let parsed;
  try { parsed = new URL(url); } catch { return result; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return result;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return result;
  result.host = host;

  const reasons = [];
  // Public signals trigger a reviewable warning, never a confirmed-phishing claim.
  if (matchPhishingHost(host).matched) reasons.push('public-feed');
  const entries = parseBlocklist(options.blocklist);
  for (const rule of entries) {
    if (!hostMatches(host, rule.host)) continue;
    if (rule.path && !parsed.pathname.startsWith(rule.path)) continue;
    reasons.push('blocklist');
    result.blocked = true;
    break;
  }

  if (host.includes('xn--')) reasons.push('idn');
  if (isIpLiteral(host) && !isPrivateAddress(host)) reasons.push('ip-literal');

  const domain = String(getDomain(host, { allowPrivateDomains: false }) || host).toLowerCase();
  const brand = brandReason(host, domain);
  if (brand) reasons.push('brand');

  const tld = domain.split('.').pop();
  if (RISKY_TLDS.has(tld) && (brand || hostTokens(host).some((token) => LOGIN_WORDS.has(token)))) reasons.push('risky-tld');
  if (host.split('.').length >= 5 && hostTokens(host).some((token) => LOGIN_WORDS.has(token))) reasons.push('subdomains');

  result.reasons = [...new Set(reasons)];
  result.action = result.reasons.length ? 'warn' : 'allow';
  return result;
}

module.exports = {
  BRANDS,
  MAX_LIST_ENTRIES,
  MAX_ENTRY_LENGTH,
  normalizeEntry,
  parseBlocklist,
  verdictFor
};
