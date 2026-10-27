'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { INTERNAL_SECURITY_HEADERS, secureInternalResponse, internalErrorResponse } = require('../src/internal-response.cjs');

for (const [status, message] of [[403, 'Forbidden'], [404, 'Not found'], [500, 'Unavailable']]) {
  test(`internal ${status} responses retain the security header set`, async () => {
    const response = await internalErrorResponse(status, message);
    assert.equal(response.status, status);
    for (const [name, value] of Object.entries(INTERNAL_SECURITY_HEADERS)) assert.equal(response.headers.get(name), value);
    assert.equal(await response.text(), message);
  });
}

test('internal success responses preserve MIME headers while overriding missing security headers', async () => {
  const response = await secureInternalResponse(Promise.resolve(new Response('ok', { headers: { 'Content-Type': 'text/plain' } })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain');
  for (const [name, value] of Object.entries(INTERNAL_SECURITY_HEADERS)) assert.equal(response.headers.get(name), value);
});

test('internal HEAD and rejected file loaders remain secure and bodyless for HEAD', async () => {
  const head = await internalErrorResponse(404, 'not found', 'HEAD');
  assert.equal(head.body, null);
  for (const [name, value] of Object.entries(INTERNAL_SECURITY_HEADERS)) assert.equal(head.headers.get(name), value);
  const failedLoader = await secureInternalResponse(Promise.reject(new Error('fixture path')), 'GET');
  assert.equal(failedLoader.status, 500);
  for (const [name, value] of Object.entries(INTERNAL_SECURITY_HEADERS)) assert.equal(failedLoader.headers.get(name), value);
});
