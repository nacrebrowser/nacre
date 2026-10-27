'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const i18n = require('../src/i18n.cjs');
const en = require('../src/locales/en.json'), fr = require('../src/locales/fr.json');

function folder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-languages-'));
  i18n.setCustomLanguageDirectory(directory);
  return directory;
}

test('a template holds every text of the reference language with instructions', (t) => {
  const directory = folder();
  t.after(() => { i18n.setCustomLanguageDirectory(''); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = i18n.createCustomLanguage('fr');
  assert.equal(path.basename(file), 'custom1.json');
  const template = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(template._name, fr['customLanguage.templateName']);
  assert.equal(template._locale, 'en');
  assert.equal(template._instructions, fr['customLanguage.instructions']);
  assert.equal(template['tor.activate'], fr['tor.activate']);
  assert.equal(Object.keys(template).filter((key) => !key.startsWith('_')).length, Object.keys(en).filter((key) => !key.startsWith('_') && !key.startsWith('languages.')).length);
  assert.equal(path.basename(i18n.createCustomLanguage('xx')), 'custom2.json', 'a second template never replaces the first');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'custom2.json'), 'utf8'))['tor.activate'], en['tor.activate'], 'unknown references use English');
});

test('a custom language is offered under a private-use tag and only its valid texts are used', (t) => {
  const directory = folder();
  t.after(() => { i18n.setCustomLanguageDirectory(''); fs.rmSync(directory, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'Kiswahili.json'), JSON.stringify({
    _name: 'Kiswahili\u0007', _locale: 'sw',
    'tor.activate': 'Washa Tor',
    'import.icons': 'Aikoni {count} zimepatikana.',
    'import.done': 'Imekamilika bila nafasi.',
    'not.a.key': 'x',
    'common.close': '   ',
    'tabs.newTitle': 'x'.repeat(5000)
  }));
  const [language] = i18n.listCustomLanguages();
  assert.deepEqual({ code: language.code, name: language.name }, { code: 'sw-x-kiswahil', name: 'Kiswahili' });
  assert.equal(i18n.isAvailableLanguage('sw-x-kiswahil'), true);
  assert.equal(i18n.isSupportedLanguage('sw-x-kiswahil'), false, 'the built-in list is unchanged');
  assert.deepEqual(Intl.getCanonicalLocales(language.code), ['sw-x-kiswahil'], 'Intl and lang= accept the tag');
  const messages = i18n.getMessages('sw-x-kiswahil');
  assert.equal(messages['tor.activate'], 'Washa Tor');
  assert.equal(messages['import.icons'], 'Aikoni {count} zimepatikana.');
  assert.equal(messages['import.done'], en['import.done'], 'a text that lost its placeholders stays in English');
  assert.equal(messages['common.close'], en['common.close']);
  assert.equal(messages['tabs.newTitle'], en['tabs.newTitle']);
  assert.equal(messages['not.a.key'], undefined);
  assert.equal(i18n.t('tor.activate', 'sw-x-kiswahil'), 'Washa Tor');
  // An edited file is read again.
  const file = path.join(directory, 'Kiswahili.json');
  fs.writeFileSync(file, JSON.stringify({ _name: 'Kiswahili', _locale: 'sw', 'tor.activate': 'Anzisha Tor' }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(i18n.getMessages('sw-x-kiswahil')['tor.activate'], 'Anzisha Tor');
});

test('stored custom languages survive and fall back when their file is gone', (t) => {
  const directory = folder();
  t.after(() => { i18n.setCustomLanguageDirectory(''); fs.rmSync(directory, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'urdu.json'), JSON.stringify({ _name: 'اردو', _locale: 'ur' }));
  fs.writeFileSync(path.join(directory, 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(directory, 'tag.json'), JSON.stringify({ _name: 'Bad tag', _locale: 'x-evil-' + 'a'.repeat(40) }));
  assert.deepEqual(i18n.listCustomLanguages().map((item) => item.code), ['en-x-tag', 'ur-x-urdu']);
  assert.equal(i18n.closestLanguage('ur-x-urdu'), 'ur-x-urdu');
  assert.equal(i18n.isRightToLeft('ur-x-urdu'), true);
  assert.equal(i18n.isRightToLeft('fr'), false);
  fs.rmSync(path.join(directory, 'urdu.json'));
  assert.equal(i18n.isAvailableLanguage('ur-x-urdu'), false);
  assert.equal(i18n.closestLanguage('ur-x-urdu'), 'en');
  assert.equal(i18n.closestLanguage('fr-x-old'), 'fr', 'a removed custom language keeps its base language when Nacre has it');
  assert.deepEqual(i18n.getMessages('ur-x-urdu'), i18n.getMessages('en'));
});

test('the first supported language of the Windows list is chosen', () => {
  assert.equal(i18n.preferredLanguage(['sw-KE', 'fr-FR', 'en-US']), 'fr');
  assert.equal(i18n.preferredLanguage(['ar-MA', 'fr-MA']), 'ar');
  assert.equal(i18n.preferredLanguage(['sw-KE', 'en-IN']), 'en');
  assert.equal(i18n.preferredLanguage(['zh-Hant-HK']), 'zh-TW');
  assert.equal(i18n.preferredLanguage(['pt-PT', 'en-GB']), 'pt-BR');
  assert.equal(i18n.preferredLanguage(['af-ZA']), 'en');
  assert.equal(i18n.preferredLanguage([]), 'en');
  assert.equal(i18n.preferredLanguage(null), 'en');
  assert.equal(i18n.preferredLanguage(['__proto__', 42, 'de_DE']), 'de');
});
