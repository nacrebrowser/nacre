'use strict';

const api = window.nacre;
const $ = (selector) => document.querySelector(selector);
const fallback = {
  "transparency.title": "Protection explained",
  "transparency.intro": "See the companies associated with observed activity, how Nacre handled it and why.",
  "transparency.decision": "Decision",
  "transparency.all": "All decisions",
  "transparency.modified": "Modified",
  "transparency.why": "Why?",
  "transparency.reason.filterRule": "Matched a loaded filter",
  "transparency.reason.strictMode": "Strict third-party policy",
  "transparency.reason.siteException": "Site exception",
  "transparency.reason.blockingDisabled": "Request blocker disabled",
  "transparency.reason.filterException": "Filter exception",
  "transparency.reason.noMatchingRule": "No blocking rule matched",
  "transparency.reason.cookiePolicy": "Cookie policy",
  "transparency.reason.httpsOnly": "HTTPS-only policy",
  "transparency.reason.cookiePurge": "Native cookie cleanup",
  "transparency.reason.unknown": "Reason not recorded",
  "transparency.rule": "Matched rule ID: {id}",
  "transparency.source": "Attribution source",
  "transparency.reviewed": "Registry reviewed: {date}",
  "transparency.first": "First observed: {time}",
  "transparency.last": "Last observed: {time}",
  "transparency.requestAllowed": "Request allowed by Nacre",
  "transparency.requestModified": "Request modified by Nacre",
  "transparency.scope": "Up to 200 recent grouped decisions, kept only in this session. No cookie values or full URLs. An allowed request does not prove a completed connection or tracking. Some JavaScript activity cannot be observed.",
  "transparency.export": "Copy transparency report",
  "transparency.exported": "Transparency report copied locally.",
  "transparency.exportFailed": "Could not copy the transparency report.",
  "transparency.retained": "Showing {count} recent grouped entries",
  "transparency.reportNote": "Copies all retained entries in this session, including those hidden by filters or pagination, with hostnames and cookie names.",
  "transparency.more": "Show more",
  "transparency.sessionTotal": "{count} observed decisions this session",
  "transparency.company": "Company",
  "transparency.allCompanies": "All companies",
  "transparency.uncertainty": "A blocked cookie or an allowed request alone does not establish tracking.",
  "activity.previewTitle": "Cookies & companies filtered",
  "activity.title": "Who was blocked?",
  "activity.intro": "See the cookies filtered by Nacre, their domains and the companies we can identify.",
  "activity.searchLabel": "Search activity",
  "activity.searchPlaceholder": "Company, cookie or domain…",
  "activity.scope": "Local session only · up to 200 recent entries, 50 displayed. No cookie values or full URLs are kept. Counts are interventions, not unique trackers. A blocked cookie is not necessarily a tracker; some JavaScript activity cannot be observed.",
  "activity.private": "Activity from private browsing is not collected in this journal.",
  "activity.empty": "No activity observed yet. Blocked cookies and requests will appear here as you browse.",
  "activity.noMatch": "No matching activity.",
  "activity.unknownCompany": "Company not identified",
  "activity.noCookie": "Cookie not observable",
  "activity.onSite": "On {site}",
  "activity.basis.domain": "Company associated with the observed domain",
  "activity.basis.signature": "Possible technology · cookie-name match",
  "activity.basis.unknown": "No reliable company attribution",
  "activity.purpose.analytics": "Audience measurement",
  "activity.purpose.advertising": "Advertising / conversion measurement",
  "activity.purpose.unknown": "Purpose not established",
  "activity.action.requestBlocked": "Request blocked before a cookie could be observed",
  "activity.action.cookieSendBlocked": "Cookie prevented from being sent",
  "activity.action.cookieSetBlocked": "Cookie storage prevented",
  "activity.action.cookiePurged": "Native cookie removed",
  "activity.scopePrivate": "This private tab only · in memory, without cookie values or full URLs. Cleared when the tab closes and kept separate from normal browsing.",
  "activity.footerPrivate": "This private tab’s data stays in memory and is cleared when the tab closes. The normal journal is not shown here.",
  'dashboard.unknown': 'Unknown',
  'dashboard.waiting': 'Waiting for the session state.',
  'dashboard.partial': 'Partial',
  'dashboard.on': 'On',
  'dashboard.off': 'Off',
  'dashboard.loaded': 'Loaded',
  'dashboard.unavailable': 'Unavailable',
  'dashboard.enabled': 'Enabled',
  'dashboard.disabled': 'Disabled',
  'dashboard.notVerified': 'Not verified',
  'dashboard.notApplicable': 'Not applicable',
  'dashboard.engineEnabled': 'Blocking enabled · {count} site exceptions.',
  'dashboard.engineExceptionsUnknown': 'Blocking enabled; site exceptions are not reported.',
  'dashboard.engineDisabled': 'Request blocking is switched off.',
  'dashboard.engineUnknown': 'Request blocking setting is unknown.',
  'dashboard.routeTor': 'Tor ready',
  'dashboard.routeTorDetail': 'The Tor runtime reports ready. Exit details below are observations, not a network leak test.',
  'dashboard.routeConnecting': 'Connecting',
  'dashboard.routeConnectingDetail': 'Tor is starting or changing identity. A working exit has not been confirmed here.',
  'dashboard.routeNotReady': 'Tor not ready',
  'dashboard.routeNotReadyDetail': 'Tor is selected but its runtime is not ready. A usable exit has not been confirmed.',
  'dashboard.routeBlocked': 'Blocked',
  'dashboard.routeBlockedDetail': 'The session reports a Tor error or a blocked route. Check the network settings.',
  'dashboard.routeUnknownDetail': 'Route readiness is not reported. Connectivity and exit location are unknown.',
  'dashboard.routeDirect': 'Direct',
  'dashboard.routeDirectDetail': 'Direct routing is selected. Tor is not providing this connection.',
  'dashboard.routeManual': 'Manual proxy',
  'dashboard.routeManualDetail': 'A manual proxy is configured. Its connectivity and privacy are not verified here.',
  'dashboard.routeSystem': 'System policy',
  'dashboard.routeSystemDetail': 'System routing mode is reported. Runtime connectivity is not verified here.',
  'dashboard.filterTitle': 'Ads and trackers',
  'dashboard.filterDetail': 'Loaded rules can block matching network requests. Site exceptions may pause blocking; a blocked request is not a unique tracker.',
  'dashboard.cookieTitle': 'Cookie headers',
  'dashboard.cookieThirdParty': 'Third-party filtered',
  'dashboard.cookieAll': 'All filtered',
  'dashboard.cookieAllowed': 'Allowed',
  'dashboard.cookieDetail': "Network headers and direct JavaScript access in blocked frames are guarded. Native cookie writes are conservatively purged. Worker reads and borrowed native accessors are not fully covered.",
  'dashboard.fingerprintTitle': 'Partial page fingerprint guards',
  'dashboard.fingerprintDetail': "Partial Canvas and Web Audio guards are configured. OffscreenCanvas, workers and some frame realms are not protected; this status does not certify effective Canvas protection or anonymity.",
  'dashboard.webglTitle': 'WebGL',
  'dashboard.webglDetail': 'The configured WebGL policy is shown here. Use the privacy tests to check the exposed page APIs.',
  'dashboard.httpsTitle': 'HTTPS-only navigation',
  'dashboard.httpsDetail': 'Controls HTTP navigation warnings. HTTPS means encrypted transport with an accepted certificate; it does not establish anonymity.',
  'dashboard.signalsTitle': 'Privacy signals',
  'dashboard.signalsStatus': 'GPC: {gpc} · DNT: {dnt}',
  'dashboard.signalsDetail': 'These request signals express your preference. Sites decide whether to honor them.',
  'dashboard.webrtcTitle': 'IP, DNS and WebRTC leaks',
  'dashboard.webrtcDetail': 'This dashboard does not measure network leaks or run packet capture. Local privacy tests can inspect page APIs but cannot prove that all traffic stays on the intended route.',
  'dashboard.statsUnavailable': 'Session counters are unavailable.',
  'dashboard.typesEmpty': 'No blocked requests in the available session counters.',
  'dashboard.sitesEmpty': 'Sites will appear when their requests are blocked.',
  'dashboard.typesUnknown': 'Request types not reported',
  'dashboard.blockedCount': '{count} blocked',
  'dashboard.cleared': 'Session counters cleared.',
  'dashboard.clearFailed': 'Could not clear the counters. Try again.',
  'dashboard.clearUnconfirmed': 'Clear request sent; the updated counters have not been confirmed.',
  'dashboard.clearing': 'Clearing counters…'
};
let messages = Object.create(null);
let state;
let locale = 'en';
let localeSequence = 0;
let requestedLocale;
let clearing = false;
let clearTimer;
let feedbackKey;
let reportFeedbackKey;
let copyingReport = false;
let activityLimit = 50;
let activityScope;

