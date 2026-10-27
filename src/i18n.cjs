'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Single source of truth for language codes. A code is accepted only when it is
// exactly one of these strings; anything else resolves to the fallback language.
// Locale files are optional; missing translations use the English catalogue.
// Twenty languages, kept few enough to be translated and checked properly.
const SUPPORTED_LANGUAGES = Object.freeze([
  'de', 'en', 'ar', 'zh-CN', 'zh-TW', 'ko', 'es', 'fr', 'hi', 'id',
  'it', 'ja', 'nl', 'fa', 'pl', 'pt-BR', 'ru', 'tr', 'uk', 'vi'
]);
const FALLBACK_LANGUAGE = 'en';
// Regional variants offered by earlier versions and system locales without their
// own catalogue use the closest supported language.
const CLOSEST_LANGUAGE = Object.freeze({ pt: 'pt-BR', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant': 'zh-TW', zh: 'zh-CN' });

// Keep English plus three recently used effective catalogues. Loading JSON via
// require would retain every visited locale permanently in Node's module cache.
const MAX_CACHED_LOCALES = 3;
const effectiveCache = new Map();
let englishMessages;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSupportedLanguage(language) {
  return typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language);
}

// Custom languages: JSON files the user writes in the profile's "languages"
// folder, starting from a template (createCustomLanguage). Each is offered as
// a private-use language tag, "<_locale>-x-<file id>" (sw-x-custom1), which
// Intl and the lang attribute accept like any other language. Their texts are
// local files of unknown quality: only texts matching an English key and its
// placeholders are used, always rendered as plain text, and anything missing
// stays in English.
const MAX_CUSTOM_LANGUAGES = 20;
const MAX_CUSTOM_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CUSTOM_TEXT = 4000;
let customDirectory = '';
let customListing = { stamp: '', languages: [] };

function setCustomLanguageDirectory(directory) {
  customDirectory = typeof directory === 'string' ? directory : '';
  customListing = { stamp: '', languages: [] };
}

function customFiles() {
  if (!customDirectory) return [];
  let names;
  try { names = fs.readdirSync(customDirectory).filter((name) => /\.json$/i.test(name)).sort().slice(0, MAX_CUSTOM_LANGUAGES); } catch { return []; }
  const files = [];
  for (const name of names) {
    const file = path.join(customDirectory, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CUSTOM_FILE_BYTES) files.push({ name, file, stamp: name + ':' + stat.size + ':' + stat.mtimeMs });
    } catch {}
  }
  return files;
}

function readCustomFile(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

// "sw", "pt-BR", "ckb-IQ": a plain language tag, without private-use parts.
function customLocale(value) {
  if (typeof value !== 'string' || value.length > 20 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) return FALLBACK_LANGUAGE;
  try { return Intl.getCanonicalLocales(value)[0]; } catch { return FALLBACK_LANGUAGE; }
}

// The custom languages found in the folder, read again only when a file
// was added, removed or changed. The id is the file name's first 8 letters
// and digits; a second file with the same id is ignored.
function listCustomLanguages() {
  const files = customFiles();
  const stamp = files.map((item) => item.stamp).join('|');
  if (stamp === customListing.stamp) return customListing.languages;
  const languages = [];
  const ids = new Set();
  for (const { name, file } of files) {
    const id = name.slice(0, -5).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const raw = id && !ids.has(id) ? readCustomFile(file) : null;
    if (!raw) continue;
    ids.add(id);
    const label = typeof raw._name === 'string' ? raw._name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
    languages.push(Object.freeze({ code: customLocale(raw._locale) + '-x-' + id, name: label || name.slice(0, -5).slice(0, 60), file }));
  }
  customListing = { stamp, languages: Object.freeze(languages) };
  return customListing.languages;
}

function customLanguage(language) {
  return typeof language === 'string' && language.includes('-x-') ? listCustomLanguages().find((item) => item.code === language) || null : null;
}

// A built-in language, or a custom language whose file is present.
function isAvailableLanguage(language) {
  return isSupportedLanguage(language) || Boolean(customLanguage(language));
}

function resolveLanguage(language) {
  return isAvailableLanguage(language) ? language : FALLBACK_LANGUAGE;
}

// The supported language closest to a locale, or '' when there is none.
function matchLanguage(locale) {
  const value = typeof locale === 'string' ? locale.trim().replace(/_/g, '-') : '';
  if (isSupportedLanguage(value)) return value;
  const [base, region] = value.split('-');
  for (const candidate of [base + '-' + region, base]) {
    if (hasOwn(CLOSEST_LANGUAGE, candidate)) return CLOSEST_LANGUAGE[candidate];
  }
  return isSupportedLanguage(base) ? base : '';
}

// For a stored preference or a system locale ("fr-CA", "pt-PT", "zh-HK",
// "es-MX"): the language itself, its closest variant, its base language, or
// English. A custom language whose file was removed falls back the same way
// from its _locale.
function closestLanguage(locale) {
  if (isAvailableLanguage(locale)) return locale;
  return matchLanguage(typeof locale === 'string' ? locale.split('-x-')[0] : locale) || FALLBACK_LANGUAGE;
}

// The first language of the user's Windows preference list that Nacre
// supports ("Swahili, English" gives English), otherwise English.
function preferredLanguage(locales) {
  for (const locale of Array.isArray(locales) ? locales.slice(0, 20) : []) {
    const match = matchLanguage(locale);
    if (match) return match;
  }
  return FALLBACK_LANGUAGE;
}

// Right-to-left scripts, for built-in and custom languages alike.
function isRightToLeft(language) {
  return /^(?:ar|fa|he|ur|ps|sd|ckb|yi|dv)(?:-|$)/i.test(String(language || ''));
}

// The code has already passed the strict check above,
// so the path is always one of the registered files. Keys beginning with "_"
// are metadata (such as _status) and are never returned as messages.
function readCatalogue(language) {
  const localePath = path.join(__dirname, 'locales', `${language}.json`);
  if (!fs.existsSync(localePath)) {
    if (language === FALLBACK_LANGUAGE) throw new Error('The English locale catalogue is missing.');
    return null;
  }
  return JSON.parse(fs.readFileSync(localePath, 'utf8'));
}

function messagesFrom(raw, language) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`Catalogue ${language} must be a JSON object.`);
  }
  const messages = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue;
    if (!key || typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`Message ${language}:${key} must be a non-empty string.`);
    }
    messages[key] = value;
  }
  return messages;
}

