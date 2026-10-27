'use strict';

// Icons for home shortcuts and bookmarks. Two sources, both without any new
// direct connection:
// - passive: the tab favicon Nacre already fetched for a page the user opened
//   (see favicon.cjs) is kept when its host is a shortcut or a bookmark;
// - active: a shortcut or bookmark never opened is fetched only over Tor, in a
//   dedicated in-memory session without cookies, when Tor is connected. Without
//   Tor the tile keeps its letter until the user opens the site.
// Icons are stored re-encoded as 32px PNG data: URLs in a signed profile file,
// limited to the hosts of shortcuts and bookmarks so it never becomes a history.

const { encodeFavicon, isSafeFaviconDataUrl, MAX_FAVICON_BYTES } = require('./favicon.cjs');

const MAX_ICONS = 300;
const MAX_PAGE_BYTES = 512 * 1024;
const RETRY_AFTER_MS = 30 * 60 * 1000;

function iconHost(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() : '';
  } catch { return ''; }
}

// Ranks the icons a page declares: decodable raster formats first, sizes
// close to 32-64 px before large touch icons. SVG and mask icons are skipped
// because nativeImage cannot decode them.
function iconCandidatesFromHtml(html, baseUrl) {
  const head = String(html || '').slice(0, MAX_PAGE_BYTES);
  const found = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const attribute = (name) => {
      const value = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
      return value ? (value[1] ?? value[2] ?? value[3] ?? '').trim() : '';
    };
    const rel = attribute('rel').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    const type = attribute('type').toLowerCase();
    const href = attribute('href').replace(/&amp;/g, '&');
    if (!href || type.includes('svg') || /\.svg(?:[?#]|$)/i.test(href)) continue;
    let url;
    try { url = new URL(href, baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const sizes = attribute('sizes').toLowerCase().match(/(\d+)x\d+/g) || [];
    const size = Math.max(0, ...sizes.map((value) => Number.parseInt(value, 10)));
    const score = rel.includes('apple-touch-icon') ? 3 : size >= 32 && size <= 96 ? 0 : size === 0 ? 1 : 2;
    found.push({ href: url.href, score, size });
  }
  found.sort((a, b) => a.score - b.score || Math.abs(a.size - 48) - Math.abs(b.size - 48));
  return [...new Set(found.map((item) => item.href))].slice(0, 4);
}

async function readText(response, readBoundedBody) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok || !type.includes('html')) {
    try { await response.body?.cancel(); } catch {}
    return '';
  }
  const bytes = await readBoundedBody(response, MAX_PAGE_BYTES).catch(() => null);
  return bytes ? bytes.toString('utf8') : '';
}

async function readImage(response, readBoundedBody) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  // Electron's session.fetch leaves response.url empty; when it is known, a
  // redirect must not have left https.
  const insecureRedirect = Boolean(response.url) && !String(response.url).startsWith('https:');
  if (!response.ok || !(type.startsWith('image/') || type === 'application/octet-stream') || length > MAX_FAVICON_BYTES || insecureRedirect) {
    try { await response.body?.cancel(); } catch {}
    return null;
  }
  return readBoundedBody(response, MAX_FAVICON_BYTES).catch(() => null);
}

// fetcher must be bound to the Tor-only icon session. Only https is used.
async function fetchSiteIcon({ fetcher, pageUrl, nativeImage, readBoundedBody, timeoutMs = 20000 }) {
  let page;
  try { page = new URL(pageUrl); } catch { return ''; }
  if (page.protocol === 'http:') page.protocol = 'https:';
  if (page.protocol !== 'https:' || page.username || page.password) return '';
  const init = () => ({ credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeoutMs) });
  let candidates = [];
  try {
    const response = await fetcher(page.origin + '/', { ...init(), headers: { Accept: 'text/html' } });
    const finalUrl = String(response.url || page.origin + '/');
    candidates = finalUrl.startsWith('https:') ? iconCandidatesFromHtml(await readText(response, readBoundedBody), finalUrl) : [];
  } catch {}
  candidates.push(page.origin + '/favicon.ico');
  for (const candidate of [...new Set(candidates)].slice(0, 5)) {
    try {
      const response = await fetcher(candidate, { ...init(), headers: { Accept: 'image/png,image/x-icon,image/*;q=0.8' } });
      const encoded = encodeFavicon(await readImage(response, readBoundedBody), nativeImage);
      if (encoded) return encoded;
    } catch {}
  }
  return '';
}

function createSiteIconStore({ read, write, now = Date.now }) {
  let icons = new Map();
  const attempts = new Map();
  let version = 0;
  try {
    const stored = read();
    for (const [host, icon] of Object.entries(stored && typeof stored.icons === 'object' && stored.icons ? stored.icons : {}).slice(0, MAX_ICONS)) {
      if (iconHost('https://' + host) === host && isSafeFaviconDataUrl(icon)) icons.set(host, icon);
    }
  } catch {}
  function save() {
    try { write({ icons: Object.fromEntries(icons) }); } catch {}
  }
  return {
    get version() { return version; },
    get: (host) => icons.get(host) || '',
    has: (host) => icons.has(host),
    set(host, icon) {
      if (!host || !isSafeFaviconDataUrl(icon) || icons.get(host) === icon) return false;
      icons.delete(host);
      icons.set(host, icon);
      while (icons.size > MAX_ICONS) icons.delete(icons.keys().next().value);
      version += 1;
      save();
      return true;
    },
    // Drops icons of hosts that are no longer shortcuts or bookmarks.
    retain(hosts) {
      const keep = new Set(hosts);
      const before = icons.size;
      icons = new Map([...icons].filter(([host]) => keep.has(host)));
      if (icons.size !== before) { version += 1; save(); }
    },
    clear() { icons.clear(); attempts.clear(); version += 1; save(); },
    persist: save,
    // Hosts without an icon that were not tried recently.
    due(hosts) {
      return [...new Set(hosts)].filter((host) => host && !icons.has(host) && (!attempts.has(host) || now() - attempts.get(host) > RETRY_AFTER_MS));
    },
    attempted(host) { attempts.set(host, now()); }
  };
}

module.exports = { MAX_ICONS, iconHost, iconCandidatesFromHtml, fetchSiteIcon, createSiteIconStore };
