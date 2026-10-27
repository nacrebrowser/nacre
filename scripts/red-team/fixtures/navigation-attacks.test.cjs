'use strict';

// Dev-only red-team fixture (not packaged). Attacks the navigation policy with
// hostile targets. Each assertion records one attack from the red-team table.

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedNavigationTarget, isAllowedNacreRequest } = require('../../../src/security-core.cjs');

const externalProtocolAttacks = [
  'file:///C:/Windows/win.ini',
  'file://attacker.example/share/x.html',
  'file:///\\\\attacker.example\\share\\x.html',
  'ms-search:query?',
  'search-ms:query=x&crumb=location:%5C%5Cattacker.example%5Cshare',
  'ms-msdt:/id PCWDiagnostic',
  'mailto:someone@example.org',
  'javascript:alert(document.cookie)',
  'data:text/html,<script>alert(1)</script>',
  'blob:https://example.org/00000000-0000-0000-0000-000000000000',
  'view-source:https://example.org/',
  'ftp://example.org/file.txt',
  'smb://attacker.example/share',
  'nacre://app/../settings/',
  'nacre://settings@attacker.example/'
];

test('red team: external and OS protocol navigations are refused from every context', () => {
  for (const value of externalProtocolAttacks) {
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: false, internalTab: false }), false, `web: ${value}`);
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: true, internalTab: false }), false, `chrome: ${value}`);
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: false, internalTab: true }), false, `internal: ${value}`);
  }
});

test('red team: a web page cannot navigate to an internal nacre page', () => {
  for (const value of ['nacre://settings/', 'nacre://downloads/', 'nacre://app/', 'nacre://tests-fuite/']) {
    assert.equal(isAllowedNavigationTarget(value, { isChromeView: false, internalTab: false }), false, value);
  }
});

test('red team: only the app chrome view may load nacre://app', () => {
  assert.equal(isAllowedNavigationTarget('nacre://app/', { isChromeView: true }), true);
  assert.equal(isAllowedNavigationTarget('nacre://settings/', { isChromeView: true }), false);
});

test('red team: fetch from a page cannot use unsafe methods against internal pages', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    assert.equal(isAllowedNacreRequest('nacre://settings/settings.js', method), false, method);
  }
  assert.equal(isAllowedNacreRequest('nacre://settings:8080/settings.js', 'GET'), false);
  assert.equal(isAllowedNacreRequest('nacre://user:pw@settings/settings.js', 'GET'), false);
});

test('red team: control characters in navigation strings are refused', () => {
  assert.equal(isAllowedNavigationTarget('nacre://settings/\n', { internalTab: true }), false);
  assert.equal(isAllowedNavigationTarget('nacre://settings/\u0000x', { internalTab: true }), false);
  assert.equal(isAllowedNavigationTarget(' nacre://settings/', { internalTab: true }), false);
});
