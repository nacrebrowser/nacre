'use strict';

// Dev-only red-team fixture (not packaged). Attacks site-permission storage with
// prototype-polluting host keys sent over the nacre:set-site-permission channel.

const test = require('node:test');
const assert = require('node:assert/strict');
const { permissionModeFor, setPermissionPolicy } = require('../../../src/privacy-core.cjs');

const permissions = ['camera', 'microphone', 'geolocation', 'notifications'];

test('red team: __proto__ host key cannot grant a permission to any host', () => {
  const store = {};
  setPermissionPolicy(store, '__proto__', 'camera', 'allow');
  // Global prototype must stay clean.
  assert.equal(Object.prototype.camera, undefined, 'Object.prototype polluted');
  assert.equal(({}).camera, undefined, 'plain objects polluted');
  for (const host of ['example.org', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    for (const permission of permissions) {
      assert.equal(permissionModeFor(store, host, permission), 'deny', `${host}/${permission}`);
    }
  }
  assert.equal(JSON.stringify(store), '{}', 'a __proto__ write must not persist as data');
  assert.equal(Object.getPrototypeOf(store), Object.prototype, 'store prototype was replaced');
});

test('red team: constructor and toString host keys resolve only to own entries', () => {
  const store = {};
  for (const host of ['constructor', 'toString', 'valueOf']) {
    for (const permission of permissions) {
      assert.equal(permissionModeFor(store, host, permission), 'deny', `${host}/${permission}`);
      assert.equal(permissionModeFor(store, host, 'constructor'), 'deny', `${host}/constructor`);
    }
  }
});

test('red team: inherited permission keys on own host entries are refused', () => {
  const store = { 'example.org': Object.create({ camera: 'allow' }) };
  assert.equal(permissionModeFor(store, 'example.org', 'camera'), 'deny');
});

test('red team: garbage permission modes never grant access', () => {
  for (const value of ['yes', true, 1, { mode: 'allow' }, null, 'ALLOW']) {
    const store = { 'example.org': { camera: value } };
    assert.equal(permissionModeFor(store, 'example.org', 'camera'), 'deny', String(value));
  }
});
