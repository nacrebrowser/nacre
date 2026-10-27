'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hostFromUrl,
  siteForHost,
  shouldBlockRequestCookies
} = require('../src/cookie-policy.cjs');
const { cookieContextForRequest } = require('../src/cookie-policy.cjs');
const { cookieRemovalUrl } = require('../src/cookie-policy.cjs');

test('cookie purge URLs support bare and bracketed IPv6, HTTPS and cookie paths', () => {
  for (const [domain, expected] of [
    ['::1', '[::1]'], ['[::1]', '[::1]'], ['2001:0DB8:0:0:0:0:0:1', '[2001:db8::1]'],
    ['127.0.0.1', '127.0.0.1'], ['.example.com', 'example.com']
  ]) {
    for (const secure of [false, true]) {
      const url = cookieRemovalUrl({ domain, secure, path: '/account' });
      assert.equal(url, `${secure ? 'https' : 'http'}://${expected}/account`);
    }
  }
  for (const domain of ['', 'example.com/path', 'evil.test@real.test', 'example.com:1234']) assert.throws(() => cookieRemovalUrl({ domain }));
});

test('cookie sites use registrable domains and preserve IP hosts', () => {
  assert.equal(hostFromUrl('https://A.Example.test/path'), 'a.example.test');
  assert.equal(siteForHost('a.example.com'), 'example.com');
  assert.equal(siteForHost('127.0.0.1'), '127.0.0.1');
});

test('nested requests are classified against the top frame, not their immediate initiator', () => {
  const nested = {
    requestUrl: 'https://nested.test/resource',
    resourceType: 'xhr',
    topFrameOrigin: 'https://first.test',
    tabUrl: 'https://first.test/top',
    initiatorOrigin: 'https://nested.test'
  };
  assert.equal(shouldBlockRequestCookies('block-third-party', nested), true);
  assert.equal(shouldBlockRequestCookies('allow', nested), false);
  assert.equal(shouldBlockRequestCookies('block-all', nested), true);
});

test('same-scheme subdomains and workers with a proven top-level site remain allowed', () => {
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    requestUrl: 'https://cdn.example.com/data',
    resourceType: 'xhr',
    topFrameOrigin: 'https://www.example.com'
  }), false);

  assert.equal(shouldBlockRequestCookies('block-third-party', {
    requestUrl: 'https://worker.example/data',
    resourceType: 'xhr',
    topFrameOrigin: 'https://worker.example',
    initiatorOrigin: 'https://worker.example'
  }), false);
});

test('missing request context fails closed except for top-level navigation', () => {
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    requestUrl: 'https://example.test/data',
    resourceType: 'xhr'
  }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    requestUrl: 'https://example.test/',
    resourceType: 'mainFrame',
    tabUrl: 'https://old.test/'
  }), false);
});

test('detached worker initiators cannot prove the top-level cookie site', () => {
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    requestUrl: 'https://nested.test/observe-worker',
    resourceType: 'xhr',
    initiatorOrigin: 'https://nested.test'
  }), true);
});

test('cookie policy distinguishes schemes and normalizes WebSocket schemes', () => {
  const context = { resourceType: 'xhr', topFrameOrigin: 'http://www.example.test' };
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...context, requestUrl: 'https://api.example.test/resource'
  }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...context, requestUrl: 'ws://api.example.test/socket'
  }), false);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...context, requestUrl: 'wss://api.example.test/socket'
  }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    resourceType: 'webSocket', topFrameOrigin: 'https://www.example.test',
    requestUrl: 'wss://api.example.test/socket'
  }), false);
});

test('a cross-site or opaque ancestor keeps A to B to A requests third-party', () => {
  const base = { requestUrl: 'https://first.test/resource', resourceType: 'xhr', topFrameOrigin: 'https://first.test' };
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...base, ancestorOrigins: ['https://first.test', 'https://middle.test', 'https://first.test']
  }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...base, ancestorOrigins: ['https://first.test', 'null', 'https://first.test']
  }), true);
  assert.equal(shouldBlockRequestCookies('block-third-party', {
    ...base, ancestorOrigins: ['https://first.test', 'https://first.test']
  }), false);
});

test('frame context includes ancestors and ignores the document being replaced during navigation', () => {
  const top = { origin: 'https://first.test', parent: null };
  top.top = top;
  const parent = { origin: 'https://middle.test', parent: top, top };
  const leaf = { origin: 'https://first.test', parent, top };
  const request = { url: 'https://first.test/data', resourceType: 'xhr', frame: leaf };
  assert.equal(shouldBlockRequestCookies('block-third-party', cookieContextForRequest(request)), true);
  assert.deepEqual(cookieContextForRequest({ ...request, resourceType: 'subFrame' }).ancestorOrigins,
    ['https://middle.test', 'https://first.test']);
  // A first-party iframe navigation must not inherit its old cross-site origin.
  const oldFrame = { origin: 'https://old.test', parent: top, top };
  assert.equal(shouldBlockRequestCookies('block-third-party', cookieContextForRequest({
    ...request, resourceType: 'subFrame', frame: oldFrame
  })), false);
});

test('destroyed and cyclic frame ancestry fails closed', () => {
  const top = { origin: 'https://first.test', parent: null };
  top.top = top;
  const frame = { origin: 'https://first.test', parent: top, top };
  frame.parent = frame;
  const request = { url: 'https://first.test/data', resourceType: 'xhr', frame };
  assert.equal(shouldBlockRequestCookies('block-third-party', cookieContextForRequest(request)), true);
  Object.defineProperty(request, 'frame', { get() { throw new Error('frame destroyed'); } });
  assert.equal(shouldBlockRequestCookies('block-third-party', cookieContextForRequest(request, 'https://first.test')), true);
});
