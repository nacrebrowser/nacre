'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');

// Source pin only: this asserts the proxy rule text in src/main.cjs. It does not
// prove Chromium routes IPv6 sockets through SOCKS; the NetLog IPv6 reachability
// probe remains unverified.
test('Tor session proxy is one SOCKS5 rule with loopback-only bypass, and fails closed without a ready Tor port', () => {
  assert.match(main, /function torProxyConfig\(port\) \{\n  return \{ mode: 'fixed_servers', proxyRules: 'socks5:\/\/127\.0\.0\.1:' \+ port, proxyBypassRules: '<-loopback>' \};\n\}/);
  assert.match(main, /if \(requiredCountry\) return torProxyConfig\(runtime && runtime\.country === requiredCountry \? runtime\.port : 1\);/);
  assert.match(main, /if \(shouldFailClosed\(true, Boolean\(runtime && runtime\.ready && runtime\.process && runtime\.process\.exitCode === null\)\)\) return torProxyConfig\(1\);/);
});
