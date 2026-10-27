'use strict';

// Internal-page renderer shared by the toolbar and dashboard. Observed names
// stay text. Attribution links are restricted to this curated registry mirror.
(() => {
  const sources = new Set([
    'https://policies.google.com/technologies/cookies?hl=en-us',
    'https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies',
    'https://help.ads.microsoft.com/apex/index/3/en-in/53056',
    'https://www.linkedin.com/legal/l/cookie-table',
    'https://github.com/facebook/facebook-for-woocommerce/blob/main/facebook-commerce-pixel-event.php'
  ]);
  const actions = {
    'request-blocked': 'activity.action.requestBlocked',
    'http-blocked': 'activity.action.requestBlocked',
    'cookie-send-blocked': 'activity.action.cookieSendBlocked',
    'cookie-set-blocked': 'activity.action.cookieSetBlocked',
    'cookie-purged': 'activity.action.cookiePurged',
    'request-allowed': 'transparency.requestAllowed',
    'request-redirected': 'transparency.requestModified',
    'request-rewritten': 'transparency.requestModified'
  };
  const reasons = {
    'filter-rule': 'filterRule', 'strict-mode': 'strictMode',
    'site-exception': 'siteException', 'blocking-disabled': 'blockingDisabled',
    'filter-exception': 'filterException', 'no-matching-rule': 'noMatchingRule',
    'cookie-policy': 'cookiePolicy', 'https-only': 'httpsOnly',
    'cookie-purge': 'cookiePurge', unknown: 'unknown'
  };
  function decision(entry) {
    if (['blocked', 'allowed', 'modified'].includes(entry.decision)) return entry.decision;
    if (entry.action === 'request-allowed') return 'allowed';
    if (['request-redirected', 'request-rewritten'].includes(entry.action)) return 'modified';
    return 'blocked';
  }
  function source(value) {
    if (typeof value !== 'string' || !sources.has(value)) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && sources.has(url.href) ? url.href : '';
    } catch { return ''; }
  }
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  function substitute(t, key, name, value) { return t(key, { [name]: value }).replaceAll('{' + name + '}', String(value)); }
  function time(value, t, key) {
    if (!Number.isFinite(value) || value < 0) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const node = element('time', 'activity-observed', '');
    node.dateTime = date.toISOString();
    let text;
    try { text = date.toLocaleString(document.documentElement.lang || 'en', { timeZoneName: 'short' }); }
    catch { text = date.toLocaleString('en', { timeZoneName: 'short' }); }
    node.textContent = substitute(t, key, 'time', text);
    return node;
  }
  function rowKey(entry) {
    return JSON.stringify([entry.tabId, entry.host, entry.site, entry.cookieName, entry.action, entry.decision, entry.reason, entry.ruleId, entry.resourceType]);
  }
  window.NacreProtectionActivity = Object.freeze({
    render(root, activity, t, { compact = false, limit = 50, query = '', decision: selectedDecision = 'all', company = '' } = {}) {
      if (!root) return { total: 0, displayed: 0 };
      const opened = new Set([...root.querySelectorAll('details[open]')].map(node => node.dataset.activityKey));
      const focused = root.contains(document.activeElement) ? document.activeElement : null;
      const focusedKey = focused?.closest('details')?.dataset.activityKey;
      const focusSelector = focused?.tagName === 'A' ? 'a' : 'summary';
      root.replaceChildren();
      const all = activity?.available === true && ['normal', 'private'].includes(activity.scope) && Array.isArray(activity.entries) ? activity.entries.slice(0, 200) : [];
      const search = typeof query === 'string' ? query.trim().toLowerCase().slice(0, 100) : '';
      const rows = all.filter(entry => entry && typeof entry.host === 'string' && Number.isSafeInteger(entry.count) && entry.count > 0
        && (!compact || decision(entry) === 'blocked')
        && (selectedDecision === 'all' || decision(entry) === selectedDecision)
        && (!company || entry.company === company)
        && (!search || [entry.host, entry.site, entry.cookieName, entry.company, entry.service, entry.reason, entry.ruleId, entry.resourceType, Number.isSafeInteger(entry.tabId) ? String(entry.tabId) : ''].some(value => typeof value === 'string' && value.toLowerCase().includes(search))));
      const displayLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
      if (!rows.length) {
        root.append(element('p', 'activity-empty', t(search || company || selectedDecision !== 'all' ? 'activity.noMatch' : 'activity.empty')));
        return { total: 0, displayed: 0 };
      }
      for (const entry of rows.slice(0, displayLimit)) {
        const outcome = decision(entry);
        const row = element('article', 'activity-row' + (compact ? ' activity-compact' : ''), '');
        row.dataset.decision = outcome;
        const identity = element('div', 'activity-identity', '');
        identity.append(element('strong', 'activity-company', entry.company || t('activity.unknownCompany')));
        if (entry.service && !compact) identity.append(element('span', 'activity-service', entry.service));
        row.append(identity, element('span', 'activity-frequency', '×' + entry.count));
        if (entry.cookieName || compact || (typeof entry.action === 'string' && entry.action.startsWith('cookie-'))) row.append(element('code', 'activity-cookie', entry.cookieName || t('activity.noCookie')));
        row.append(element('span', 'activity-domain', entry.host + (!compact && entry.site ? ' · ' + substitute(t, 'activity.onSite', 'site', entry.site) : '')));
        if (!compact) {
          const actionKey = Object.hasOwn(actions, entry.action) ? actions[entry.action] : 'activity.action.requestBlocked';
          const action = element('div', 'activity-action', '');
          const labels = { blocked: 'dashboard.routeBlocked', allowed: 'dashboard.cookieAllowed', modified: 'transparency.modified' };
          const badge = element('span', 'activity-decision', t(labels[outcome]));
          badge.dataset.decision = outcome;
          action.append(badge, element('span', '', t(actionKey)));
          row.append(action);
          const basis = ['domain', 'signature', 'unknown'].includes(entry.basis) ? entry.basis : 'unknown';
          const purpose = ['analytics', 'advertising'].includes(entry.purpose) ? entry.purpose : 'unknown';
          row.append(element('small', 'activity-evidence', t('activity.basis.' + basis)));
          const details = element('details', 'activity-details', '');
          details.dataset.activityKey = rowKey(entry);
          details.open = opened.has(details.dataset.activityKey);
          details.append(element('summary', '', t('transparency.why')));
          const body = element('div', 'activity-detail-body', '');
          body.append(element('p', 'activity-reason', t('transparency.reason.' + (Object.hasOwn(reasons, entry.reason) ? reasons[entry.reason] : 'unknown'))));
          if (typeof entry.ruleId === 'string' && entry.ruleId) body.append(element('code', 'activity-rule', substitute(t, 'transparency.rule', 'id', entry.ruleId)));
          if (typeof entry.resourceType === 'string' && entry.resourceType) body.append(element('span', 'activity-resource', entry.resourceType));
          body.append(element('small', 'activity-evidence', t('activity.purpose.' + purpose)));
          const first = time(entry.firstSeen, t, 'transparency.first');
          const last = time(entry.lastSeen, t, 'transparency.last');
          if (first) body.append(first);
          if (last) body.append(last);
          const reference = source(entry.sourceUrl);
          if (reference && ['domain', 'signature'].includes(basis)) {
            const link = element('a', 'activity-source', t('transparency.source'));
            link.href = reference; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
            body.append(link);
            if (typeof entry.sourceReviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.sourceReviewedAt)) body.append(element('small', 'activity-evidence', substitute(t, 'transparency.reviewed', 'date', entry.sourceReviewedAt)));
          }
          details.append(body); row.append(details);
        } else if (entry.basis === 'signature') row.append(element('small', 'activity-evidence', t('activity.basis.signature')));
        root.append(row);
      }
      if (focusedKey) {
        const replacement = [...root.querySelectorAll('details')].find(node => node.dataset.activityKey === focusedKey);
        replacement?.querySelector(focusSelector)?.focus({ preventScroll: true });
      }
      return { total: rows.length, displayed: Math.min(rows.length, displayLimit) };
    }
  });
})();
