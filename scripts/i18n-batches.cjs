'use strict';

// Manual translation round trip: export batches, translate them with any tool
// or by hand, import them back. Development tool only: it reads and writes src/locales and the
// git-ignored translation-work/ folder, and never contacts a network service.
//
//   node scripts/i18n-batches.cjs status
//   node scripts/i18n-batches.cjs export [--langs de,es] [--size 150] [--all]
//   node scripts/i18n-batches.cjs import [--langs de,es] [--dry-run]
//
// export writes, for each language, translation-work/<code>/GUIDELINES.txt and
// batch-NN.json files holding only the English texts still to translate:
// texts identical to English and existing translations with known machine
// translation defects (--all takes every text). The answer to batch-NN.json
// is saved as translation-work/<code>/answers/batch-NN.json; import checks
// each text (same keys, same placeholders, protected terms kept, no artifact)
// and merges only the accepted ones. A rejected text keeps its current value
// and stays in the next export.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localeDirectory = path.join(root, 'src', 'locales');
const workDirectory = path.join(root, 'translation-work');
const SOURCE = 'en';
const SKIPPED_LANGUAGES = new Set(['en', 'fr']);
// Names and identifiers that must appear unchanged when the English text has them.
const PROTECTED_TERMS = ['Nacre', 'Tor', 'HTTPS', 'HTTP', 'DNS', 'DoH', 'Quad9', 'WebRTC', 'WebGL', 'SOCKS5', 'GPC', 'DNT', 'obfs4', 'Snowflake', 'DuckDuckGo', 'Qwant', 'Startpage', 'Ecosia', 'GitHub', 'Chrome', 'Firefox', 'Edge', 'Netflix', 'YouTube', 'Ctrl', 'Shift'];
const ARTIFACT = /(?:ZXID|ZACID|ZXQ|DXQ)\d|QXZ|DIXZ|�/i;

const placeholders = (text) => (String(text).match(/\{[A-Za-z0-9_]+\}/g) || []).sort();
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
// Only Latin letters and digits end a term: Korean or Telugu attach grammar
// directly to it ("Nacre는"), and Chinese writes it without spaces.
const countOf = (text, term) => (String(text).match(new RegExp('(?<![A-Za-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi')) || []).length;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function locales() { return fs.readdirSync(localeDirectory).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort(); }
function languageName(code) { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; } }

// Texts with nothing to translate: language autonyms, engine names, and
// values made only of protected terms, placeholders, digits and symbols.
function translatable(key, english) {
  if (key.startsWith('_') || key.startsWith('languages.') || key.startsWith('engines.') || key.startsWith('home.brandMark')) return false;
  // URLs, example hosts and filter rules are kept as they are.
  let rest = String(english).replace(/\{[A-Za-z0-9_]+\}/g, ' ').replace(/\S*[./#|^%=]\S*/g, ' ');
  for (const term of PROTECTED_TERMS) rest = rest.replace(new RegExp('(?<![\\p{L}])' + term + '(?![\\p{L}])', 'giu'), ' ');
  return /\p{L}{3,}/u.test(rest);
}

// Every English text en.json ever held, from its Git history: a translation
// still equal to one of them was never translated (texts move between keys).
let pastEnglish = null;
function earlierEnglish() {
  if (pastEnglish) return pastEnglish;
  pastEnglish = new Set();
  const git = (args) => require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  let commits = [];
  try { commits = git(['log', '--format=%H', '--', 'src/locales/en.json']).split('\n').filter(Boolean); } catch {}
  for (const commit of commits) {
    let old;
    try { old = JSON.parse(git(['show', commit + ':src/locales/en.json'])); } catch { continue; }
    for (const value of Object.values(old)) if (typeof value === 'string') pastEnglish.add(value);
  }
  // English fallbacks written in the interface code, now or in the past,
  // which older tools also used as a translation source. French texts of
  // the code are left out: they are the French catalogue's own values.
  const sourceDirectory = path.join(root, 'src');
  let code = fs.readdirSync(sourceDirectory).filter((item) => /\.(?:c?js|html)$/.test(item)).map((name) => fs.readFileSync(path.join(sourceDirectory, name), 'utf8')).join('\n');
  try { code += '\n' + git(['log', '-p', '--format=', '--', 'src/*.js', 'src/*.cjs', 'src/*.html']); } catch {}
  const french = new Set(Object.values(readJson(path.join(localeDirectory, 'fr.json'))));
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.){10,})'|"((?:[^"\\\n]|\\.){10,})"|>([^<>{}\n]{10,})</g)) {
    const text = (match[1] ?? match[2] ?? match[3]).replace(/\\(.)/g, '$1').trim();
    if (!french.has(text)) pastEnglish.add(text);
  }
  return pastEnglish;
}

