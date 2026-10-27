'use strict';

function privacyCheck(settings, { torConnected = false, now = Date.now() } = {}) {
  const items = [];
  const add = (id, status, detail, action) => items.push({ id, status, detail, action });
  add('httpsOnly', settings.httpsOnly ? 'enabled' : 'review', 'Require encrypted HTTPS connections.', settings.httpsOnly ? null : 'httpsOnly');
  add('adBlockEnabled', settings.adBlockEnabled ? 'enabled' : 'review', 'Filter known ads and trackers.', settings.adBlockEnabled ? null : 'adBlockEnabled');
  add('cookiePolicy', settings.cookiePolicy !== 'allow' ? 'enabled' : 'review', 'Third-party cookie restrictions. This does not certify all storage isolation.', settings.cookiePolicy === 'allow' ? 'cookiePolicy' : null);
  add('tor', settings.torCountry ? (torConnected ? 'connected' : 'connecting-or-unavailable') : 'direct', 'Connection state only; no independent IP or DNS leak verification.', null);
  const updated = Date.parse(settings.adBlockUpdatedAt || settings.filterListsUpdatedAt || '');
  add('filters', Number.isFinite(updated) && updated <= now && now - updated < 7 * 86400000 ? 'recent' : 'review', 'Review filter update status in Ad blocker settings. A bundled snapshot is not a verified online update.', null);
  for (const host of (settings.adBlockSiteExceptions || []).slice(0, 1000)) {
    if (typeof host === 'string') add('filter-exception:' + host, 'review', host, { kind: 'filter-exception', host });
  }
  for (const [workspace, hosts] of Object.entries(settings.workspaceSitePermissions || {})) {
    for (const [host, permissions] of Object.entries(hosts || {})) {
      if (!permissions || typeof permissions !== 'object') continue;
      for (const [permission, mode] of Object.entries(permissions)) {
        if (mode === 'allow') add(`permission:${workspace}:${host}:${permission}`, 'review', `${workspace} · ${host} · ${permission}`, { kind: 'permission', workspace, host, permission });
      }
    }
  }
  for (const [workspace, hosts] of Object.entries(settings.workspaceSiteCookiePolicies || {})) {
    for (const [host, mode] of Object.entries(hosts || {})) {
      if (mode === 'allow') add(`cookie-exception:${workspace}:${host}`, 'review', `${workspace} · ${host}`, { kind: 'cookie-exception', workspace, host });
    }
  }
  return { checkedAt: new Date(now).toISOString(), items: items.slice(0, 5000) };
}

function applyPrivacyAction(settings, id) {
  // Accept only a current finding: renderer-provided hosts or paths are never trusted.
  const item = privacyCheck(settings).items.find(item => item.id === id);
  if (!item?.action) return false;
  const action = item.action;
  if (action === 'httpsOnly') settings.httpsOnly = true;
  else if (action === 'adBlockEnabled') { settings.adBlockEnabled = true; settings.blockTrackers = true; }
  else if (action === 'cookiePolicy') { settings.cookiePolicy = 'block-third-party'; settings.blockThirdPartyCookies = true; }
  else if (action.kind === 'filter-exception') settings.adBlockSiteExceptions = settings.adBlockSiteExceptions.filter(host => host !== action.host);
  else if (action.kind === 'permission') delete settings.workspaceSitePermissions[action.workspace][action.host][action.permission];
  else if (action.kind === 'cookie-exception') delete settings.workspaceSiteCookiePolicies[action.workspace][action.host];
  else return false;
  return true;
}
module.exports = { privacyCheck, applyPrivacyAction };