function t(key, values = {}) {
  let value = typeof messages[key] === 'string' ? messages[key] : fallback[key] || key;
  for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

function number(value) { return new Intl.NumberFormat(locale).format(value); }
function validCount(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function entries(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []; }
function counts(value) { return entries(value).filter(([, count]) => validCount(count) && count > 0).sort((a, b) => b[1] - a[1]); }
function boolLabel(value) { return t(value === true ? 'dashboard.on' : value === false ? 'dashboard.off' : 'dashboard.unknown'); }

function empty(root, key) {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = t(key);
  root.replaceChildren(element);
}

function status(element, key, tone = 'neutral') {
  const label = t(key);
  if (element.textContent !== label) element.textContent = label;
  element.dataset.tone = tone;
}

function renderRoute(prefs) {
  const proxy = prefs.proxy;
  let key = 'dashboard.unknown';
  let detail = state ? 'dashboard.routeUnknownDetail' : 'dashboard.waiting';
  let tone = 'neutral';
  if (proxy?.mode === 'blocked' || (proxy?.mode === 'tor' && proxy.torError)) {
    key = 'dashboard.routeBlocked'; detail = 'dashboard.routeBlockedDetail'; tone = 'warning';
  } else if (proxy?.mode === 'tor') {
    if (proxy.torConnecting === true || proxy.torConnectingCountry || proxy.torIdentityChanging === true) {
      key = 'dashboard.routeConnecting'; detail = 'dashboard.routeConnectingDetail';
    } else if (proxy.torReady === true) {
      key = 'dashboard.routeTor'; detail = 'dashboard.routeTorDetail'; tone = 'active';
    } else if (proxy.torReady === false) {
      key = 'dashboard.routeNotReady'; detail = 'dashboard.routeNotReadyDetail';
    }
  } else if (proxy?.mode === 'direct') {
    key = 'dashboard.routeDirect'; detail = 'dashboard.routeDirectDetail';
  } else if (proxy?.mode === 'manual') {
    key = 'dashboard.routeManual'; detail = 'dashboard.routeManualDetail';
  } else if (proxy?.mode === 'system') {
    key = 'dashboard.routeSystem'; detail = 'dashboard.routeSystemDetail';
  }
  status($('#route-status'), key, tone);
  $('#route-detail').textContent = t(detail);
  const tor = proxy?.mode === 'tor';
  const nonTor = ['direct', 'manual', 'system', 'blocked'].includes(proxy?.mode);
  const unknown = t('dashboard.unknown');
  const notApplicable = t('dashboard.notApplicable');
  $('#tor-country').textContent = tor ? (typeof proxy.torLabel === 'string' && proxy.torLabel || proxy.torCountry || unknown) : nonTor ? notApplicable : unknown;
  $('#tor-ip').textContent = tor ? (proxy.torReady === true && typeof proxy.torExitIp === 'string' && proxy.torExitIp || unknown) : nonTor ? notApplicable : unknown;
  $('#tor-circuits').textContent = tor ? (validCount(proxy.torCircuitCount) ? number(proxy.torCircuitCount) : unknown) : nonTor ? notApplicable : unknown;
}

function renderProtections(prefs) {
  const enabled = prefs.adBlockEnabled;
  const ready = prefs.blockerReady;
  const blockingKey = enabled === false ? 'dashboard.disabled' : enabled === true && ready === true ? 'dashboard.enabled' : ready === false ? 'dashboard.unavailable' : 'dashboard.unknown';
  const cookieKey = { 'block-third-party': 'dashboard.cookieThirdParty', 'block-all': 'dashboard.cookieAll', allow: 'dashboard.cookieAllowed' }[prefs.cookiePolicy] || 'dashboard.unknown';
  const rows = [
    ['dashboard.filterTitle', t(blockingKey), 'dashboard.filterDetail', enabled === true && ready === true ? 'active' : ready === false && enabled === true ? 'warning' : 'neutral'],
    ['dashboard.cookieTitle', t(cookieKey), 'dashboard.cookieDetail', ['block-all', 'block-third-party'].includes(prefs.cookiePolicy) ? 'active' : 'neutral'],
    ['dashboard.fingerprintTitle', prefs.antiFingerprint ? t('dashboard.partial') : boolLabel(false), 'dashboard.fingerprintDetail', 'neutral'],
    ['dashboard.webglTitle', t(prefs.webglMode === 'disabled' ? 'dashboard.disabled' : 'dashboard.unknown'), 'dashboard.webglDetail', 'neutral'],
    ['dashboard.httpsTitle', boolLabel(prefs.httpsOnly), 'dashboard.httpsDetail', 'neutral'],
    ['dashboard.signalsTitle', t('dashboard.signalsStatus', { gpc: boolLabel(prefs.sendGpc), dnt: boolLabel(prefs.sendDnt) }), 'dashboard.signalsDetail', 'neutral'],
    ['dashboard.webrtcTitle', t('dashboard.notVerified'), 'dashboard.webrtcDetail', 'neutral']
  ];
  const root = $('#protections');
  root.replaceChildren();
  for (const [title, label, detail, tone] of rows) {
    const row = document.createElement('div'); row.className = 'protection-row';
    const heading = document.createElement('h3'); heading.textContent = t(title);
    const badge = document.createElement('span'); badge.className = 'status'; badge.dataset.tone = tone; badge.textContent = label;
    const description = document.createElement('p'); description.textContent = t(detail);
    row.append(heading, badge, description); root.append(row);
  }
}

function renderStats(prefs) {
  // Only consume the normal-session aggregate supplied by main. Never merge in
  // tab counters: private tabs must not contribute to this page's statistics.
  const stats = prefs.adBlockStats;
  const available = stats && stats.available !== false && stats.private !== true && stats.scope !== 'private' && validCount(stats.total);
  $('#total').textContent = available ? number(stats.total) : '—';
  const sites = available ? entries(stats.bySite).filter(([, entry]) => entry && validCount(entry.total) && entry.total > 0).sort((a, b) => b[1].total - a[1].total) : [];
  const hasSites = available && stats.bySite && typeof stats.bySite === 'object' && !Array.isArray(stats.bySite);
  $('#sites-count').textContent = hasSites ? number(sites.length) : '—';
  $('#clear').disabled = clearing || (!available && prefs.protectionActivity?.available !== true) || typeof api?.clearProtectionStats !== 'function';
  $('#engine').textContent = t(prefs.blockerReady === true ? 'dashboard.loaded' : prefs.blockerReady === false ? 'dashboard.unavailable' : 'dashboard.unknown');
  $('#engine-detail').textContent = prefs.adBlockEnabled === true
    ? Array.isArray(prefs.adBlockSiteExceptions) ? t('dashboard.engineEnabled', { count: number(prefs.adBlockSiteExceptions.length) }) : t('dashboard.engineExceptionsUnknown')
    : t(prefs.adBlockEnabled === false ? 'dashboard.engineDisabled' : 'dashboard.engineUnknown');

  const typeRoot = $('#types');
  const types = available ? counts(stats.byType) : [];
  const hasTypes = available && stats.byType && typeof stats.byType === 'object' && !Array.isArray(stats.byType);
  typeRoot.replaceChildren();
  if (!hasTypes) empty(typeRoot, 'dashboard.statsUnavailable');
  else if (!types.length) empty(typeRoot, 'dashboard.typesEmpty');
  const maxType = Math.max(1, ...types.map(([, count]) => count));
  for (const [type, count] of types) {
    const row = document.createElement('div'); row.className = 'bar-row';
    const label = document.createElement('span'); label.textContent = type;
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); track.classList.add('bar-track'); track.setAttribute('viewBox', '0 0 100 8'); track.setAttribute('preserveAspectRatio', 'none'); track.setAttribute('aria-hidden', 'true');
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); fill.classList.add('bar-fill'); fill.setAttribute('width', String(Math.max(1, count / maxType * 100))); fill.setAttribute('height', '8'); track.append(fill);
    const value = document.createElement('b'); value.className = 'bar-value'; value.textContent = number(count);
    row.append(label, track, value); typeRoot.append(row);
  }

  const siteRoot = $('#sites'); siteRoot.replaceChildren();
  if (!hasSites) empty(siteRoot, 'dashboard.statsUnavailable');
  else if (!sites.length) empty(siteRoot, 'dashboard.sitesEmpty');
  for (const [host, entry] of sites.slice(0, 20)) {
    const row = document.createElement('div'); row.className = 'site-row';
    const details = document.createElement('div');
    const name = document.createElement('b'); name.textContent = host;
    const typesForSite = counts(entry.byType).map(([type, count]) => `${type} ${number(count)}`).join(' · ');
    const typeList = document.createElement('small'); typeList.textContent = typesForSite || t('dashboard.typesUnknown');
    details.append(name, typeList);
    const count = document.createElement('span'); count.textContent = t('dashboard.blockedCount', { count: number(entry.total) });
    row.append(details, count); siteRoot.append(row);
  }
}

