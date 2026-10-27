'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomain } = require('tldts-experimental');
const {
  registrableDomain,
  socksToken,
  isValidCircuitLimit,
  isAllowedPermissionMode,
  permissionModeFor,
  setPermissionPolicy,
  validateBridgeLines,
  validateSettingsPayload,
  shouldFailClosed,
  torStoppedErrorUrl,
  torStartupResumeUrl,
  stripTrackingParameters,
  createCircuitBudget
} = require('../src/privacy-core.cjs');
const { buildTorBridgeArguments } = require('../src/tor-bridge-config.cjs');

test('registrable domains use the public suffix list, including co.uk', () => {
  assert.equal(registrableDomain('a.b.example.co.uk', (host) => getDomain(host, { allowPrivateDomains: true })), 'example.co.uk');
  assert.equal(registrableDomain('shop.example.com', (host) => getDomain(host, { allowPrivateDomains: true })), 'example.com');
  assert.equal(registrableDomain('invalid host', getDomain), '');
});

test('SOCKS credentials are stable per domain and distinct by domain/session', () => {
  const first = Buffer.alloc(32, 1);
  const second = Buffer.alloc(32, 2);
  const a = socksToken('example.co.uk', first);
  assert.equal(socksToken('example.co.uk', first), a);
  assert.notEqual(socksToken('other.co.uk', first), a);
  assert.notEqual(socksToken('example.co.uk', second), a);
});

test('IPC preference payloads and permission modes are constrained', () => {
  assert.equal(validateSettingsPayload({ theme: 'dark', showBookmarksBar: true, sendDnt: false }), true);
  assert.equal(validateSettingsPayload({ command: 'nacre:arbitrary' }), false);
  assert.equal(validateSettingsPayload([]), false);
  assert.equal(isAllowedPermissionMode('ask'), true);
  assert.equal(isAllowedPermissionMode('grant-all'), false);
  assert.equal(permissionModeFor({}, 'example.org', 'media'), 'deny');
  assert.equal(permissionModeFor({ 'example.org': { media: 'ask' } }, 'example.org', 'media'), 'ask');
  assert.equal(permissionModeFor({ 'example.org': { media: 'invalid' } }, 'example.org', 'media'), 'deny');
});

test('site permissions never resolve or write inherited Object.prototype keys', () => {
  // "constructor" is a valid single-label host; it must not reach Object.prototype.constructor.
  const before = Object.camera;
  assert.equal(permissionModeFor({}, 'constructor', 'camera'), 'deny');
  const policies = {};
  setPermissionPolicy(policies, 'constructor', 'camera', 'allow');
  assert.equal(Object.camera, before);
  assert.equal(Object.hasOwn(policies, 'constructor'), true);
  assert.deepEqual({ ...policies.constructor }, { camera: 'allow' });
  assert.equal(Object.getPrototypeOf(policies.constructor), null);
  assert.equal(permissionModeFor(policies, 'constructor', 'camera'), 'allow');
  assert.equal(permissionModeFor(policies, 'constructor', 'microphone'), 'deny');
  assert.equal(permissionModeFor(policies, 'example.org', 'camera'), 'deny');
});

test('a corrupted stored permission entry is replaced rather than crashing the write', () => {
  const policies = { 'example.org': 'allow' };
  setPermissionPolicy(policies, 'example.org', 'media', 'ask');
  assert.deepEqual({ ...policies['example.org'] }, { media: 'ask' });
  assert.equal(permissionModeFor(policies, 'example.org', 'media'), 'ask');
});

test('kill-switch simulation fails closed while Tor is configured but unavailable', () => {
  assert.equal(shouldFailClosed(true, false), true);
  assert.equal(shouldFailClosed(true, true), false);
  assert.equal(shouldFailClosed(false, false), false);
});

