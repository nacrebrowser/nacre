'use strict';

// Development-only red-team fixtures. Each test records one attack hypothesis
// against the pure validators that sit behind the privileged IPC handlers.
// Result for every attack below: BLOCKED (see scripts/red-team/README.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSettingsPayload,
  validateBridgeLines,
  torStoppedErrorUrl,
  torStartupResumeUrl,
  isValidCircuitLimit,
  permissionModeFor
} = require('../../../src/privacy-core.cjs');

const GOOD_OBFS4 = 'obfs4 192.0.2.10:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=AAAA iat-mode=0';

test('attack: prototype-key smuggling through a JSON settings payload is rejected', () => {
  // JSON.parse keeps __proto__ and constructor as own keys; the allow-list must refuse them.
  assert.equal(validateSettingsPayload(JSON.parse('{"__proto__":{"polluted":true}}')), false);
  assert.equal(validateSettingsPayload(JSON.parse('{"constructor":{"prototype":{}}}')), false);
  assert.equal(({}).polluted, undefined);
});

test('attack: control characters and CR/NUL injection inside bridge lines are rejected', () => {
  assert.equal(validateBridgeLines('obfs4', `${GOOD_OBFS4}\rExtra`).valid, false);
  assert.equal(validateBridgeLines('obfs4', `${GOOD_OBFS4}\u0000`).valid, false);
  assert.equal(validateBridgeLines('obfs4', `${GOOD_OBFS4}\u007f`).valid, false);
});

test('attack: oversized bridge payloads are refused before parsing', () => {
  const huge = `obfs4 192.0.2.10:443 ${'A'.repeat(1100)}`;
  assert.equal(validateBridgeLines('custom', huge).valid, false);
  const flood = Array.from({ length: 9 }, () => GOOD_OBFS4).join('\n');
  assert.equal(validateBridgeLines('obfs4', flood).valid, false);
});

test('attack: a bridge line with an unknown option token cannot smuggle Tor arguments', () => {
  const smuggled = `${GOOD_OBFS4} SocksPort=0.0.0.0:9050`;
  assert.equal(validateBridgeLines('obfs4', smuggled).valid, false);
});

test('attack: javascript:, file: and nacre: targets never become a retry URL after a Tor failure', () => {
  for (const hostile of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'nacre://settings/', 'data:text/html,<script>1</script>']) {
    assert.equal(torStartupResumeUrl(hostile), '', hostile);
    assert.equal(torStoppedErrorUrl(hostile), 'nacre://error/?reason=tor-stopped', hostile);
  }
});

test('attack: an oversized error-page parameter falls back to the fixed error URL', () => {
  assert.equal(torStoppedErrorUrl(`https://a.example/?q=${'x'.repeat(5000)}`), 'nacre://error/?reason=tor-stopped');
});

test('attack: circuit-limit values outside 1..16 or non-integers are refused', () => {
  assert.equal(isValidCircuitLimit(0), false);
  assert.equal(isValidCircuitLimit(17), false);
  assert.equal(isValidCircuitLimit(1e9), false);
  assert.equal(isValidCircuitLimit(1.5), false);
  assert.equal(isValidCircuitLimit('16'), false);
});

test('attack: a forged permission value in stored settings is treated as deny', () => {
  assert.equal(permissionModeFor({ 'example.org': { camera: 'grant-all' } }, 'example.org', 'camera'), 'deny');
  assert.equal(permissionModeFor({ 'example.org': { camera: ['allow'] } }, 'example.org', 'camera'), 'deny');
});