function fallbackMessages() {
  if (!englishMessages) englishMessages = Object.freeze(messagesFrom(readCatalogue(FALLBACK_LANGUAGE), FALLBACK_LANGUAGE));
  return englishMessages;
}

const placeholdersOf = (text) => (String(text).match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join(' ');

// The usable texts of a custom language file: known keys only, same
// placeholders as English, bounded length. Other entries are ignored.
function customMessages(raw) {
  const english = fallbackMessages();
  const messages = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_') || !hasOwn(english, key) || typeof value !== 'string' || !value.trim() || value.length > MAX_CUSTOM_TEXT) continue;
    if (placeholdersOf(value) === placeholdersOf(english[key])) messages[key] = value;
  }
  return messages;
}

// Returns a frozen message catalogue. Unreviewed placeholders use English until
// their translations are reviewed; missing or unknown locales also use English.
function getMessages(language) {
  const resolvedLanguage = resolveLanguage(language);
  const custom = customLanguage(resolvedLanguage);
  // An edited custom file is read again: its size and date are in the key.
  let cacheKey = resolvedLanguage;
  if (custom) { try { const stat = fs.statSync(custom.file); cacheKey += '@' + stat.size + ':' + stat.mtimeMs; } catch {} }
  if (effectiveCache.has(cacheKey)) {
    const cached = effectiveCache.get(cacheKey);
    effectiveCache.delete(cacheKey);
    effectiveCache.set(cacheKey, cached);
    return cached;
  }
  const fallback = fallbackMessages();
  if (resolvedLanguage === FALLBACK_LANGUAGE) return fallback;
  let messages;
  if (custom) {
    const raw = readCustomFile(custom.file);
    if (!raw) return fallback;
    messages = customMessages(raw);
  } else {
    const locale = readCatalogue(resolvedLanguage);
    if (locale === null) return fallback;
    if (locale._status === 'not-reviewed') return fallback;
    messages = messagesFrom(locale, resolvedLanguage);
  }
  const effective = Object.freeze(Object.assign(Object.create(null), fallback, messages));
  effectiveCache.set(cacheKey, effective);
  if (effectiveCache.size > MAX_CACHED_LOCALES) effectiveCache.delete(effectiveCache.keys().next().value);
  return effective;
}

// Writes a template in the custom languages folder: every text of the
// reference language (the interface language, or English), to be replaced
// in place. Returns the new file's path.
function createCustomLanguage(referenceLanguage) {
  if (!customDirectory) throw new Error('The custom languages folder is not available.');
  fs.mkdirSync(customDirectory, { recursive: true });
  if (customFiles().length >= MAX_CUSTOM_LANGUAGES) throw new Error('Too many custom languages.');
  const reference = isSupportedLanguage(referenceLanguage) ? referenceLanguage : FALLBACK_LANGUAGE;
  const messages = getMessages(reference);
  const template = {
    _name: t('customLanguage.templateName', reference),
    _locale: 'en',
    _instructions: t('customLanguage.instructions', reference)
  };
  for (const key of Object.keys(fallbackMessages())) if (!key.startsWith('languages.')) template[key] = messages[key];
  for (let index = 1; index <= MAX_CUSTOM_LANGUAGES * 5; index++) {
    const file = path.join(customDirectory, 'custom' + index + '.json');
    try {
      fs.writeFileSync(file, JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
      return file;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Too many custom languages.');
}

// Unknown languages and missing keys fall back to English; a key missing
// everywhere is returned unchanged.
function t(key, language) {
  if (typeof key !== 'string' || !key) throw new TypeError('Message key must be a non-empty string.');
  const messages = getMessages(language);
  if (hasOwn(messages, key)) return messages[key];
  const fallback = fallbackMessages();
  return hasOwn(fallback, key) ? fallback[key] : key;
}

module.exports = {
  SUPPORTED_LANGUAGES, FALLBACK_LANGUAGE, isSupportedLanguage, isAvailableLanguage, resolveLanguage, closestLanguage,
  preferredLanguage, isRightToLeft, getMessages, t,
  setCustomLanguageDirectory, listCustomLanguages, createCustomLanguage
};
