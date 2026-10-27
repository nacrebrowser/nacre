'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { QUAD9_DOH, hostResolverOptions, isStrictDnsFailure } = require('../src/dns-policy.cjs');

test('Tor and proxies disable secure DNS so no direct DoH connection is opened', () => {
  assert.deepEqual(hostResolverOptions(true, 'automatic'), { secureDnsMode: 'off' });
  assert.deepEqual(hostResolverOptions(true, 'strict'), { secureDnsMode: 'off' });
});

test('direct connections use Quad9, with fallback only in automatic mode', () => {
  assert.deepEqual(hostResolverOptions(false, 'automatic'), { secureDnsMode: 'automatic', secureDnsServers: [QUAD9_DOH] });
  assert.deepEqual(hostResolverOptions(false, 'strict'), { secureDnsMode: 'secure', secureDnsServers: [QUAD9_DOH] });
  assert.equal(hostResolverOptions(false, undefined).secureDnsMode, 'automatic');
});

test('only strict direct DNS failures get the Quad9 explanation', () => {
  assert.equal(isStrictDnsFailure('ERR_NAME_NOT_RESOLVED', 'strict', false), true);
  assert.equal(isStrictDnsFailure('net::ERR_DNS_TIMED_OUT', 'strict', false), true);
  assert.equal(isStrictDnsFailure('ERR_NAME_NOT_RESOLVED', 'automatic', false), false);
  assert.equal(isStrictDnsFailure('ERR_NAME_NOT_RESOLVED', 'strict', true), false);
  assert.equal(isStrictDnsFailure('ERR_CONNECTION_REFUSED', 'strict', false), false);
});

test('the error page offers the automatic DNS fix only for strict DNS failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'error.js'), 'utf8');
  assert.match(source, /reason === 'dns-strict'/);
  assert.match(source, /savePreferences\(\{ secureDnsMode: 'automatic' \}\)/);
});
