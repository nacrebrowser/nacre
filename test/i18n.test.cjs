'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../src/i18n.cjs');
const fr = require('../src/locales/fr.json');
const en = require('../src/locales/en.json');
const localeDirectory = path.join(__dirname, '..', 'src', 'locales');
const EXPECTED_LANGUAGES = `
  de en ar zh-CN zh-TW ko es fr hi id it ja nl fa pl pt-BR ru tr uk vi
`.trim().split(/\s+/);

test('supported languages are the exact registered codes with English fallback', () => {
  assert.equal(Object.isFrozen(i18n.SUPPORTED_LANGUAGES), true);
  assert.deepEqual([...i18n.SUPPORTED_LANGUAGES], EXPECTED_LANGUAGES);
  assert.equal(new Set(i18n.SUPPORTED_LANGUAGES).size, i18n.SUPPORTED_LANGUAGES.length);
  assert.equal(i18n.isSupportedLanguage('en-US'), false, 'unlisted language codes are rejected');
  assert.equal(i18n.FALLBACK_LANGUAGE, 'en');
  assert.equal(i18n.resolveLanguage('xx'), 'en');
  for (const language of EXPECTED_LANGUAGES) {
    assert.equal(i18n.isSupportedLanguage(language), true, language);
  }
  for (const inheritedName of ['__proto__', 'constructor', 'toString']) {
    assert.equal(i18n.isSupportedLanguage(inheritedName), false, inheritedName);
    assert.equal(i18n.resolveLanguage(inheritedName), 'en', inheritedName);
  }
});

test('registered catalogues preserve review status and resolve every English key with explicit fallback', () => {
  const localeFiles = fs.readdirSync(localeDirectory).filter(name => name.endsWith('.json')).sort();
  assert.deepEqual(localeFiles, EXPECTED_LANGUAGES.map(language => language + '.json').sort());
  const keys = Object.keys(en).filter(key => !key.startsWith('_')).sort();
  for (const language of EXPECTED_LANGUAGES) {
    const raw = JSON.parse(fs.readFileSync(path.join(localeDirectory, language + '.json'), 'utf8'));
    assert.ok(['pending-review','reviewed-source','machine-translated','model-translated-draft','script-converted-draft','regional-base'].includes(raw._status), language + ' honest translation metadata');
    assert.deepEqual(Object.keys(raw).filter(key=>!key.startsWith('_')).sort(),keys,language+' raw catalogue is complete without fallback');
    for(const [key,value] of Object.entries(raw)) {
      assert.equal(typeof value, 'string', language + ':' + key);
      assert.ok(value.trim(), language + ':' + key);
    }
    const messages = i18n.getMessages(language);
    assert.equal(Object.isFrozen(messages), true);
    assert.equal(Object.getPrototypeOf(messages), null);
    assert.deepEqual(Object.keys(messages).sort(), keys, language + ' effective catalogue keys');
    for(const key of keys) {
      assert.equal(messages[key],raw[key],language+':'+key);
      const placeholders=value=>(value.match(/\{[A-Za-z0-9_]+\}/g)||[]).sort();
      assert.deepEqual(placeholders(raw[key]),placeholders(en[key]),language+':'+key+' placeholders');
    }
  }
  for(const language of ['de','es']) assert.notEqual(i18n.getMessages(language)['tor.activate'], fr['tor.activate']);
});

test('unknown and malformed language codes fall back to en', () => {
  const key = 'tor.activate';
  const expected = en[key];
  assert.deepEqual(i18n.getMessages('xx'), i18n.getMessages('en'));
  assert.notEqual(i18n.getMessages('fa')['tor.activate'], i18n.getMessages('en')['tor.activate'], 'Persian has a real catalogue');
  assert.equal(i18n.getMessages('en')['__proto__'], undefined);
  for (const language of ['xx', '../fr', 'FR;', 'FR', 'fr-FR', '__proto__', 'constructor', 'toString', '', ' fr', 'fr\u0000', null, undefined, 42, {}, ['fr'], () => 'fr']) {
    assert.equal(i18n.resolveLanguage(language), 'en', `resolveLanguage(${String(language)})`);
    assert.equal(i18n.isSupportedLanguage(language), false, `isSupportedLanguage(${String(language)})`);
    assert.equal(i18n.t(key, language), expected, `t with ${String(language)}`);
  }
});

test('supported language returns its message', () => {
  assert.equal(i18n.isSupportedLanguage('fr'), true);
  assert.equal(i18n.resolveLanguage('fr'), 'fr');
  assert.equal(i18n.t('home.titleEmphasis', 'fr'), 'à votre rythme.');
});

test('a missing key falls back to the key itself without throwing', () => {
  assert.equal(i18n.t('does.not.exist', 'fr'), 'does.not.exist');
  assert.equal(i18n.t('does.not.exist', 'xx'), 'does.not.exist');
});

test('a non-string or empty key is rejected', () => {
  for (const key of ['', null, undefined, 7, {}]) {
    assert.throws(() => i18n.t(key, 'fr'), TypeError, `key ${String(key)}`);
  }
});

test('lookup does not reach inherited object properties', () => {
  assert.equal(i18n.t('constructor', 'fr'), 'constructor');
  assert.equal(i18n.t('__proto__', 'fr'), '__proto__');
  assert.equal(i18n.t('toString', 'xx'), 'toString');
  assert.equal(i18n.t('tor.activate', 'xx'), en['tor.activate']);
});

test('every key in fr.json exists and has a non-empty string value', () => {
  const keys = Object.keys(fr);
  assert.ok(keys.length > 0);
  for (const key of keys.filter((key) => key !== '_status')) {
    assert.equal(typeof fr[key], 'string', `${key} is not a string`);
    assert.ok(fr[key].trim().length > 0, `${key} is empty`);
    assert.equal(i18n.t(key, 'fr'), fr[key], `${key} does not resolve`);
  }
  assert.equal(i18n.t('_status', 'fr'), '_status', 'locale metadata is not exposed as a message');
});

test('retired regional variants and system locales use the closest kept language', () => {
  const pairs = { 'fr-CA': 'fr', 'pt-PT': 'pt-BR', 'zh-HK': 'zh-TW', 'zh-Hant-HK': 'zh-TW', zh: 'zh-CN', 'es-419': 'es', 'es-MX': 'es', 'en-GB': 'en', 'de-AT': 'de', af: 'en', sw: 'en', fr: 'fr', '__proto__': 'en', constructor: 'en', '': 'en' };
  for (const [locale, expected] of Object.entries(pairs)) assert.equal(i18n.closestLanguage(locale), expected, locale);
  for (const value of [null, undefined, 42, {}, ['fr']]) assert.equal(i18n.closestLanguage(value), 'en');
});
