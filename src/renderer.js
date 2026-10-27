const api = window.nacre;
const $ = (selector) => document.querySelector(selector);
const appendIcon = (node, name) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); node.append(svg); };
const icon = (name) => '<svg aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
const chrome = $('#chrome');
const address = $('#address');
const home = $('#home');
const layer = $('#popover-layer');
const shieldPanel = $('#protection-panel');
const settingsPanel = $('#settings-panel');
const aboutOverlay = $('#about-overlay');
const vpnMenu = $('#vpn-menu');
const browserMenu = $('#browser-menu');
const browserMenuButton = $('#browser-menu-button');
const toast = $('#toast');
const messages = Object.create(null);
const t = (key) => typeof messages[key] === 'string' ? messages[key] : key;
let state = null;
let expanded = false;
let toastTimer;
let draggedTabId = null;
let tabSearchQuery = '';

function updateLayout() {
  const height = chrome.getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--chrome-height', Math.ceil(height) + 'px');
  api.layout(height, expanded);
}

function renderTabs() {
  if (!state) return;
  const container = $('#tab-list');
  container.replaceChildren();
  state.tabs.forEach((tab) => {
    if (state.workspaces && tab.workspaceId !== state.workspaces.activeId) return;
    if (tabSearchQuery && !(tab.title + ' ' + tab.url).toLocaleLowerCase('fr').includes(tabSearchQuery)) return;
    const item = document.createElement('div');
    item.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.private ? ' tab-private' : '') + (tab.pinned ? ' tab-pinned' : '') + (tab.muted ? ' tab-muted' : '') + (tab.suspended ? ' tab-suspended' : '') + (tab.loading && !tab.home ? ' tab-loading' : '');
    item.draggable = true;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(tab.id === state.activeId));
    if (tab.groupColor) item.style.boxShadow = 'inset 0 2px 0 ' + tab.groupColor;
    if (tab.group) item.title = t('tabs.group').replace('{name}', tab.group);
    item.tabIndex = 0;
    const favicon = document.createElement('span');
    favicon.className = 'tab-favicon';
    if (!tab.suspended && isSafeFavicon(tab.favicon)) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = tab.favicon;
      favicon.append(image);
    } else if (tab.home && !tab.private && !tab.suspended) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = 'logo.svg';
      favicon.append(image);
    } else {
      appendIcon(favicon, tab.suspended ? 'sleep' : tab.private ? 'moon' : 'globe');
    }
    const cleanTitle = (tab.title || t('tabs.newTitle')).replace(/\s*—\s*Nacre\s*$/i, '');
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = cleanTitle;
    item.title = (tab.title || cleanTitle) + (tab.suspended ? ' · ' + t('tabs.suspended') : '');
    if (tab.group) { const group = document.createElement('span'); group.className = 'tab-group-label'; group.textContent = tab.group; group.style.color = tab.groupColor; item.append(favicon, group, title); }
    else item.append(favicon, title);
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.title = t('tabs.close');
    close.setAttribute('aria-label', t('tabs.closeNamed').replace('{title}', cleanTitle));
    appendIcon(close, 'close');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      api.closeTab(tab.id);
    });
    item.append(close);
    item.addEventListener('click', () => api.activateTab(tab.id));
    item.addEventListener('contextmenu', (event) => { event.preventDefault(); api.showTabMenu(tab.id); });
    item.addEventListener('dragstart', (event) => { draggedTabId = tab.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(tab.id)); });
    item.addEventListener('dragover', (event) => { if (draggedTabId !== null) event.preventDefault(); });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const moving = draggedTabId;
      draggedTabId = null;
      if (moving === null || moving === tab.id) return;
      const ordered = state.tabs.map((entry) => entry.id).filter((id) => id !== moving);
      const index = ordered.indexOf(tab.id);
      ordered.splice(index < 0 ? ordered.length : index, 0, moving);
      api.reorderTabs(ordered);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') api.activateTab(tab.id);
    });
    container.append(item);
  });
  container.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function safeDisplayHost(value) {
  try { return new URL(value).host; } catch { return t('address.placeholder'); }
}

// Favicons arrive from the main process already re-encoded as small PNGs.
function isSafeFavicon(value) {
  return typeof value === 'string' && value.length < 20000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}

function faviconForUrl(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return ''; }
  const match = (state?.tabs || []).find((tab) => !tab.private && tab.host === host && isSafeFavicon(tab.favicon));
  return match ? match.favicon : siteIconCache.get(host) || '';
}

// Icons of shortcuts and bookmarks kept by the main process (site-icons.cjs).
// Missing ones are fetched there over Tor only; the list is asked again when
// the store changes or Tor connects.
const siteIconCache = new Map();
let siteIconRequestKey = '';
function iconHostsWanted() {
  const urls = [...(state?.settings.home?.shortcuts || []), ...(state?.bookmarks || []).slice(0, 40)].map((item) => item.url);
  return [...new Set(urls.map((url) => { try { return new URL(url).hostname; } catch { return ''; } }).filter(Boolean))];
}
function refreshSiteIcons() {
  if (!state) return;
  const hosts = iconHostsWanted();
  const key = [state.settings.siteIconsVersion, state.settings.proxy?.torReady, hosts.join(',')].join('|');
  if (key === siteIconRequestKey) return;
  siteIconRequestKey = key;
  api.siteIcons(hosts).then((icons) => {
    let changed = false;
    for (const [host, icon] of Object.entries(icons || {})) {
      if (isSafeFavicon(icon) && siteIconCache.get(host) !== icon) { siteIconCache.set(host, icon); changed = true; }
    }
    if (changed) { renderBookmarksBar(); window.dispatchEvent(new Event('nacre:site-icons')); }
  }).catch(() => {});
}

