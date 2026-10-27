'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verdictFor, parseBlocklist, normalizeEntry } = require('../src/phishing-guard.cjs');

test('official brand domains are allowed', () => {
  for (const url of ['https://www.paypal.com/signin', 'https://accounts.google.com/', 'https://github.com/org/repo', 'https://apple.stackexchange.com/questions/1', 'https://example.xyz/article']) {
    assert.equal(verdictFor(url).action, 'allow', url);
  }
});

test('brand impersonation and risky combinations are flagged', () => {
  for (const url of [
    'https://paypal-secure-login.com/',
    'https://paypal.com.evil.example/login',
    'https://login.secure.account.paypal.evil.example/',
    'https://microsoft-support.xyz/',
    'https://login.xyz/'
  ]) {
    const verdict = verdictFor(url);
    assert.equal(verdict.action, 'warn', url);
    assert.ok(verdict.reasons.length > 0, url);
  }
});

test('encoded domains and raw addresses are flagged', () => {
  assert.deepEqual(verdictFor('https://xn--pple-43d.com/').reasons.includes('idn'), true);
  assert.deepEqual(verdictFor('http://192.0.2.10/login').reasons.includes('ip-literal'), true);
});

test('the local list matches exact hosts, subdomains and path prefixes', () => {
  const blocklist = '# local entries\nbad.example\nhttps://phish.example/login\n*.wild.example';
  assert.equal(verdictFor('https://bad.example/', { blocklist }).blocked, true);
  assert.equal(verdictFor('https://deep.bad.example/', { blocklist }).blocked, true);
  assert.equal(verdictFor('https://phish.example/login/step', { blocklist }).blocked, true);
  assert.equal(verdictFor('https://phish.example/other', { blocklist }).blocked, false);
  assert.equal(verdictFor('https://sub.wild.example/', { blocklist }).blocked, true);
  assert.equal(verdictFor('https://notbad.example/', { blocklist }).blocked, false);
});

test('the list parser is bounded, deduplicated and rejects malformed entries', () => {
  const entries = parseBlocklist('bad.example\nBAD.example\nhttp://bad.example/path\nnot a host\n' + 'x'.repeat(400));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => [entry.host, entry.path]), [['bad.example', ''], ['bad.example', '/path']]);
  assert.equal(normalizeEntry('http://'), null);
  assert.equal(normalizeEntry('https://user:pass@bad.example/'), null);
});

test('disabled checks and non-web URLs are allowed', () => {
  assert.equal(verdictFor('https://paypal-secure-login.com/', { enabled: false }).action, 'allow');
  assert.equal(verdictFor('nacre://settings/').action, 'allow');
  assert.equal(verdictFor('file:///etc/passwd').action, 'allow');
  assert.equal(verdictFor('not a url').action, 'allow');
});
