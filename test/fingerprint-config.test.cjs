'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChromeUserAgent, buildChromeUserAgentMetadata, buildClientHintHeaders, applyPrivacySignals } = require('../src/fingerprint-config.cjs');

test('Chrome UA is reduced to Chromium major and contains no Nacre or Electron token', () => {
  const userAgent = buildChromeUserAgent('152.0.7977.130');
  assert.equal(userAgent, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  assert.doesNotMatch(userAgent, /Nacre|Electron/i);
});

test('la préférence Accept-Language Chromium inclut la liste en-US,en avant le démarrage', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  assert.match(source, /app\.commandLine\.appendSwitch\('lang', 'en-US'\);[\s\S]*?app\.whenReady\(\)/);
});

test('Client Hints agree with the reduced Chrome UA and expose Google Chrome', () => {
  const metadata = buildChromeUserAgentMetadata('152.0.7977.130');
  const headers = buildClientHintHeaders('152.0.7977.130');
  assert.deepEqual(metadata.brands, [
    { brand: 'Not_A Brand', version: '99' },
    { brand: 'Chromium', version: '152' },
    { brand: 'Google Chrome', version: '152' }
  ]);
  assert.match(headers['Sec-CH-UA'], /"Google Chrome";v="152"/);
  assert.equal(headers['Sec-CH-UA-Mobile'], '?0');
  assert.equal(headers['Sec-CH-UA-Platform'], '"Windows"');
  assert.equal(headers['Sec-CH-UA-Form-Factors'], '"Desktop"');
});

test('invalid Chromium major version is rejected', () => {
  assert.throws(() => buildChromeUserAgent('unknown'), /Version Chromium invalide/);
});

test('GPC is sent by default while the rare DNT header stays disabled', () => {
  assert.deepEqual(applyPrivacySignals({ DNT: '1', 'Sec-GPC': '0' }, {}), { 'Sec-GPC': '1' });
  assert.deepEqual(applyPrivacySignals({}, { sendGpc: true, sendDnt: true }), { 'Sec-GPC': '1', DNT: '1' });
});