// A coloured letter stands in for a site icon that Nacre has not seen yet.
function siteBadge(url, title, size) {
  const favicon = faviconForUrl(url);
  if (favicon) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = favicon;
    image.width = size;
    image.height = size;
    return image;
  }
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const label = (title || host || '?').trim();
  const badge = document.createElement('span');
  badge.className = 'site-monogram';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = (host || label).charAt(0).toLocaleUpperCase() || '?';
  let hash = 0;
  for (const character of host || label) hash = (hash * 31 + character.codePointAt(0)) % 360;
  badge.style.setProperty('--monogram-hue', String(hash));
  return badge;
}

function homeTile(url, title, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = url;
  const iconHolder = document.createElement('span');
  iconHolder.className = 'home-tile-icon';
  iconHolder.append(siteBadge(url, title, 24));
  const label = document.createElement('span');
  label.className = 'home-tile-label';
  label.textContent = title || safeDisplayHost(url);
  button.append(iconHolder, label);
  button.addEventListener('click', () => api.navigate(url));
  return button;
}

function renderBookmarksBar() {
  const bar = $('#bookmarks-bar');
  const visible = Boolean(state && state.settings.showBookmarksBar && state.bookmarks && state.bookmarks.length);
  if (bar.hidden !== !visible) {
    bar.hidden = !visible;
    requestAnimationFrame(updateLayout);
  }
  if (!visible) { bar.replaceChildren(); return; }
  bar.replaceChildren();
  state.bookmarks.slice(0, 40).forEach((bookmark) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = (bookmark.title ? bookmark.title + '\n' : '') + bookmark.url;
    const text = document.createElement('span');
    text.textContent = bookmark.title || safeDisplayHost(bookmark.url);
    button.append(siteBadge(bookmark.url, bookmark.title, 16), text);
    button.addEventListener('click', () => api.navigate(bookmark.url));
    bar.append(button);
  });
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'bookmarks-bar-all';
  all.title = t('commands.bookmarks');
  all.setAttribute('aria-label', t('commands.bookmarks'));
  appendIcon(all, 'folder');
  all.addEventListener('click', () => api.openBookmarks());
  bar.append(all);
}

function renderHomeStats() {
  const total = Number(state?.settings?.adBlockStats?.total || 0);
  const holder = $('#home-stats');
  holder.hidden = !(total > 0);
  if (!total) return;
  const text = $('#home-stats-text');
  const [before, after = ''] = t('home.statsBlocked').split('{count}');
  const count = document.createElement('strong');
  count.textContent = new Intl.NumberFormat(document.documentElement.lang || 'en').format(total);
  text.replaceChildren(before, count, after);
}

const suggestions = $('#address-suggestions');
let suggestionItems = [];
let suggestionIndex = -1;

function closeAddressSuggestions() {
  if (suggestions.hidden) return;
  suggestions.hidden = true;
  suggestions.replaceChildren();
  suggestionItems = [];
  suggestionIndex = -1;
  chrome.classList.remove('with-suggestions');
  chrome.style.removeProperty('--suggestions-height');
  updateLayout();
}

function paintSuggestionSelection() {
  suggestions.querySelectorAll('button[role="option"]').forEach((button, index) => {
    button.classList.toggle('is-active', index === suggestionIndex);
    button.setAttribute('aria-selected', String(index === suggestionIndex));
    if (index === suggestionIndex) button.scrollIntoView({ block: 'nearest' });
  });
}

function renderAddressSuggestions() {
  if (!state || document.activeElement !== address || !address.value.trim()) { closeAddressSuggestions(); return; }
  const matches = window.NacreAddressSuggestions
    ? window.NacreAddressSuggestions.filterBookmarks(state.bookmarks || [], address.value)
    : [];
  if (!matches.length) { closeAddressSuggestions(); return; }
  suggestionItems = matches;
  suggestionIndex = -1;
  suggestions.replaceChildren();
  const caption = document.createElement('div');
  caption.className = 'suggestion-caption';
  caption.textContent = t('address.suggestionsLabel');
  suggestions.append(caption);
  matches.forEach((bookmark) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    appendIcon(button, 'bookmark');
    const copy = document.createElement('span');
    copy.className = 'suggestion-copy';
    const title = document.createElement('span');
    title.className = 'suggestion-title';
    title.textContent = bookmark.title || safeDisplayHost(bookmark.url);
    const host = document.createElement('span');
    host.className = 'suggestion-host';
    host.textContent = safeDisplayHost(bookmark.url);
    copy.append(title);
    button.append(copy, host);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      closeAddressSuggestions();
      api.navigate(bookmark.url);
      address.blur();
    });
    suggestions.append(button);
  });
  suggestions.hidden = false;
  const chromeRect = chrome.getBoundingClientRect();
  const addressRect = address.getBoundingClientRect();
  suggestions.style.left = Math.max(0, addressRect.left - chromeRect.left) + 'px';
  suggestions.style.top = Math.round(addressRect.bottom - chromeRect.top + 6) + 'px';
  suggestions.style.width = Math.round(addressRect.width) + 'px';
  chrome.classList.add('with-suggestions');
  // Measure synchronously: a background or hidden window can throttle frames,
  // which previously left the page content underneath the suggestion list.
  const reserveSuggestionHeight = () => {
    chrome.style.setProperty('--suggestions-height', suggestions.offsetHeight + 'px');
    updateLayout();
  };
  reserveSuggestionHeight();
  requestAnimationFrame(reserveSuggestionHeight);
}

