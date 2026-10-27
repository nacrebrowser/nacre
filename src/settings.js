const api = window.nacre;
const params = new URLSearchParams(location.search);
const $ = (selector) => document.querySelector(selector);
const messages = Object.create(null);
const t = (key) => typeof messages[key] === 'string' ? messages[key] : key;
let state = null;
let timer;

const settingSections = [...document.querySelectorAll('.settings-main .group')];
const navLinks = [...document.querySelectorAll('.settings-sidebar a[href^="#"]')];
const searchField = $('#find-setting');
const emptyState = document.createElement('div');
emptyState.id = 'settings-empty';
emptyState.className = 'settings-empty';
emptyState.setAttribute('role', 'status');
emptyState.setAttribute('aria-live', 'polite');
emptyState.hidden = true;
const emptyLabel = document.createElement('span');
emptyLabel.dataset.i18n = 'commands.empty';
emptyState.append(emptyLabel);

function prepareSettingsSections() {
  for (const section of settingSections) {
    const children = [...section.children];
    const eyebrow = children.find((element) => element.classList.contains('eyebrow'));
    const title = children.find((element) => element.tagName === 'H1');
    const intro = children.find((element) => element.classList.contains('intro'));
    const header = document.createElement('header');
    header.className = 'settings-section-header';
    const content = document.createElement('div');
    content.className = 'settings-section-content';
    for (const element of [eyebrow, title, intro]) {
      if (element) header.append(element);
    }
    for (const element of children) {
      if (element !== eyebrow && element !== title && element !== intro) content.append(element);
    }
    section.replaceChildren(header, content);
  }
  $('#settings-main').append(emptyState);
}

function currentSettingRoute() {
  let route = location.hash.slice(1);
  try { route = decodeURIComponent(route); } catch { route = ''; }
  return settingSections.some((section) => section.id === route) ? route : 'start';
}