function renderCookieActivity(prefs) {
  const activity = prefs.protectionActivity;
  const footer = document.querySelector('footer');
  footer.dataset.i18n = activity?.scope === 'private' ? 'activity.footerPrivate' : 'dashboard.footer';
  footer.textContent = t(footer.dataset.i18n);
  const available = activity?.available === true && ['normal', 'private'].includes(activity.scope);
  $('#activity-count').textContent = available && validCount(activity.total) ? t('transparency.sessionTotal', { count: number(activity.total) }) : '—';
  $('#activity-private-scope').hidden = activity?.scope !== 'private';
  if (activityScope !== activity?.scope) {
    activityScope = activity?.scope;
    activityLimit = 50;
    $('#activity-search').value = '';
    $('#activity-decision').value = 'all';
    $('#activity-company').value = '';
    reportFeedbackKey = undefined;
  }
  const companies = new Map();
  if (available && Array.isArray(activity.entries)) for (const entry of activity.entries.slice(0, 200)) {
    if (entry && typeof entry.company === 'string' && entry.company && validCount(entry.count) && entry.count > 0) companies.set(entry.company, Math.min(Number.MAX_SAFE_INTEGER, (companies.get(entry.company) || 0) + entry.count));
  }
  const companySelect = $('#activity-company');
  const companyNames = [...companies.keys()].sort((a, b) => a.localeCompare(b));
  // Keep this control stable during state updates so keyboard focus is retained.
  const companySignature = JSON.stringify([locale, ...companyNames]);
  if (companySelect.dataset.companies !== companySignature) {
    const selected = companySelect.value;
    const allOption = document.createElement('option'); allOption.value = ''; allOption.textContent = t('transparency.allCompanies');
    companySelect.replaceChildren(allOption);
    for (const company of companyNames) {
      const option = document.createElement('option'); option.value = company; option.textContent = company; companySelect.append(option);
    }
    companySelect.value = companies.has(selected) ? selected : '';
    companySelect.dataset.companies = companySignature;
  }
  const query = $('#activity-search').value;
  const result = window.NacreProtectionActivity.render($('#cookie-activity'), activity, t, { query, limit: activityLimit, decision: $('#activity-decision').value, company: companySelect.value });
  $('#activity-retained').textContent = t('transparency.retained', { count: number(result.displayed) });
  $('#activity-more').hidden = result.displayed >= result.total;
  $('#copy-transparency-report').disabled = copyingReport || !available || typeof api?.copyTransparencyReport !== 'function';
  $('#transparency-report-feedback').textContent = reportFeedbackKey ? t(reportFeedbackKey) : '';
  const root = $('#activity-companies'); root.replaceChildren();
  for (const [company, count] of [...companies].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'activity-company-filter';
    badge.textContent = company + ' · ' + number(count);
    badge.addEventListener('click', () => { $('#activity-search').value = company; companySelect.value = ''; activityLimit = 50; renderCookieActivity(state?.settings || {}); });
    root.append(badge);
  }
}

