'use strict';

// Tab icons. Electron reports the icons a page declares but never downloads
// them, so Nacre fetches one itself under strict rules:
// - only from the page's own origin (scheme, host and port), which the tab has
//   already contacted: a page cannot point Nacre at another host, a local
//   network address or a third-party tracker. Plain-HTTP pages qualify only
//   when their host is an IP literal: a DNS name over HTTP could be re-bound
//   to a private address between the page load and the icon request;
// - through the tab's own session, so Tor, proxies and private sessions apply
//   as for the page, without cookies, and only if the content blocker would
//   let the page load the same URL as an image;
// - at most 256 KiB and 1024x1024 pixels (checked before decoding), then
//   re-encoded as a 32px PNG so the chrome only receives an inert data: URL.

const { isIP } = require('node:net');

const MAX_FAVICON_BYTES = 256 * 1024;
const MAX_FAVICON_DIMENSION = 1024;
const MAX_DATA_URL_LENGTH = 20000;
const FAVICON_SIZE = 32;

function pickFaviconUrl(candidates, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return ''; }
  if (!['http:', 'https:'].includes(page.protocol) || !page.hostname) return '';
  if (page.protocol === 'http:' && !isIP(page.hostname.replace(/^\[|\]$/g, ''))) return '';
  const list = Array.isArray(candidates) ? candidates.slice(0, 8) : [];
  list.push(page.origin + '/favicon.ico');
  for (const candidate of list) {
    if (typeof candidate !== 'string' || candidate.length > 2048) continue;
    let url;
    try { url = new URL(candidate, page); } catch { continue; }
    if (url.origin !== page.origin || url.username || url.password) continue;
    return url.href;
  }
  return '';
}

async function fetchFaviconBytes(fetcher, url, readBoundedBody) {
  const response = await fetcher(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (!response.ok || !type.startsWith('image/') || length > MAX_FAVICON_BYTES) {
    try { await response.body?.cancel(); } catch {}
    return null;
  }
  return readBoundedBody(response, MAX_FAVICON_BYTES);
}

function pngSize(bytes, offset = 0) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < offset + 24 || !signature.every((value, index) => bytes[offset + index] === value)) return null;
  if (bytes.toString('ascii', offset + 12, offset + 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(offset + 16), height: bytes.readUInt32BE(offset + 20) };
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

// Largest image found in the container, read from headers only. null means
// the format is unknown or malformed, and the icon is dropped.
function imageDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 10) return null;
  const png = pngSize(bytes);
  if (png) return png;
  if (bytes.toString('ascii', 0, 3) === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.toString('ascii', 0, 2) === 'BM' && bytes.length >= 26) return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
  const jpeg = jpegSize(bytes);
  if (jpeg) return jpeg;
  // ICO: every directory entry may embed a PNG or a BMP (DIB) image.
  if (bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
    const count = bytes.readUInt16LE(4);
    if (!count || count > 64 || bytes.length < 6 + count * 16) return null;
    let width = 0;
    let height = 0;
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 16;
      const offset = bytes.readUInt32LE(entry + 12);
      if (offset + 16 > bytes.length) return null;
      const embedded = pngSize(bytes, offset);
      const size = embedded || { width: Math.abs(bytes.readInt32LE(offset + 4)), height: Math.abs(bytes.readInt32LE(offset + 8)) / 2 };
      width = Math.max(width, size.width);
      height = Math.max(height, size.height);
    }
    return { width, height };
  }
  return null;
}

function hasSafeDimensions(bytes) {
  const size = imageDimensions(bytes);
  return Boolean(size && size.width > 0 && size.height > 0 && size.width <= MAX_FAVICON_DIMENSION && size.height <= MAX_FAVICON_DIMENSION);
}

// nativeImage decodes PNG, JPEG, GIF, BMP and ICO; anything else is dropped.
function encodeFavicon(bytes, nativeImage) {
  if (!bytes || !bytes.length || !hasSafeDimensions(bytes)) return '';
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return '';
  const dataUrl = image.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, quality: 'best' }).toDataURL();
  return isSafeFaviconDataUrl(dataUrl) ? dataUrl : '';
}

function isSafeFaviconDataUrl(value) {
  return typeof value === 'string' && value.length < MAX_DATA_URL_LENGTH && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}

module.exports = { MAX_FAVICON_BYTES, MAX_FAVICON_DIMENSION, pickFaviconUrl, fetchFaviconBytes, imageDimensions, hasSafeDimensions, encodeFavicon, isSafeFaviconDataUrl };