function updateSettingsNavigation() {
  const language = document.documentElement.lang || 'en';
  const needle = searchField.value.trim().toLocaleLowerCase(language);
  const route = currentSettingRoute();
  let visibleCount = 0;
  for (const section of settingSections) {
    const matches = !needle || section.textContent.toLocaleLowerCase(language).includes(needle);
    const visible = needle ? matches : section.id === route;
    section.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  emptyLabel.textContent = t('commands.empty');
  emptyState.hidden = !needle || visibleCount > 0;
  for (const link of navLinks) {
    const selected = !needle && link.getAttribute('href') === `#${route}`;
    link.classList.toggle('is-active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

prepareSettingsSections();
const backgroundField = document.createElement('label'); backgroundField.className = 'field';
const backgroundLabel = document.createElement('span'); backgroundLabel.dataset.i18n = 'settings.darkBackground'; backgroundLabel.textContent = 'Dark background palette';
const backgroundChoice = document.createElement('select'); backgroundChoice.dataset.pref = 'darkBackground';
for (const [value, name, label] of [['#202124', 'charcoal', 'Neutral charcoal'], ['#171d25', 'slate', 'Slate blue'], ['#1f1724', 'aubergine', 'Aubergine'], ['#17251e', 'forest', 'Forest'], ['#231b17', 'brown', 'Warm brown'], ['#121212', 'black', 'Black']]) {
  const option = document.createElement('option'); option.value = value; option.dataset.i18n = 'settings.darkBackground.' + name; option.textContent = label; backgroundChoice.append(option);
}
backgroundField.append(backgroundLabel, backgroundChoice); document.querySelector('#appearance .settings-section-content').append(backgroundField);
// Custom wallpaper for the home page. The main process opens the file picker,
// re-encodes the image and returns it only as a JPEG data: URL.
const wallpaperCard = document.createElement('div'); wallpaperCard.className = 'card wallpaper-card';
const wallpaperPreview = document.createElement('img'); wallpaperPreview.className = 'wallpaper-preview'; wallpaperPreview.alt = ''; wallpaperPreview.hidden = true;
const wallpaperInfo = document.createElement('div'), wallpaperTitle = document.createElement('b'), wallpaperDetail = document.createElement('small');
wallpaperTitle.dataset.i18n = 'wallpaper.title'; wallpaperTitle.textContent = 'Home page wallpaper';
wallpaperDetail.dataset.i18n = 'wallpaper.detail'; wallpaperDetail.textContent = 'A picture from your computer, kept in this profile only.';
wallpaperInfo.append(wallpaperTitle, wallpaperDetail);
const wallpaperChoose = document.createElement('button'); wallpaperChoose.type = 'button'; wallpaperChoose.id = 'wallpaper-choose'; wallpaperChoose.dataset.i18n = 'wallpaper.choose'; wallpaperChoose.textContent = 'Choose a picture…';
const wallpaperClear = document.createElement('button'); wallpaperClear.type = 'button'; wallpaperClear.id = 'wallpaper-clear'; wallpaperClear.dataset.i18n = 'wallpaper.remove'; wallpaperClear.textContent = 'Remove';
wallpaperCard.append(wallpaperPreview, wallpaperInfo, wallpaperChoose, wallpaperClear);
backgroundField.after(wallpaperCard);
let wallpaperShown = null;
function renderWallpaperSetting(id) {
  wallpaperClear.hidden = !id;
  if (id === wallpaperShown) return;
  wallpaperShown = id;
  if (!id) { wallpaperPreview.hidden = true; wallpaperPreview.removeAttribute('src'); return; }
  api.wallpaper('get').then((url) => {
    if (wallpaperShown !== id || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(String(url))) return;
    wallpaperPreview.src = url; wallpaperPreview.hidden = false;
  }).catch(() => {});
}
wallpaperChoose.addEventListener('click', () => {
  wallpaperChoose.disabled = true;
  api.wallpaper('choose').catch((error) => { wallpaperDetail.textContent = api.localizeText(error?.message) || t('wallpaper.invalid'); }).finally(() => { wallpaperChoose.disabled = false; });
});
wallpaperClear.addEventListener('click', () => { api.wallpaper('clear').catch(() => {}); });
const feedCard = document.createElement('div'); feedCard.className = 'card';
const feedInfo = document.createElement('div'), feedTitle = document.createElement('b'), feedDetail = document.createElement('small');
feedTitle.dataset.i18n = 'phishing.publicFeed'; feedTitle.textContent = 'Included public phishing signals';
feedInfo.append(feedTitle, feedDetail); feedCard.append(feedInfo); document.querySelector('#phishing .settings-section-content').prepend(feedCard);
api.getPhishingFeedStatus().then(feed => {
  feedDetail.style.whiteSpace = 'pre-line';
  const sources = (feed.sources || []).map(source => `${source.name}: ${source.entryCount.toLocaleString()} domains · ${source.sourceLastModified || 'unknown source date'} · ${source.freshness.status}`).join('\n');
  feedDetail.textContent = `${feed.entryCount.toLocaleString()} unique domains · snapshot ${feed.updatedAt}\n${sources || feed.source}\nSuspected sites, not confirmed findings. Updated with browser releases; no visited URL is sent to these providers.`;
}).catch(() => { feedDetail.textContent = 'Public feed unavailable. Manual rules still apply.'; });

function applySnapshot(next) {
  state = next;
  const prefs = next.settings;
  const languageSelect = $('#language');
  if (languageSelect) syncCustomLanguages(languageSelect, prefs.customLanguages);
  if (languageSelect && document.activeElement !== languageSelect) languageSelect.value = prefs.language || 'en';
  document.body.dataset.theme = prefs.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : prefs.theme;
  document.documentElement.style.setProperty('--accent', prefs.accent);
  document.documentElement.style.fontSize = (prefs.fontSize || 16) + 'px';
  renderWallpaperSetting(prefs.homeWallpaper || '');
  document.querySelectorAll('[data-pref]').forEach((element) => {
    const key = element.dataset.pref;
    if (element === document.activeElement) return;
    const value = prefs[key];
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else if (key === 'startupPages') element.value = Array.isArray(value) ? value.join('\n') : '';
    else if (value !== undefined) element.value = String(value);
    if (element.tagName === 'SELECT') {
      for (const option of element.options) {
        const key = option.getAttribute('data-i18n');
        if (key && typeof messages[key] === 'string') option.textContent = t(key);
      }
    }
  });
  const stamp = prefs.filterListsUpdatedAt ? new Date(prefs.filterListsUpdatedAt).toLocaleString(prefs.language || 'en') : '';
  $('#filter-status').textContent = prefs.blockerReady ? (stamp ? t('settings.filterStatusLoaded').replace('{date}', stamp) : t('settings.filterStatusBundled')) : t('settings.filterStatusUnavailable');
  $('#update-filters').disabled = Boolean(window.filterBusy);
  renderAdblock(next);
  const filterTorReady = prefs.proxy?.torReady === true;
  $('#filter-route-note').hidden = filterTorReady;
  $('#filter-network-link').hidden = filterTorReady;
  $('#webgl-status').textContent = t('settings.webglRuntime');
  $('#tor-country').value = prefs.proxy.torPreferredCountry || 'AUTO';
  $('#tor-status').textContent = prefs.proxy.torError
    ? t('settings.torUnavailableBlocked')
    : prefs.proxy.torConnectingCountry || prefs.proxy.torConnecting ? t('tor.connectingNetwork') + ' · ' + Number(prefs.proxy.torBootstrapPercent || 0) + '%'
    : prefs.proxy.torReady ? t('settings.torActiveExit').replace('{exit}', prefs.proxy.torLabel || t('tor.selected'))
      : prefs.proxy.enabled ? t('settings.manualProxyActive') : prefs.proxy.mode === 'direct' ? t('settings.directConnected') : t('settings.torStartingBlocked');
  $('#tor-toggle').textContent = prefs.proxy.torConnectingCountry || prefs.proxy.torConnecting ? t('tor.connecting')
    : prefs.proxy.torReady ? t('tor.deactivate')
      : prefs.proxy.torError ? t('settings.retryTor') : t('tor.activate');
  $('#tor-toggle').disabled = Boolean(prefs.proxy.torConnectingCountry);
  $('#direct-mode').disabled = prefs.proxy.mode === 'direct' || Boolean(prefs.proxy.torConnectingCountry);
  $('#direct-mode').hidden = prefs.proxy.mode === 'direct';
  $('#versions').textContent = `Electron ${next.versions.electron} · Chromium ${next.versions.chromium} · Tor ${next.versions.tor} · proxy ${prefs.proxy.mode}`;
  const blocklistCount = String(prefs.phishingBlocklist || '').split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length;
  $('#phishing-count').textContent = t('settings.phishingListCount').replace('{count}', new Intl.NumberFormat(prefs.language || 'en').format(blocklistCount));
  $('#download-directory').textContent = prefs.downloadDirectory || t('settings.downloadDirectoryDefault');
  $('#profile-location').textContent = prefs.profileLocation || t('settings.profileLocationDefault');
  if (params.get('page') === 'http-warning') $('#http-target').textContent = next.active?.pendingHttpUrl || t('settings.httpRequestedPage');
  updateSettingsNavigation();
}

function renderAdblock(next) {
  const prefs = next.settings;
  const listRoot = $('#adblock-lists');
  if (!listRoot) return;
  listRoot.replaceChildren();
  const lists = [...(prefs.adBlockStats?.lists || prefs.adBlockCatalog || []).filter((list) => !String(list.id).startsWith('custom:'))];
  for (const list of lists) {
    const row = document.createElement('label');
    row.className = 'filter-row';
    const text = document.createElement('span');
    const title = document.createElement('b'); title.textContent = list.name;
    const detail = document.createElement('small');
    const bundled = (prefs.adBlockStats?.bundledIds || []).includes(list.id);
    const stamp = list.updatedAt ? new Date(list.updatedAt).toLocaleString(prefs.language || 'en') : '';
    detail.textContent = bundled
      ? t('settings.filterBundledActive') + (stamp ? ' · ' + t('settings.filterSnapshotDate').replace('{date}', stamp) : '')
      : list.enabled
        ? stamp ? t('settings.filterUpdatedDate').replace('{date}', stamp) : t('settings.filterWaitingTor')
        : t('settings.filterOptionalDisabled');
    text.append(title, detail);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = Boolean(list.enabled || bundled); toggle.disabled = bundled; toggle.setAttribute('aria-label', t('settings.enableFilter').replace('{name}', list.name));
    toggle.addEventListener('change', () => {
      const states = { ...(prefs.adBlockListStates || {}) };
      states[list.id] = { ...(states[list.id] || {}), enabled: toggle.checked };
      api.savePreferences({ adBlockListStates: states });
    });
    row.append(text, toggle); listRoot.append(row);
  }
  for (const [index, item] of (prefs.adBlockCustomLists || []).entries()) {
    const row = document.createElement('label'); row.className = 'filter-row custom';
    const text = document.createElement('span');
    const title = document.createElement('b');
    try { title.textContent = new URL(item.url).hostname; } catch { title.textContent = t('settings.customListTitle'); }
    const detail = document.createElement('small'); detail.textContent = item.updatedAt ? t('settings.filterUpdatedDate').replace('{date}', new Date(item.updatedAt).toLocaleString(prefs.language || 'en')) : t('settings.filterNeverDownloaded');
    text.append(title, detail);
    const controls = document.createElement('span'); controls.className = 'filter-actions';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = item.enabled !== false; toggle.setAttribute('aria-label', t('settings.enableCustomList'));
    toggle.addEventListener('change', () => { const lists = (prefs.adBlockCustomLists || []).map((entry) => ({ ...entry })); lists[index].enabled = toggle.checked; api.savePreferences({ adBlockCustomLists: lists }); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('common.remove');
    remove.addEventListener('click', () => api.savePreferences({ adBlockCustomLists: (prefs.adBlockCustomLists || []).filter((_, current) => current !== index) }));
    controls.append(toggle, remove); row.append(text, controls); listRoot.append(row);
  }
  const exceptionRoot = $('#adblock-exceptions');
  if (exceptionRoot) {
    exceptionRoot.replaceChildren();
    for (const host of prefs.adBlockSiteExceptions || []) {
      const row = document.createElement('div'); row.className = 'exception-row';
      const name = document.createElement('span'); name.textContent = host;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('settings.reenable');
      remove.addEventListener('click', () => api.savePreferences({ adBlockSiteExceptions: (prefs.adBlockSiteExceptions || []).filter((entry) => entry !== host) }));
      row.append(name, remove); exceptionRoot.append(row);
    }
  }
  const metrics = prefs.blockerLoadMetrics || {};
  const mb = Number.isFinite(metrics.rssAfter) && Number.isFinite(metrics.rssBefore) ? Math.max(0, (metrics.rssAfter - metrics.rssBefore) / 1048576).toFixed(1) : '?';
  const runtime = metrics.loadMilliseconds == null ? '' : ` · ${t('settings.profileLocationLoading')} ${new Intl.NumberFormat(prefs.language || 'en').format(metrics.loadMilliseconds)} ms · RSS +${new Intl.NumberFormat(prefs.language || 'en', {maximumFractionDigits:1}).format(Number(mb))} MiB${metrics.source ? ' (' + api.localizeText(metrics.source) + ')' : ''}`;
  $('#filter-status').textContent = (prefs.blockerReady ? t('settings.filterEngineLoaded') : t('settings.filterEngineUnavailable')) + ' · ' + (prefs.adBlockUpdatedAt ? t('settings.filterStatusLoaded').replace('{date}', new Date(prefs.adBlockUpdatedAt).toLocaleString(prefs.language || 'en')) : t('settings.filterBundledSnapshot')) + runtime;
}

function save() {
  const data = {};
  document.querySelectorAll('[data-pref]').forEach((element) => {
    const key = element.dataset.pref;
    if (element.type === 'checkbox') data[key] = element.checked;
    else if (key === 'startupPages') data[key] = element.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    else if (key === 'defaultZoom' || key === 'fontSize' || key === 'suspendAfterMinutes') data[key] = Number(element.value);
    else data[key] = element.value;
  });
  api.savePreferences(data);
}

document.querySelectorAll('[data-pref]').forEach((element) => {
  element.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' || element.type === 'color' ? 'change' : 'input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 180);
  });
});
let catalogueSequence = 0;
async function loadCatalogue(language) {
  const sequence = ++catalogueSequence;
  const catalogue = await api.getMessages(language);
  if (sequence !== catalogueSequence) return;
  Object.assign(messages, catalogue);
  document.documentElement.lang = language;
  emptyLabel.textContent = t('commands.empty');
  if (state) applySnapshot(state);
  else updateSettingsNavigation();
}
api.getLanguage().then(loadCatalogue).catch(() => {});
window.addEventListener('nacre:locale-ready', (event) => {
  loadCatalogue(event.detail).catch(() => {});
});
// Custom languages found in the profile's languages folder follow the
// built-in ones in the list.
function syncCustomLanguages(select, languages) {
  const list = Array.isArray(languages) ? languages : [];
  for (const option of [...select.options]) if (option.dataset.custom) option.remove();
  for (const item of list) {
    const option = document.createElement('option');
    option.value = item.code;
    option.dataset.custom = 'true';
    option.textContent = t('settings.customLanguageOption').replace('{name}', item.name);
    select.append(option);
  }
}
$('#custom-language-create').addEventListener('click', async () => {
  const status = $('#custom-language-status');
  try {
    const result = await api.customLanguage('create');
    status.textContent = t('settings.customLanguageCreated').replace('{file}', result.file);
  } catch { status.textContent = t('settings.customLanguageFailed'); }
});
$('#custom-language-folder').addEventListener('click', () => { api.customLanguage('open-folder').catch(() => {}); });
$('#language').addEventListener('change', () => {
  const language = $('#language').value;
  if (![...$('#language').options].some(option => option.value === language)) return;
  api.savePreferences({ language });
  $('#language-restart-notice').hidden = true;
  $('#language-restart-notice').textContent = t('settings.languageRestartNotice');
});
let searchWasActive = false;
function handleSearchChange() {
  const searchIsActive = Boolean(searchField.value.trim());
  updateSettingsNavigation();
  if (searchIsActive !== searchWasActive) window.scrollTo({ top: 0, behavior: 'auto' });
  searchWasActive = searchIsActive;
}
searchField.addEventListener('input', handleSearchChange);
searchField.addEventListener('search', handleSearchChange);
searchField.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !searchField.value) return;
  event.preventDefault();
  searchField.value = '';
  searchField.dispatchEvent(new Event('input', { bubbles: true }));
});
$('#clear-data').addEventListener('click', () => api.clearData({ dataTypes: [...document.querySelectorAll('[name="clearType"]:checked')].map((input) => input.value) }));
$('#update-filters').addEventListener('click', async () => {
  if (window.filterBusy) return;
  if (state?.settings?.proxy?.torReady !== true) {
    $('#filter-update-result').textContent = t('settings.filterTorRequired');
    $('#filter-update-result').dataset.kind = 'warning';
    return;
  }
  $('#filter-update-result').dataset.kind = 'working';
  window.filterBusy = true;
  $('#filter-update-result').textContent = t('settings.filterDownloadingTor');
  $('#update-filters').disabled = true;
  try {
    const result = await api.updateFilterLists();
    $('#filter-update-result').dataset.kind = 'success';
    const reloaded = Number(result?.reloadedYoutubeTabs || 0);
    $('#filter-update-result').textContent = reloaded
      ? t('settings.filterLoadedReloaded').replace('{count}', String(reloaded))
      : t('settings.filterLoadedNextNavigation');
  }
  catch (error) { $('#filter-update-result').dataset.kind = 'warning'; $('#filter-update-result').textContent = api.localizeText(error?.message) || t('settings.filterFailedClosed'); }
  finally { window.filterBusy = false; $('#update-filters').disabled = false; }
});
$('#custom-list-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#custom-list-url'); const output = $('#filter-update-result');
  output.textContent = t('settings.filterAddingTor');
  try { await api.addAdblockListUrl(input.value); input.value = ''; output.textContent = t('settings.filterListAdded'); }
  catch (error) { output.textContent = api.localizeText(error?.message) || t('settings.filterListFailed'); }
});
$('#add-adblock-exception').addEventListener('click', () => {
  const host = $('#adblock-exception-host').value.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (!/^(?=.{1,253}$)[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) { $('#filter-update-result').textContent = t('settings.invalidHostname'); return; }
  const current = state?.settings?.adBlockSiteExceptions || [];
  api.savePreferences({ adBlockSiteExceptions: [...new Set([...current, host])] });
  $('#adblock-exception-host').value = '';
});
$('#site-permissions').addEventListener('click', () => api.openSiteSettings());
$('#manage-bookmarks').addEventListener('click', () => api.openBookmarks());
$('#tor-toggle').addEventListener('click', () => {
  const country = $('#tor-country').value;
  if (state?.settings?.proxy?.mode === 'tor' && !state.settings.proxy.torError) api.disableProxy();
  else if (!state?.settings?.proxy?.torConnectingCountry) { api.chooseTorCountry(country); api.connectTor(country); }
});
$('#tor-country').addEventListener('change', () => {
  const country = $('#tor-country').value;
  api.chooseTorCountry(country);
  if (state && state.settings.proxy.mode === 'tor') api.connectTor(country);
});
$('#proxy-settings').addEventListener('click', () => api.showSettingsPanel());
$('#direct-mode').addEventListener('click', () => api.disableProxy());
$('#reset-preferences').addEventListener('click', () => api.resetPreferences());
$('#leak-tests').textContent = t('diagnostics.run');
$('#leak-tests').addEventListener('click', () => api.openLeakTests());
$('#donate').addEventListener('click', () => api.openDonation());
$('#choose-download-directory').addEventListener('click', () => api.chooseDownloadDirectory());
$('#choose-profile-location').addEventListener('click', () => api.chooseProfileLocation());
$('#show-downloads').addEventListener('click', () => api.openDownloads());
$('#security-check').addEventListener('click', () => {
  const prefs = state.settings;
  const torActive = (prefs.proxy.mode === 'tor' && !prefs.proxy.torError) || Boolean(prefs.proxy.torConnectingCountry);
  $('#security-result').textContent = t('settings.securityReport').replace('{dns}', prefs.proxy.enabled ? t('settings.dnsDisabledProxy') : prefs.secureDnsMode === 'strict' ? t('settings.dnsQuad9Active') : t('settings.dnsQuad9Automatic')).replace('{webrtc}', torActive ? t('settings.webrtcTor') : t('settings.webrtcDirect')).replace('{blocker}', prefs.blockerReady ? t('settings.easylistLoaded') : t('settings.filterEngineUnavailable')).replace('{tor}', torActive ? t('settings.active') : prefs.proxy.torError ? t('settings.unavailableBlocked') : t('settings.inactive'));
});
$('#check-updates').addEventListener('click', async () => {
  const button = $('#check-updates');
  const output = $('#update-result');
  button.disabled = true;
  output.textContent = state?.settings?.proxy?.mode === 'tor' && !state.settings.proxy.torError
    ? t('settings.githubCheckingTor')
    : t('settings.connectTorFirst');
  try {
    const result = await api.checkUpdates($('#release-repository').value.trim());
    const statusLine = (label, item) => {
      if (item.unconfigured) return t('settings.releaseUnconfigured').replace('{label}', label).replace('{current}', item.current);
      if (item.error) return t('settings.releaseCheckFailed').replace('{label}', label).replace('{current}', item.current).replace('{error}', api.localizeText(item.error));
      return item.updateAvailable
        ? t('settings.releaseUpdateAvailable').replace('{label}', label).replace('{current}', item.current).replace('{latest}', item.latest)
        : t('settings.releaseUpToDate').replace('{label}', label).replace('{current}', item.current).replace('{latest}', item.latest);
    };
    output.textContent = [statusLine('Nacre', result.nacre), statusLine('Electron', result.electron)].join('\n');
  } catch (error) {
    output.textContent = api.localizeText(error?.message) || t('settings.updatesFailed');
  } finally {
    button.disabled = false;
  }
});

if (params.get('page') === 'http-warning') {
  $('#settings-app').hidden = true;
  $('#http-warning').hidden = false;
  $('#http-target').textContent = state?.active?.pendingHttpUrl || t('settings.httpRequestedPage');
  $('#continue-http').addEventListener('click', () => api.continueHttp());
  $('#cancel-http').addEventListener('click', () => api.cancelHttp());
}

window.addEventListener('hashchange', updateSettingsNavigation);
window.addEventListener('popstate', updateSettingsNavigation);
navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (searchField.value) {
      searchField.value = '';
      searchWasActive = false;
    }
    const destination = link.getAttribute('href');
    if (location.hash !== destination) history.pushState(null, '', destination);
    updateSettingsNavigation();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
});
updateSettingsNavigation();
api.onState(applySnapshot);