test('unexpected Tor exit opens a local recovery page and only retains safe HTTP(S) retry targets', () => {
  assert.equal(torStoppedErrorUrl('https://www.youtube.com/watch?v=abc'), 'nacre://error/?reason=tor-stopped&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc');
  assert.equal(torStoppedErrorUrl('https://user:secret@example.org/'), 'nacre://error/?reason=tor-stopped');
  assert.equal(torStoppedErrorUrl('file:///C:/private.txt'), 'nacre://error/?reason=tor-stopped');
  assert.equal(torStoppedErrorUrl('x'.repeat(4097)), 'nacre://error/?reason=tor-stopped');
});

test('Tor startup resumes the pending web URL behind an internal error page', () => {
  assert.equal(torStartupResumeUrl({ internal: true, url: 'nacre://error/?code=-130', torResumeUrl: 'https://www.youtube.com/watch?v=example' }), 'https://www.youtube.com/watch?v=example');
  assert.equal(torStartupResumeUrl({ internal: false, url: 'https://example.org/' }), 'https://example.org/');
  assert.equal(torStartupResumeUrl({ internal: true, url: 'nacre://error/?code=-130' }), '');
  assert.equal(torStartupResumeUrl({ internal: false, url: 'file:///secret' }), '');
  assert.equal(torStartupResumeUrl({ internal: false, url: 'https://user:password@example.org/' }), '');
});

test('tracking query parameters are removed without deleting ordinary query values', () => {
  assert.equal(stripTrackingParameters('https://example.org/p?utm_source=news&q=privacy&fbclid=abc#part'), 'https://example.org/p?q=privacy#part');
});

test('circuit budget evicts oldest idle identity, refuses when every identity is active', () => {
  const budget = createCircuitBudget(2);
  const evicted = [];
  assert.equal(budget.ensure('a', (token) => evicted.push(token)), true);
  budget.enter('a');
  assert.equal(budget.ensure('b', (token) => evicted.push(token)), true);
  budget.enter('b');
  assert.equal(budget.ensure('c'), false);
  budget.leave('a');
  assert.equal(budget.ensure('c'), true);
  assert.deepEqual(evicted, ['a']);
  assert.equal(isValidCircuitLimit(16), true);
  assert.equal(isValidCircuitLimit(17), false);
});

test('Tor bridge definitions validate obfs4 and Snowflake fields and reject invalid/mismatched lines', () => {
  const obfs4 = 'obfs4 37.218.245.14:38224 D9A82D2F9C2F65A18407B1D2B764F130847F8B5D cert=bjRaMrr1BRiAW8IE9U5z27fQaYgOhX1UCmOpg2pFpoMvo6ZgQMzLsaTzzQNTlm7hNcb+Sg iat-mode=0';
  const snowflake = 'snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=2B280B23E1107BB62ABFC40DDCC8824814F80A72 url=https://1098762253.rsc.cdn77.org/ fronts=app.datapacket.com ice=stun:stun.example.net:3478';
  assert.equal(validateBridgeLines('obfs4', obfs4).valid, true);
  assert.equal(validateBridgeLines('snowflake', snowflake).valid, true);
  assert.equal(validateBridgeLines('custom', obfs4 + '\n' + snowflake).valid, true);
  assert.equal(validateBridgeLines('custom', '').valid, false);
  assert.equal(validateBridgeLines('obfs4', snowflake).valid, false);
  assert.equal(validateBridgeLines('obfs4', obfs4.replace('38224', '99999')).valid, false);
  const args = buildTorBridgeArguments('custom', obfs4 + '\n' + snowflake, 'C:\\Nacre\\pluggable_transports\\lyrebird.exe');
  assert.equal(args.filter((item) => item === '--Bridge').length, 2);
  assert.equal(args.filter((item) => item === '--ClientTransportPlugin').length, 2);
  assert.ok(args.includes('--UseBridges'));
  assert.throws(() => buildTorBridgeArguments('custom', '', 'lyrebird.exe'), /au moins une ligne/);
  assert.deepEqual(buildTorBridgeArguments('none', '', ''), []);
});
