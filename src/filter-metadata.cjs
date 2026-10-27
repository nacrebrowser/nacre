'use strict';

const crypto = require('node:crypto');

const FILTER_SOURCES = Object.freeze([
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
  'https://easylist-downloads.adblockplus.org/liste_fr.txt'
]);

function createFilterMetadata(buffer, generatedAt = new Date().toISOString(), details = {}) {
  return {
    schema: 2,
    engine: '@ghostery/adblocker-electron',
    engineVersion: '2.20.1',
    appVersion: typeof details.appVersion === 'string' && details.appVersion ? details.appVersion : '0.4.0',
    preset: 'EasyList + EasyPrivacy + uBlock Origin + Peter Lowe + Liste FR',
    generatedAt,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sources: details.sources || FILTER_SOURCES,
    lists: details.lists || []
  };
}

function isFilterMetadataFor(buffer, metadata) {
  return Boolean(metadata && [1, 2].includes(metadata.schema) && metadata.engine === '@ghostery/adblocker-electron' &&
    metadata.engineVersion === '2.20.1' && Array.isArray(metadata.sources) &&
    metadata.sha256 === crypto.createHash('sha256').update(buffer).digest('hex'));
}

module.exports = { FILTER_SOURCES, createFilterMetadata, isFilterMetadataFor };
