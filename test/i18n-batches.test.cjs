'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { translatable, defect, checkTranslation, checkAnswer, parseAnswer } = require('../scripts/i18n-batches.cjs');

test('only texts with words to translate are exported', () => {
  assert.equal(translatable('settings.httpsOnly', 'HTTPS-only mode'), true);
  assert.equal(translatable('proxy.socks5', 'SOCKS5'), false);
  assert.equal(translatable('app.version', 'BETA · 1.0.0'), true);
  assert.equal(translatable('home.metricBlockedValue', '{count}'), false);
  assert.equal(translatable('languages.de', 'Deutsch'), false);
  assert.equal(translatable('_status', 'machine-translated'), false);
});

test('known machine translation defects are sent again', () => {
  assert.equal(defect('Close', 'Close'), 'untranslated');
  assert.match(defect('PRIVATE BROWSER', 'I- PRIVATE BRrowser'), /prefix/);
  assert.match(defect('{count} tabs', '{n} amathebhu'), /placeholders/);
  assert.equal(defect('Close', 'Schließen'), '');
  assert.equal(defect('Aubergine', 'Aubergine', 'settings.darkBackground.aubergine'), 'untranslated');
  // The brand name translated, and an all-capitals label written in lower case.
  assert.match(defect('NACRE · CURRENT SESSION', 'ПЕРЛАМУТ · ПОТОЧНА СЕСІЯ'), /protected term changed: Nacre/);
  assert.match(defect('PRIVATE BROWSER', 'PRIVAAT Blaaier'), /capitals lost/);
});

test('scripts and grammar of each language are respected', () => {
  // Korean and Chinese attach words to the brand without a space.
  assert.equal(checkTranslation('Nacre opens a new tab.', 'Nacre는 새 탭을 엽니다.'), '');
  assert.equal(checkTranslation('Add via Tor', '通过Tor添加'), '');
  // Georgian has no capital letters; Marathi ends sentences with a full stop.
  assert.equal(checkTranslation('PRIVATE BROWSER', 'პირადი ბრაუზერი'), '');
  assert.equal(checkTranslation('Suggestions are off.', 'सूचना बंद आहेत.', 'mr'), '');
  assert.match(checkTranslation('Done.', 'ተጠናቋል.'), /Ethiopic/);
});

test('answers keep placeholders, protected terms and line breaks', () => {
  assert.equal(checkTranslation('{count} icons from {browser}', '{count} Symbole aus {browser}'), '');
  assert.match(checkTranslation('{count} icons from {browser}', '{count} Symbole'), /placeholders/);
  assert.match(checkTranslation('Connect to Tor', 'Mit dem Netzwerk verbinden'), /protected term changed: Tor/);
  assert.equal(checkTranslation('Connect to Tor', 'Mit Tor verbinden'), '');
  assert.match(checkTranslation('One\nTwo', 'Eins Zwei'), /line breaks/);
  assert.match(checkTranslation('Close', 'I- Vala'), /prefix/);
  assert.match(checkTranslation('Close', '<b>Schließen</b>'), /markup/);
  assert.match(checkTranslation('Close', ''), /empty/);
  assert.match(checkTranslation('Link copied.', 'リンクをコピーしました.'), /full stop/);
  assert.equal(checkTranslation('Link copied.', 'リンクをコピーしました。'), '');
  assert.match(checkTranslation('Suggestions are off.', 'सुझाव बंद हैं.', 'hi'), /Devanagari/);
  assert.equal(checkTranslation('Suggestions are off.', 'सुझाव बंद हैं।'), '');
  assert.match(checkTranslation('The web,', 'الويب,'), /Arabic-script/);
  assert.equal(checkTranslation('The web,', 'الويب،'), '');
});

test('a batch answer is checked text by text and may be wrapped in a code block', () => {
  const answer = parseAnswer('Voici :\n```json\n{"a": "Schließen", "b": "{n}", "z": "x"}\n```');
  const result = checkAnswer({ a: 'Close', b: '{count} tabs', c: 'Open' }, answer);
  assert.deepEqual(result.accepted, { a: 'Schließen' });
  assert.deepEqual(Object.keys(result.rejected), ['b']);
  assert.deepEqual(result.missing, ['c']);
  assert.deepEqual(result.extra, ['z']);
  assert.throws(() => parseAnswer('no json here'));
});