function renderSettings() {
  if (!state) return;
  document.querySelectorAll('[data-setting]').forEach((row) => {
    const key = row.dataset.setting;
    const enabled = Boolean(state.settings[key]);
    row.classList.toggle('is-on', enabled);
    row.setAttribute('aria-pressed', String(enabled));
  });
  renderProxy();
  renderVPN();
}

function renderVPN() {
  if (!state || !state.settings.proxy) return;
  const proxy = state.settings.proxy;
  const active = proxy.mode === 'tor' && proxy.torReady && !proxy.torError;
  const busy = Boolean(proxy.torConnectingCountry || proxy.torConnecting);
  const connected = active && !proxy.torError && !busy;
  const selected = busy ? proxy.torConnectingCountry || proxy.torCountry : active ? proxy.torCountry : proxy.torPreferredCountry || 'AUTO';
  const flagEl = $('#vpn-flag');
  if (flagEl) flagEl.textContent = flagFor(selected);
  $('#vpn-country-short').textContent = selected || 'AUTO';
  $('#vpn-country-button').title = t('tor.chooseCountry') + ': ' + countryLabel(proxy, selected);
  $('#vpn-toggle').classList.toggle('is-connected', active);
  $('#vpn-toggle').classList.toggle('is-connecting', busy);
  $('#vpn-toggle').disabled = busy;
  $('#vpn-toggle').setAttribute('aria-pressed', String(active));
  const toggleLabel = busy ? t('tor.connecting') + ' · ' + Number(proxy.torBootstrapPercent || 0) + '%' : active ? t('tor.deactivate') : t('tor.activate');
  $('#vpn-toggle-label').textContent = toggleLabel;
  $('#vpn-toggle').setAttribute('aria-label', toggleLabel);
  $('#vpn-toggle').title = toggleLabel;
  $('#vpn-menu-state').textContent = proxy.torError
    ? t('tor.failedClosed')
    : busy ? t('tor.connectingNetwork') + ' · ' + Number(proxy.torBootstrapPercent || 0) + '%'
      : active ? t('tor.connectedExit') + ' ' + (proxy.torLabel || t('tor.selected'))
        : t('tor.disconnected');
  $('#vpn-failure-details').hidden = !proxy.torError;
  $('#vpn-cause').textContent = proxy.torError || '';
  $('#vpn-menu-status-dot').classList.toggle('is-connected', connected);
  $('#vpn-menu-status-dot').classList.toggle('is-connecting', busy);
  $('#vpn-exit-ip').textContent = proxy.torIdentityChanging ? t('tor.identityUpdating') : proxy.torExitIp || (active ? t('tor.exitIpUnchecked') : t('tor.disabled'));
  const circuitCount = Number(proxy.torCircuitCount || 0);
  if (!active) {
    $('#vpn-circuit-count').textContent = t('tor.circuitsInactive');
  } else if (circuitCount === 0) {
    $('#vpn-circuit-count').textContent = t('tor.circuitsFirstRequest');
  } else {
    $('#vpn-circuit-count').textContent = t(circuitCount > 1 ? 'tor.circuitsActivePlural' : 'tor.circuitsActive').replace('{count}', String(circuitCount));
  }
  $('#vpn-new-identity').disabled = !connected || proxy.torIdentityChanging;
  $('#vpn-new-identity').textContent = proxy.torIdentityChanging ? t('tor.identityChanging') : t('tor.newIdentity');
  document.querySelectorAll('[data-vpn-option]').forEach((button) => {
    const picked = button.dataset.vpnOption === (proxy.torPreferredCountry || 'AUTO');
    button.classList.toggle('is-selected', picked);
    button.disabled = busy;
    button.setAttribute('aria-pressed', String(picked));
  });
}

function renderProxy() {
  if (!state || !state.settings.proxy) return;
  const proxy = state.settings.proxy;
  const form = $('#proxy-form');
  const status = $('#proxy-state');
  if (!form.dataset.initialized) {
    $('#proxy-type').value = proxy.type || 'socks5';
    $('#proxy-host').value = proxy.host || '';
    $('#proxy-port').value = String(proxy.port || 1080);
    $('#proxy-username').value = proxy.username || '';
    form.dataset.initialized = 'true';
  }
  const busy = Boolean(proxy.torConnectingCountry);
  if (busy) status.textContent = t('tor.connecting') + ' · ' + countryLabel(proxy, proxy.torConnectingCountry) + '…';
  else if (proxy.torError) status.textContent = t('tor.unavailable') + ' · ' + proxy.torError;
  else if (proxy.mode === 'tor') status.textContent = t('tor.activeExit') + ' · ' + (proxy.torLabel || t('tor.selected'));
  else if (proxy.enabled) status.textContent = t('proxy.active') + ' · ' + proxy.host + ':' + proxy.port;
  else status.textContent = t('proxy.disabledWindows');
  status.classList.toggle('proxy-active', Boolean(proxy.enabled && !proxy.torError));
  $('#proxy-disable').disabled = !proxy.enabled;
  document.querySelectorAll('[data-tor-country]').forEach((button) => {
    button.disabled = busy;
    button.classList.toggle('is-active', proxy.mode === 'tor' && button.dataset.torCountry === proxy.torCountry);
  });
  form.querySelectorAll('input, select, .proxy-connect').forEach((control) => { control.disabled = busy; });
}

