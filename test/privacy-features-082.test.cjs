'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTrackingParameters } = require('../src/privacy-core.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('src/main.cjs');
const preload = read('src/preload.cjs');
const renderer = read('src/renderer.js');
const index = read('src/index.html');

test('link cleaning removes expanded click identifiers and keeps functional parameters', () => {
  const identifiers = [
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'gbraid', 'wbraid', 'twclid',
    'ttclid', 'li_fat_id', 'igshid', 'epik', 's_kwcid', 'ef_id', 'wickedid',
    'yclid', 'rb_clickid', 'mkt_tok', 'mc_cid', 'mc_eid', 'vero_id', 'vero_conv',
    'oly_anon_id', 'oly_enc_id', '_hsenc', '_hsmi', 'hsCtaTracking', 'elqTrackId',
    'elqTrack', 's_cid', 'sc_cid'
  ];
  for (const key of identifiers) {
    assert.equal(
      stripTrackingParameters(`https://example.test/article?${key}=secret&page=2#part`),
      'https://example.test/article?page=2#part',
      key
    );
  }
  assert.equal(
    stripTrackingParameters('https://example.test/article?utm_source=mail&utm_medium=email&ref=nav&q=privacy'),
    'https://example.test/article?ref=nav&q=privacy'
  );
});

test('copied links follow the tracking-parameter policy', () => {
  assert.match(main, /function cleanLinkForCopy\(value\)[\s\S]*?cleanTrackingLink\(value/);
  assert.match(main, /clipboard\.writeText\(cleanLinkForCopy\(targetLink\)\)/);
  assert.match(main, /clipboard\.writeText\(cleanLinkForCopy\(url\)\)/);
});

test('forget-site only clears the validated page origin after user confirmation', () => {
  const forget = main.slice(main.indexOf('async function forgetSiteData('), main.indexOf('function registerPrivacyPreloads('));
  assert.ok(forget.length > 0);
  assert.match(forget, /if \(!tab \|\| tab\.internal \|\| !tab\.browserSession \|\| !validHost\(host\)\) return false/);
  assert.match(forget, /url\.hostname\.toLowerCase\(\) !== host/);
  assert.match(forget, /dialog\.showMessageBox\(win, \{[\s\S]*?defaultId: 1, cancelId: 1/);
  assert.match(forget, /clearOriginData\(ses, url\.origin\)/);
  assert.doesNotMatch(forget, /delete policiesForTab\('workspaceSitePermissions'/);
  assert.doesNotMatch(forget, /delete policiesForTab\('workspaceSiteCookiePolicies'/);
  assert.match(forget, /reloadIgnoringCache\(\)/);
  const helper = main.slice(main.indexOf('async function clearOriginData('), main.indexOf('async function forgetSiteData('));
  assert.match(helper, /origins: \[origin\]/);
  assert.match(helper, /originMatchingMode: 'origin-in-all-contexts'/);
});

test('forget-on-close clears the site only after its last tab in that session closes', () => {
  const helper = main.slice(main.indexOf('function forgetClosedSiteData('), main.indexOf('function reopenLastTab('));
  assert.match(helper, /if \(!tab \|\| tab\.private \|\| !tab\.browserSession \|\| quittingAfterClear\) return/);
  assert.match(helper, /forgetfulSites\.release\(tab\)/);
  assert.match(helper, /clearOriginData\(ses, origin\)/);
  assert.match(main, /forgetSiteOnClose: \[\],/);
  assert.match(main, /forgetSiteOnClose: Array\.isArray\(stored\.forgetSiteOnClose\)/);
  assert.match(main, /forgetOnClose: Boolean\(host && settings\.forgetSiteOnClose\.includes\(host\)\)/);
  assert.match(main, /ipcMain\.on\('nacre:toggle-forget-site', \(event\) => \{[\s\S]*?isTrustedUIEvent\(event\)[\s\S]*?!tab\.private/);
  assert.match(preload, /toggleForgetSite: \(\) => ipcRenderer\.send\('nacre:toggle-forget-site'\)/);
  assert.match(index, /id="forget-site-on-close"/);
  assert.match(renderer, /api\.toggleForgetSite\(\)/);
  assert.match(renderer, /\$\('#forget-site-on-close'\)\.disabled = !webPage \|\| Boolean\(tab\.private\)/);
  const quit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('window-all-closed'"));
  assert.match(quit, /const forgetOrigins = forgetfulSites\.snapshot\(\)/);
  assert.match(quit, /await Promise\.allSettled\(\[\.\.\.pendingSiteClears\.values\(\)\]\)/);
  assert.match(quit, /for \(const \[ses, origins\] of forgetOrigins\)[\s\S]*?originMatchingMode: 'origin-in-all-contexts'/);
});

test('forget-site is exposed to the trusted interface only', () => {
  assert.match(main, /ipcMain\.handle\('nacre:forget-site', async \(event\) => \{[\s\S]*?isTrustedUIEvent\(event\)/);
  assert.match(preload, /forgetSite: \(\) => ipcRenderer\.invoke\('nacre:forget-site'\)/);
  assert.match(index, /id="forget-site"/);
  assert.match(renderer, /api\.forgetSite\(\)/);
  assert.match(renderer, /\$\('#forget-site'\)\.disabled = !webPage/);
});

test('permission checks reject absent or destroyed WebContents before reading them', () => {
  assert.match(main, /setPermissionCheckHandler\(\(_contents, permission,[\s\S]*?if \(!_contents \|\| _contents\.isDestroyed\(\)\) return false;[\s\S]*?requestingHost\(details, _contents\)/);
});

test('source viewer fetches are time-bounded', () => {
  assert.match(main, /session\.fetch\(target, \{[\s\S]*?signal: AbortSignal\.timeout\(20000\)/);
});

test('stored proxy endpoints are revalidated before use', () => {
  assert.match(main, /proxy: sanitizeStoredProxy\(stored\.proxy\)/);
  const policy = fs.readFileSync(path.join(root, 'src', 'url-policy.cjs'), 'utf8');
  assert.match(policy, /function sanitizeStoredProxy\(value\)/);
  assert.match(policy, /hostValid && portValid/);
});

test('audible autoplay requires a user gesture in the process and tab views', () => {
  assert.match(main, /appendSwitch\('autoplay-policy', 'user-gesture-required'\)/);
  assert.match(main, /webgl: false,\s*autoplayPolicy: 'user-gesture-required',/);
});
