'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedNavigationTarget, isAllowedNacreRequest } = require('../../../src/security-core.cjs');

const hostilePaths = [
  '/../settings.js',
  '/%2e%2e/settings.js',
  '/%252e%252e/settings.js',
  '/foo%2f..%2fsettings.js',
  '/foo\\..\\settings.js',
  '/settings.js%00.html',
  '/%zz'
];

test('red team: hostile local nacre paths are refused while canonical assets remain reachable', () => {
  for (const path of hostilePaths) {
    const value = `nacre://settings${path}`;
    assert.equal(isAllowedNacreRequest(value, 'GET'), false, `request: ${value}`);
    assert.equal(isAllowedNavigationTarget(value, { internalTab: true }), false, `navigation: ${value}`);
  }
  assert.equal(isAllowedNacreRequest('nacre://settings/settings.js', 'GET'), true);
  assert.equal(isAllowedNavigationTarget('nacre://settings/', { internalTab: true }), true);
});
