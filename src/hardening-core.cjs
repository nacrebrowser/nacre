'use strict';

const { validHost } = require('./site-cookie-controls.cjs');

async function readBoundedBody(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

function validZapperSelector(value) {
  if (typeof value !== 'string' || !value || value.length > 500) return false;
  const ident = '[A-Za-z_][A-Za-z0-9_-]{0,79}';
  const part = new RegExp(`^(?:[a-z][a-z0-9-]{0,39})?(?:#${ident})?(?:\\.${ident}){0,2}(?::nth-of-type\\([1-9][0-9]{0,5}\\))?$`);
  const parts = value.split(' > ');
  return parts.length <= 6 && parts.every(item => item && part.test(item));
}

function normalizeSitePermissions(raw) {
  const result = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [host, entry] of Object.entries(raw).slice(0, 1000)) {
    if (!validHost(host) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    result[host] = Object.create(null);
    for (const [permission, mode] of Object.entries(entry)) {
      if (/^[a-z][a-z-]{0,40}$/.test(permission) && ['allow', 'deny', 'ask'].includes(mode)) result[host][permission] = mode;
    }
  }
  return result;
}

function decodeEntities(value) {
  return value.replace(/&(?:#(x[0-9a-f]{1,6}|[0-9]{1,7})|([a-z]{2,5}));/gi, (whole, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[named.toLowerCase()] ?? whole;
  });
}

// Tokenize once, with bounded individual tags and titles. No nested wildcard
// scanning over an entire malicious HTML file.
const MAX_ANCHOR_TAG = 70000;
function parseBookmarkHtml(source, safeURL) {
  const imported = [];
  let anchor = null;
  source = source.slice(0, 5_000_000);
  let cursor = 0;
  while (cursor < source.length) {
    let token;
    if (source[cursor] === '<') {
      const end = source.indexOf('>', cursor + 1);
      if (end === -1) break;
      token = source.slice(cursor, end + 1);
      cursor = end + 1;
      // Browser exports embed each site icon as a data: URI in the <A> tag.
      if (token.length > (/^<a\s/i.test(token) ? MAX_ANCHOR_TAG : 16384)) { anchor = null; continue; }
    } else {
      const end = source.indexOf('<', cursor);
      const stop = end === -1 ? source.length : end;
      token = source.slice(cursor, Math.min(stop, cursor + 16384));
      cursor = stop;
    }
    if (/^<a\s/i.test(token)) {
      const href = /\bhref\s*=\s*(?:"([^"<>]{0,8192})"|'([^'<>]{0,8192})')/i.exec(token);
      const icon = /\bicon\s*=\s*"(data:image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|gif);base64,[A-Za-z0-9+/=]{1,60000})"/i.exec(token);
      anchor = href ? { url: safeURL(decodeEntities(href[1] ?? href[2])), text: '', icon: icon ? icon[1] : '' } : null;
    } else if (/^<\/a\s*>$/i.test(token)) {
      if (anchor?.url) {
        const title = decodeEntities(anchor.text).replace(/<[^>]{0,16384}>/g, '').trim().slice(0, 200);
        imported.push({ url: anchor.url, title: title || new URL(anchor.url).hostname, folder: '', ...(anchor.icon ? { icon: anchor.icon } : {}) });
        if (imported.length >= 500) break;
      }
      anchor = null;
    } else if (anchor && !token.startsWith('<')) anchor.text += token.slice(0, Math.max(0, 16384 - anchor.text.length));
  }
  return imported;
}

module.exports = { readBoundedBody, validZapperSelector, normalizeSitePermissions, parseBookmarkHtml };
