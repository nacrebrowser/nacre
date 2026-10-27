'use strict';
(() => {
  const root = document.querySelector('#privacy-check');
  const api = window.nacre;
  const text = (key, fallback, values = {}) => {
    const value = api.getLocaleText(key);
    let result = value && value !== key ? value : fallback;
    for (const [name, replacement] of Object.entries(values)) result = result.replaceAll('{' + name + '}', String(replacement));
    return result;
  };
  const output = root.querySelector('[role=status]');
  // Shown until the first report; written again once the catalogue is loaded.
  const showLoading = () => {
    if (root.querySelector('#pc-summary').dataset.tone === 'loading') root.querySelector('#pc-summary-title').textContent = text('privacyCheck.summary.loading', 'Checking…');
  };
  showLoading();
  const invoke = (action, data) => api.privacyCenter(action, data);

  function element(tag, value, className) {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function button(label, run, className) {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', async () => {
      node.disabled = true;
      try { await run(); } catch (error) { output.textContent = error.message; } finally { node.disabled = false; }
    });
    return node;
  }

  // One tone per row: ok (protected), review (needs attention), info (neutral).
  const glyph = { ok: '✓', review: '!', info: 'i' };

  function row({ tone, title, detail, action }) {
    const item = element('div', '', 'card pc-item');
    item.dataset.tone = tone;
    const icon = element('span', glyph[tone], 'pc-icon');
    icon.setAttribute('aria-hidden', 'true');
    const copy = element('div', '', 'pc-copy');
    copy.append(element('b', title), element('small', detail));
    item.append(icon, copy);
    if (action) item.append(action);
    return item;
  }

  // Core protections: a plain sentence for the current state, and a button that
  // says what it will do.
  function describeCore(item) {
    const on = item.status === 'enabled';
    const fix = (label) => item.action ? button(label, async () => { await invoke('apply', item.id); await refresh(); }) : null;
    switch (item.id) {
      case 'httpsOnly':
        return on
          ? { tone: 'ok', title: text('privacyCheck.https.title', 'HTTPS-only browsing'), detail: text('privacyCheck.https.on', 'Nacre warns you before opening a site that is not encrypted (http://).') }
          : { tone: 'review', title: text('privacyCheck.https.title', 'HTTPS-only browsing'), detail: text('privacyCheck.https.off', 'Sites that are not encrypted (http://) open without a warning.'), action: fix(text('privacyCheck.fix.turnOn', 'Turn on')) };
      case 'adBlockEnabled':
        return on
          ? { tone: 'ok', title: text('privacyCheck.blocker.title', 'Ads and trackers'), detail: text('privacyCheck.blocker.on', 'Known ad and tracker requests are blocked.') }
          : { tone: 'review', title: text('privacyCheck.blocker.title', 'Ads and trackers'), detail: text('privacyCheck.blocker.off', 'Blocking is off, so known trackers can follow you from site to site.'), action: fix(text('privacyCheck.fix.turnOn', 'Turn on')) };
      case 'cookiePolicy':
        return on
          ? { tone: 'ok', title: text('privacyCheck.cookies.title', 'Third-party cookies'), detail: text('privacyCheck.cookies.on', 'Cookies set by other sites inside the page are filtered. This does not isolate all site storage.') }
          : { tone: 'review', title: text('privacyCheck.cookies.title', 'Third-party cookies'), detail: text('privacyCheck.cookies.off', 'All cookies are allowed, including those other sites set to follow you.'), action: fix(text('privacyCheck.fix.filterCookies', 'Filter third-party cookies')) };
      case 'tor':
        if (item.status === 'connected') return { tone: 'ok', title: text('privacyCheck.tor.title', 'Connection'), detail: text('privacyCheck.tor.connected', 'Tor is connected. Websites see a Tor exit address instead of yours.') };
        if (item.status === 'connecting-or-unavailable') return { tone: 'review', title: text('privacyCheck.tor.title', 'Connection'), detail: text('privacyCheck.tor.pending', 'Tor is starting or unavailable. Browsing stays blocked until it connects.'), action: button(text('settings.nav.network', 'Network and Tor'), () => { location.hash = 'network'; }) };
        return { tone: 'info', title: text('privacyCheck.tor.title', 'Connection'), detail: text('privacyCheck.tor.direct', 'Nacre connects directly, so websites see your IP address. Turn on Tor to hide it from them.'), action: button(text('settings.nav.network', 'Network and Tor'), () => { location.hash = 'network'; }) };
      case 'filters':
        return item.status === 'recent'
          ? { tone: 'ok', title: text('privacyCheck.filters.title', 'Filter lists'), detail: text('privacyCheck.filters.recent', 'Updated within the last 7 days.') }
          : { tone: 'info', title: text('privacyCheck.filters.title', 'Filter lists'), detail: text('privacyCheck.filters.old', 'Using the list bundled with Nacre, or lists older than 7 days. You can update them in the ad blocker settings.'), action: button(text('settings.nav.adblock', 'Ad blocker'), () => { location.hash = 'adblock'; }) };
      default:
        return { tone: 'info', title: item.id, detail: '' };
    }
  }

  // Exceptions come from ids built by privacy-check.cjs: kind:workspace:host[:permission].
  function describeException(item) {
    const parts = item.id.split(':');
    const kind = parts[0];
    const remove = (label) => button(label, async () => { await invoke('apply', item.id); await refresh(); });
    if (kind === 'filter-exception') {
      return { tone: 'review', title: parts.slice(1).join(':'), detail: text('privacyCheck.exception.filter', 'Ad and tracker blocking is off on this site.'), action: remove(text('privacyCheck.fix.blockAgain', 'Block again')) };
    }
    if (kind === 'cookie-exception') {
      return { tone: 'review', title: parts.slice(2).join(':'), detail: text('privacyCheck.exception.cookies', 'Third-party cookies are allowed on this site.'), action: remove(text('privacyCheck.fix.filterAgain', 'Filter cookies again')) };
    }
    const permission = parts.at(-1);
    const names = { media: 'siteControls.permission.media', geolocation: 'siteControls.permission.geolocation', notifications: 'siteControls.permission.notifications' };
    const label = names[permission] ? text(names[permission], permission) : permission;
    return { tone: 'review', title: parts.slice(2, -1).join(':'), detail: text('privacyCheck.exception.permission', 'Allowed: {permission}', { permission: label }), action: remove(text('privacyCheck.fix.revoke', 'Revoke')) };
  }

  const EXCEPTION_KINDS = new Set(['filter-exception', 'cookie-exception', 'permission']);

  root.querySelector('#tracking-links-enabled').addEventListener('change', async (event) => {
    try { await invoke('tracking-links', event.target.checked); } catch (error) { output.textContent = error.message; }
  });

  function renderSummary(core, exceptionCount) {
    const toReview = core.filter((entry) => entry.tone === 'review').length;
    const summary = root.querySelector('#pc-summary');
    const good = toReview === 0;
    summary.dataset.tone = good ? 'ok' : 'review';
    root.querySelector('#pc-summary-icon').textContent = good ? '✓' : '!';
    root.querySelector('#pc-summary-title').textContent = good
      ? text('privacyCheck.summary.good', 'Your main protections are on')
      : text('privacyCheck.summary.review', 'To review: {count}', { count: toReview });
    const lines = [good
      ? text('privacyCheck.summary.goodDetail', 'Nothing needs your attention. This review only reads your settings; it does not test for leaks.')
      : text('privacyCheck.summary.reviewDetail', 'Each item below says what is off and offers a one-click fix. This review only reads your settings; it does not test for leaks.')];
    if (exceptionCount > 0) lines.push(text('privacyCheck.summary.exceptions', 'Site exceptions you allowed: {count}.', { count: exceptionCount }));
    root.querySelector('#pc-summary-detail').textContent = lines.join(' ');
  }

  async function refresh() {
    const report = await invoke('snapshot');
    const findings = root.querySelector('#privacy-findings');
    const exceptions = root.querySelector('#privacy-exceptions');
    findings.replaceChildren();
    exceptions.replaceChildren();
    const core = [];
    let exceptionCount = 0;
    for (const item of report.check.items) {
      const kind = item.id.split(':')[0];
      if (EXCEPTION_KINDS.has(kind)) {
        exceptions.append(row(describeException(item)));
        exceptionCount += 1;
      } else {
        const entry = describeCore(item);
        core.push(entry);
        findings.append(row(entry));
      }
    }
    if (!exceptionCount) exceptions.append(element('p', text('privacyCheck.noExceptions', 'No exceptions. Every site follows your protection settings.'), 'pc-empty'));
    renderSummary(core, exceptionCount);

    const profiles = root.querySelector('#local-profiles');
    profiles.replaceChildren();
    for (const profile of report.profiles || []) {
      const item = element('div', '', 'card pc-item pc-profile');
      const copy = element('div', '', 'pc-copy');
      copy.append(element('b', profile.name));
      if (profile.active) copy.append(element('small', text('privacyCheck.active', 'Active')));
      item.append(copy);
      if (!profile.active) item.append(button(text('privacyCheck.switch', 'Use on next launch'), async () => { await invoke('profile-select', profile.id); output.textContent = text('privacyCheck.restart', 'Close Nacre and launch it again to use the selected profile.'); }));
      if (!profile.active && profile.id !== 'personal') item.append(button(text('privacyCheck.retire', 'Remove from list (keep files)'), async () => { await invoke('profile-retire', profile.id); await refresh(); }));
      profiles.append(item);
    }
    root.querySelector('#vault-state').textContent = report.vaultEnabled ? text('privacyCheck.vaultOn', 'Settings vault enabled. Unlock is required on launch.') : text('privacyCheck.vaultOff', 'Settings vault disabled.');
    root.querySelector('#vault-enable').hidden = report.vaultEnabled;
    root.querySelector('#vault-disable').hidden = !report.vaultEnabled;
    root.querySelector('#vault-change').hidden = !report.vaultEnabled;
    root.querySelector('#tracking-links-enabled').checked = report.cleanTrackingLinks;
    output.textContent = text('privacyCheck.complete', 'Local review complete. No network leak test was performed.');
  }

  const reportError = (error) => { output.textContent = error.message; };
  root.querySelector('#privacy-refresh').addEventListener('click', () => refresh().catch(reportError));
  root.querySelector('#profile-create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = root.querySelector('#new-profile-name');
    try { await invoke('profile-create', input.value); input.value = ''; await refresh(); } catch (error) { reportError(error); }
  });
  const changeButton = element('button', text('privacyCheck.changePassword', 'Change primary password'));
  changeButton.id = 'vault-change';
  changeButton.dataset.i18n = 'privacyCheck.changePassword';
  changeButton.type = 'button';
  root.querySelector('#vault-disable').after(changeButton);
  for (const mode of ['enable', 'disable', 'change']) {
    root.querySelector('#vault-' + mode).addEventListener('click', async () => {
      try { await invoke('vault-' + mode); await refresh(); } catch (error) { reportError(error); }
    });
  }
  const refreshIfVisible = () => { if (location.hash === '#privacy-check') refresh().catch(reportError); };
  window.addEventListener('hashchange', refreshIfVisible);
  // The catalogue arrives after the first paint: redraw so the sentences use it.
  window.addEventListener('nacre:locale-ready', () => { showLoading(); refreshIfVisible(); });
  refreshIfVisible();
})();