function renderActive() {
  if (!state || !state.active) return;
  const tab = state.active;
  const theme = state.settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--accent', state.settings.accent || '#2f9e86');
  document.documentElement.style.setProperty('--ui-font-size', (state.settings.fontSize || 16) + 'px');
  home.hidden = !tab.home;
  document.body.classList.toggle('private-mode', Boolean(tab.private));
  $('#space-label').hidden = !tab.private;
  $('#space-label').textContent = t('home.privateSpaceLabel');
  $('#address-form').classList.toggle('is-insecure', Boolean(tab.url && !tab.secure));
  $('.address-lock use').setAttribute('href', tab.home ? '#i-shield' : (tab.secure ? '#i-lock' : '#i-globe'));
  const on = Boolean(tab.protectionEnabled);
  $('#protection-button').classList.toggle('is-protected', on);
  $('#protection-button').classList.toggle('is-off', !on);
  $('.protection-label').textContent = on ? t('protection.enabled') : t('protection.paused');
  $('#protection-button').setAttribute('aria-label', on ? t('protection.buttonProtected') : t('protection.buttonPaused'));
  const filteredCount = (tab.adBlockBlocked || 0) + (tab.cookieBlocked || 0);
  $('#blocked-count').textContent = String(filteredCount);
  $('#site-label').textContent = tab.host || t('site.none');
  $('#site-secure').textContent = tab.url ? (tab.secure ? api.getLocaleText("ui.rendererjs.text205ecf3f81") : api.getLocaleText("proxy.http")) : t('site.ready');
  $('#site-secure').classList.toggle('is-insecure', Boolean(tab.url && !tab.secure));
  $('#panel-blocked').textContent = String(filteredCount);
  const activity = state.settings.protectionActivity;
  window.NacreProtectionActivity.render($('#cookie-preview'), { ...activity, entries: (activity?.entries || []).filter(entry => entry.tabId === tab.id) }, t, { compact: true, limit: 3 });
  $('#site-protection-toggle').classList.toggle('is-on', on);
  $('#site-protection-toggle').setAttribute('aria-pressed', String(on));
  $('#site-protection-copy').textContent = on ? t('protection.blockingActive') : t('protection.pausedForSite');
  $('#cookie-state').classList.toggle('state-off', tab.cookieHeaderPolicy === 'allow');
  $('#cookie-state').title = t(tab.cookieHeaderPolicy === 'allow' ? 'settings.cookiesAllow' : tab.cookieHeaderPolicy === 'block-all' ? 'settings.cookiesBlockAll' : 'settings.cookiesBlockThirdParty');
  $('#bookmark').classList.toggle('is-bookmarked', state.bookmarks.some((item) => item.url === tab.url));
  const webPage = Boolean(tab.url && !tab.internal && /^https?:/i.test(tab.url));
  $('#reader-button').disabled = !webPage;
  $('#share-button').disabled = !webPage;
  $('#forget-site').disabled = !webPage;
  const forgetOnClose = Boolean(tab.forgetOnClose);
  $('#forget-site-on-close').disabled = !webPage || Boolean(tab.private);
  $('#forget-site-on-close').classList.toggle('is-on', forgetOnClose);
  $('#forget-site-on-close').setAttribute('aria-pressed', String(forgetOnClose));
  const trustedSite = Boolean(tab.trustedSite);
  $('#trusted-site').disabled = !webPage || Boolean(tab.private);
  $('#trusted-site').classList.toggle('is-on', trustedSite);
  $('#trusted-site').setAttribute('aria-pressed', String(trustedSite));
  $('#zoom-in').disabled = !webPage;
  $('#zoom-out').disabled = !webPage;
  $('#zoom-reset').disabled = !webPage;
  $('#zoom-value').textContent = t('zoom.value').replace('{value}', String(tab.zoom || state.settings.defaultZoom || 100));
  renderZoomControls(tab, webPage);
  const activeDownloads = (state.downloads || []).filter((item) => ['downloading', 'choosing', 'waiting', 'paused'].includes(item.state)).length;
  $('#downloads-count').hidden = activeDownloads === 0;
  $('#downloads-count').textContent = activeDownloads ? String(activeDownloads) : '';
  $('#back').disabled = !tab.canGoBack;
  $('#forward').disabled = !tab.canGoForward;
  if (document.activeElement !== address) address.value = tab.url || '';
  $('#reload').classList.toggle('is-loading', Boolean(tab.loading));
  renderTabs();
  renderSettings();
  renderBookmarksBar();
  refreshSiteIcons();
  renderHomeStats();
  if (document.activeElement === address) renderAddressSuggestions();
}

function openPanel(name) {
  closeBrowserMenu(false);
  closeAbout();
  vpnMenu.hidden = true;
  $('#vpn-country-button').setAttribute('aria-expanded', 'false');
  expanded = true;
  layer.hidden = false;
  shieldPanel.hidden = name !== 'shield';
  settingsPanel.hidden = name !== 'settings';
  updateLayout();
}

function closePanel() {
  closeBrowserMenu(false);
  expanded = false;
  layer.hidden = true;
  shieldPanel.hidden = true;
  settingsPanel.hidden = true;
  vpnMenu.hidden = true;
  $('#vpn-country-button').setAttribute('aria-expanded', 'false');
  updateLayout();
}

function openAbout() {
  closePanel();
  expanded = true;
  aboutOverlay.hidden = false;
  updateLayout();
}

function closeAbout() {
  aboutOverlay.hidden = true;
  expanded = false;
  updateLayout();
}

function openVPNMenu() {
  closeBrowserMenu(false);
  closePanel();
  closeAbout();
  vpnMenu.hidden = false;
  $('#vpn-country-button').setAttribute('aria-expanded', 'true');
  expanded = true;
  updateLayout();
}