function filterActivity() { activityLimit = 50; renderCookieActivity(state?.settings || {}); }
$('#activity-search').addEventListener('input', filterActivity);
$('#activity-decision').addEventListener('change', filterActivity);
$('#activity-company').addEventListener('change', filterActivity);
$('#activity-more').addEventListener('click', () => {
  activityLimit = Math.min(200, activityLimit + 50);
  renderCookieActivity(state?.settings || {});
});
$('#copy-transparency-report').addEventListener('click', async () => {
  if (copyingReport || typeof api?.copyTransparencyReport !== 'function') return;
  copyingReport = true;
  reportFeedbackKey = undefined;
  renderCookieActivity(state?.settings || {});
  try {
    const result = await api.copyTransparencyReport();
    reportFeedbackKey = result === true || result?.ok === true ? 'transparency.exported' : 'transparency.exportFailed';
  } catch { reportFeedbackKey = 'transparency.exportFailed'; }
  copyingReport = false;
  renderCookieActivity(state?.settings || {});
});

function render(next) {
  state = next;
  const prefs = state?.settings || {};
  renderRoute(prefs);
  renderProtections(prefs);
  renderStats(prefs);
  renderCookieActivity(prefs);
  if (feedbackKey) $('#feedback').textContent = t(feedbackKey);
  if (typeof prefs.language === 'string' && prefs.language !== requestedLocale) loadCatalogue(prefs.language);
}