// A sentence found word for word in many different languages was copied in
// English, not translated, whatever English wording it was copied from.
let sharedValues = null;
function sharedAcrossLanguages(key, value) {
  if (!sharedValues) {
    sharedValues = new Map();
    for (const code of locales()) {
      if (['en', 'en-GB'].includes(code)) continue;
      for (const [name, text] of Object.entries(readJson(path.join(localeDirectory, code + '.json')))) {
        const id = name + '\u0000' + text;
        sharedValues.set(id, (sharedValues.get(id) || 0) + 1);
      }
    }
  }
  return (sharedValues.get(key + '\u0000' + value) || 0) >= 10;
}

// Why an existing translation should be redone, or '' when it looks usable.
function defect(english, value, key, code = '') {
  if (typeof value !== 'string' || !value.trim()) return 'empty';
  if (value === english) return 'untranslated';
  // Three words or more: short labels such as "Aubergine" may be identical.
  if (key && /\S+\s+\S+\s+\S+/.test(value) && (earlierEnglish().has(value) || sharedAcrossLanguages(key, value))) return 'outdated English';
  // Anything the import would refuse in a new answer is redone as well.
  return checkTranslation(english, value, code);
}

function keptFile(code) { return path.join(workDirectory, code, 'kept-identical.json'); }
function keptIdentical(code) { try { return new Set(readJson(keptFile(code))); } catch { return new Set(); } }

function pending(code, en, all) {
  const locale = readJson(path.join(localeDirectory, code + '.json'));
  const kept = keptIdentical(code);
  const result = {};
  for (const [key, english] of Object.entries(en)) {
    if (!translatable(key, english)) continue;
    const reason = defect(english, locale[key], key, code);
    if (all || (reason && !(reason === 'untranslated' && kept.has(key)))) result[key] = english;
  }
  return result;
}

// Checks one answered text against its English source. Returns '' when it
// can be merged, otherwise the reason it is rejected.
function checkTranslation(english, value, code = '') {
  if (typeof value !== 'string') return 'not a string';
  if (!value.trim()) return 'empty';
  if (value.length > 4000) return 'too long';
  if (ARTIFACT.test(value)) return 'generation artifact';
  if (/^I- /.test(value) && !/^I- /.test(english)) return 'stray "I- " prefix';
  if (!sameList(placeholders(value), placeholders(english))) return 'placeholders differ: ' + placeholders(english).join(' ') + ' → ' + placeholders(value).join(' ');
  if (/[぀-ヿ一-鿿]\.(?:\s|$)/u.test(value)) return 'Latin full stop after Japanese or Chinese text (use 。)';
  // Hindi and Nepali end sentences with ।; Marathi uses the Latin full stop.
  if (['hi', 'ne'].includes(code) && /[ऀ-ॿ]\.(?:\s|$)/u.test(value)) return 'Latin full stop after Devanagari text (use ।)';
  if (/[؀-ۿ][,?;](?:\s|$)/u.test(value)) return 'Latin comma, question mark or semicolon after Arabic-script text (use ، ؟ ؛)';
  if (/[ሀ-፿][.,](?:\s|$)/u.test(value)) return 'Latin full stop or comma after Ethiopic text (use ። ፣)';
  // A label written in capitals (NACRE · CURRENT SESSION) stays in capitals,
  // in the scripts that have them (Georgian, for one, has no capitals).
  const letters = (text) => String(text).replace(/\{[A-Za-z0-9_]+\}/g, '');
  if (/\p{Lu}{3}/u.test(letters(english)) && !/\p{Ll}/u.test(letters(english)) && /[\p{Ll}&&[\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Armenian}]]/v.test(letters(value))) return 'capitals lost: the English label is all in capitals';
  if ((english.match(/\n/g) || []).length !== (value.match(/\n/g) || []).length) return 'line breaks differ';
  for (const term of PROTECTED_TERMS) {
    if (countOf(english, term) && countOf(value, term) < countOf(english, term)) return 'protected term changed: ' + term;
  }
  for (const version of english.match(/\d+(?:\.\d+)+/g) || []) if (!value.includes(version)) return 'version number changed: ' + version;
  if (/<\/?[a-z][^>]*>/i.test(value) && !/<\/?[a-z][^>]*>/i.test(english)) return 'markup added';
  if (english.length >= 12 && value.length > english.length * 4 + 40) return 'much longer than the source';
  return '';
}