function closeVPNMenu() {
  if (vpnMenu.hidden) return;
  vpnMenu.hidden = true;
  $('#vpn-country-button').setAttribute('aria-expanded', 'false');
  if (layer.hidden && aboutOverlay.hidden) expanded = false;
  updateLayout();
}

let browserMenuFocusBefore = null;

function browserMenuFocusables() {
  return Array.from(browserMenu.querySelectorAll('button:not(:disabled):not(#browser-menu-close), select:not(:disabled), input:not(:disabled)'))
    .filter((element) => !element.hidden && element.getClientRects().length > 0);
}

function openBrowserMenu() {
  closePanel();
  closeAbout();
  closeVPNMenu();
  browserMenuFocusBefore = document.activeElement;
  browserMenu.hidden = false;
  browserMenuButton.setAttribute('aria-expanded', 'true');
  expanded = true;
  updateLayout();
  const first = browserMenu.querySelector('#menu-new-tab');
  (first || browserMenuFocusables()[0])?.focus();
}

function closeBrowserMenu(restoreFocus = false) {
  if (browserMenu.hidden) return;
  browserMenu.hidden = true;
  browserMenuButton.setAttribute('aria-expanded', 'false');
  expanded = !layer.hidden || !aboutOverlay.hidden || !vpnMenu.hidden;
  updateLayout();
  if (restoreFocus && browserMenuFocusBefore instanceof HTMLElement && browserMenuFocusBefore.isConnected) {
    browserMenuFocusBefore.focus();
  }
  browserMenuFocusBefore = null;
}

// Country codes come from the main process allowlist (src/tor-exit-countries.cjs).
function flagFor(code) {
  if (!/^[A-Z]{2}$/.test(String(code))) return '🌐';
  return [...code].map((letter) => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 65)).join('');
}

function countryLabel(proxy, code) {
  return (proxy.torCountries && proxy.torCountries[code]) || code;
}

function toggleVPN() {
  if (!state || state.settings.proxy.torConnectingCountry) return;
  if (state.settings.proxy.mode === 'tor' && !state.settings.proxy.torError) api.disableProxy();
  else api.connectTor(state.settings.proxy.torPreferredCountry || 'AUTO');
}

function showToast(item) {
  toast.textContent = item.key
    ? t(item.key).replace(/\{([A-Za-z0-9_]+)\}/g, (token, name) => Object.hasOwn(item.params || {}, name) ? String(item.params[name]) : token)
    : api.localizeText(item.message || '');
  toast.className = 'toast visible' + (item.kind === 'warning' ? ' warning' : '');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000);
}

function focusAddress() {
  closePanel();
  address.focus();
  address.select();
}

function openTabSearch() {
  const input = $('#tab-search-input');
  input.hidden = false;
  input.focus();
  input.select();
}

function openGroupEditor(id) {
  const current = state?.tabs.find((tab) => tab.id === id);
  const overlay = document.createElement('div'); overlay.className = 'group-editor';
  const form = document.createElement('form'); form.className = 'group-editor-card';
  const heading = document.createElement('strong'); heading.textContent = t('tabs.groupEditorTitle');
  const name = document.createElement('input'); name.maxLength = 32; name.placeholder = t('tabs.groupNamePlaceholder'); name.value = current?.group || '';
  const color = document.createElement('select');
  for (const [value, key] of [['mint','colors.mint'],['blue','colors.blue'],['violet','colors.violet'],['amber','colors.amber'],['coral','colors.coral']]) { const option = document.createElement('option'); option.value = value; option.textContent = t(key); color.append(option); }
  const buttons = document.createElement('div'); buttons.className = 'group-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('common.cancel'); cancel.addEventListener('click', () => overlay.remove());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = t('common.apply');
  buttons.append(cancel, save); form.append(heading, name, color, buttons); overlay.append(form); document.body.append(overlay);
  form.addEventListener('submit', (event) => { event.preventDefault(); api.setTabGroup(id, name.value, color.value); overlay.remove(); });
  name.focus();
}

$('#address-form').addEventListener('submit', (event) => {
  event.preventDefault();
  closeAddressSuggestions();
  api.navigate(address.value);
  address.blur();
});
address.addEventListener('input', renderAddressSuggestions);
address.addEventListener('focus', renderAddressSuggestions);
address.addEventListener('blur', () => window.setTimeout(closeAddressSuggestions, 120));
address.addEventListener('keydown', (event) => {
  if (suggestions.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    suggestionIndex = (suggestionIndex + step + suggestionItems.length) % suggestionItems.length;
    paintSuggestionSelection();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeAddressSuggestions();
  } else if (event.key === 'Enter' && suggestionIndex >= 0) {
    event.preventDefault();
    const selected = suggestionItems[suggestionIndex];
    closeAddressSuggestions();
    api.navigate(selected.url);
    address.blur();
  }
});
$('#reader-button').addEventListener('click', () => api.openReader());
$('#share-button').addEventListener('click', () => api.openShare());
$('#zoom-in').addEventListener('click', () => api.siteZoom('in'));
$('#zoom-out').addEventListener('click', () => api.siteZoom('out'));
$('#zoom-reset').addEventListener('click', () => api.siteZoom('reset'));

