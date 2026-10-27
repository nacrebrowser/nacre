'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterContext, registerRequestFilter } = require('../src/request-filter-context.cjs');
const { shouldAllowHttpRequest } = require('../src/network-security.cjs');

test('a worker initiator can match domain rules but cannot prove a top-level exception', () => {
  const value = filterContext({ url: 'https://ads.test/pixel', resourceType: 'xhr', initiatorOrigin: 'https://worker.test', referrer: 'https://exempt.test' });
  assert.equal(value.sourceUrl, 'https://worker.test/');
  assert.equal(value.topUrl, '');
  assert.equal(value.topHost, '');
  assert.equal(value.thirdParty, null);
  assert.equal(filterContext({ url: 'https://ads.test/', initiatorOrigin: 'null', referrer: 'https://exempt.test' }).sourceUrl, '');
});

test('native frame ancestry supplies the containing site independently from the initiating iframe', () => {
  const top = { origin: 'https://top.test', url: 'https://top.test/page', parent: null }; top.top = top;
  const child = { origin: 'https://child.test', url: 'https://child.test/frame', top, parent: top };
  const value = filterContext({ url: 'https://top.test/script', resourceType: 'script', frame: child });
  assert.equal(value.sourceUrl, 'https://child.test/frame');
  assert.equal(value.topUrl, 'https://top.test/');
  assert.equal(value.thirdParty, false);
});

test('a second request-hook registration or unregistration cannot silently replace the policy', () => {
  let active, calls = 0;
  const request = { onBeforeRequest(_filter, fn) { active = fn; calls++; } };
  const policy = (_details, callback) => callback({ cancel: true });
  registerRequestFilter(request, { urls: ['https://*/*'] }, policy);
  assert.throws(() => request.onBeforeRequest(null), /Nacre owns/);
  assert.throws(() => { request.onBeforeRequest = () => {}; }, TypeError);
  assert.throws(() => registerRequestFilter(request, {}, () => {}), /already registered/);
  let decision; active({}, value => { decision = value; });
  assert.equal(calls, 1); assert.deepEqual(decision, { cancel: true });
});

test('HTTPS-only covers plaintext WebSocket and ties any exception to the accepted document', () => {
  assert.equal(shouldAllowHttpRequest('ws://socket.test/live', true, '', ''), false);
  assert.equal(shouldAllowHttpRequest('wss://socket.test/live', true, '', ''), true);
  assert.equal(shouldAllowHttpRequest('ws://socket.test/live', true, 'http://page.test/', 'http://page.test/'), true);
  assert.equal(shouldAllowHttpRequest('ws://socket.test/live', true, 'http://page.test/', 'https://page.test/'), false);
});