// Accepts the answer as plain JSON, or wrapped in a ``` block or a sentence.
function parseAnswer(text) {
  const source = String(text).replace(/^﻿/, '');
  try { return JSON.parse(source); } catch {}
  const start = source.indexOf('{'), end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(source.slice(start, end + 1));
}

function checkAnswer(batch, answer, code = '') {
  const accepted = {}, rejected = {}, missing = [], extra = [];
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new Error('the answer is not a JSON object');
  for (const [key, english] of Object.entries(batch)) {
    if (!Object.hasOwn(answer, key)) { missing.push(key); continue; }
    const problem = checkTranslation(english, answer[key], code);
    if (problem) rejected[key] = problem; else accepted[key] = answer[key];
  }
  for (const key of Object.keys(answer)) if (!Object.hasOwn(batch, key)) extra.push(key);
  return { accepted, rejected, missing, extra };
}

function guidelines(code) {
  const name = languageName(code);
  return `Translating Nacre into ${name} (${code})

Nacre is a privacy-focused desktop web browser with an ad blocker, built-in Tor and tracking protection. Each batch-NN.json file maps keys to English texts. Save the translated file as answers/batch-NN.json, with the same keys in the same order.

1. Never change the keys.
2. Keep everything in braces ({count}, {browser}, {value0}…) exactly as it is, the same number of times. You may move it within the sentence.
3. Do not translate: ${PROTECTED_TERMS.join(', ')}, site or service names, URLs, file paths, or symbols such as ◈ · › %.
4. Use the punctuation of ${name} (for example 。、！？ in Japanese and Chinese, ¿¡ in Spanish, « » in French). Keep line breaks (\n), « · » and « › ».
5. Use the words of mainstream browsers in ${name}, as Firefox or Chrome do (tab, bookmark, cookie, tracking, fingerprint, Tor bridge…).
6. Keep the usual software register of ${name}, consistent from one text to the next.
7. Translate privacy and security texts exactly, without promising more. Words such as "may", "partial" or "does not guarantee" keep their nuance.
8. Keep button and menu labels short.
9. If a text is ambiguous, pick the meaning that fits a web browser.
10. Some entries may be earlier, poor translations: always translate from the English text.
`;
}

function options(argv) {
  const result = { langs: null, size: 150, all: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--langs') result.langs = String(argv[++i] || '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (argv[i] === '--size') result.size = Math.max(20, Math.min(400, Number(argv[++i]) || 150));
    else if (argv[i] === '--all') result.all = true;
    else if (argv[i] === '--dry-run') result.dryRun = true;
    else throw new Error('Unknown option ' + argv[i]);
  }
  const known = locales();
  for (const code of result.langs || []) if (!known.includes(code)) throw new Error('Unknown language ' + code);
  result.langs = (result.langs || known).filter((code) => !SKIPPED_LANGUAGES.has(code) || (result.langs && code !== SOURCE));
  return result;
}

function status(en, opts) {
  const total = Object.entries(en).filter(([key, english]) => translatable(key, english)).length;
  const rows = opts.langs.map((code) => {
    const left = Object.keys(pending(code, en, false)).length;
    return { code, done: Math.round(100 * (total - left) / total), left };
  }).sort((a, b) => a.done - b.done);
  for (const row of rows) console.log(row.code.padEnd(7) + String(row.done).padStart(4) + ' %   ' + row.left + ' texts left');
  console.log(total + ' translatable texts per language.');
}

