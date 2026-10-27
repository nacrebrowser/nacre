'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLocalAddressInput } = require('../src/address-input.cjs');

test('les adresses IPv4 et localhost sont ouvertes directement', () => {
  for (const value of ['192.168.1.1', '192.168.1.254', '10.0.0.1:8080', '127.0.0.1', 'localhost', 'localhost:3000', '[::1]', '[::1]:8080/x', '8.8.8.8/path?q=1']) {
    assert.equal(isLocalAddressInput(value), true, value);
  }
});

test('les autres saisies ne sont pas des adresses locales', () => {
  for (const value of ['example.com', 'note:hello', 'hello world', '999.1.1.1', '1.2.3', '192.168.1.1.5', 'localhost.evil.com', '']) {
    assert.equal(isLocalAddressInput(value), false, value);
  }
});
