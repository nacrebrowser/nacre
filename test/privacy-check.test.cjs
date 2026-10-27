'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { privacyCheck, applyPrivacyAction } = require('../src/privacy-check.cjs');
test('local privacy check revokes only the selected persistent permission', () => {
  const settings = { workspaceSitePermissions: { work: { 'example.org': { media: 'allow', notifications: 'allow' } } } };
  assert.equal(privacyCheck(settings).items.filter(i => i.id.startsWith('permission:')).length, 2);
  assert.equal(applyPrivacyAction(settings, 'permission:work:example.org:media'), true);
  assert.equal(settings.workspaceSitePermissions.work['example.org'].notifications, 'allow');
  assert.equal(applyPrivacyAction(settings, 'permission:__proto__:example.org:media'), false);
});
test('exceptions and disabled protections produce specific actionable findings', () => {
  const settings = { httpsOnly: false, cookiePolicy: 'allow', adBlockSiteExceptions: ['example.org'], workspaceSiteCookiePolicies: { a: { 'example.org': 'allow' } } };
  assert.equal(applyPrivacyAction(settings, 'httpsOnly'), true);
  assert.equal(settings.httpsOnly, true);
  assert.equal(applyPrivacyAction(settings, 'filter-exception:example.org'), true);
  assert.deepEqual(settings.adBlockSiteExceptions, []);
  assert.equal(applyPrivacyAction(settings, 'cookie-exception:a:example.org'), true);
  assert.deepEqual(settings.workspaceSiteCookiePolicies.a, {});
});
