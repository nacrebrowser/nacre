'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { closedProxyConfig, chromiumPrivacySwitches, shouldAllowHttpRequest } = require('../src/network-security.cjs');
const { cookieContextForRequest, shouldBlockRequestCookies } = require('../src/cookie-policy.cjs');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');

test('closed proxy explicitly subtracts Chromium implicit loopback bypass', () => {
  assert.deepEqual(closedProxyConfig(), {
    mode: 'fixed_servers',
    proxyRules: 'http=127.0.0.1:1;https=127.0.0.1:1;socks=127.0.0.1:1',
    proxyBypassRules: '<-loopback>'
  });
  assert.match(main, /appendSwitch\('proxy-server', `\$\{CLOSED_PROXY_HOST\}:\$\{CLOSED_PROXY_PORT\}`\)/);
  assert.match(main, /await setSessionProxy\(ses, route\);[\s\S]*?setSpellCheckerEnabled\(false\)/);
  assert.match(main, /await prepareBrowserSession\(ses, settings\.torCountry && torRuntime/);
  assert.match(main, /await prepareWorkspaceSessions\(\)/);
});

test('Tor stop simulation keeps sessions on a proxy instead of switching to direct/system', () => {
  const torDownConfig = { mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' };
  assert.equal(torDownConfig.mode, 'fixed_servers');
  assert.match(torDownConfig.proxyRules, /127\.0\.0\.1:1$/);
  assert.notEqual(torDownConfig.mode, 'direct');
  assert.match(main, /handleUnexpectedTorExit[\s\S]*?setSessionProxy\(ses, torProxyConfig\(1\)\)/);
  assert.match(main, /effectiveProxyConfig[\s\S]*?torProxyConfig\(runtime && runtime\.country === requiredCountry \? runtime\.port : 1\)/);
  assert.match(main, /catch \{\s*await waitForAll\(sessions\.map\(\(ses\) => setSessionProxy\(ses, effectiveProxyConfig\(previous, previousTorCountry\)\)\.catch\(\(\) => \{\}\)\)\)/);
});

test('Chromium background network and speculative transports are disabled by startup switches', () => {
  const switches = chromiumPrivacySwitches().map(([name, value]) => value ? `${name}=${value}` : name);
  for (const expected of [
    'disable-background-networking', 'disable-component-update', 'disable-sync',
    'disable-default-apps', 'no-pings', 'disable-breakpad',
    'disable-domain-reliability', 'disable-quic', 'disable-preconnect',
    'disable-prerender-local-predictor', 'dns-prefetch-disable'
  ]) assert.ok(switches.includes(expected), `${expected} must remain configured`);
  assert.match(main, /for \(const \[name, value\] of chromiumPrivacySwitches\(\)\) app\.commandLine\.appendSwitch\(name, value\)/);
  assert.match(main, /spellcheck: false/);
  assert.match(main, /proxyBypassRules: '<-loopback>'/);
  assert.match(main, /app\.configureHostResolver\(hostResolverOptions\(torActive, settings\.secureDnsMode\)\)/);
  assert.deepEqual(require('../src/dns-policy.cjs').hostResolverOptions(false, 'strict'), { secureDnsMode: 'secure', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
  assert.match(main, /function proxyConfig\(proxy, directMode = settings\.directMode\)[\s\S]*?if \(!proxy\.enabled\) return directMode \? \{ mode: 'system' \} : closedProxyConfig\(\)/);
});

test('third-party cookie policy fails closed without a usable initiator except for top-level navigation', () => {
  for (const resourceType of ['subFrame', 'script', 'xhr', 'fetch', 'worker', 'serviceWorker', 'stylesheet', 'image', 'other']) {
    assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/pixel', resourceType }), true, `missing context ${resourceType}`);
  }
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/', resourceType: 'mainFrame' }), false);
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://first.test/a', tabUrl: 'https://first.test/', resourceType: 'script' }), false);
  assert.equal(shouldBlockRequestCookies('block-third-party', { requestUrl: 'https://third.test/a', tabUrl: 'https://first.test/', resourceType: 'script' }), true);
  assert.equal(shouldBlockRequestCookies('block-all', { resourceType: 'mainFrame' }), true);
  assert.equal(shouldBlockRequestCookies('allow', { resourceType: 'xhr' }), false);
});

test('HTTP is blocked by default and only allowed after the page warning for that document', () => {
  assert.equal(shouldAllowHttpRequest('http://example.org/', true, '', ''), false);
  assert.equal(shouldAllowHttpRequest('https://example.org/', true, '', ''), true);
  assert.equal(shouldAllowHttpRequest('http://example.org/a', true, 'http://example.org/a', 'http://example.org/a', true), true);
  assert.equal(shouldAllowHttpRequest('http://example.org/next', true, 'http://example.org/a', 'http://example.org/a', true), false);
  assert.equal(shouldAllowHttpRequest('http://cdn.example.org/a.js', true, 'http://example.org/a', 'http://example.org/a'), true);
  assert.equal(shouldAllowHttpRequest('http://example.org/a', true, 'http://example.org/a', 'https://example.org/', true), false);
  assert.equal(shouldAllowHttpRequest('http://example.org/', false, '', ''), true);
  assert.match(main, /will-frame-navigate[\s\S]*?warnBeforeHttpNavigation/);
  assert.match(main, /will-redirect[\s\S]*?warnBeforeHttpNavigation/);
  assert.match(main, /if \(!httpAllowed\) \{[\s\S]*?callback\(\{ cancel: true \}\)/);
  // Policy selection now supports site overrides. Check the effective decision
  // behaviorally; real request/response hooks are covered by the HTTPS/WSS/SW
  // site-controls probe, rather than counting a particular source spelling.
  const { siteCookiePolicy, detachedCookiePolicy } = require('../src/site-cookie-controls.cjs');
  assert.equal(shouldBlockRequestCookies(siteCookiePolicy('allow', 'example.org', {'example.org':'block-all'}), {requestUrl:'https://example.org/a',tabUrl:'https://example.org/',resourceType:'xhr'}),true);
  assert.equal(shouldBlockRequestCookies(detachedCookiePolicy('allow', {'example.org':'block-all'}), {requestUrl:'https://other.test/a',resourceType:'xhr'}),true);
  // Exercise the extracted frame-context code instead of requiring its former
  // inline spelling in main.cjs. Real HTTPS/WSS hook coverage is provided by
  // verify-cookie-policy.cjs, including A -> B -> A frame ancestry.
  const top = { origin: 'https://first.test', parent: null };
  top.top = top;
  const frame = { origin: 'https://nested.test', parent: top, top };
  const context = cookieContextForRequest({ url: 'https://nested.test/data', resourceType: 'xhr', frame });
  assert.equal(context.topFrameOrigin, top.origin);
  assert.equal(shouldBlockRequestCookies('block-third-party', context), true);
});

