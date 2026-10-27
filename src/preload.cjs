const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function getMessages(lang) {
  return ipcRenderer.invoke('nacre:get-messages', lang);
}

function getLanguage() {
  return ipcRenderer.invoke('nacre:get-language');
}

let localeMessages = Object.create(null);

// The same appearance applies to every trusted internal page, including those
// without a page-specific renderer (shortcuts, offline help and diagnostics).
let appearancePreferences;
const systemAppearance = window.matchMedia('(prefers-color-scheme: light)');
function applyAppearance() {
  if (!appearancePreferences || !document.documentElement) return;
  const prefs = appearancePreferences;
  const theme = prefs.theme === 'system' ? (systemAppearance.matches ? 'light' : 'dark')
    : prefs.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if (document.body) document.body.dataset.theme = theme;
  if (/^#[0-9a-f]{6}$/i.test(prefs.accent || '')) {
    document.documentElement.style.setProperty('--mint', prefs.accent);
    document.documentElement.style.setProperty('--accent', prefs.accent);
  }
  if (/^#[0-9a-f]{6}$/i.test(prefs.darkBackground || '')) document.documentElement.style.setProperty('--dark-background', prefs.darkBackground);
  const size = Number(prefs.fontSize);
  if (Number.isFinite(size) && size >= 12 && size <= 24) {
    document.documentElement.style.setProperty('--ui-font-size', size + 'px');
  }
}
subscribe('nacre:state', (state) => {
  appearancePreferences = state?.settings;
  applyAppearance();
  if (document.readyState !== 'loading') refreshLocale(state?.settings?.language);
});
systemAppearance.addEventListener('change', applyAppearance);
window.addEventListener('DOMContentLoaded', applyAppearance);

function applyLocaleMessages(messages) {
  if (!messages || typeof messages !== 'object') return;
  localeMessages = messages;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (Object.prototype.hasOwnProperty.call(messages, key) && typeof messages[key] === 'string') {
      element.textContent = messages[key];
    }
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((element) => {
    for (const mapping of element.getAttribute('data-i18n-attr').split(';')) {
      const [attribute, key] = mapping.split(':', 2);
      if (attribute === 'textContent') {
        const child = element.querySelector('span[data-i18n-child]');
        if (child && Object.prototype.hasOwnProperty.call(messages, key)) child.textContent = messages[key];
        continue;
      }
      if (!['aria-label', 'placeholder', 'title'].includes(attribute)) continue;
      if (Object.prototype.hasOwnProperty.call(messages, key) && typeof messages[key] === 'string') {
        element.setAttribute(attribute, messages[key]);
      }
    }
  });
}

const sourceKeys = new Map();
let sourceTemplates = [];
let sourcePrefixes = [];
let sourceCatalogues;
function localizeText(value) {
  if (typeof value !== 'string' || value.length > 8192) return value;
  value = value.replace(/^Error invoking remote method '[a-z0-9:-]+': Error: /i, '');
  const key = sourceKeys.get(value);
  if (key) return localeMessages[key] || value;
  const bridge = /^Pont ([^·\n]{1,120}) · ([^\n]{1,200})\. Cette cause reste indicative\.$/.exec(value);
  if (bridge && sourceKeys.has(bridge[2])) {
    const label = bridge[1].replace('pont personnalisé', localeMessages['diagnostic.tordiagnosticscjs.textd54e11136e']).replace(/ sélectionné$/, ' ' + localeMessages['diagnostic.tordiagnosticscjs.text3f8c0e1af6']);
    return localeMessages['diagnostic.torBridgeFailure'].replace('{bridge}', label).replace('{cause}', localeMessages[sourceKeys.get(bridge[2])]);
  }
  for (const template of sourceTemplates) {
    if (!value.startsWith(template.parts[0])) continue;
    let offset = template.parts[0].length;
    const values = [];
    for (let i = 1; i < template.parts.length; i++) {
      const part = template.parts[i];
      const end = i === template.parts.length - 1 ? value.length - part.length : value.indexOf(part, offset);
      if (end < offset || end - offset > 2048 || value.slice(end, end + part.length) !== part) break;
      values.push(value.slice(offset, end)); offset = end + part.length;
    }
    if (values.length !== template.slots.length || offset !== value.length) continue;
    return (localeMessages[template.key] || value).replace(/\{([A-Za-z0-9_]+)\}/g, (token, name) => {
      const index = template.slots.indexOf(name); return index < 0 ? token : values[index];
    });
  }
  for (const prefix of sourcePrefixes) if (value.startsWith(prefix.source)) return (localeMessages[prefix.key] || prefix.source).trimEnd() + ' ' + value.slice(prefix.source.length);
  return value;
}
async function loadSourceCatalogues() {
  if (!sourceCatalogues) sourceCatalogues = Promise.all([getMessages('en'), getMessages('fr')]).then(catalogues => {
    for (const catalogue of catalogues) for (const [key, value] of Object.entries(catalogue)) sourceKeys.set(value, key);
    sourceTemplates = [];
    sourcePrefixes = [];
    for (const [value, key] of sourceKeys) {
      if (key === 'diagnostic.torBridgeFailure' || !/^(?:diagnostic\.|toast\.|tor\.)/.test(key)) continue;
      if (value.length >= 16 && /:\s*$/.test(value)) sourcePrefixes.push({ source: value, key });
      const parts = [], slots = []; let offset = 0;
      for (const match of value.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        parts.push(value.slice(offset, match.index)); slots.push(match[1]); offset = match.index + match[0].length;
      }
      parts.push(value.slice(offset));
      if (slots.length && slots.length <= 4 && parts[0].length >= 4 && parts.slice(1, -1).every(Boolean)) sourceTemplates.push({key, parts, slots});
    }
  }).catch(error => { sourceCatalogues = undefined; throw error; });
  return sourceCatalogues;
}
let requestedLocale;
let localeSequence = 0;
async function refreshLocale(language) {
  if (typeof language !== 'string' || requestedLocale === language) return;
  requestedLocale = language;
  const sequence = ++localeSequence;
  try {
    const [messages] = await Promise.all([getMessages(language), loadSourceCatalogues()]);
    if (sequence !== localeSequence) return;
    document.documentElement.lang = language;
    // Same scripts as isRightToLeft in i18n.cjs; custom languages are "ur-x-custom1".
    document.documentElement.dir = /^(?:ar|fa|he|ur|ps|sd|ckb|yi|dv)(?:-|$)/i.test(language) ? 'rtl' : 'ltr';
    applyLocaleMessages(messages);
    window.dispatchEvent(new CustomEvent('nacre:locale-ready', { detail: language }));
  } catch (error) {
    if (sequence === localeSequence) requestedLocale = undefined;
    console.warn('Could not load the locale catalogue.', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  let pageUrl;
  try { pageUrl = new URL(window.location.href); } catch { return; }
  if (pageUrl.protocol !== 'nacre:' || !['app', 'settings', 'error', 'leak-tests', 'tests-fuite', 'downloads', 'source', 'bookmarks', 'shortcuts', 'offline', 'protection', 'reader', 'share', 'phishing'].includes(pageUrl.hostname) || !['/', '/sites', '/settings.html'].includes(pageUrl.pathname)) return;
  getLanguage()
    .then(refreshLocale)
    .catch((error) => console.warn('Could not load the locale catalogue; keeping the static English text.', error));
});

contextBridge.exposeInMainWorld('nacre', Object.freeze({
  onState: (callback) => subscribe('nacre:state', callback),
  onToast: (callback) => subscribe('nacre:toast', callback),
  onFocusAddress: (callback) => subscribe('nacre:focus-address', callback),
  onFindInPage: (callback) => subscribe('nacre:find-in-page', callback),
  onFindResults: (callback) => subscribe('nacre:find-results', callback),
  onConfirmClear: (callback) => subscribe('nacre:confirm-clear', callback),
  onOpenSettings: (callback) => subscribe('nacre:open-settings', callback),
  onTabSearch: (callback) => subscribe('nacre:tab-search', callback),
  onCommands: (callback) => subscribe('nacre:commands', callback),
  onZoomBubble: (callback) => subscribe('nacre:zoom-bubble', callback),
  setOverlay: (value) => ipcRenderer.invoke('nacre:overlay', Boolean(value)),
  onEditTabGroup: (callback) => subscribe('nacre:edit-tab-group', callback),
  navigate: (value) => ipcRenderer.send('nacre:navigate', String(value)),
  search: (value) => ipcRenderer.send('nacre:search', String(value)),
  newTab: () => ipcRenderer.send('nacre:new-tab'),
  newPrivateTab: () => ipcRenderer.send('nacre:new-private-tab'),
  activateTab: (id) => ipcRenderer.send('nacre:activate-tab', Number(id)),
  reorderTabs: (ids) => ipcRenderer.send('nacre:reorder-tabs', Array.isArray(ids) ? ids.map(Number) : []),
  showTabMenu: (id) => ipcRenderer.send('nacre:tab-context', Number(id)),
  closeTab: (id) => ipcRenderer.send('nacre:close-tab', Number(id)),
  back: () => ipcRenderer.send('nacre:back'),
  home: () => ipcRenderer.send('nacre:home'),
  forward: () => ipcRenderer.send('nacre:forward'),
  reload: () => ipcRenderer.send('nacre:reload'),
  findInPage: (query, forward) => ipcRenderer.send('nacre:find', String(query || ''), Boolean(forward)),
  stopFindInPage: () => ipcRenderer.send('nacre:stop-find'),
  bookmark: () => ipcRenderer.send('nacre:bookmark'),
  openReader: () => ipcRenderer.send('nacre:open-reader'),
  exitReader: () => ipcRenderer.send('nacre:exit-reader'),
  getReader: () => ipcRenderer.invoke('nacre:get-reader'),
  openShare: () => ipcRenderer.send('nacre:open-share'),
  getShare: () => ipcRenderer.invoke('nacre:get-share'),
  copyShare: () => ipcRenderer.invoke('nacre:copy-share'),
  closeShare: () => ipcRenderer.send('nacre:close-share'),
  getPhishing: () => ipcRenderer.invoke('nacre:get-phishing'),
  continuePhishing: () => ipcRenderer.send('nacre:continue-phishing'),
  cancelPhishing: () => ipcRenderer.send('nacre:cancel-phishing'),
  siteZoom: (action) => ipcRenderer.send('nacre:site-zoom', String(action)),
  focusPage: () => ipcRenderer.send('nacre:focus-page'),
  homeShortcuts: (request) => ipcRenderer.invoke('nacre:home-shortcuts', request && typeof request === 'object' ? { ...request } : {}),
  siteIcons: (hosts) => ipcRenderer.invoke('nacre:site-icons', Array.isArray(hosts) ? hosts.map(String).slice(0, 80) : []),
  wallpaper: (action) => ipcRenderer.invoke('nacre:wallpaper', String(action || 'get')),
  panic: () => ipcRenderer.send('nacre:panic'),
  clearData: (options) => ipcRenderer.send('nacre:clear-data', options),
  openSettingsTab: () => ipcRenderer.send('nacre:open-settings-tab'),
  openSiteSettings: () => ipcRenderer.send('nacre:open-site-settings'),
  forgetSite: () => ipcRenderer.invoke('nacre:forget-site'),
  toggleForgetSite: () => ipcRenderer.send('nacre:toggle-forget-site'),
  showSettingsPanel: () => ipcRenderer.send('nacre:show-settings-panel'),
  openLeakTests: () => ipcRenderer.send('nacre:open-leak-tests'),
  openDonation: () => ipcRenderer.send('nacre:open-donation'),
  privacyCenter: (action, data) => ipcRenderer.invoke('nacre:privacy-center', action, data),
  customLanguage: (action) => ipcRenderer.invoke('nacre:custom-language', String(action || '')),
  runDiagnostics: (external) => ipcRenderer.invoke('nacre:diagnostic-run', external === true),
  getPhishingFeedStatus: () => ipcRenderer.invoke('nacre:phishing-feed-status'),
  openDownloads: () => ipcRenderer.send('nacre:open-downloads'),
  chooseDownloadDirectory: () => ipcRenderer.send('nacre:choose-download-directory'),
  chooseProfileLocation: () => ipcRenderer.send('nacre:choose-profile-location'),
  downloadAction: (id, action) => ipcRenderer.send('nacre:download-action', Number(id), String(action)),
  getSource: (url) => ipcRenderer.invoke('nacre:get-source', String(url || '')),
  getSitePermissions: () => ipcRenderer.invoke('nacre:get-site-permissions'),
  getSiteInfo: () => ipcRenderer.invoke('nacre:get-site-info'),
  getBookmarks: () => ipcRenderer.invoke('nacre:get-bookmarks'),
  saveBookmarks: (items) => ipcRenderer.invoke('nacre:save-bookmarks', items),
  importBookmarks: () => ipcRenderer.invoke('nacre:import-bookmarks'),
  exportBookmarks: () => ipcRenderer.invoke('nacre:export-bookmarks'),
  getImportSources: () => ipcRenderer.invoke('nacre:import-sources'),
  importFromBrowser: (id) => ipcRenderer.invoke('nacre:import-from-browser', String(id || '')),
  trustedSites: (data) => ipcRenderer.invoke('nacre:trusted-sites', data),
  finishWelcome: () => ipcRenderer.invoke('nacre:welcome-done'),
  openBookmarks: () => ipcRenderer.send('nacre:open-bookmarks'),
  openShortcuts: () => ipcRenderer.send('nacre:open-shortcuts'),
  openOffline: () => ipcRenderer.send('nacre:open-offline'),
  openProtectionDashboard: () => ipcRenderer.send('nacre:open-protection'),
  clearProtectionStats: () => ipcRenderer.send('nacre:clear-protection-stats'),
  copyAdblockReport: () => ipcRenderer.invoke('nacre:copy-adblock-report'),
  copyTransparencyReport: () => ipcRenderer.invoke('nacre:copy-transparency-report'),
  zapElement: () => ipcRenderer.invoke('nacre:zap-element'),
  setTabGroup: (id, name, color) => ipcRenderer.send('nacre:set-tab-group', Number(id), String(name || ''), String(color || 'mint')),
  workspace: (data) => ipcRenderer.invoke('nacre:workspace', data),
  splitView: (data) => ipcRenderer.invoke('nacre:split-view', data),
  applySitePermission: (data) => ipcRenderer.invoke('nacre:apply-site-permission', data),
  applySiteCookies: (data) => ipcRenderer.invoke('nacre:apply-site-cookies', data),
  checkUpdates: (repository) => ipcRenderer.invoke('nacre:check-updates', String(repository || '')),
  newIdentity: () => ipcRenderer.invoke('nacre:new-identity'),
  getTorLog: () => ipcRenderer.invoke('nacre:get-tor-log'),
  getMessages,
  getLanguage,
  getLocaleText: (key) => typeof localeMessages[key] === 'string' ? localeMessages[key] : key,
  localizeText,
  savePreferences: (settings) => ipcRenderer.send('nacre:update-preferences', settings),
  updateFilterLists: () => ipcRenderer.invoke('nacre:update-filter-lists'),
  addAdblockListUrl: (url) => ipcRenderer.invoke('nacre:add-adblock-list-url', String(url || '')),
  resetPreferences: () => ipcRenderer.send('nacre:reset-preferences'),
  continueHttp: () => ipcRenderer.send('nacre:continue-http'),
  cancelHttp: () => ipcRenderer.send('nacre:cancel-http'),
  configureProxy: (settings) => ipcRenderer.send('nacre:configure-proxy', settings),
  connectTor: (country) => ipcRenderer.send('nacre:connect-tor', String(country)),
  chooseTorCountry: (country) => ipcRenderer.send('nacre:choose-tor-country', String(country)),
  disableProxy: () => ipcRenderer.send('nacre:disable-proxy'),
  toggleSiteProtection: () => ipcRenderer.send('nacre:toggle-site-protection'),
  setSitePermission: (host, permission, mode) => ipcRenderer.send('nacre:set-site-permission', String(host || ''), String(permission || ''), String(mode || 'deny')),
  resetSitePermissions: (host) => ipcRenderer.send('nacre:reset-site-permissions', String(host || '*')),
  updateSetting: (key, value) => ipcRenderer.send('nacre:update-setting', String(key), Boolean(value)),
  layout: (chromeHeight, expanded) => ipcRenderer.send('nacre:layout', {
    chromeHeight: Number(chromeHeight),
    expanded: Boolean(expanded)
  })
}));