function exportBatches(en, opts) {
  let files = 0;
  for (const code of opts.langs) {
    const entries = Object.entries(pending(code, en, opts.all));
    const folder = path.join(workDirectory, code);
    fs.mkdirSync(path.join(folder, 'answers'), { recursive: true });
    // Old answers belong to the previous batches: import them before exporting again.
    for (const directory of [folder, path.join(folder, 'answers')]) {
      for (const name of fs.readdirSync(directory)) if (/^batch-\d+\.json$/.test(name)) fs.rmSync(path.join(directory, name));
    }
    fs.writeFileSync(path.join(folder, 'GUIDELINES.txt'), guidelines(code));
    const count = Math.ceil(entries.length / opts.size);
    for (let index = 0; index < count; index++) {
      writeJson(path.join(folder, 'batch-' + String(index + 1).padStart(2, '0') + '.json'), Object.fromEntries(entries.slice(index * opts.size, (index + 1) * opts.size)));
      files++;
    }
    console.log(code.padEnd(7) + entries.length + ' texts in ' + count + ' batches');
  }
  console.log(files + ' batch files written to translation-work/.');
}

function importAnswers(en, opts) {
  let merged = 0, refused = 0;
  for (const code of opts.langs) {
    const folder = path.join(workDirectory, code);
    const answers = path.join(folder, 'answers');
    if (!fs.existsSync(answers)) continue;
    const file = path.join(localeDirectory, code + '.json');
    const locale = readJson(file);
    const kept = keptIdentical(code);
    const keptBefore = kept.size;
    let changed = 0;
    for (const name of fs.readdirSync(answers).filter((item) => /^batch-\d+\.json$/.test(item)).sort()) {
      const batchFile = path.join(folder, name);
      if (!fs.existsSync(batchFile)) { console.log(code + ' ' + name + ': no matching batch file (exported again since?), skipped'); continue; }
      const batch = readJson(batchFile);
      let result;
      try { result = checkAnswer(batch, parseAnswer(fs.readFileSync(path.join(answers, name), 'utf8')), code); }
      catch (error) { console.log(code + ' ' + name + ': REJECTED, ' + error.message); refused += Object.keys(batch).length; continue; }
      for (const [key, value] of Object.entries(result.accepted)) {
        if (value === en[key]) kept.add(key);
        if (locale[key] !== value) { locale[key] = value; changed++; }
      }
      const rejected = Object.entries(result.rejected);
      refused += rejected.length + result.missing.length;
      console.log(code + ' ' + name + ': ' + Object.keys(result.accepted).length + ' accepted, ' + rejected.length + ' rejected, ' + result.missing.length + ' missing' + (result.extra.length ? ', ' + result.extra.length + ' unknown keys ignored' : ''));
      for (const [key, problem] of rejected.slice(0, 10)) console.log('    ' + key + ': ' + problem);
      if (rejected.length > 10) console.log('    … ' + (rejected.length - 10) + ' more');
    }
    if (changed && !opts.dryRun) {
      if (locale._status === 'machine-translated') locale._status = 'model-translated-draft';
      writeJson(file, locale);
    }
    if ((changed || kept.size !== keptBefore) && !opts.dryRun) writeJson(keptFile(code), [...kept].sort());
    merged += changed;
  }
  console.log((opts.dryRun ? 'Dry run: ' : '') + merged + ' texts ' + (opts.dryRun ? 'would be' : '') + ' merged, ' + refused + ' left for the next export.');
}

if (require.main === module) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const en = readJson(path.join(localeDirectory, SOURCE + '.json'));
    const opts = options(rest);
    if (command === 'status') status(en, opts);
    else if (command === 'export') exportBatches(en, opts);
    else if (command === 'import') importAnswers(en, opts);
    else { console.log('Usage: node scripts/i18n-batches.cjs status|export|import [--langs de,es] [--size 150] [--all] [--dry-run]'); process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { translatable, defect, checkTranslation, checkAnswer, parseAnswer, guidelines };
