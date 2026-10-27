'use strict';
const { getDomain } = require('tldts-experimental');

const MAX_ENTRIES = 1_000_000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
// These services put unrelated users under URL paths, not distinct hostnames.
// A domain-only public feed cannot safely identify one such user's content.
const SHARED_HOSTING_ROOTS = new Set([
  'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.google.com',
  'forms.gle', 'storage.googleapis.com', 'onedrive.live.com', '1drv.ms',
  'sharepoint.com', 'sway.cloud.microsoft', 'sway.office.com', 'medium.com',
  'notion.so', 'notion.site', 'telegra.ph', 't.me', 'bit.ly', 'tinyurl.com'
]);
function isUsableFeedHost(host) {
  if (SHARED_HOSTING_ROOTS.has(host)) return false;
  try { return Boolean(getDomain(host, { allowPrivateDomains: true })); }
  catch { return false; }
}
module.exports = { MAX_ENTRIES, MAX_SNAPSHOT_BYTES, isUsableFeedHost };
