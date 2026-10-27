'use strict';

const path = require('node:path');

const SITE_DATA_TYPES = Object.freeze([
  'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers',
  'webSQL', 'backgroundFetch'
]);

function clearDataTypesForSelection(selection) {
  const types = new Set();
  if (selection.includes('cookies')) types.add('cookies');
  if (selection.includes('cache')) types.add('cache');
  if (selection.includes('siteData')) for (const type of SITE_DATA_TYPES) types.add(type);
  return [...types];
}

function sanitizeDownloadFilename(input) {
  let filename = path.basename(String(input || ''));
  filename = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!filename || filename === '.' || filename === '..') filename = 'telechargement';
  const stem = filename.split('.')[0].replace(/ +$/, '');
  if (/^(CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])$/i.test(stem)) filename = `_${filename}`;
  if (filename.length > 180) {
    const extension = path.extname(filename).slice(0, 20);
    filename = filename.slice(0, 180 - extension.length) + extension;
  }
  return filename;
}

function isSafeAutoOpenDownload(filename) {
  const base = String(filename || '').replace(/^.*[\\/]/, '');
  return !/[:\x00-\x1f]/.test(base) && /\.(?:txt|png|jpg|jpeg|gif|webp|bmp|avif|mp3|wav|ogg|mp4|webm)$/i.test(base);
}

function isRiskyOpenDownload(filename) {
  const base = String(filename || '').replace(/^.*[\\/]/, '');
  if (/[:\x00-\x1f]/.test(base)) return true;
  return /\.(?:exe|msi|msix|appx|bat|cmd|ps1|psm1|ps1xml|psc1|cdxml|msh|msh1|msh2|mshxml|msh1xml|msh2xml|scr|com|reg|lnk|url|hta|vbs|vbe|js|jse|ws|wsf|wsc|wsh|sct|inf|diagcab|chm|hlp|dll|xll|jar|py|pyw|cpl|msc|scf|pif|gadget|application|appref-ms|settingcontent-ms|search-ms|jnlp|xbap|appxbundle|msixbundle|html|htm|shtml|xht|xhtml|svg|mht|mhtml|xsl|xslt|msp|msu|cab|iso|img|vhd|vhdx|one|library-ms|searchconnector-ms|theme|themepack|docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam)[. ]*$/i.test(String(filename || ''));
}

function canRemoveDownloadRecord(record) {
  return !record || !['downloading', 'waiting', 'choosing'].includes(record.state);
}

function publicDownloadRecord(record, canResume = false, isPaused = false) {
  const { item: _item, path: _localPath, ...safeRecord } = record;
  return { ...safeRecord, hasPath: Boolean(record.path), canResume: Boolean(canResume), isPaused: Boolean(isPaused) };
}

module.exports = { SITE_DATA_TYPES, clearDataTypesForSelection, sanitizeDownloadFilename, isRiskyOpenDownload, isSafeAutoOpenDownload, canRemoveDownloadRecord, publicDownloadRecord };
