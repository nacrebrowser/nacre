'use strict';
const fs = require('node:fs');

function readStartupChoice(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || Object.keys(value).sort().join(',') !== 'id,mode,version'
      || value.version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id)
      || !['tor', 'standard'].includes(value.mode)) return null;
    return value;
  } catch { return null; }
}

// Keeps a non-default language the user already has. English is also the
// default, so it is replaced by the system language the installer ran under.
function applyStartupChoice(settings, choice, systemLanguage) {
  if (!choice || settings.setupChoiceId === choice.id) return settings;
  return { ...settings, setupChoiceId: choice.id, language: settings.language && settings.language !== 'en' ? settings.language : systemLanguage || 'en', torAutoStart: choice.mode === 'tor',
    torCountry: choice.mode === 'tor' ? settings.torPreferredCountry || 'AUTO' : '',
    directMode: choice.mode === 'standard', proxy: { ...settings.proxy, enabled: false },
    adBlockEnabled: true, blockTrackers: true, cookiePolicy: 'block-third-party', blockThirdPartyCookies: true };
}

function applyStartupRoute(settings) {
  if (settings.setupChoiceId && settings.torAutoStart === true && !settings.proxy?.enabled) {
    return { ...settings, torCountry: settings.torPreferredCountry || 'AUTO', directMode: false };
  }
  // Manual Tor connections last for this run only in Standard protection.
  return settings.torAutoStart === false && settings.torCountry
    ? { ...settings, torCountry: '', directMode: true } : settings;
}
module.exports = { readStartupChoice, applyStartupChoice, applyStartupRoute };