// Zoom bubble, as in Chromium: Ctrl+wheel or Ctrl+/-/0 open it for a moment
// under the address bar; the magnifier stays in the address bar while the
// site is not at the default zoom, and opens the bubble until dismissed.
const zoomBubble = $('#zoom-bubble');
const zoomIndicator = $('#zoom-indicator');
let zoomBubbleTimer;
let zoomBubbleSticky = false;
// Opened from the page (wheel or keyboard): give the page its focus back on close.
let zoomBubbleFromPage = false;
function renderZoomControls(tab, webPage) {
  const value = Number(tab.zoom || state.settings.defaultZoom || 100);
  const base = Number(state.settings.defaultZoom || 100);
  zoomIndicator.hidden = !webPage || value === base;
  zoomIndicator.querySelector('use').setAttribute('href', value < base ? '#i-zoom-out' : '#i-zoom-in');
  zoomIndicator.title = t('zoom.site') + ' · ' + t('zoom.value').replace('{value}', String(value));
  $('#zoom-bubble-value').textContent = t('zoom.value').replace('{value}', String(value));
  $('#zoom-bubble-reset').disabled = value === base;
  if (!webPage) closeZoomBubble();
  else if (!zoomBubble.hidden) placeZoomBubble();
}
function placeZoomBubble() {
  const anchor = zoomIndicator.hidden ? $('#bookmark') : zoomIndicator;
  const rect = anchor.getBoundingClientRect();
  const width = zoomBubble.offsetWidth;
  zoomBubble.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width + 8)) + 'px';
  zoomBubble.style.top = Math.round(rect.bottom + 10) + 'px';
}
function openZoomBubble(sticky) {
  if (!state?.active || state.active.internal || !/^https?:/i.test(state.active.url || '')) return;
  zoomBubbleSticky = sticky || (zoomBubbleSticky && !zoomBubble.hidden);
  zoomBubbleFromPage = !sticky && (zoomBubbleFromPage || zoomBubble.hidden);
  zoomBubble.hidden = false;
  zoomIndicator.setAttribute('aria-expanded', 'true');
  placeZoomBubble();
  if (!expanded) { expanded = true; updateLayout(); }
  scheduleZoomBubbleClose();
}
function scheduleZoomBubbleClose() {
  window.clearTimeout(zoomBubbleTimer);
  if (zoomBubbleSticky) return;
  zoomBubbleTimer = window.setTimeout(() => {
    if (zoomBubble.matches(':hover')) scheduleZoomBubbleClose();
    else closeZoomBubble();
  }, 1800);
}
function closeZoomBubble() {
  window.clearTimeout(zoomBubbleTimer);
  if (zoomBubble.hidden) return;
  zoomBubble.hidden = true;
  zoomBubbleSticky = false;
  zoomIndicator.setAttribute('aria-expanded', 'false');
  expanded = !layer.hidden || !aboutOverlay.hidden || !vpnMenu.hidden || !browserMenu.hidden;
  updateLayout();
  if (zoomBubbleFromPage && !expanded) api.focusPage();
  zoomBubbleFromPage = false;
}
function zoomFromBubble(action) {
  api.siteZoom(action);
  scheduleZoomBubbleClose();
}
api.onZoomBubble(() => openZoomBubble(false));
zoomIndicator.addEventListener('click', () => {
  if (zoomBubble.hidden || !zoomBubbleSticky) openZoomBubble(true);
  else closeZoomBubble();
});
$('#zoom-bubble-in').addEventListener('click', () => zoomFromBubble('in'));
$('#zoom-bubble-out').addEventListener('click', () => zoomFromBubble('out'));
$('#zoom-bubble-reset').addEventListener('click', () => zoomFromBubble('reset'));
zoomBubble.addEventListener('pointerleave', scheduleZoomBubbleClose);
// The raised chrome has the keyboard focus while the bubble is shown.
window.addEventListener('keydown', (event) => {
  if (zoomBubble.hidden || !event.ctrlKey || !['+', '=', '-', '0'].includes(event.key)) return;
  event.preventDefault();
  zoomFromBubble(event.key === '0' ? 'reset' : event.key === '-' ? 'out' : 'in');
});
// While the bubble is shown the chrome sits above the page, so it receives the
// wheel: Ctrl+wheel keeps zooming, a plain wheel hands the page back.
window.addEventListener('wheel', (event) => {
  if (zoomBubble.hidden) return;
  if (event.ctrlKey) {
    event.preventDefault();
    if (event.deltaY) zoomFromBubble(event.deltaY < 0 ? 'in' : 'out');
  } else closeZoomBubble();
}, { passive: false });
let panicArmed = false;
let panicTimer;
function disarmPanic() {
  panicArmed = false;
  window.clearTimeout(panicTimer);
  $('#panic-button').classList.remove('is-armed');
  $('#panic-button').setAttribute('aria-pressed', 'false');
  $('#panic-label').textContent = t('panic.label');
}
$('#panic-button').addEventListener('click', () => {
  if (!panicArmed) {
    panicArmed = true;
    $('#panic-button').classList.add('is-armed');
    $('#panic-button').setAttribute('aria-pressed', 'true');
    $('#panic-label').textContent = t('panic.armed');
    window.clearTimeout(panicTimer);
    panicTimer = window.setTimeout(disarmPanic, 3500);
    return;
  }
  disarmPanic();
  api.panic();
});
$('#home-search').addEventListener('submit', (event) => {
  event.preventDefault();
  api.navigate($('#home-query').value);
});
$('#new-tab').addEventListener('click', () => api.newTab());
$('#private-tab').addEventListener('click', () => api.newPrivateTab());
$('#menu-new-tab').addEventListener('click', () => api.newTab());
$('#menu-bookmarks').addEventListener('click', () => api.openBookmarks());
$('#menu-downloads').addEventListener('click', () => api.openDownloads());
$('#menu-import').addEventListener('click', () => window.NacreWelcome?.openImport());
$('#menu-pin-home').addEventListener('click', () => {
  closeBrowserMenu(false);
  api.homeShortcuts({ action: 'add-current' }).then((added) => { if (added) showToast({ key: 'toast.shortcutAdded' }); }).catch(() => {});
});
$('#menu-shortcuts').addEventListener('click', () => api.openShortcuts());
browserMenuButton.addEventListener('click', () => browserMenu.hidden ? openBrowserMenu() : closeBrowserMenu(true));
$('#browser-menu-close').addEventListener('click', () => closeBrowserMenu(true));
browserMenu.addEventListener('click', (event) => {
  const action = event.target.closest('button, select, input');
  if (!action || !browserMenu.contains(action)) return;
  if (action.id === 'browser-menu-close') return;
  if (action.id === 'panic-button') {
    window.setTimeout(() => {
      if (!action.classList.contains('is-armed')) closeBrowserMenu(true);
    }, 0);
    return;
  }
  closeBrowserMenu(true);
});
$('#home-button').addEventListener('click', () => api.home());
$('#back').addEventListener('click', () => api.back());
$('#forward').addEventListener('click', () => api.forward());
$('#reload').addEventListener('click', () => api.reload());
$('#bookmark').addEventListener('click', () => api.bookmark());
$('#clear-button').addEventListener('click', () => api.clearData());
$('#home-clear').addEventListener('click', () => api.clearData());
$('#settings-clear').addEventListener('click', () => api.clearData());
$('#settings-button').addEventListener('click', () => api.openSettingsTab());
$('#downloads-button').addEventListener('click', () => api.openDownloads());
$('#vpn-toggle').addEventListener('click', toggleVPN);
$('#vpn-country-button').addEventListener('click', () => vpnMenu.hidden ? openVPNMenu() : closeVPNMenu());
$('#vpn-new-identity').addEventListener('click', async () => {
  try {
    const result = await api.newIdentity();
    showToast({ key: 'tor.identityConfirmed', params: { ip: result.ip } });
  } catch (error) {
    showToast(error.message ? { message: error.message, kind: 'warning' } : { key: 'toast.newIdentityFailed', kind: 'warning' });
  }
});
$('#vpn-retry').addEventListener('click', () => {
  const country = state?.settings?.proxy?.torPreferredCountry || 'AUTO';
  api.connectTor(country);
});
$('#vpn-show-log').addEventListener('click', async () => {
  const output = $('#vpn-log');
  if (!output.hidden) { output.hidden = true; return; }
  output.textContent = t('tor.logLoading');
  output.hidden = false;
  try { output.textContent = await api.getTorLog(); }
  catch { output.textContent = t('tor.logUnavailable'); }
});
document.querySelectorAll('[data-vpn-option]').forEach((button) => {
  button.addEventListener('click', () => {
    const country = button.dataset.vpnOption;
    api.chooseTorCountry(country);
    if (state && state.settings.proxy.mode === 'tor' && state.settings.proxy.torCountry !== country) api.connectTor(country);
    closeVPNMenu();
  });
});
$('#protection-button').addEventListener('click', () => openPanel('shield'));
$('#site-protection-toggle').addEventListener('click', () => api.toggleSiteProtection());
$('#site-zapper').addEventListener('click', async () => {
  try { await api.zapElement(); }
  catch (error) { showToast(error?.message ? { message: error.message, kind: 'warning' } : { key: 'toast.zapperFailed', kind: 'warning' }); }
});
$('#site-report-broken').addEventListener('click', async () => {
  try { await api.copyAdblockReport(); showToast({ key: 'toast.reportCopied' }); }
  catch { showToast({ key: 'toast.reportCopyFailed', kind: 'warning' }); }
});
$('#open-protection-dashboard').addEventListener('click', () => api.openProtectionDashboard());
$('#site-info-button').addEventListener('click', async () => {
  openPanel('shield');
  const details = $('#site-details');
  details.textContent = t('site.infoLoading');
  try {
    const info = await api.getSiteInfo();
    details.textContent = info.host ? t('site.infoDetails').replace('{host}', info.host).replace('{transport}', info.transport).replace('{cookies}', String(info.cookies)).replace('{permissions}', info.permissions).replace('{blocked}', String(info.blocked)) : info.transport;
  } catch { details.textContent = t('site.infoUnavailable'); }
});
$('#open-site-permissions').addEventListener('click', () => api.openSiteSettings());
$('#forget-site').addEventListener('click', async () => {
  try { await api.forgetSite(); }
  catch (error) { showToast(error?.message ? { message: error.message, kind: 'warning' } : { key: 'toast.forgetSiteFailed', kind: 'warning' }); }
});
$('#forget-site-on-close').addEventListener('click', () => api.toggleForgetSite());
$('#trusted-site').addEventListener('click', () => api.trustedSites({ action: 'current' }).catch((error) => showToast({ message: api.localizeText(error?.message) || t('trusted.invalid'), kind: 'warning' })));
$('#tab-search').addEventListener('click', () => openTabSearch());
$('#tab-search-input').addEventListener('input', (event) => { tabSearchQuery = event.target.value.trim().toLocaleLowerCase('fr'); renderTabs(); });
$('#tab-search-input').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.target.value = ''; tabSearchQuery = ''; event.target.hidden = true; renderTabs(); }
  if (event.key === 'Enter') { const tab = state.tabs.find((item) => (item.title + ' ' + item.url).toLocaleLowerCase('fr').includes(tabSearchQuery)); if (tab) { api.activateTab(tab.id); event.target.hidden = true; } }
});
$('#shortcuts-button').addEventListener('click', () => api.openShortcuts());
$('#about-button').addEventListener('click', openAbout);
$('#home-bookmarks').addEventListener('click', () => api.openBookmarks());
$('#home-downloads').addEventListener('click', () => api.openDownloads());
$('#home-settings').addEventListener('click', () => api.openSettingsTab());
$('#privacy-link').addEventListener('click', openAbout);
$('#popover-scrim').addEventListener('click', closePanel);
document.addEventListener('pointerdown', (event) => {
  if (!zoomBubble.hidden && !event.target.closest('#zoom-bubble, #zoom-indicator')) closeZoomBubble();
  if (!vpnMenu.hidden && !event.target.closest('.vpn-menu, .vpn-control')) closeVPNMenu();
  if (!browserMenu.hidden && !event.target.closest('#browser-menu, #browser-menu-button')) closeBrowserMenu(false);
});
document.addEventListener('focusin', (event) => {
  if (!browserMenu.hidden && !browserMenu.contains(event.target) && event.target !== browserMenuButton) closeBrowserMenu(false);
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closePanel));
document.querySelectorAll('[data-close-about]').forEach((button) => button.addEventListener('click', closeAbout));
document.querySelectorAll('[data-setting]').forEach((row) => {
  row.addEventListener('click', () => {
    const key = row.dataset.setting;
    api.updateSetting(key, !Boolean(state.settings[key]));
  });
});
$('#proxy-form').addEventListener('submit', (event) => {
  event.preventDefault();
  api.configureProxy({
    type: $('#proxy-type').value,
    host: $('#proxy-host').value,
    port: $('#proxy-port').value,
    username: $('#proxy-username').value,
    password: $('#proxy-password').value
  });
  $('#proxy-password').value = '';
});
$('#proxy-disable').addEventListener('click', () => api.disableProxy());
document.querySelectorAll('[data-tor-country]').forEach((button) => {
  button.addEventListener('click', () => api.connectTor(button.dataset.torCountry));
});
document.querySelectorAll('[data-open-settings]').forEach((button) => {
  button.addEventListener('click', () => openPanel('settings'));
});
$('#read-privacy').addEventListener('click', (event) => {
  event.preventDefault();
  openAbout();
});
$('#open-donation').addEventListener('click', (event) => {
  event.preventDefault();
  closeAbout();
  api.openDonation();
});
$('#open-privacy-file').addEventListener('click', (event) => {
  event.preventDefault();
  showToast({ key: 'toast.privacyPolicyNote' });
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeZoomBubble();
    if (!browserMenu.hidden) closeBrowserMenu(true);
    closePanel();
    closeAbout();
    closeVPNMenu();
  }
  if (!browserMenu.hidden && browserMenu.contains(document.activeElement)) {
    const focusables = browserMenuFocusables();
    const current = focusables.indexOf(document.activeElement);
    if (focusables.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') focusables[0].focus();
      else if (event.key === 'End') focusables[focusables.length - 1].focus();
      else {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        focusables[(current + delta + focusables.length) % focusables.length].focus();
      }
    }
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    browserMenu.hidden ? openBrowserMenu() : closeBrowserMenu(true);
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    focusAddress();
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    if (state) api.updateSetting('showBookmarksBar', !state.settings.showBookmarksBar);
  }
});
function openFind() {
  const bar = $('#findbar');
  bar.hidden = false;
  $('#find-query').focus();
  $('#find-query').select();
}
function closeFind() {
  $('#findbar').hidden = true;
  api.stopFindInPage();
}
$('#find-query').addEventListener('input', () => api.findInPage($('#find-query').value, false));
$('#find-query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); api.findInPage($('#find-query').value, !event.shiftKey); }
  if (event.key === 'Escape') closeFind();
});
$('#find-prev').addEventListener('click', () => api.findInPage($('#find-query').value, false));
$('#find-next').addEventListener('click', () => api.findInPage($('#find-query').value, true));
$('#find-close').addEventListener('click', closeFind);
window.addEventListener('resize', updateLayout);
new ResizeObserver(updateLayout).observe(chrome);

