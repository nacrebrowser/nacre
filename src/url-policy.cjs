'use strict';

// Pure URL and stored-value validation shared by the main process.
// Nothing here touches Electron or the live settings object.

function safeURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Stored profiles can predate the current proxy validation. Treat an invalid
// endpoint as disabled instead of handing it to Chromium.
function sanitizeStoredProxy(value) {
  const proxy = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const host = typeof proxy.host === 'string' ? proxy.host.trim().toLowerCase() : '';
  const hostValid = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)
    || /^\[[0-9a-f:.]+\]$/.test(host);
  const port = Number(proxy.port);
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  return {
    enabled: Boolean(proxy.enabled) && hostValid && portValid,
    type: proxy.type === 'http' ? 'http' : 'socks5',
    host: hostValid ? host : '',
    port: portValid ? port : 1080,
    username: typeof proxy.username === 'string' ? proxy.username.slice(0, 255) : '',
    encryptedPassword: typeof proxy.encryptedPassword === 'string' ? proxy.encryptedPassword : ''
  };
}

function sanitizeSiteZoom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  let count = 0;
  for (const [domain, zoom] of Object.entries(value)) {
    if (count >= 500) break;
    if (!/^(?=.{1,253}$)[a-z0-9.-]+$/i.test(domain) || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) continue;
    const percent = Number(zoom);
    if (!Number.isFinite(percent) || percent < 50 || percent > 300) continue;
    result[domain.toLowerCase()] = Math.round(percent);
    count += 1;
  }
  return result;
}

function isGitHubRepository(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.includes('..');
}

// Semantic version comparison; returns null when either value is not semver.
function compareVersions(left, right) {
  const parse = (value) => {
    const match = String(value).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    return match ? { core: match.slice(1, 4).map(Number), pre: match[4] || '' } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true });
}

const SEARCH_URLS = Object.freeze({
  duckduckgo: 'https://duckduckgo.com/?q=',
  qwant: 'https://www.qwant.com/?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  brave: 'https://search.brave.com/search?q=',
  ecosia: 'https://www.ecosia.org/search?q='
});

function searchURL(query, engine, customTemplate) {
  const q = encodeURIComponent(String(query || '').trim());
  const fallback = SEARCH_URLS.duckduckgo + q;
  if (engine !== 'custom') return SEARCH_URLS[engine] ? SEARCH_URLS[engine] + q : fallback;
  if (typeof customTemplate !== 'string' || !customTemplate.includes('%s')) return fallback;
  try { return safeURL(customTemplate.replaceAll('%s', q)) || fallback; } catch { return fallback; }
}

module.exports = { safeURL, sanitizeStoredProxy, sanitizeSiteZoom, isGitHubRepository, compareVersions, searchURL, SEARCH_URLS };