async function loadCatalogue(language) {
  if (typeof language !== 'string' || typeof api?.getMessages !== 'function') return;
  requestedLocale = language;
  const sequence = ++localeSequence;
  try {
    const catalogue = await api.getMessages(language);
    if (sequence !== localeSequence) return;
    messages = catalogue && typeof catalogue === 'object' ? catalogue : Object.create(null);
    locale = language;
    document.documentElement.lang = language;
    document.documentElement.dir = /^(?:ar|fa|he|ur|ps|sd|ckb|yi|dv)(?:-|$)/i.test(language) ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n;
      if (typeof messages[key] === 'string') element.textContent = messages[key];
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((element) => {
      for (const mapping of element.dataset.i18nAttr.split(';')) {
        const [attribute, key] = mapping.split(':', 2);
        if (['aria-label', 'placeholder'].includes(attribute) && typeof messages[key] === 'string') element.setAttribute(attribute, messages[key]);
      }
    });
    render(state);
  } catch {
    if (sequence === localeSequence) requestedLocale = undefined;
  }
}

function setFeedback(key) {
  feedbackKey = key;
  $('#feedback').textContent = t(key);
}

function applyState(next) {
  if (clearing && next?.settings?.adBlockStats?.total === 0 && (next.settings.protectionActivity?.total ?? 0) === 0) {
    clearing = false;
    reportFeedbackKey = undefined;
    window.clearTimeout(clearTimer);
    setFeedback('dashboard.cleared');
  }
  render(next);
}

$('#clear').addEventListener('click', async () => {
  if (clearing || typeof api?.clearProtectionStats !== 'function') return;
  clearing = true;
  $('#clear').disabled = true;
  setFeedback('dashboard.clearing');
  clearTimer = window.setTimeout(() => {
    clearing = false;
    setFeedback('dashboard.clearUnconfirmed');
    render(state);
  }, 5000);
  try {
    await api.clearProtectionStats();
  } catch {
    window.clearTimeout(clearTimer);
    clearing = false;
    setFeedback('dashboard.clearFailed');
    render(state);
  }
});
window.addEventListener('nacre:locale-ready', (event) => {
  if (event.detail !== requestedLocale) loadCatalogue(event.detail);
});
render(undefined);
if (typeof api?.onState === 'function') api.onState(applyState);
if (typeof api?.getLanguage === 'function') api.getLanguage().then(loadCatalogue).catch(() => {});
