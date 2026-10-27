'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeURL, sanitizeStoredProxy, sanitizeSiteZoom, isGitHubRepository, compareVersions, searchURL } = require('../src/url-policy.cjs');

test('safeURL keeps plain web addresses only', () => {
  assert.equal(safeURL('https://example.org/a'), 'https://example.org/a');
  assert.equal(safeURL('http://192.168.1.1:8080/'), 'http://192.168.1.1:8080/');
  assert.equal(safeURL('https://user:pw@example.org/'), null);
  assert.equal(safeURL('javascript:alert(1)'), null);
  assert.equal(safeURL('file:///C:/x'), null);
  assert.equal(safeURL('https://example.org/' + 'a'.repeat(9000)), null);
});

test('stored proxy and zoom values are sanitised', () => {
  assert.equal(sanitizeStoredProxy({ enabled: true, host: 'bad host', port: 1080 }).enabled, false);
  assert.deepEqual(sanitizeStoredProxy({ enabled: true, host: 'Proxy.Example', port: '9050', type: 'socks5' }).host, 'proxy.example');
  assert.equal(sanitizeStoredProxy({ enabled: true, host: 'proxy.example', port: 70000 }).enabled, false);
  assert.deepEqual(sanitizeSiteZoom({ 'Example.org': 125, '..bad': 110, 'x.org': 900 }), { 'example.org': 125 });
});

test('versions compare as semver, so 0.9.5 is newer than the old 0.9.4-3', () => {
  assert.equal(compareVersions('0.9.4-3', '0.9.5'), -1);
  assert.equal(compareVersions('0.9.5', '0.9.4'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('0.9.4.3', 'x'), null);
  assert.equal(isGitHubRepository('nacre/browser'), true);
  assert.equal(isGitHubRepository('../etc'), false);
});

test('search addresses follow the selected engine and validate custom templates', () => {
  assert.equal(searchURL('a b', 'qwant'), 'https://www.qwant.com/?q=a%20b');
  assert.equal(searchURL('x', 'unknown'), 'https://duckduckgo.com/?q=x');
  assert.equal(searchURL('x', 'custom', 'https://search.example/?q=%s'), 'https://search.example/?q=x');
  assert.equal(searchURL('x', 'custom', 'javascript:%s'), 'https://duckduckgo.com/?q=x');
  assert.equal(searchURL('x', 'custom', 'https://search.example/'), 'https://duckduckgo.com/?q=x');
});
