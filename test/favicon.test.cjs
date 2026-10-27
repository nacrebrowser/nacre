'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_FAVICON_BYTES, pickFaviconUrl, fetchFaviconBytes, encodeFavicon, isSafeFaviconDataUrl, imageDimensions, hasSafeDimensions } = require('../src/favicon.cjs');
const { readBoundedBody } = require('../src/hardening-core.cjs');

test('favicons are only taken from the page own origin', () => {
  // Another subdomain or port could resolve to a local network address (SSRF).
  assert.equal(pickFaviconUrl(['https://cdn.github.com/icon.png'], 'https://github.com/x'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['https://github.com:8443/icon.png'], 'https://github.com/x'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['https://github.com/icon.png'], 'https://github.com/x'), 'https://github.com/icon.png');
  assert.equal(pickFaviconUrl(['https://tracker.example/pixel.png'], 'https://github.com/'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['/static/icon.png'], 'https://news.ycombinator.com/item'), 'https://news.ycombinator.com/static/icon.png');
  assert.equal(pickFaviconUrl([], 'http://192.168.1.1/'), 'http://192.168.1.1/favicon.ico');
  assert.equal(pickFaviconUrl([], 'http://[::1]:8080/'), 'http://[::1]:8080/favicon.ico');
  // DNS rebinding: a name served over HTTP could re-resolve to a private address.
  assert.equal(pickFaviconUrl(['/icon.png'], 'http://lemonde.fr/'), '');
});

test('favicon selection rejects downgrades, credentials and non-web pages', () => {
  assert.equal(pickFaviconUrl(['http://github.com/icon.png'], 'https://github.com/'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['https://user:pw@github.com/icon.png'], 'https://github.com/'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['data:image/png;base64,AAAA'], 'https://github.com/'), 'https://github.com/favicon.ico');
  assert.equal(pickFaviconUrl(['https://github.com/a.png'], 'nacre://settings/'), '');
  assert.equal(pickFaviconUrl(['https://github.com/a.png'], 'not a url'), '');
});

function response(body, headers = {}, ok = true) {
  return new Response(body, { status: ok ? 200 : 404, headers });
}

test('favicon downloads omit cookies, refuse redirects and stay bounded', async () => {
  let init;
  const bytes = await fetchFaviconBytes(async (_url, options) => { init = options; return response(Buffer.from([1, 2, 3]), { 'content-type': 'image/png' }); }, 'https://github.com/favicon.ico', readBoundedBody);
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(await fetchFaviconBytes(async () => response('<html>', { 'content-type': 'text/html' }), 'https://a.test/', readBoundedBody), null);
  assert.equal(await fetchFaviconBytes(async () => response('x', { 'content-type': 'image/png' }, false), 'https://a.test/', readBoundedBody), null);
  assert.equal(await fetchFaviconBytes(async () => response('x', { 'content-type': 'image/png', 'content-length': String(MAX_FAVICON_BYTES + 1) }), 'https://a.test/', readBoundedBody), null);
  await assert.rejects(fetchFaviconBytes(async () => response(Buffer.alloc(MAX_FAVICON_BYTES + 10), { 'content-type': 'image/x-icon' }), 'https://a.test/', readBoundedBody), /byte limit/);
});

function pngHeader(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function icoWith(embedded) {
  const directory = Buffer.alloc(6 + 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt32LE(directory.length, 6 + 12);
  return Buffer.concat([directory, embedded]);
}

test('image dimensions are checked from headers before decoding', () => {
  assert.deepEqual(imageDimensions(pngHeader(32, 32)), { width: 32, height: 32 });
  assert.equal(hasSafeDimensions(pngHeader(16384, 16384)), false, 'decompression bomb');
  const gif = Buffer.alloc(16);
  gif.write('GIF89a', 0, 'ascii');
  gif.writeUInt16LE(16, 6);
  gif.writeUInt16LE(16, 8);
  assert.deepEqual(imageDimensions(gif), { width: 16, height: 16 });
  assert.equal(hasSafeDimensions(icoWith(pngHeader(20000, 20000))), false, 'oversized PNG inside an ICO');
  assert.equal(hasSafeDimensions(icoWith(pngHeader(48, 48))), true);
  assert.equal(hasSafeDimensions(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), false, 'unknown formats are dropped');
});

test('favicons are re-encoded as small PNG data URLs', () => {
  const fakeImage = (empty, dataUrl) => ({ isEmpty: () => empty, resize: (size) => { assert.deepEqual([size.width, size.height], [32, 32]); return { toDataURL: () => dataUrl }; } });
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(encodeFavicon(pngHeader(64, 64), { createFromBuffer: () => fakeImage(false, png) }), png);
  assert.equal(encodeFavicon(pngHeader(64, 64), { createFromBuffer: () => fakeImage(true, png) }), '');
  assert.equal(encodeFavicon(pngHeader(9000, 9000), { createFromBuffer: () => { throw new Error('must not decode'); } }), '');
  assert.equal(encodeFavicon(Buffer.alloc(0), { createFromBuffer: () => fakeImage(false, png) }), '');
  assert.equal(isSafeFaviconDataUrl('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(isSafeFaviconDataUrl('data:image/png;base64,' + 'A'.repeat(30000)), false);
  assert.equal(isSafeFaviconDataUrl('javascript:alert(1)'), false);
});

test('the chrome only renders validated PNG favicons and the blocker vets each fetch', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /function isSafeFavicon\(value\)[\s\S]*?data:image\\\/png;base64/);
  assert.match(renderer, /isSafeFavicon\(tab\.favicon\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(main, /favicon: isSafeFaviconDataUrl\(tab\.favicon\) \? tab\.favicon : ''/);
  assert.match(main, /if \(!faviconAllowedByBlocker\(tab, target\)\) return;/);
  assert.match(main, /resourceType: 'image', referrer: tab\.url/);
});