let catalogueSequence = 0;
async function loadCatalogue(language) {
  const sequence = ++catalogueSequence;
  const catalogue = await api.getMessages(language);
  if (sequence !== catalogueSequence) return;
  Object.assign(messages, catalogue);
  document.documentElement.lang = language;
  renderActive();
}
api.getLanguage().then(loadCatalogue).catch(() => {});
window.addEventListener('nacre:locale-ready', (event) => {
  loadCatalogue(event.detail).catch(() => {});
});
api.onState((nextState) => {
  state = nextState;
  renderActive();
});
api.onToast(showToast);
api.onFocusAddress(focusAddress);
api.onFindInPage(openFind);
api.onFindResults((result) => { $('#find-count').textContent = result.matches ? `${result.activeMatchOrdinal} / ${result.matches}` : t('find.none'); });
api.onConfirmClear(() => api.clearData());
api.onOpenSettings((section) => section === 'settings' ? openPanel('settings') : openAbout());
api.onTabSearch(openTabSearch);
api.onEditTabGroup(openGroupEditor);
window.NacreChrome = Object.freeze({
  refreshLayout: updateLayout,
  homeTile: (url, title) => homeTile(url, title, 'home-tile home-shortcut'),
  pinCurrentPage: () => api.homeShortcuts({ action: 'add-current' }),
  showToast: (message) => showToast({ message, kind: 'warning' }),
  beginOverlay: async () => {
    closeBrowserMenu(false);
    closePanel(); closeAbout(); closeVPNMenu(); expanded = true;
    await api.setOverlay(true); updateLayout();
  },
  endOverlay: () => { expanded = false; updateLayout(); return api.setOverlay(false); }
});
updateLayout();
