process.env.TZ = 'UTC';
const { app, BaseWindow, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog, safeStorage, protocol, net: electronNet, clipboard, nativeImage, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const net = require('node:net');
const { promptHttpAuth, isAuthContents } = require('./http-auth.cjs');
const { createProtectionActivity, cookieNamesFromHeader, attribution, filterIdentifier, createTransparencyReport } = require('./protection-activity.cjs');
const { readBoundedBody, validZapperSelector, normalizeSitePermissions, parseBookmarkHtml } = require('./hardening-core.cjs');
const { createProfileIntegrity } = require('./profile-integrity.cjs');
const { createLocalProfiles, defaultProfilePaths } = require('./local-profiles.cjs');
const { createProfileVault, isVaultEnvelope } = require('./profile-vault.cjs');
const { promptVault } = require('./vault-prompt.cjs');
const { privacyCheck, applyPrivacyAction } = require('./privacy-check.cjs');
const { cleanTrackingLink } = require('./tracking-links.cjs');
const { webProbeSource } = require('./diagnostic-web-probe.cjs');
const { getPhishingFeedStatus } = require('./phishing-feed.cjs');
const { getReleaseValidationReport } = require('./release-validation.cjs');
const { readStartupChoice, applyStartupChoice, applyStartupRoute } = require('./startup-choice.cjs');
const { normalizeStoredScalars, applyScalarPatch } = require('./settings-schema.cjs');
const { hostResolverOptions, isStrictDnsFailure } = require('./dns-policy.cjs');
const { safeURL, sanitizeStoredProxy, sanitizeSiteZoom, isGitHubRepository, compareVersions, searchURL: searchURLFor } = require('./url-policy.cjs');
// Search addresses follow the user's engine choice.
const searchURL = (query) => searchURLFor(query, settings.searchEngine, settings.customSearchUrl);
const { pickFaviconUrl, fetchFaviconBytes, encodeFavicon, isSafeFaviconDataUrl, imageDimensions } = require('./favicon.cjs');
const { localizeText } = require('./message-localizer.cjs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const securityWarnings = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
const { getDomain } = require('tldts-experimental');
const { createTorSocksBridge } = require('./tor-socks-bridge.cjs');
const { connectTorControl, readControlPort } = require('./tor-control.cjs');
const { createCircuitBudget, permissionModeFor, setPermissionPolicy, validateBridgeLines, validateSettingsPayload, shouldFailClosed, torStoppedErrorUrl, torStartupResumeUrl, stripTrackingParameters } = require('./privacy-core.cjs');
const { buildTorBridgeArguments } = require('./tor-bridge-config.cjs');
const { TOR_BUNDLE_VERSION, TOR_VERSION, verifyPinnedTorFiles, secureTorRuntimeDirectory } = require('./tor-integrity.cjs');
const { buildTorRuntimeArguments } = require('./tor-runtime-config.cjs');
const { TOR_EXIT_COUNTRIES, TOR_EXIT_COUNTRY_ERROR, isTorExitSelection, TOR_EXIT_AUTO, assertTorExitCountry, migrateStoredTorCountry } = require('./tor-exit-countries.cjs');
const { createFilterMetadata, isFilterMetadataFor } = require('./filter-metadata.cjs');
const { buildChromeUserAgent, buildChromeUserAgentMetadata, buildClientHintHeaders, applyPrivacySignals } = require('./fingerprint-config.cjs');
const { sanitizeTorLog, explainTorFailure } = require('./tor-diagnostics.cjs');
const { DEFAULT_LISTS, MAX_LIST_BYTES, MAX_TOTAL_LIST_BYTES, FILTER_FETCH_TIMEOUT_MS, safeFilterListUrl, readFilterResponseText, validateFilterListText, validateCustomFilters, shouldUpdateViaTor, shouldBlockStrictThirdParty, verifyAdvertisedDigest, updateBlockerFromSources, persistFilterSnapshot, recordBlockedRequest, normalizeListStates, updateDue, reloadYouTubeTabs } = require('./adblock-core.cjs');
const { buildProceduralCosmeticScript } = require('./adblock-procedural.cjs');
const { buildScriptletBundle } = require('./adblock-injector.cjs');
const { INTERNAL_HOSTS, isTrustedNacreMainFrame, isAllowedNavigationTarget, isAllowedNacreRequest } = require('./security-core.cjs');
const { secureInternalResponse, internalErrorResponse } = require('./internal-response.cjs');
const { CLOSED_PROXY_HOST, CLOSED_PROXY_PORT, closedProxyConfig, chromiumPrivacySwitches, shouldAllowHttpRequest, isHttpUrl } = require('./network-security.cjs');
const { shouldBlockRequestCookies, cookieContextForRequest, cookieRemovalUrl } = require('./cookie-policy.cjs');
const { clearDataTypesForSelection, sanitizeDownloadFilename, isRiskyOpenDownload, isSafeAutoOpenDownload, canRemoveDownloadRecord, publicDownloadRecord } = require('./data-policy.cjs');
const { configuredUserDataPath, writeProfileLocation } = require('./profile-location.cjs');
const { isLocalAddressInput } = require('./address-input.cjs');
const { applyWebglDisablePolicy } = require('./webgl-policy.cjs');
const { createFingerprintSeedStore } = require('./fingerprint-seeds.cjs');
const { registerFrameLocaleOverrides } = require('./frame-locale.cjs');
const { isAvailableLanguage, closestLanguage, preferredLanguage, isRightToLeft, getMessages, t: translate, setCustomLanguageDirectory, listCustomLanguages, createCustomLanguage } = require('./i18n.cjs');
const { normalizeWorkspaces, createWorkspace, renameWorkspace, removeWorkspace, workspaceForTab, publicWorkspaceState, persistWorkspaceState } = require('./workspace-model.cjs');
const { normalizeHome, migrateHome, applyShortcutAction, nextZoom, pageBounds, canSplit } = require('./experience-core.cjs');
const { iconHost, fetchSiteIcon, createSiteIconStore } = require('./site-icons.cjs');
const { verdictFor: phishingVerdict } = require('./phishing-guard.cjs');
const { normalizeReaderDocument, extractionSource: readerExtractionSource } = require('./reader-extract.cjs');
const { COOKIE_POLICIES, validHost, normalizeSiteCookiePolicies, siteCookiePolicy, detachedCookiePolicy } = require('./site-cookie-controls.cjs');
const { normalizeWorkspaceIdentityState, createSerialQueue, waitForAll, workspaceSessionEntries } = require('./workspace-sessions.cjs');
const { filterContext, registerRequestFilter } = require('./request-filter-context.cjs');
const { createForgetfulSites } = require('./forgetful-sites.cjs');
const { tabsToSleep } = require('./tab-sleep.cjs');
const { findBrowserSources, describeSources, readSourceBookmarks, readSourceIcons, mergeBookmarks } = require('./browser-import.cjs');
const { TRUSTED_SITE_PRESETS, MAX_TRUSTED_SITES, normalizeTrustedSites, presetDomains, enabledPresets, isTrustedDomain, normalizeTrustedSecret, createTrustedSecret, trustedFingerprintSeed, trustedOrigins } = require('./trusted-sites.cjs');
if (securityWarnings === undefined) delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
else process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = securityWarnings;

protocol.registerSchemesAsPrivileged([{ scheme: 'nacre', privileges: { standard: true, secure: true } }]);
// Asking Chromium to enable the process sandbox after the caller explicitly
// disabled it crashes on Windows 11 26200 (0xC0000005 at first window). Keep the
// app bootable for the documented --no-sandbox fixture path; normal launches
// still enable the sandbox here.
if (!process.argv.includes('--no-sandbox')) app.enableSandbox();

const APP_NAME = 'Nacre';
const DONATION_URL = 'https://www.paypal.com/paypalme/donNacre';
// Electron names the default profile folder after the package (nacre-browser).
// Use %APPDATA%\Nacre, where the profile pointer and registry already live, but
// keep an existing nacre-browser profile when it is the only one.
if (path.basename(app.getPath('userData')) === 'nacre-browser') {
  const named = path.join(app.getPath('appData'), APP_NAME);
  if (fs.existsSync(path.join(named, 'settings.json')) || !fs.existsSync(path.join(app.getPath('userData'), 'settings.json'))) app.setPath('userData', named);
}
// Set the profile path before ready. Portable builds default beside Nacre.exe;
// an internal settings action can point to another folder for the next launch.
const selectedUserDataPath = configuredUserDataPath({
  portable: process.env.NACRE_PORTABLE_MODE === '1',
  executablePath: app.getPath('exe'),
  appDataPath: app.getPath('appData'),
  readFileSync: fs.readFileSync.bind(fs)
});
if (selectedUserDataPath) {
  fs.mkdirSync(selectedUserDataPath, { recursive: true });
  app.setPath('userData', selectedUserDataPath);
}
const personalProfilePath = app.getPath('userData');
let localProfiles;
function ensureLocalProfiles() {
  if (!localProfiles) {
    localProfiles = createLocalProfiles({ appDataPath: app.getPath('appData'), defaultProfilePath: personalProfilePath });
    localProfiles.initialize();
  }
  return localProfiles;
}
// Do not create a new registry until the profile controls are used. Existing
// selections must be applied before Chromium initializes any sessions.
if (fs.existsSync(defaultProfilePaths({ appDataPath: app.getPath('appData') }).registryPath)) {
  const selected = ensureLocalProfiles().getSelectedProfile();
  fs.mkdirSync(selected.path, { recursive: true });
  app.setPath('userData', selected.path);
  app.setPath('sessionData', selected.path);
}
let profileVault;
let startupGateActive = true;
// Profile vault transactions must never race a second process using the same data.
if (app.requestSingleInstanceLock?.() === false) app.exit(0);
else app.on?.('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
});
// crashReporter is never started. Keep Electron's crash dump destination inside
// the selected profile in case a future component enables it accidentally.
app.setPath('crashDumps', path.join(app.getPath('userData'), 'crashDumps'));
// Custom languages written by the user live in the selected profile.
setCustomLanguageDirectory(path.join(app.getPath('userData'), 'languages'));
// Keep WebRTC from opening direct UDP paths that could bypass a configured proxy.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('lang', 'en-US');
// Audible media must not start without a user gesture. Chromium still allows
// muted autoplay; the per-view preference below repeats the policy for tab views.
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');
// Fail closed for Chromium networking contexts that do not belong to an
// explicitly configured browser Session. Browser Sessions replace this route
// with the user's system proxy, configured proxy, or Tor before any page loads.
app.commandLine.appendSwitch('proxy-server', `${CLOSED_PROXY_HOST}:${CLOSED_PROXY_PORT}`);
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
for (const [name, value] of chromiumPrivacySwitches()) app.commandLine.appendSwitch(name, value);
// Disable hardware/software 3D and the WebGL APIs before Chromium starts. A
// renderer override alone failed to hide the physical GPU in BrowserLeaks.
const startupWebglMode = 'disabled';
applyWebglDisablePolicy(app);
const torWebRtcPreloads = new WeakMap();
const defaults = {
  blockTrackers: true,
  adBlockEnabled: true,
  adBlockMode: 'comfort',
  adBlockWeeklyUpdates: false,
  adBlockListStates: normalizeListStates(),
  adBlockCustomLists: [],
  adBlockCustomFilters: '',
  adBlockSiteExceptions: [],
  adBlockUpdatedAt: '',
  webglMode: 'disabled',
  blockThirdPartyCookies: true,
  sendGpc: true,
  sendDnt: false,
  clearOnQuit: false,
  directMode: false,
  siteExceptions: [],
  bookmarks: [],
  proxy: { enabled: false, type: 'socks5', host: '', port: 1080, username: '', encryptedPassword: '' },
  torCountry: '',
  torAutoStart: true,
  torPreferredCountry: TOR_EXIT_AUTO,
  searchEngine: 'duckduckgo',
  releaseRepository: 'nacrebrowser/nacre',
  customSearchUrl: '',
  startupMode: 'new-tab',
  startupPages: [],
  theme: 'dark',
  accent: '#2f9e86',
  darkBackground: '#202124',
  defaultZoom: 100,
  fontSize: 16,
  showBookmarksBar: true,
  httpsOnly: true,
  filterListsUpdatedAt: '',
  askDownloadLocation: true,
  downloadDirectory: '',
  openDownloadsAfter: false,
  antiFingerprint: true,
  cookiePolicy: 'block-third-party',
  forgetSiteOnClose: [],
  trustedSites: [],
  trustedSiteSecret: '',
  welcomeDone: false,
  torBridgeMode: 'none',
  torBridgeLines: '',
  language: 'en',
  siteZoom: {},
  workspaces: normalizeWorkspaces(),
  workspaceLegacyOwner: 'personal',
  workspaceSessionPartitions: Object.create(null),
  workspaceSitePermissions: Object.create(null),
  workspaceSiteCookiePolicies: Object.create(null),
  activeWorkspace: 'personal',
  verticalTabs: false,
  phishingGuardEnabled: true,
  phishingBlocklist: '',
  iconTorBackground: true,
  suspendInactiveTabs: true,
  suspendAfterMinutes: 15,
  secureDnsMode: 'automatic',
  home: normalizeHome(),
  homeWallpaper: ''
};

let win;
let chromeView;
let regularSession;
const workspaceSessionObjects = new Map();
const privateSessionObjects = new Set();
const retiredSessions = new Set();
const sessionIdentities = new WeakMap();
const workspaceMutations = createSerialQueue();
const removingWorkspaceIds = new Set();
const pendingTabCreations = new Set();
let identityLifecycleBusy = false;
let activeTabId = null;
let activeWorkspaceId = 'personal';
let splitTabIds = [];
let splitRatio = .5;
let nextTabId = 1;
let expandedOverlay = false;
// Menus and panels draw in the chrome view. While one is open the chrome view
// is raised above the page views (with a transparent background) so the page
// stays visible underneath, as in other desktop browsers. null = unknown depth.
let chromeViewOnTop = false;
let quittingAfterClear = false;
let dnsRouteUsesProxy = false;
let browserSize = { width: 1200, height: 800, chromeHeight: 86 };
let settings = { ...defaults };
const tabs = new Map();
const recentlyClosedTabs = [];
const tabByContentsId = new Map();
const configuredSessions = new WeakSet();
const privacyPreloads = new WeakMap();
const userAgentPreloads = new WeakMap();
const webglGuardPreloads = new WeakMap();
const privatePermissionDecisions = new Map();
const pendingPermissionPrompts = new Set();
const forgetfulSites = createForgetfulSites();
const pendingSiteClears = new Map();
const cookieGuardPreloads = new WeakMap();
let profileIntegrity;
let profileIntegrityWarning = '';
const fingerprintSeeds = createFingerprintSeedStore();
const protocolSessions = new WeakSet();
const downloads = new Map();
let nextDownloadId = 1;
let torRuntime = null;
let torStartupError = '';
let lastTorLog = '';
let torConnectingCountry = '';
let torBootstrapPercent = 0;
let torExitIp = '';
let torIdentityChanging = false;
let torCircuitStateTimer = null;
let blocker = null;
let blockerUpdate = null;
let blockerLoadMetrics = { loadMilliseconds: 0, rssBefore: 0, rssAfter: 0, source: 'non chargé' };
let adBlockStats = { total: 0, byType: {}, bySite: {}, lastUpdated: 0 };
const protectionActivity = createProtectionActivity();
let adBlockSourcesCache = {};
let adBlockWeeklyTimer = null;
let adBlockStateTimer = null;
let adBlockPreloads = new WeakMap();
const readerDocuments = new Map();
const shareDocuments = new Map();
const phishingNotices = new Map();
let panicBusy = false;
let tabSuspensionTimer = null;

function torAsset(...names) {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor'), 'tor', ...names);
}

function stopTor(runtime) {
  if (!runtime || !runtime.process || runtime.process.exitCode !== null) return;
  try { runtime.process.kill(); } catch {}
}

function waitForTorExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function removeTorDataDirectory(directory) {
  if (!directory) return;
  await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rmdir(path.dirname(directory)).catch(() => {});
}

function torBridgeConfiguration(mode, configuredLines, directory = torAsset()) {
  const asset = (...names) => path.join(directory, ...names);
  if (mode === 'none') return [];
  if (!['obfs4', 'snowflake', 'custom'].includes(mode)) throw new Error('Le type de pont Tor choisi est invalide.');
  let lines = String(configuredLines || '');
  if (!lines.trim() && mode !== 'custom') {
    let defaults;
    try { defaults = JSON.parse(fs.readFileSync(asset('pt_config.json'), 'utf8')).bridges; }
    catch { throw new Error('La configuration des ponts n’est pas disponible dans le bundle Tor.'); }
    lines = (defaults && defaults[mode] || []).join('\n');
  }
  const executable = asset('pluggable_transports', 'lyrebird.exe');
  return buildTorBridgeArguments(mode, lines, fs.existsSync(executable) ? executable : '');
}

// background: a temporary Tor that only fetches site icons (see
// fetchIconsInBackground). It leaves the visible Tor state untouched, and
// onSpawn hands its runtime out early so it can be stopped while connecting.
async function startTor(country, { background = false, onSpawn } = {}) {
  if (!isTorExitSelection(country)) throw new Error(TOR_EXIT_COUNTRY_ERROR);
  let executable = torAsset('tor.exe');
  let geoip = torAsset('geoip');
  let geoip6 = torAsset('geoip6');
  if (!background) torBootstrapPercent = 0;
  for (const file of [executable, geoip, geoip6]) {
    if (!fs.existsSync(file)) throw new Error('Les fichiers Tor inclus sont introuvables. Réinstalle Nacre.');
  }
  const torDirectory = path.dirname(executable);
  const integrity = verifyPinnedTorFiles(torDirectory);
  if (!integrity.valid) throw new Error('L’intégrité du bundle Tor ' + TOR_BUNDLE_VERSION + ', de ses transports ou de sa configuration ne correspond pas aux empreintes intégrées à Nacre. Tor ne sera pas lancé.');

  const dataDirectory = path.join(app.getPath('userData'), 'tor-runtime', crypto.randomBytes(16).toString('hex'));
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  try { secureTorRuntimeDirectory(dataDirectory); }
  catch (error) {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    throw new Error('Nacre ne peut pas protéger le dossier temporaire Tor : ' + error.message);
  }
  const bundleDirectory = path.join(dataDirectory, 'bundle');
  fs.cpSync(torDirectory, bundleDirectory, { recursive: true, dereference: false });
  executable = path.join(bundleDirectory, 'tor.exe');
  geoip = path.join(bundleDirectory, 'geoip');
  geoip6 = path.join(bundleDirectory, 'geoip6');
  const bridgeArgs = torBridgeConfiguration(settings.torBridgeMode || 'none', settings.torBridgeLines || '', bundleDirectory);
  const controlPortFile = path.join(dataDirectory, 'control-port');
  const cookiePath = path.join(dataDirectory, 'control_auth_cookie');
  const args = buildTorRuntimeArguments({ socksPort: 'auto', controlPort: 'auto', controlPortFile, cookiePath, dataDirectory, geoip, geoip6, country, bridgeArgs });
  // No await or mutable setup between this check and CreateProcess. The bundle
  // copy inherits the private runtime ACL; same-account malware is out of scope.
  if (!verifyPinnedTorFiles(bundleDirectory).valid) {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    throw new Error('Tor runtime integrity failed');
  }
  const child = spawn(executable, args, { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const runtime = { process: child, port: 0, controlPort: 0, cookiePath, dataDirectory, country, output: '', ready: false, stopping: false, background, bridges: new Map(), control: null, circuitBudget: createCircuitBudget(16) };
  onSpawn?.(runtime);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Tor n’a pas réussi à se connecter au réseau en 2 minutes. Vérifie ta connexion ou réessaie.')), 120000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        if (!background) lastTorLog = sanitizeTorLog(runtime.output);
        stopTor(runtime);
        reject(error);
      } else {
        resolve(runtime);
      }
    };
    const onError = () => {
      removeTorDataDirectory(dataDirectory).catch(() => {});
      finish(new Error('Impossible de démarrer le relais Tor intégré.'));
    };
    const onExit = (code) => {
      if (!settled) finish(new Error('Le relais Tor s’est arrêté avant sa connexion (' + code + ').'));
      else if (!runtime.stopping && torRuntime === runtime) {
        torRuntime = null;
        torStartupError = 'Le relais Tor s’est interrompu. Le trafic reste bloqué tant qu’il n’est pas reconnecté.';
        torExitIp = '';
        handleUnexpectedTorExit(runtime);
      }
      removeTorDataDirectory(dataDirectory).catch(() => {});
    };
    const onOutput = (chunk) => {
      runtime.output = sanitizeTorLog(runtime.output + chunk.toString());
      if (!background) lastTorLog = runtime.output;
      const progress = [...runtime.output.matchAll(/Bootstrapped (\d+)%/g)].pop();
      if (!background && progress && Number(progress[1]) !== torBootstrapPercent) {
        torBootstrapPercent = Math.min(100, Number(progress[1]));
        sendState();
      }
      if (/Bootstrapped 100% \(done\): Done/i.test(runtime.output) && !runtime.ready) {
        runtime.ready = true;
        Promise.resolve().then(() => {
          runtime.controlPort = readControlPort(controlPortFile);
          return connectTorControl(runtime.controlPort, cookiePath, () => {
          if (torRuntime !== runtime || torCircuitStateTimer) return;
          torCircuitStateTimer = setTimeout(() => { torCircuitStateTimer = null; sendState(); }, 200);
          });
        }).then(async (control) => {
          runtime.control = control;
          runtime.port = await control.socksPort();
          finish();
        }).catch((error) => finish(error));
      }
      if (!settled && /\[err\]|Could not bind to .*SocksPort|Address already in use/i.test(runtime.output)) {
        finish(new Error('Le relais Tor n’a pas pu ouvrir son port local. Ferme l’autre instance et réessaie.'));
      }
    };
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
  });
}

function torProxyConfig(port) {
  return { mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:' + port, proxyBypassRules: '<-loopback>' };
}

async function torBridgeForSession(runtime, ses) {
  let bridge = runtime.bridges.get(ses);
  if (!bridge) {
    bridge = createTorSocksBridge({
      upstreamPort: runtime.port,
      getDomain: (host) => getDomain(host, { allowPrivateDomains: true }) || host,
      budget: runtime.circuitBudget,
      onCircuitEvict: (token) => runtime.control && runtime.control.closeCircuitsForTokens([token]).catch(() => {})
    });
    runtime.bridges.set(ses, bridge);
    try { await bridge.ready; }
    catch (error) { runtime.bridges.delete(ses); throw error; }
  }
  return bridge;
}

async function torSessionProxyConfig(runtime, ses) {
  if (shouldFailClosed(true, Boolean(runtime && runtime.ready && runtime.process && runtime.process.exitCode === null))) return torProxyConfig(1);
  const bridge = await torBridgeForSession(runtime, ses);
  return torProxyConfig(bridge.port);
}

async function closeTorRuntime(runtime) {
  if (!runtime) return;
  if (runtime.cleanupPromise) return runtime.cleanupPromise;
  runtime.cleanupPromise = (async () => {
    runtime.stopping = true;
    if (runtime.control) runtime.control.close();
    await Promise.all(Array.from(runtime.bridges.values(), (bridge) => bridge.close().catch(() => {})));
    runtime.bridges.clear();
    stopTor(runtime);
    let exited = await waitForTorExit(runtime.process, 5000);
    if (!exited) {
      stopTor(runtime);
      exited = await waitForTorExit(runtime.process, 2000);
    }
    if (exited && runtime.dataDirectory) {
      await removeTorDataDirectory(runtime.dataDirectory);
    }
    else console.warn('Le dossier temporaire Tor est conservé car tor.exe n’a pas confirmé son arrêt.');
  })();
  return runtime.cleanupPromise;
}

async function handleUnexpectedTorExit(runtime) {
  // Keep every session pinned to a known closed local port before showing the
  // local error page. No session is ever returned to the system/direct route.
  const sessions = browserSessions();
  await waitForAll(sessions.map((ses) => setSessionProxy(ses, torProxyConfig(1)).catch(() => {})));
  await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
  for (const tab of tabs.values()) {
    if (!tab.pageView || tab.pageView.webContents.isDestroyed()) continue;
    const failedUrl = safeURL(tab.url);
    if (!failedUrl) continue;
    tab.torResumeUrl = failedUrl;
    navigateTab(tab, torStoppedErrorUrl(failedUrl));
  }
  closeTorRuntime(runtime).catch(() => {});
  sendState();
  notify('toast.torStopped', {}, 'warning');
}

function primaryDomain(host) {
  return getDomain(String(host || '').toLowerCase(), { allowPrivateDomains: true }) || String(host || '').toLowerCase();
}

// The first language of the Windows preference list that Nacre has, so
// "Swahili, French" gives French; the display language comes last.
function systemSupportedLanguage() {
  const preferred = app.getPreferredSystemLanguages?.();
  return preferredLanguage([...(Array.isArray(preferred) ? preferred : []), String(app.getLocale?.() || '')]);
}

function countryName(code) {
  if (!code) return '';
  if (code === TOR_EXIT_AUTO) return translate('tor.countryAUTO', settings.language || 'en');
  return new Intl.DisplayNames([settings.language || 'en'], { type: 'region' }).of(code);
}

async function updateTorExitIp() {
  if (!settings.torCountry || !torRuntime || !torRuntime.ready || !regularSession || !torRuntime.process || torRuntime.process.exitCode !== null) {
    throw new Error('Tor doit être connecté avant de vérifier l’IP de sortie.');
  }
  const response = await regularSession.fetch('https://check.torproject.org/api/ip', {
    redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'User-Agent': buildChromeUserAgent(process.versions.chrome) }
  });
  if (!response.ok) throw new Error('Le service de vérification IP a répondu avec le statut HTTP ' + response.status + '.');
  const result = JSON.parse(await response.text());
  if (result.IsTor !== true || net.isIP(String(result.IP || '')) === 0) throw new Error('Le service officiel n’a pas confirmé une adresse de sortie Tor valide.');
  torExitIp = String(result.IP);
  sendState();
  return torExitIp;
}

function effectiveProxyConfig(proxy = settings.proxy, torCountry = settings.torCountry, runtime = torRuntime) {
  const requiredCountry = torCountry || torConnectingCountry;
  if (requiredCountry) return torProxyConfig(runtime && runtime.country === requiredCountry ? runtime.port : 1);
  return proxyConfig(proxy);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function applyWorkspaceIdentitySettings(stored = {}) {
  const options = {
    workspaces: settings.workspaces,
    storedPartitions: stored.workspaceSessionPartitions,
    storedSitePermissionsByWorkspace: stored.workspaceSitePermissions,
    storedCookiePoliciesByWorkspace: stored.workspaceSiteCookiePolicies,
    legacySitePermissions: stored.sitePermissions,
    legacySiteCookiePolicies: stored.siteCookiePolicies,
    normalizePermissions: normalizeSitePermissions,
    normalizeCookiePolicies: normalizeSiteCookiePolicies
  };
  if (Object.hasOwn(stored, 'workspaceLegacyOwner')) options.storedLegacyOwner = stored.workspaceLegacyOwner;
  Object.assign(settings, normalizeWorkspaceIdentityState(options));
  delete settings.sitePermissions;
  delete settings.siteCookiePolicies;
}

function normalizeCurrentWorkspaceIdentities() {
  Object.assign(settings, normalizeWorkspaceIdentityState({
    workspaces: settings.workspaces,
    storedPartitions: settings.workspaceSessionPartitions,
    storedLegacyOwner: settings.workspaceLegacyOwner,
    storedSitePermissionsByWorkspace: settings.workspaceSitePermissions,
    storedCookiePoliciesByWorkspace: settings.workspaceSiteCookiePolicies,
    normalizePermissions: normalizeSitePermissions,
    normalizeCookiePolicies: normalizeSiteCookiePolicies
  }));
}

function workspacePolicyMap(name, workspaceId) {
  const map = settings[name];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return Object.create(null);
  const value = map[workspaceId];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : Object.create(null);
}

function policiesForTab(name, tab = activeTab()) {
  if (tab?.private) return name === 'workspaceSitePermissions' ? (tab.privateSitePermissions ||= Object.create(null)) : Object.create(null);
  return workspacePolicyMap(name, tab?.workspaceId || activeWorkspaceId);
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.private === right.private && left.workspaceId === right.workspaceId
    && (!left.private || left.id === right.id || left.contextTabId === right.id));
}

function siteControlTarget(sender) {
  const target = sender ? tabs.get(sender.contextTabId) : activeTab();
  return target && (!sender || sameIdentity(sender, target)) ? target : null;
}

function setWorkspacePolicyMap(name, workspaceId, value) {
  const next = Object.assign(Object.create(null), settings[name] || {});
  next[workspaceId] = value;
  settings[name] = next;
  return value;
}

async function readSettings() {
  if (!fs.existsSync(settingsPath())) {
    settings = { ...defaults, torCountry: TOR_EXIT_AUTO, clearOnQuit: true, directMode: false };
    applyWorkspaceIdentitySettings();
    saveSettings();
    return;
  }
  try {
    if (fs.statSync(settingsPath()).size > (profileVault?.isConfigured() ? 7_000_000 : 5_000_000)) throw new Error('Profile exceeds size limit');
    const settingsText = fs.readFileSync(settingsPath(), 'utf8');
    const previous = JSON.parse(profileVault?.isConfigured() ? profileVault.open('settings', settingsText) : settingsText);
    if (previous && typeof previous === 'object' && !Array.isArray(previous)
      && !Object.hasOwn(previous, 'payload') && !Object.hasOwn(previous, 'hmac')
      && !fs.existsSync(path.join(app.getPath('userData'), 'integrity-key.bin'))) {
      const language = 'en';
      const choice = await dialog.showMessageBox({
        type: 'question', title: translate('profileMigration.title', language),
        message: translate('profileMigration.message', language), detail: translate('profileMigration.detail', language),
        buttons: [translate('profileMigration.import', language), translate('profileMigration.defaults', language)],
        defaultId: 1, cancelId: 1, noLink: true
      });
      if (choice.response === 0) {
        fs.copyFileSync(settingsPath(), settingsPath() + '.before-integrity-' + Date.now(), fs.constants.COPYFILE_EXCL);
        profileIntegrity.write(settingsPath(), 'settings', previous);
      } else {
        fs.copyFileSync(settingsPath(), settingsPath() + '.before-integrity-' + Date.now(), fs.constants.COPYFILE_EXCL);
        settings = { ...defaults, torCountry: TOR_EXIT_AUTO, clearOnQuit: true, directMode: false };
        applyWorkspaceIdentitySettings();
        saveSettings();
        return;
      }
    }
    const stored = profileIntegrity.open('settings', fs.readFileSync(settingsPath(), 'utf8'));
    settings = {
      ...defaults,
      ...stored,
      ...normalizeStoredScalars(stored),
      // A language no longer offered moves to the closest one kept.
      language: closestLanguage(stored.language),
      siteExceptions: Array.isArray(stored.siteExceptions) ? stored.siteExceptions : [],
      adBlockEnabled: stored.adBlockEnabled !== false && stored.blockTrackers !== false,
      adBlockListStates: normalizeListStates(stored.adBlockListStates),
      adBlockCustomLists: Array.isArray(stored.adBlockCustomLists) ? stored.adBlockCustomLists.slice(0, 20).map((list) => { const url = safeFilterListUrl(list && list.url); return { url, id: url ? customListId(url) : "", enabled: list && list.enabled !== false, updatedAt: typeof (list && list.updatedAt) === "string" ? list.updatedAt.slice(0, 40) : "" }; }).filter((list) => list.url) : [],
      adBlockCustomFilters: validateCustomFilters(stored.adBlockCustomFilters) || '',
      adBlockUpdatedAt: typeof stored.adBlockUpdatedAt === 'string' ? stored.adBlockUpdatedAt : (typeof stored.filterListsUpdatedAt === 'string' ? stored.filterListsUpdatedAt : ''),
      adBlockSiteExceptions: Array.isArray(stored.adBlockSiteExceptions)
        ? stored.adBlockSiteExceptions.filter((host) => typeof host === 'string' && /^(?=.{1,253}$)[a-z0-9.-]+$/i.test(host)).slice(0, 1000)
        : (Array.isArray(stored.siteExceptions) ? stored.siteExceptions : []),
      forgetSiteOnClose: Array.isArray(stored.forgetSiteOnClose)
        ? stored.forgetSiteOnClose.filter((host) => typeof host === 'string' && /^(?=.{1,253}$)[a-z0-9.-]+$/i.test(host) && !host.startsWith('.') && !host.endsWith('.')).map((host) => host.toLowerCase()).slice(0, 500)
        : [],
      trustedSites: normalizeTrustedSites(stored.trustedSites),
      trustedSiteSecret: normalizeTrustedSecret(stored.trustedSiteSecret),
      welcomeDone: stored.welcomeDone === true,
      // Older profiles may contain the former experimental "masked" value.
      // It is intentionally ignored because masking exposed the physical GPU.
      webglMode: 'disabled',
      bookmarks: Array.isArray(stored.bookmarks) ? stored.bookmarks : [],
      torCountry: migrateStoredTorCountry(stored.torCountry),
      torAutoStart: stored.torAutoStart !== false,
      torPreferredCountry: migrateStoredTorCountry(stored.torPreferredCountry) || migrateStoredTorCountry(stored.torCountry) || TOR_EXIT_AUTO,
      releaseRepository: isGitHubRepository(stored.releaseRepository) ? stored.releaseRepository : defaults.releaseRepository,
      customSearchUrl: typeof stored.customSearchUrl === 'string' ? stored.customSearchUrl : '',
      startupPages: Array.isArray(stored.startupPages) ? stored.startupPages.filter((item) => safeURL(item)).slice(0, 10) : [],
      directMode: stored.directMode === true,
      filterListsUpdatedAt: typeof stored.filterListsUpdatedAt === 'string' ? stored.filterListsUpdatedAt : '',
      downloadDirectory: typeof stored.downloadDirectory === 'string' && path.isAbsolute(stored.downloadDirectory) ? stored.downloadDirectory : '',
      cookiePolicy: ['allow', 'block-third-party', 'block-all'].includes(stored.cookiePolicy) ? stored.cookiePolicy : (stored.blockThirdPartyCookies === false ? 'allow' : 'block-third-party'),
      torBridgeMode: ['none', 'obfs4', 'snowflake', 'custom'].includes(stored.torBridgeMode) ? stored.torBridgeMode : 'none',
      torBridgeLines: typeof stored.torBridgeLines === 'string' ? stored.torBridgeLines.slice(0, 8192) : '',
      siteZoom: sanitizeSiteZoom(stored.siteZoom),
      phishingBlocklist: typeof stored.phishingBlocklist === 'string' ? stored.phishingBlocklist.slice(0, 40000) : '',
      proxy: sanitizeStoredProxy(stored.proxy)
    };
    settings.blockThirdPartyCookies = settings.cookiePolicy !== 'allow';
    settings.workspaces = normalizeWorkspaces(stored.workspaces);
    settings.activeWorkspace = persistWorkspaceState(settings.workspaces, stored.activeWorkspace).activeId;
    activeWorkspaceId = settings.activeWorkspace;
    applyWorkspaceIdentitySettings(stored);
    settings.home = migrateHome(stored.home, settings.bookmarks);
    settings.homeWallpaper = typeof stored.homeWallpaper === 'string' && /^[a-f0-9]{32}$/.test(stored.homeWallpaper) ? stored.homeWallpaper : '';
    for (const id of bundledFilterListIds()) if (settings.adBlockListStates[id]) settings.adBlockListStates[id].enabled = true;
  } catch (error) {
    // Fail closed for unsigned/tampered profiles; keep the original file for recovery.
    if (profileVault?.isConfigured()) throw new Error('The protected settings could not be verified. Your files have been preserved.');
    try { fs.copyFileSync(settingsPath(), settingsPath() + '.rejected-' + Date.now(), fs.constants.COPYFILE_EXCL); } catch {}
    profileIntegrityWarning = 'The previous profile could not be verified. A settings.json.rejected-* backup has been saved. Fresh protected settings are now active.';
    settings = { ...defaults, torCountry: TOR_EXIT_AUTO, clearOnQuit: true, directMode: false };
    applyWorkspaceIdentitySettings();
    saveSettings();
    console.warn('Profile integrity failed; safe defaults loaded.');
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    profileIntegrity.write(settingsPath(), 'settings', settings);
    return true;
  } catch (error) {
    console.error('Impossible d’enregistrer les préférences locales.', error);
    return false;
  }
}

// Copies of links follow the same tracking-parameter policy as navigation.
// Non-web values are returned unchanged so internal addresses stay readable.
function cleanLinkForCopy(value) {
  try { return cleanTrackingLink(value, { enabled: settings.cleanTrackingLinks !== false }).url; } catch { return value; }
}

function siteZoomMap(tab) {
  return tab && tab.private ? tab.privateSiteZoom : settings.siteZoom;
}

function zoomPercentFor(tab, url = tab && tab.url) {
  const domain = primaryDomain(hostOf(url));
  const stored = Number(siteZoomMap(tab)?.[domain]);
  if (Number.isFinite(stored) && stored >= 50 && stored <= 300) return Math.round(stored);
  return Number(settings.defaultZoom || 100);
}

// reveal: the change came from the keyboard or Ctrl+wheel, so the chrome
// shows the zoom bubble briefly, as Chromium does.
function setTabZoom(tab, action, { reveal = false } = {}) {
  if (!tab || tab.internal || !safeURL(tab.url) || !tab.pageView || tab.pageView.webContents.isDestroyed()) return false;
  const next = nextZoom(zoomPercentFor(tab), action, Number(settings.defaultZoom || 100));
  const domain = primaryDomain(hostOf(tab.url));
  const map = siteZoomMap(tab);
  if (action === 'reset') delete map[domain];
  else map[domain] = next;
  tab.pageView.webContents.setZoomFactor(next / 100);
  if (!tab.private) saveSettings();
  sendState();
  if (reveal && tab.id === activeTabId && chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.send('nacre:zoom-bubble');
  return true;
}

function newDocumentId() {
  return crypto.randomBytes(16).toString('hex');
}

function rememberDocument(store, record, limit = 12) {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (!entry || now - entry.createdAt > 30 * 60 * 1000) store.delete(id);
  }
  while (store.size >= limit) store.delete(store.keys().next().value);
  store.set(record.id, record);
  return record.id;
}

function forgetTabDocuments(tabId) {
  for (const store of [readerDocuments, shareDocuments, phishingNotices]) {
    for (const [id, entry] of store) if (entry.tabId === tabId) store.delete(id);
  }
}

async function latestGitHubRelease(ses, repository) {
  const endpoint = 'https://api.github.com/repos/' + repository + '/releases/latest';
  const response = await ses.fetch(endpoint, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': buildChromeUserAgent(process.versions.chrome)
    }
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'Aucune version publique trouvée sur GitHub.' : translate('diagnostic.githubStatus', settings.language).replace('{status}', String(response.status)));
  const body = await response.text();
  if (body.length > 200000) throw new Error('La réponse GitHub dépasse la taille prévue.');
  const release = JSON.parse(body);
  const version = String(release.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('La version publiée n’a pas un format reconnu.');
  return { version, url: 'https://github.com/' + repository + '/releases/tag/' + encodeURIComponent(release.tag_name) };
}

function safeNavigationURL(value) {
  const web = safeURL(value);
  if (web) return web;
  try {
    const url = new URL(value);
    if (url.protocol === 'nacre:' && INTERNAL_HOSTS.has(url.hostname) && !url.username && !url.password && ['', '/', '/sites'].includes(url.pathname)) {
      return 'nacre://' + url.hostname + (url.pathname === '/sites' ? '/sites' : '/') + url.search + url.hash;
    }
  } catch {}
  return null;
}

function handleNacreRequest(request) {
  let url;
  try { url = new URL(request.url); }
  catch { return internalErrorResponse(403, 'Forbidden', request.method); }
  const fetchSite = request.headers?.get('sec-fetch-site');
  const origin = request.headers?.get('origin');
  const referrer = request.headers?.get('referer');
  if ((fetchSite && !['none', 'same-origin'].includes(fetchSite)) || (origin && origin !== 'nacre://' + url.host) || (referrer && (() => { try { const source = new URL(referrer); return source.protocol !== 'nacre:' || source.hostname !== url.hostname; } catch { return true; } })())) return internalErrorResponse(403, 'Forbidden', request.method);
  if (!isAllowedNacreRequest(request.url, request.method)) return internalErrorResponse(403, 'Forbidden', request.method);
  if (url.pathname === '/theme.css' || url.pathname === '/pages.css' || url.pathname === '/logo.svg') {
    return secureNacreResponse(electronNet.fetch(pathToFileURL(path.join(__dirname, url.pathname.slice(1))).href), request.method);
  }
  const assets = url.hostname === 'auth' ? { '/': 'http-auth.html' } : url.hostname === 'app'
    ? { '/': 'index.html', '/renderer.js': 'renderer.js', '/styles.css': 'styles.css', '/address-suggestions.js': 'address-suggestions.js', '/protection-activity-ui.js': 'protection-activity-ui.js', '/command-palette.js': 'command-palette.js', '/command-palette.css': 'command-palette.css', '/experience-ui.js': 'experience-ui.js', '/experience.css': 'experience.css', '/welcome-ui.js': 'welcome-ui.js' }
    : url.hostname === 'settings'
    ? { '/': 'settings.html', '/settings.html': 'settings.html', '/settings.js': 'settings.js', '/settings.css': 'settings.css', '/sites.js': 'sites.js', '/sites.css': 'sites.css', '/privacy-center.js': 'privacy-center.js' }
    : url.hostname === 'tests-fuite' ? { '/': 'tests.html', '/tests.css': 'tests.css' }
      : url.hostname === 'downloads' ? { '/': 'downloads.html', '/downloads.css': 'downloads.css', '/downloads.js': 'downloads.js' }
        : url.hostname === 'source' ? { '/': 'source.html', '/source.css': 'source.css', '/downloads.css': 'downloads.css', '/source.js': 'source.js' }
          : url.hostname === 'error' ? { '/': 'error.html', '/error.css': 'error.css', '/error.js': 'error.js' }
            : url.hostname === 'leak-tests' ? { '/': 'leak-tests.html', '/leak-tests.css': 'leak-tests.css', '/diagnostics.js':'diagnostics.js', '/diagnostic-frame.html':'diagnostic-frame.html', '/diagnostic-frame.js':'diagnostic-frame.js', '/diagnostic-worker.js':'diagnostic-worker.js' }
              : url.hostname === 'bookmarks' ? { '/': 'bookmarks.html', '/bookmarks.js': 'bookmarks.js', '/bookmarks.css': 'bookmarks.css' }
                : url.hostname === 'shortcuts' ? { '/': 'shortcuts.html', '/shortcuts.css': 'shortcuts.css' }
                : url.hostname === 'offline' ? { '/': 'offline.html', '/offline.css': 'offline.css' }
                  : url.hostname === 'protection' ? { '/': 'protection.html', '/protection.css': 'protection.css', '/protection.js': 'protection.js', '/protection-activity-ui.js': 'protection-activity-ui.js' }
                    : url.hostname === 'reader' ? { '/': 'reader.html', '/reader.css': 'reader.css', '/reader.js': 'reader.js' }
                      : url.hostname === 'share' ? { '/': 'share.html', '/share.css': 'share.css', '/share.js': 'share.js', '/qrcode.js': 'vendor/qrcode.js', '/qrcode-utf8.js': 'vendor/qrcode-utf8.js' }
                        : url.hostname === 'phishing' ? { '/': 'phishing.html', '/phishing.css': 'phishing.css', '/phishing.js': 'phishing.js' } : {};
  if (url.hostname === 'settings' && url.pathname === '/sites') return secureNacreResponse(electronNet.fetch(pathToFileURL(path.join(__dirname, 'sites.html')).href), request.method);
  const file = assets[url.pathname];
  if (url.hostname === 'leak-tests' && url.pathname === '/diagnostic-verdicts.js') return secureNacreResponse(electronNet.fetch(pathToFileURL(path.join(__dirname, 'diagnostic-verdicts.js')).href), request.method);
  if (!file) return internalErrorResponse(404, 'Not found', request.method);
  return secureNacreResponse(electronNet.fetch(pathToFileURL(path.join(__dirname, file)).href), request.method);
}

function secureNacreResponse(responsePromise, method = 'GET') {
  return secureInternalResponse(responsePromise, method);
}

function registerNacreProtocolForSession(ses) {
  if (protocolSessions.has(ses)) return;
  protocolSessions.add(ses);
  ses.protocol.handle('nacre', handleNacreRequest);
}

function applyWebRTCIPPolicy(contents) {
  // Electron 44 exposes this per-WebContents policy. The process-level switch
  // above remains as defense in depth for Chromium contexts outside our views.
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}

function configureWebContentsSecurity(contents) {
  applyWebRTCIPPolicy(contents);
  registerFrameLocaleOverrides(contents);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const allowedTarget = (target) => {
    if (isAuthContents(contents)) return target === 'nacre://auth/';
    const owner = tabByContentsId.get(contents.id);
    return isAllowedNavigationTarget(target, { isChromeView: contents === chromeView, internalTab: Boolean(owner && owner.internal) });
  };
  // Electron 44 emits these navigation details on the Event object itself
  // (event.url, event.isMainFrame, event.preventDefault), not as a second arg.
  const blockSuspiciousSubframe = (event) => {
    const owner = tabByContentsId.get(contents.id);
    if (!owner || owner.internal || event.isMainFrame || typeof event.url !== 'string' || !/^https?:/i.test(event.url)) return false;
    const verdict = phishingVerdict(event.url, { enabled: settings.phishingGuardEnabled, blocklist: settings.phishingBlocklist });
    if (verdict.action === 'allow') return false;
    event.preventDefault();
    return true;
  };
  contents.on('will-frame-navigate', (event) => {
    if (!event || typeof event.url !== 'string' || !allowedTarget(event.url)) event.preventDefault();
    else if (blockSuspiciousSubframe(event)) return;
    else if (settings.httpsOnly && isHttpUrl(event.url)) {
      if (!event.isMainFrame && !shouldAllowHttpRequest(event.url, true, tabByContentsId.get(contents.id)?.httpAcceptedUrl, tabByContentsId.get(contents.id)?.url)) event.preventDefault();
      else if (event.isMainFrame) warnBeforeHttpNavigation(contents, event, event.url);
    }
  });
  contents.on('will-redirect', (event) => {
    if (!event || typeof event.url !== 'string' || !allowedTarget(event.url)) event.preventDefault();
    else if (blockSuspiciousSubframe(event)) return;
    else if (settings.httpsOnly && isHttpUrl(event.url)) {
      if (!event.isMainFrame && !shouldAllowHttpRequest(event.url, true, tabByContentsId.get(contents.id)?.httpAcceptedUrl, tabByContentsId.get(contents.id)?.url)) event.preventDefault();
      else if (event.isMainFrame) warnBeforeHttpNavigation(contents, event, event.url);
    }
  });
}

function warnBeforeHttpNavigation(contents, event, url) {
  if (!settings.httpsOnly || !isHttpUrl(url)) return false;
  const tab = tabByContentsId.get(contents.id);
  if (tab && (shouldAllowHttpRequest(url, true, tab.allowHttpOnce, url)
      || shouldAllowHttpRequest(url, true, tab.httpAcceptedUrl, tab.url, true))) {
    tab.httpAcceptedUrl = url;
    tab.allowHttpOnce = '';
    return false;
  }
  event.preventDefault();
  if (tab) queueHttpWarning(tab, url);
  return true;
}

function queueHttpWarning(tab, url) {
  tab.pendingHttpUrl = url;
  if (tab.httpWarningQueued) return;
  tab.httpWarningQueued = true;
  queueMicrotask(() => {
    tab.httpWarningQueued = false;
    if (!tabs.has(tab.id) || !tab.pageView || tab.pageView.webContents.isDestroyed()) return;
    navigateTab(tab, 'nacre://settings/?page=http-warning');
  });
}

function showPhishingWarning(tab, url, verdict) {
  if (!tab || !tabs.has(tab.id)) return Promise.resolve();
  if (tab.pendingPhishingToken) phishingNotices.delete(tab.pendingPhishingToken);
  const id = newDocumentId();
  rememberDocument(phishingNotices, {
    id, tabId: tab.id, url, reasons: verdict.reasons, blocked: verdict.blocked,
    returnUrl: tab.url && tab.url !== url ? tab.url : '', createdAt: Date.now()
  });
  tab.pendingPhishingUrl = url;
  tab.pendingPhishingToken = id;
  return navigateTab(tab, 'nacre://phishing/?id=' + id);
}

function queuePhishingWarning(tab, url) {
  if (!tab || !tabs.has(tab.id)) return;
  const verdict = phishingVerdict(url, { enabled: settings.phishingGuardEnabled, blocklist: settings.phishingBlocklist });
  if (verdict.action === 'allow') return;
  tab.pendingPhishingUrl = url;
  if (tab.phishingWarningQueued) return;
  tab.phishingWarningQueued = true;
  queueMicrotask(() => {
    tab.phishingWarningQueued = false;
    if (!tabs.has(tab.id) || tab.phishingAcceptedUrl === url) return;
    showPhishingWarning(tab, url, verdict).catch(() => {});
  });
}

function registerTorWebRTCBlocker(ses) {
  if (torWebRtcPreloads.has(ses)) return;
  const id = ses.registerPreloadScript({
    type: 'frame',
    filePath: path.join(__dirname, 'tor-webrtc-preload.cjs')
  });
  torWebRtcPreloads.set(ses, id);
}

function unregisterTorWebRTCBlocker(ses) {
  const id = torWebRtcPreloads.get(ses);
  if (!id) return;
  ses.unregisterPreloadScript(id);
  torWebRtcPreloads.delete(ses);
}

function syncTorWebRTCBlocker(ses) {
  if (settings.torCountry || torConnectingCountry) registerTorWebRTCBlocker(ses);
  else unregisterTorWebRTCBlocker(ses);
}

const SITE_PERMISSIONS = Object.freeze({
  media: 'Caméra et microphone',
  geolocation: 'Localisation',
  notifications: 'Notifications',
  'clipboard-read': 'Lecture du presse-papiers',
  usb: 'USB',
  hid: 'HID',
  serial: 'Port série',
  midi: 'MIDI',
  midiSysex: 'MIDI système'
});

function requestingHost(details, contents) {
  try {
    if (!contents || contents.isDestroyed()) return '';
    const url = new URL((details && (details.requestingUrl || details.requestingOrigin)) || contents.getURL());
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && validHost(host) ? host : '';
  } catch { return ''; }
}

function permissionMode(host, permission, tab = null) {
  const contents = tab && tab.pageView && tab.pageView.webContents;
  const temporary = contents && !contents.isDestroyed() ? privatePermissionDecisions.get(privatePermissionKey(contents, host, permission)) : null;
  if (temporary === 'allow' || temporary === 'deny' || temporary === 'ask') return temporary;
  const policies = tab ? policiesForTab('workspaceSitePermissions', tab) : Object.create(null);
  return permissionModeFor(policies, host, permission);
}

function privatePermissionKey(contents, host, permission) {
  return [contents.id, host, permission].join('|');
}

function requestCookiePolicy(details, tab, ses) {
  const sessionTabs = Array.from(tabs.values()).filter(item=>item.browserSession===ses);
  const identity = workspaceIdentityForSession(ses);
  const policies = identity ? workspacePolicyMap('workspaceSiteCookiePolicies', identity.workspaceId) : Object.create(null);
  const context = cookieContextForRequest(details,tab?tab.url:'');
  const topUrl = details.resourceType==='mainFrame' ? details.url : context.topFrameOrigin || context.tabUrl;
  const host = hostOf(topUrl);
  if(host && tab){
    const policy=siteCookiePolicy(settings.cookiePolicy,host,policies,tab.cookiePolicyOverride);
    // A trusted site may use the sign-in cookies of its own sister domains
    // (Disney+ and disney.com); other third parties stay filtered.
    if(policy==='block-third-party'&&trustedSiteHost(host,tab)&&trustedSiteHost(hostOf(details.url),tab))return 'allow';
    return policy;
  }
  return detachedCookiePolicy(settings.cookiePolicy,policies,sessionTabs.map(item=>item.cookiePolicyOverride&&item.cookiePolicyOverride.policy).filter(Boolean));
}

function trustedSiteHost(host, tab) {
  return Boolean(host && tab && !tab.private && isTrustedDomain(primaryDomain(host), settings.trustedSites));
}

function trustedSiteSecret() {
  if (!settings.trustedSiteSecret) { settings.trustedSiteSecret = createTrustedSecret(); saveSettings(); }
  return settings.trustedSiteSecret;
}

function setSitePermission(host, permission, mode, tab = null) {
  if (!validHost(host) || !Object.hasOwn(SITE_PERMISSIONS, permission) || !['allow', 'deny', 'ask'].includes(mode)) return false;
  tab ||= activeTab();
  if (!tab || removingWorkspaceIds.has(tab.workspaceId)) return false;
  const policies = policiesForTab('workspaceSitePermissions', tab);
  setPermissionPolicy(policies, host, permission, mode);
  if (!(tab && tab.private)) saveSettings();
  return true;
}

async function clearOriginData(ses, origin) {
  await ses.closeAllConnections().catch(() => {});
  await ses.clearData({
    dataTypes: ['cookies', 'cache', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'],
    origins: [origin],
    originMatchingMode: 'origin-in-all-contexts'
  });
  await ses.closeAllConnections().catch(() => {});
}

async function forgetSiteData(tab, host) {
  if (!tab || tab.internal || !tab.browserSession || !validHost(host)) return false;
  let url;
  try { url = new URL(tab.url); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname.toLowerCase() !== host) return false;
  const ses = tab.browserSession;
  const originalContents = tab.pageView?.webContents;
  const epoch = tab.siteControlsEpoch || 0;
  const language = settings.language;
  const confirmed = await dialog.showMessageBox(win, {
    type: 'warning',
    title: translate('dialog.clearData.title', language),
    message: translate('dialog.clearData.message', language),
    detail: host + '\n' + translate('home.featureCleanupDescription', language),
    buttons: [translate('dialog.clearData.confirm', language), translate('common.cancel', language)],
    defaultId: 1, cancelId: 1, noLink: true
  });
  if (confirmed.response !== 0) return false;
  if (tabs.get(tab.id) !== tab || tab.browserSession !== ses || tab.pageView?.webContents !== originalContents
    || !originalContents || originalContents.isDestroyed() || (tab.siteControlsEpoch || 0) !== epoch
    || tab.url !== url.href || quittingAfterClear || identityLifecycleBusy || retiredSessions.has(ses)) return false;
  // Scope the deletion to this origin in every browsing context. Saved site
  // permissions and cookie rules are user preferences, not site data, so they
  // are deliberately kept.
  await clearOriginData(ses, url.origin);
  const contents = tab.pageView?.webContents;
  const sameDocument = tabs.get(tab.id) === tab && tab.browserSession === ses && contents === originalContents
    && (tab.siteControlsEpoch || 0) === epoch && tab.url === url.href;
  if (sameDocument && contents && !contents.isDestroyed()) {
    const prefix = contents.id + '|';
    for (const key of privatePermissionDecisions.keys()) {
      if (key.startsWith(prefix) && key.split('|')[1] === host) privatePermissionDecisions.delete(key);
    }
  }
  if (sameDocument && contents && !contents.isDestroyed() && safeURL(tab.url)) {
    tab.preserveCookiePolicyOnReload = true;
    contents.reloadIgnoringCache();
  }
  sendState();
  notify('toast.dataCleared');
  return true;
}

function registerPrivacyPreloads(ses) {
  if (!cookieGuardPreloads.has(ses)) cookieGuardPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'cookie-guard-preload.cjs') }));
  if (!userAgentPreloads.has(ses)) userAgentPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'ua-preload.cjs') }));
  if (!webglGuardPreloads.has(ses)) webglGuardPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'webgl-guard-preload.cjs') }));
  const fingerprintId = privacyPreloads.get(ses);
  if (settings.antiFingerprint && !fingerprintId) privacyPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'fingerprint-preload.cjs') }));
  else if (!settings.antiFingerprint && fingerprintId) { ses.unregisterPreloadScript(fingerprintId); privacyPreloads.delete(ses); }
}

function reloadCookieGuards(candidates = tabs.values()) {
  for (const tab of candidates) {
    if (!tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed()) {
      tab.preserveCookiePolicyOnReload = true;
      tab.pageView.webContents.reload();
    }
  }
}

function registerAdblockPreload(ses) {
  if (!adBlockPreloads.has(ses)) adBlockPreloads.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'adblock-preload.cjs') }));
}

function applySessionLocale(ses) {
  const ua = buildChromeUserAgent(process.versions.chrome);
  try { ses.setUserAgent(ua, 'en-US,en'); } catch {}
}

async function openDownloadedFile(record, automatic = false) {
  if (!record || !record.path) return;
  if (automatic && (!isSafeAutoOpenDownload(record.path) || !isSafeAutoOpenDownload(record.filename))) return;
  // The save dialog can change the extension. Recheck the actual target on
  // every open, including restored records; a suggested filename is not trust.
  if (isRiskyOpenDownload(record.path) || isRiskyOpenDownload(record.filename)) {
    if (automatic) { notify('toast.riskyFileSkipped', { filename: record.filename }, 'warning'); return; }
    const language = settings.language;
    const result = await dialog.showMessageBox(win, {
      type: 'warning', title: translate('dialog.riskyFile.title', language),
      message: translate('dialog.riskyFile.message', language),
      detail: translate('dialog.riskyFile.detail', language),
      buttons: [translate('dialog.riskyFile.open', language), translate('common.cancel', language)], defaultId: 1, cancelId: 1, noLink: true
    });
    if (result.response !== 0) return;
  }
  const error = await shell.openPath(record.path);
  if (error) notify('toast.openFileFailed', { error }, 'warning');
  if (!automatic) sendState();
}

app.on('web-contents-created', (_event, contents) => configureWebContentsSecurity(contents));

function isTrustedUIEvent(event) {
  if (!isTrustedNacreMainFrame(event)) return false;
  const frame = event && event.senderFrame;
  if (!frame || frame.isDestroyed() || frame !== event.sender.mainFrame) return false;
  let origin;
  try { origin = new URL(frame.url); } catch { return false; }
  if (origin.protocol !== 'nacre:' || origin.username || origin.password || origin.port) return false;
  if (chromeView && event.sender.id === chromeView.webContents.id) return origin.hostname === 'app';
  const tab = tabByContentsId.get(event.sender.id);
  try { return Boolean(tab && tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed() && tab.pageView.webContents === event.sender && origin.hostname === new URL(tab.url).hostname); }
  catch { return false; }
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

function customListId(url) {
  return 'custom-' + crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
}

function isSameSite(hostA, hostB) {
  if (!hostA || !hostB) return false;
  return primaryDomain(hostA.replace(/\.$/, '')) === primaryDomain(hostB.replace(/\.$/, ''));
}

function exceptionFor(url) {
  const host = hostOf(url);
  return settings.adBlockSiteExceptions.includes(host) || settings.siteExceptions.includes(host);
}

function adBlockExceptionFor(url) {
  return settings.adBlockSiteExceptions.includes(hostOf(url)) || settings.siteExceptions.includes(hostOf(url));
}

function rebuildBlockerFromAvailableSources() {
  const filterRoot = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor'), 'filters');
  const bundled = ElectronBlocker.deserialize(fs.readFileSync(path.join(filterRoot, 'engine.bin')));
  const enabledIds = new Set(DEFAULT_LISTS.filter((list) => settings.adBlockListStates[list.id]?.enabled).map((list) => list.id));
  settings.adBlockCustomLists.forEach((list) => { if (list.enabled !== false) enabledIds.add(list.id || customListId(list.url)); });
  const rules = [];
  for (const [id, text] of Object.entries(adBlockSourcesCache)) if (enabledIds.has(id) && typeof text === 'string') rules.push(...text.split(/\r?\n/));
  rules.push(...(validateCustomFilters(settings.adBlockCustomFilters) || '').split(/\r?\n/).filter(Boolean));
  if (rules.length) bundled.updateFromDiff({ added: rules });
  blocker = bundled;
  sendState();
  return bundled;
}

function scheduleAdblockWeeklyUpdate() {
  if (adBlockWeeklyTimer) clearTimeout(adBlockWeeklyTimer);
  adBlockWeeklyTimer = null;
  if (!settings.adBlockWeeklyUpdates) return;
  const dueAt = Date.parse(settings.adBlockUpdatedAt || '') + 7 * 24 * 60 * 60 * 1000;
  const torReady = Boolean(settings.torCountry && torRuntime && torRuntime.ready && torRuntime.process.exitCode === null);
  const delay = Number.isFinite(dueAt)
    ? (dueAt <= Date.now() && !torReady ? 6 * 60 * 60 * 1000 : Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, dueAt - Date.now())))
    : 60_000;
  adBlockWeeklyTimer = setTimeout(async () => {
    adBlockWeeklyTimer = null;
    if (settings.adBlockWeeklyUpdates && settings.torCountry && torRuntime && torRuntime.ready && torRuntime.process.exitCode === null) {
      try { await loadBlocker(true); notify('toast.filtersUpdated'); }
      catch (error) { console.warn('Mise à jour hebdomadaire des filtres impossible.', error.message); }
    }
    scheduleAdblockWeeklyUpdate();
  }, delay);
  adBlockWeeklyTimer.unref?.();
}

function scheduleAdblockState() {
  if (adBlockStateTimer) return;
  adBlockStateTimer = setTimeout(() => { adBlockStateTimer = null; sendState(); }, 250);
  adBlockStateTimer.unref?.();
}

function bundledFilterListIds() {
  let sources = [];
  try {
    const filterRoot = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor'), 'filters');
    sources = JSON.parse(fs.readFileSync(path.join(filterRoot, 'metadata.json'), 'utf8')).sources || [];
  } catch {}
  const includes = (fragment) => sources.some((source) => String(source).toLowerCase().includes(fragment));
  return [
    includes('easylist/easylist') && 'easylist',
    includes('easylist/easyprivacy') && 'easyprivacy',
    includes('peter-lowe') && 'peter-lowe',
    includes('ublock-origin') && 'ubo-filters',
    includes('ublock-origin/privacy') && 'ubo-privacy',
    includes('ublock-origin/unbreak') && 'ubo-unbreak',
    includes('ublock-origin/badware') && 'ubo-badware',
    includes('ublock-origin/quick-fixes') && 'ubo-quick-fixes'
  ].filter(Boolean);
}

function recordTabProtectionActivity(tab, entry) {
  if (!tab || tab.internal) return false;
  const journal = tab.private ? tab.privateActivity : protectionActivity;
  return Boolean(journal && journal.record({ ...entry, tabId: tab.id, private: tab.private }));
}

function recordSessionProtectionActivity(ses, tab, entry) {
  if (tab && !tab.internal) return recordTabProtectionActivity(tab, entry);
  const identity = sessionIdentities.get(ses);
  if (identity?.kind === 'workspace') return protectionActivity.record(entry);
  if (identity?.kind === 'private') return tabs.get(identity.tabId)?.privateActivity?.record({ ...entry, private: true }) || false;
  return false;
}

function getAdblockSnapshot(statistics = adBlockStats) {
  const bundledIds = new Set(bundledFilterListIds());
  return {
    ...statistics,
    byType: { ...statistics.byType },
    bySite: Object.fromEntries(Object.entries(statistics.bySite).map(([host, entry]) => [host, { total: entry.total, byType: { ...entry.byType } }])),
    lists: DEFAULT_LISTS.map((list) => {
      const state = settings.adBlockListStates[list.id] || {};
      const bundled = bundledIds.has(list.id);
      return { ...list, ...state, updatedAt: state.updatedAt || (bundled ? settings.adBlockUpdatedAt : ''), bundled };
    }).concat(settings.adBlockCustomLists.map((list) => ({ ...list, name: new URL(list.url).hostname, id: 'custom:' + list.url }))),
    bundledIds: [...bundledIds]
  };
}

function getCosmeticsForFrame(contents, frameUrl) {
  const tab = contents && tabByContentsId.get(contents.id);
  if (!tab || tab.internal || !settings.adBlockEnabled || adBlockExceptionFor(tab.url) || !blocker) return null;
  let parsed;
  try { parsed = new URL(frameUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  try {
    const result = blocker.getCosmeticsFilters({
      url: parsed.href,
      hostname: parsed.hostname,
      domain: primaryDomain(parsed.hostname),
      getBaseRules: true,
      getInjectionRules: true,
      getExtendedRules: true,
      getRulesFromHostname: true
    });
    return {
      styles: typeof result.styles === 'string' ? result.styles.slice(0, 2_000_000) : '',
      scriptletBundle: buildScriptletBundle({
        scripts: Array.isArray(result.scripts) ? result.scripts.slice(0, 100) : [],
        proceduralScript: buildProceduralCosmeticScript(result.extended)
      }).source
    };
  } catch { return null; }
}

function activeTab() {
  return tabs.get(activeTabId);
}

function tabSnapshot(tab) {
  if (!tab) return null;
  const host = hostOf(tab.url);
  return {
    id: tab.id,
    workspaceId: tab.workspaceId,
    cookieHeaderPolicy: siteCookiePolicy(settings.cookiePolicy,host,policiesForTab('workspaceSiteCookiePolicies',tab),tab.cookiePolicyOverride),
    title: tab.title || translate('tabs.newTitle', settings.language),
    url: tab.url || '',
    internal: Boolean(tab.internal),
    pendingHttpUrl: tab.pendingHttpUrl || '',
    host,
    private: tab.private,
    pinned: Boolean(tab.pinned),
    muted: tab.suspended ? Boolean(tab.suspendedMuted) : Boolean(tab.pageView?.webContents.isAudioMuted()),
    suspended: Boolean(tab.suspended),
    zoom: zoomPercentFor(tab),
    group: tab.group || '',
    groupColor: tab.groupColor || '',
    favicon: isSafeFaviconDataUrl(tab.favicon) ? tab.favicon : '',
    loading: tab.loading,
    home: !tab.url,
    secure: tab.url ? tab.url.startsWith('https://') : true,
    blocked: tab.blocked,
    adBlockBlocked: tab.adBlockBlocked || 0,
    cookieBlocked: tab.cookieBlocked || 0,
    protectionEnabled: settings.adBlockEnabled && !exceptionFor(tab.url),
    forgetOnClose: Boolean(host && settings.forgetSiteOnClose.includes(host)),
    trustedSite: trustedSiteHost(host, tab),
    canGoBack: Boolean(tab.pageView?.webContents.navigationHistory.canGoBack()),
    canGoForward: Boolean(tab.pageView?.webContents.navigationHistory.canGoForward())
  };
}

function snapshot() {
  const downloadSnapshots = Array.from(downloads.values()).map(({ item, session: _session, ...record }) => {
    let canResume = false;
    let isPaused = false;
    try { canResume = Boolean(item && item.canResume()); } catch {}
    try { isPaused = Boolean(item && item.isPaused()); } catch {}
    return publicDownloadRecord(record, canResume, isPaused);
  });
  return {
    tabs: Array.from(tabs.values()).map(tabSnapshot),
    activeId: activeTabId,
    workspaces: publicWorkspaceState(settings.workspaces, activeWorkspaceId, Array.from(tabs.values())),
    splitView: { ids: [...splitTabIds], ratio: splitRatio },
    active: tabSnapshot(activeTab()),
    settings: {
      language: settings.language,
      customLanguages: listCustomLanguages().map(({ code, name }) => ({ code, name })),
      profileLocation: app.getPath('userData'),
      blockTrackers: settings.blockTrackers,
      adBlockEnabled: settings.adBlockEnabled,
      adBlockMode: settings.adBlockMode,
      adBlockWeeklyUpdates: settings.adBlockWeeklyUpdates,
      adBlockListStates: settings.adBlockListStates,
      adBlockCustomLists: settings.adBlockCustomLists,
      adBlockCustomFilters: settings.adBlockCustomFilters,
      adBlockSiteExceptions: settings.adBlockSiteExceptions,
      adBlockUpdatedAt: settings.adBlockUpdatedAt || '',
      adBlockCatalog: DEFAULT_LISTS,
      adBlockStats: getAdblockSnapshot(),
      protectionActivity: activeTab()?.private ? activeTab().privateActivity.snapshot() : protectionActivity.snapshot(),
      blockerLoadMetrics,
      webglMode: settings.webglMode,
      webglRestartRequired: false,
      blockThirdPartyCookies: settings.blockThirdPartyCookies,
      cookiePolicy: settings.cookiePolicy,
      sendGpc: settings.sendGpc,
      sendDnt: settings.sendDnt,
      secureDnsMode: settings.secureDnsMode,
      clearOnQuit: settings.clearOnQuit,
      forgetSiteOnClose: settings.forgetSiteOnClose,
      trustedSites: settings.trustedSites,
      trustedPresets: TRUSTED_SITE_PRESETS.map(({ id, name }) => ({ id, name })),
      trustedPresetsEnabled: enabledPresets(settings.trustedSites),
      welcomeDone: settings.welcomeDone,
      searchEngine: settings.searchEngine,
      customSearchUrl: settings.customSearchUrl,
      releaseRepository: settings.releaseRepository,
      startupMode: settings.startupMode,
      startupPages: settings.startupPages,
      theme: settings.theme,
      verticalTabs: settings.verticalTabs,
      home: settings.home,
      homeWallpaper: settings.homeWallpaper,
      siteIconsVersion: siteIcons ? siteIcons.version : 0,
      accent: settings.accent,
      darkBackground: settings.darkBackground,
      defaultZoom: settings.defaultZoom,
      fontSize: settings.fontSize,
      showBookmarksBar: settings.showBookmarksBar,
      httpsOnly: settings.httpsOnly,
      filterListsUpdatedAt: settings.filterListsUpdatedAt,
      askDownloadLocation: settings.askDownloadLocation,
      downloadDirectory: settings.downloadDirectory,
      openDownloadsAfter: settings.openDownloadsAfter,
      antiFingerprint: settings.antiFingerprint,
      phishingGuardEnabled: settings.phishingGuardEnabled,
      phishingBlocklist: settings.phishingBlocklist,
      iconTorBackground: settings.iconTorBackground,
      suspendInactiveTabs: settings.suspendInactiveTabs,
      suspendAfterMinutes: settings.suspendAfterMinutes,
      torBridgeMode: settings.torBridgeMode,
      torBridgeLines: settings.torBridgeLines,
      sitePermissions: policiesForTab('workspaceSitePermissions'),
      blockerReady: Boolean(blocker),
      proxy: {
        enabled: Boolean(settings.torCountry || settings.proxy.enabled),
        mode: settings.torCountry ? 'tor' : settings.proxy.enabled ? 'manual' : settings.directMode ? 'direct' : 'blocked',
        type: settings.proxy.type,
        host: settings.proxy.host,
        port: settings.proxy.port,
        username: settings.proxy.username,
        torCountry: settings.torCountry,
        torLabel: countryName(settings.torCountry),
        torCountries: Object.fromEntries([TOR_EXIT_AUTO, ...Object.keys(TOR_EXIT_COUNTRIES)].map(code => [code, countryName(code)])),
        torPreferredCountry: settings.torPreferredCountry,
        torPreferredLabel: countryName(settings.torPreferredCountry || TOR_EXIT_AUTO),
        torConnecting: Boolean(settings.torCountry && !torRuntime && !torStartupError),
        torReady: Boolean(settings.torCountry && torRuntime && torRuntime.ready && torRuntime.control && torRuntime.process && torRuntime.process.exitCode === null && !torStartupError && !torConnectingCountry),
        torError: localizeText(torStartupError, settings.language),
        torConnectingCountry,
        torBootstrapPercent,
        torExitIp,
        torIdentityChanging,
        torCircuitCount: torRuntime && torRuntime.control
          ? new Set(Array.from(torRuntime.control.circuitsByToken.values()).flatMap((ids) => Array.from(ids))).size
          : 0
      }
    },
    bookmarks: settings.bookmarks,
    downloads: downloadSnapshots,
    versions: { electron: process.versions.electron || '?', chromium: process.versions.chrome || '?', tor: TOR_VERSION }
  };
}

function sendState() {
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.webContents.send('nacre:state', snapshot());
  }
  for (const tab of tabs.values()) {
    if (tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed()) tab.pageView.webContents.send('nacre:state', internalSnapshot(tab));
  }
}

function internalSnapshot(tab) {
  const data = snapshot();
  const target = tabs.get(tab.contextTabId);
  const source = target && sameIdentity(tab, target) ? target : tab;
  data.tabs = data.tabs.filter(item => tab.private ? item.id === tab.id || item.id === source.id : !item.private);
  data.active = tabSnapshot(source);
  data.activeId = source.id;
  data.downloads = data.downloads.filter(item => tab.private ? item.private && item.tabId === source.id : !item.private);
  data.workspaces = publicWorkspaceState(settings.workspaces, tab.workspaceId, data.tabs);
  data.splitView = { ids: [], ratio: splitRatio };
  data.settings.protectionActivity = tab.private ? source.privateActivity.snapshot() : protectionActivity.snapshot();
  data.settings.sitePermissions = policiesForTab('workspaceSitePermissions', source);
  if (tab.private) {

    data.settings.sitePermissions = source.privateSitePermissions || {};
    data.settings.adBlockStats = { ...getAdblockSnapshot(source.privateStats), scope: 'private' };
  }
  return data;
}

async function loadBlocker(refresh = false) {
  if (blockerUpdate) return blockerUpdate;
  blockerUpdate = (async () => {
    const started = Date.now();
    const rssBefore = process.memoryUsage().rss;
    const filterRoot = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor'), 'filters');
    const bundledPath = path.join(filterRoot, 'engine.bin');
    const userFilterRoot = path.join(app.getPath('userData'), 'filters');
    const readVerified = (enginePath, metadataPath) => {
      const bytes = fs.readFileSync(enginePath);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!isFilterMetadataFor(bytes, metadata)) throw new Error('Le cache de filtres ne correspond pas à son manifeste SHA-256.');
      return { engine: ElectronBlocker.deserialize(bytes), metadata };
    };
    if (!refresh) {
      try {
        const pointerPath = path.join(userFilterRoot, 'active.json');
        const pointer = profileIntegrity.open('filter-manifest', fs.readFileSync(pointerPath, 'utf8'));
        for (const [name, expected] of Object.entries(pointer.hashes || {})) {
          if (!/^(?:engine|meta|sources)-[a-f0-9]{64}\.(?:bin|json)$/.test(name) || crypto.createHash('sha256').update(fs.readFileSync(path.join(userFilterRoot, name))).digest('hex') !== expected) throw new Error('Filter cache integrity failed');
        }
        if (![pointer.engineFile, pointer.metadataFile, pointer.sourcesFile].every(name => Object.hasOwn(pointer.hashes || {}, name))) throw new Error('Incomplete cache manifest');
        if (!/^engine-[a-f0-9]{64}\.bin$/.test(pointer.engineFile) || !/^meta-[a-f0-9]{64}\.json$/.test(pointer.metadataFile)) throw new Error('Pointeur de cache invalide.');
        if (!/^sources-[a-f0-9]{64}\.json$/.test(pointer.sourcesFile)) throw new Error('Pointeur de listes invalide.');
        const cached = readVerified(path.join(userFilterRoot, pointer.engineFile), path.join(userFilterRoot, pointer.metadataFile));
        blocker = cached.engine;
        const sourceSnapshot = JSON.parse(fs.readFileSync(path.join(userFilterRoot, pointer.sourcesFile), 'utf8'));
        adBlockSourcesCache = sourceSnapshot.texts || {};
        const enabledIds = new Set(DEFAULT_LISTS.filter((list) => settings.adBlockListStates[list.id]?.enabled).map((list) => list.id));
        settings.adBlockCustomLists.forEach((list) => { if (list.enabled !== false) enabledIds.add(list.id || customListId(list.url)); });
        const cachedIds = new Set(Object.keys(adBlockSourcesCache));
        const sourcesChanged = sourceSnapshot.customFilters !== (validateCustomFilters(settings.adBlockCustomFilters) || '') || enabledIds.size !== cachedIds.size || [...enabledIds].some((id) => !cachedIds.has(id));
        if (sourcesChanged) rebuildBlockerFromAvailableSources();
        blockerLoadMetrics = { loadMilliseconds: Date.now() - started, rssBefore, rssAfter: process.memoryUsage().rss, source: 'cache sérialisé local' };
        settings.adBlockUpdatedAt ||= cached.metadata.generatedAt || '';
        sendState();
        return blocker;
      } catch {}
      const metadataPath = path.join(filterRoot, 'metadata.json');
      const bundled = readVerified(bundledPath, metadataPath);
      blocker = updateBlockerFromSources(bundled.engine, [], validateCustomFilters(settings.adBlockCustomFilters) || '');
      blockerLoadMetrics = { loadMilliseconds: Date.now() - started, rssBefore, rssAfter: process.memoryUsage().rss, source: 'snapshot hors ligne embarqué' };
      settings.adBlockUpdatedAt ||= bundled.metadata.generatedAt || '';
      sendState();
      return blocker;
    }

    const torAlive = Boolean(torRuntime && torRuntime.process && torRuntime.process.exitCode === null && torRuntime.ready);
    if (!regularSession || !shouldUpdateViaTor(settings.torCountry, torAlive, torAlive)) {
      throw new Error('Mise à jour fermée : connecte Tor avant de télécharger les listes. Aucun repli direct n’est tenté.');
    }
    const bundled = readVerified(bundledPath, path.join(filterRoot, 'metadata.json'));
    const enabledLists = DEFAULT_LISTS.filter((list) => settings.adBlockListStates[list.id]?.enabled).map((list) => ({ id: list.id, url: list.url }));
    for (let index = 0; index < settings.adBlockCustomLists.length; index += 1) {
      const item = settings.adBlockCustomLists[index];
      if (item.enabled !== false) enabledLists.push({ id: item.id || customListId(item.url), url: item.url });
    }
    let receivedBytes = 0;
    const updates = [];
    for (let offset = 0; offset < enabledLists.length; offset += 3) {
      const batch = await Promise.all(enabledLists.slice(offset, offset + 3).map(async (list) => {
      const url = safeFilterListUrl(list.url);
      if (!url) throw new Error('Une URL de liste n’utilise pas une adresse HTTPS autorisée.');
      if (!settings.torCountry || !torRuntime || torRuntime.process.exitCode !== null || !torRuntime.ready) throw new Error('Tor s’est arrêté; la mise à jour des listes a été interrompue sans connexion directe.');
      let response;
      try {
        response = await regularSession.fetch(url, {
          redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(FILTER_FETCH_TIMEOUT_MS),
          headers: { Accept: 'text/plain, text/x-adblock-filter, */*;q=0.1', 'User-Agent': buildChromeUserAgent(process.versions.chrome) }
        });
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR') {
          throw new Error(`Le téléchargement de ${list.id} via Tor a expiré après ${Math.round(FILTER_FETCH_TIMEOUT_MS / 1000)} secondes ou a été interrompu.`);
        }
        throw error;
      }
      if (!response.ok) throw new Error(`La liste ${list.id} répond HTTP ${response.status}.`);
      const advertisedLength = Number(response.headers.get('content-length') || 0);
      if (advertisedLength > MAX_LIST_BYTES) throw new Error(`La liste ${list.id} dépasse la taille maximale.`);
      let text;
      try { text = await readFilterResponseText(response, MAX_LIST_BYTES); }
      catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR') {
          throw new Error(`Le téléchargement de ${list.id} via Tor a expiré après ${Math.round(FILTER_FETCH_TIMEOUT_MS / 1000)} secondes ou a été interrompu.`);
        }
        throw error;
      }
      const validated = validateFilterListText(text);
      receivedBytes += validated.bytes;
      if (receivedBytes > MAX_TOTAL_LIST_BYTES) throw new Error('Les listes dépassent la taille totale maximale.');
      const digest = verifyAdvertisedDigest(validated.text, response.headers);
        return { id: list.id, url, text: validated.text, bytes: validated.bytes, rules: validated.rules, sha256: digest.sha256, serverDigestVerified: digest.verified };
      }));
      updates.push(...batch);
    }
    if (!settings.torCountry || !torRuntime || torRuntime.process.exitCode !== null || !torRuntime.ready) throw new Error('Tor s’est arrêté avant validation des listes; la version actuelle reste active.');
    const next = ElectronBlocker.deserialize(bundled.engine.serialize());
    const customFilters = validateCustomFilters(settings.adBlockCustomFilters) || '';
    updateBlockerFromSources(next, updates.map((item) => item.text), customFilters);
    const serialized = Buffer.from(next.serialize());
    const generatedAt = new Date().toISOString();
    const metadata = createFilterMetadata(serialized, generatedAt, {
      appVersion: app.getVersion(),
      sources: updates.map((item) => item.url),
      lists: updates.map(({ text, ...item }) => item)
    });
    const sourceSnapshot = { texts: Object.fromEntries(updates.map((item) => [item.id, item.text])), customFilters, generatedAt };
    persistFilterSnapshot(userFilterRoot, serialized, metadata, sourceSnapshot, fs, profileIntegrity);
    blocker = next;
    adBlockSourcesCache = sourceSnapshot.texts;
    settings.adBlockUpdatedAt = generatedAt;
    settings.filterListsUpdatedAt = generatedAt;
    for (const item of updates) {
      if (settings.adBlockListStates[item.id]) settings.adBlockListStates[item.id].updatedAt = generatedAt;
      const customList = settings.adBlockCustomLists.find((entry) => (entry.id || customListId(entry.url)) === item.id);
      if (customList) customList.updatedAt = generatedAt;
    }
    saveSettings();
    scheduleAdblockWeeklyUpdate();
    blockerLoadMetrics = { loadMilliseconds: Date.now() - started, rssBefore, rssAfter: process.memoryUsage().rss, source: 'listes actualisées via Tor' };
    sendState();
    return next;
  })();
  try { return await blockerUpdate; }
  finally { blockerUpdate = null; }
}

function configureDnsForRoute(torActive) {
  dnsRouteUsesProxy = Boolean(torActive);
  app.configureHostResolver(hostResolverOptions(torActive, settings.secureDnsMode));
}

function workspaceSession(workspaceId) {
  if (removingWorkspaceIds.has(workspaceId)) throw new Error('Workspace identity is being removed');
  const partition = settings.workspaceSessionPartitions && settings.workspaceSessionPartitions[workspaceId];
  if (typeof partition !== 'string') throw new Error('Workspace identity has no persistent session mapping');
  let ses = workspaceSessionObjects.get(workspaceId);
  if (!ses) {
    ses = session.fromPartition(partition);
    workspaceSessionObjects.set(workspaceId, ses);
    sessionIdentities.set(ses, { kind: 'workspace', workspaceId, partition });
    if (workspaceId === settings.workspaceLegacyOwner) regularSession = ses;
  }
  return ses;
}

function normalSessionForNetwork() {
  const active = workspaceSessionObjects.get(activeWorkspaceId);
  if (active) return active;
  for (const ses of workspaceSessionObjects.values()) {
    if (sessionIdentities.get(ses)?.kind === 'workspace') return ses;
  }
  return null;
}

function workspaceIdentityForSession(ses) {
  const identity = sessionIdentities.get(ses);
  return identity && identity.kind === 'workspace' ? identity : null;
}

async function prepareBrowserSession(ses, route = effectiveProxyConfig()) {
  registerNacreProtocolForSession(ses);
  addNetworkRules(ses);
  await configureBrowserSession(ses, route);
}

async function prepareWorkspaceSessions() {
  const entries = workspaceSessionEntries(settings.workspaces, settings.workspaceSessionPartitions);
  for (const { workspaceId } of entries) workspaceSession(workspaceId);
  regularSession = settings.workspaceLegacyOwner && workspaceSessionObjects.get(settings.workspaceLegacyOwner)
    ? workspaceSessionObjects.get(settings.workspaceLegacyOwner) : normalSessionForNetwork();
  await waitForAll(entries.map(({ workspaceId }) => {
    const ses = workspaceSessionObjects.get(workspaceId);
    return prepareBrowserSession(ses, effectiveProxyConfig());
  }));
}

// Toasts carry an i18n key and parameters so the chrome renders them in the
// current language. tell() is only for free-form text from other modules
// (validation errors, Tor diagnostics), localized through the source catalogue.
function notify(key, params = {}, kind = 'info') {
  if (!chromeView || chromeView.webContents.isDestroyed()) return;
  const values = Object.fromEntries(Object.entries(params || {}).map(([name, value]) => [name, String(value)]));
  chromeView.webContents.send('nacre:toast', { key, params: values, kind });
}

function tell(message, kind) {
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.webContents.send('nacre:toast', { key: '', message: localizeText(message, settings.language), kind: kind || 'info' });
  }
}

function proxyConfig(proxy, directMode = settings.directMode) {
  if (!proxy.enabled) return directMode ? { mode: 'system' } : closedProxyConfig();
  return {
    mode: 'fixed_servers',
    proxyRules: proxy.type + '://' + proxy.host + ':' + proxy.port,
    proxyBypassRules: '<-loopback>'
  };
}

async function configureBrowserSession(ses, route = effectiveProxyConfig()) {
  await setSessionProxy(ses, route);
  ses.setSpellCheckerEnabled(false);
}

async function applyProxy(ses, proxy) {
  await setSessionProxy(ses, proxyConfig(proxy));
}

function setSessionProxy(ses, route) {
  return ses.setProxy(retiredSessions.has(ses) ? closedProxyConfig() : route);
}

function browserSessions() {
  const pageSessions = Array.from(tabs.values())
    .filter((tab) => tab.pageView && !tab.pageView.webContents.isDestroyed())
    .map((tab) => tab.pageView.webContents.session);
  return Array.from(new Set([
    ...workspaceSessionObjects.values(),
    ...privateSessionObjects,
    ...retiredSessions,
    ...pageSessions
  ].filter(Boolean)));
}

async function identityLifecycle(task) {
  identityLifecycleBusy = true;
  try { await Promise.allSettled([...pendingTabCreations]); return await task(); }
  finally { identityLifecycleBusy = false; }
}

function configureProxy(payload, enabled) {
  return workspaceMutations.run(() => identityLifecycle(() => configureProxyImpl(payload, enabled)));
}

async function configureProxyImpl(payload, enabled) {
  if (torConnectingCountry) throw new Error('Attends la fin de la connexion Tor avant de modifier le relais.');
  const previous = settings.proxy;
  const previousTorCountry = settings.torCountry;
  let next = { ...previous, enabled: false, directMode: false };

  if (enabled) {
    const type = payload && ['http', 'socks5'].includes(payload.type) ? payload.type : '';
    const hostInput = String(payload && payload.host || '').trim();
    const port = Number(payload && payload.port);
    let host;
    try {
      if (!hostInput || /[\\/@?#\s]/.test(hostInput)) throw new Error('host');
      const parsed = new URL('http://' + hostInput);
      if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.port) throw new Error('host');
      host = parsed.hostname.toLowerCase();
    } catch {
      throw new Error('Saisis le nom d’hôte du serveur fourni par ton service.');
    }
    if (!type || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Choisis un type de serveur et un port valide (1 à 65535).');
    }

    const username = String(payload && payload.username || '').trim();
    const password = String(payload && payload.password || '');
    if (Boolean(username) !== Boolean(password)) throw new Error('Saisis le nom d’utilisateur et le mot de passe, ou laisse les deux vides.');
    if (username.length > 255 || password.length > 2048) throw new Error('Les identifiants du proxy sont trop longs.');

    const sameEndpoint = previous.type === type && previous.host === host && previous.port === port;
    let encryptedPassword = sameEndpoint && username === previous.username ? previous.encryptedPassword : '';
    if (username && password) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement local des identifiants est indisponible sur cet appareil.');
      encryptedPassword = safeStorage.encryptString(password).toString('base64');
    }
    next = { enabled: true, type, host, port, username, encryptedPassword, directMode: false };
  }

  const sessions = browserSessions();
  try {
    await waitForAll(sessions.map((ses) => setSessionProxy(ses, proxyConfig(next, false))));
  } catch {
    await waitForAll(sessions.map((ses) => setSessionProxy(ses, effectiveProxyConfig(previous, previousTorCountry)).catch(() => {})));
    throw new Error('Impossible de modifier la connexion proxy. Vérifie les informations du serveur.');
  }

  settings.proxy = next;
  settings.directMode = false;
  settings.torCountry = '';
  for (const ses of sessions) { unregisterTorWebRTCBlocker(ses); registerPrivacyPreloads(ses); applySessionLocale(ses); }
  configureDnsForRoute(Boolean(next.enabled));
  const oldTor = torRuntime;
  torRuntime = null;
  torExitIp = '';
  torStartupError = '';
  saveSettings();
  await closeTorRuntime(oldTor);
  await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
  for (const tab of tabs.values()) {
    const url = tab.torResumeUrl || tab.url;
    tab.torResumeUrl = '';
    if (url && tab.pageView && !tab.pageView.webContents.isDestroyed()) navigateTab(tab, url);
  }
  sendState();
  notify(enabled ? 'toast.proxyEnabled' : 'toast.proxyDisabled');
}

function connectTor(country) {
  return workspaceMutations.run(() => identityLifecycle(() => connectTorImpl(country)));
}

async function connectTorImpl(country) {
  if (torConnectingCountry) throw new Error('Une connexion Tor est déjà en cours.');
  if (!isTorExitSelection(country)) throw new Error(TOR_EXIT_COUNTRY_ERROR);
  await stopIconTor();
  const previousCountry = settings.torCountry;
  const previousRuntime = torRuntime;
  let candidate = null;
  const previousManualProxy = settings.proxy.enabled && !previousCountry;
  const hadWorkingRoute = Boolean(previousRuntime || previousManualProxy);
  torConnectingCountry = country;
  torStartupError = '';
  lastTorLog = '';
  sendState();
  try {
    const existingSessions = browserSessions();
    for (const ses of existingSessions) { registerTorWebRTCBlocker(ses); registerPrivacyPreloads(ses); applySessionLocale(ses); }
    // Existing documents cannot receive a newly registered preload retroactively.
    // Replace them with a local Nacre page before Tor bootstrap so their active
    // RTCPeerConnection objects cannot keep sending ICE/STUN traffic directly.
    const parkedTabs = [];
    for (const tab of tabs.values()) {
      if (!tab.internal && safeURL(tab.url)) {
        tab.torResumeUrl = tab.url;
        parkedTabs.push(navigateTab(tab, 'nacre://settings/'));
      }
    }
    await waitForAll(parkedTabs);
    if (!hadWorkingRoute) {
      settings.torCountry = country;
      saveSettings();
      configureDnsForRoute(true);
      const blockedSessions = browserSessions();
      await waitForAll(blockedSessions.map((ses) => setSessionProxy(ses, torProxyConfig(1))));
      await waitForAll(blockedSessions.map((ses) => ses.closeAllConnections().catch(() => {})));
    }
    candidate = await startTor(country);
    const sessions = browserSessions();
    try {
      await waitForAll(sessions.map(async (ses) => setSessionProxy(ses, await torSessionProxyConfig(candidate, ses))));
    } catch {
      await waitForAll(sessions.map(async (ses) => {
        try { await setSessionProxy(ses, previousRuntime ? await torSessionProxyConfig(previousRuntime, ses) : effectiveProxyConfig(settings.proxy, previousCountry, null)); } catch {}
      }));
      await closeTorRuntime(candidate);
      candidate = null;
      throw new Error('Nacre n’a pas pu basculer vers Tor. La connexion précédente a été conservée.');
    }
    const previousTor = torRuntime;
    torRuntime = candidate;
    settings.torCountry = country;
    settings.directMode = false;
    settings.torPreferredCountry = country;
    configureDnsForRoute(true);
    torStartupError = '';
    saveSettings();
    scheduleAdblockWeeklyUpdate();
    await closeTorRuntime(previousTor);
    await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
    for (const tab of tabs.values()) {
      const url = torStartupResumeUrl(tab);
      tab.torResumeUrl = '';
      if (url && tab.pageView && !tab.pageView.webContents.isDestroyed()) navigateTab(tab, url);
    }
    sendState();
    notify('toast.torConnected', { country: countryName(country) });
    refreshSiteIcons();
    updateTorExitIp().catch((error) => console.warn('Adresse IP de sortie Tor non vérifiée.', error.message));
  } catch (error) {
    if (candidate && candidate !== torRuntime) await closeTorRuntime(candidate);
    if (hadWorkingRoute) {
      settings.torCountry = previousCountry;
      torStartupError = '';
      if (!previousCountry) for (const ses of browserSessions()) unregisterTorWebRTCBlocker(ses);
      const sessions = browserSessions();
      await waitForAll(sessions.map(async (ses) => {
        try { await setSessionProxy(ses, previousRuntime ? await torSessionProxyConfig(previousRuntime, ses) : proxyConfig(settings.proxy, settings.directMode)); } catch {}
      }));
      await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
      for (const tab of tabs.values()) {
        const url = torStartupResumeUrl(tab);
        tab.torResumeUrl = '';
        if (url && tab.pageView && !tab.pageView.webContents.isDestroyed()) navigateTab(tab, url);
      }
    } else {
      settings.torCountry = country;
      torStartupError = explainTorFailure(error.message, lastTorLog, settings.torBridgeMode);
      configureDnsForRoute(true);
      const failClosedSessions = browserSessions();
      await waitForAll(failClosedSessions.map((ses) => setSessionProxy(ses, torProxyConfig(1)).catch(() => {})));
      await waitForAll(failClosedSessions.map((ses) => ses.closeAllConnections().catch(() => {})));
    }
    saveSettings();
    sendState();
    throw error;
  } finally {
    torConnectingCountry = '';
    sendState();
  }
}

function chooseTorCountry(country) {
  assertTorExitCountry(country);
  settings.torPreferredCountry = country;
  saveSettings();
  sendState();
}

function addNetworkRules(ses) {
  syncTorWebRTCBlocker(ses);
  registerPrivacyPreloads(ses);
  registerAdblockPreload(ses);
  applySessionLocale(ses);
  if (configuredSessions.has(ses)) return;
  ses.on('will-download', (_event, item, contents) => {
    const tab = contents ? tabByContentsId.get(contents.id) : null;
    const id = nextDownloadId++;
    const filename = sanitizeDownloadFilename(item.getFilename() || 'telechargement');
    const record = { id, tabId: tab && tab.id, session: ses, filename, path: '', state: 'waiting', received: 0, total: item.getTotalBytes(), private: Boolean(tab && tab.private), item };
    const liveDownload = () => downloads.get(id) === record && !retiredSessions.has(ses) && !removingWorkspaceIds.has(tab?.workspaceId);
    const executable = isRiskyOpenDownload(filename);
    if (settings.askDownloadLocation || executable) item.pause();
    downloads.set(id, record);
    while (downloads.size > 60) {
    const first = downloads.keys().next().value;
      const old = downloads.get(first);
      if (old && old.state === 'downloading' && old.item && !old.item.isPaused()) break;
      downloads.delete(first);
    }
    let notifyTimer = null;
    const notify = () => {
      if (notifyTimer) return;
      notifyTimer = setTimeout(() => { notifyTimer = null; sendState(); }, 350);
    };
    item.on('updated', (_event, updateState) => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.state = updateState === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'downloading';
      notify();
    });
    item.once('done', async (_event, stateName) => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.state = stateName === 'completed' ? 'completed' : stateName === 'cancelled' ? 'cancelled' : 'failed';
      notify();
      if (liveDownload() && stateName === 'completed' && settings.openDownloadsAfter && record.path) await openDownloadedFile(record, true);
    });
    const defaultFolder = settings.downloadDirectory || app.getPath('downloads');
    fs.mkdirSync(defaultFolder, { recursive: true });
    let defaultPath = path.join(defaultFolder, filename);
    if (!settings.askDownloadLocation) {
      const parsed = path.parse(defaultPath);
      let suffix = 1;
      while (fs.existsSync(defaultPath)) defaultPath = path.join(parsed.dir, `${parsed.name} (${suffix++})${parsed.ext}`);
    }
    item.setSavePath(defaultPath);
    record.path = defaultPath;
    const chooseDestination = async () => {
      if (!liveDownload()) return;
      if (settings.askDownloadLocation) {
        record.state = 'choosing';
        const result = await dialog.showSaveDialog(win, { defaultPath, title: translate('dialog.saveDownload.title', settings.language) });
        if (!liveDownload()) return;
        if (result.canceled || !result.filePath) { item.cancel(); return; }
        record.path = path.resolve(result.filePath);
        item.setSavePath(record.path);
      }
      record.state = 'downloading';
      if (item.isPaused()) item.resume();
      sendState();
    };
    if (executable) {
      record.state = 'confirming';
      dialog.showMessageBox(win, {
        type: 'warning', title: translate('dialog.executable.title', settings.language),
        message: translate('dialog.executable.message', settings.language),
        detail: translate('dialog.executable.detail', settings.language),
        buttons: [translate('dialog.executable.continue', settings.language), translate('common.cancel', settings.language)], defaultId: 1, cancelId: 1, noLink: true
      }).then(({ response }) => response === 0 ? chooseDestination() : item.cancel()).catch(() => item.cancel());
    } else if (settings.askDownloadLocation) chooseDestination().catch(() => item.cancel());
    else { record.state = 'downloading'; sendState(); }
  });
  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed) return;
    const sessionTabs = Array.from(tabs.values()).filter(tab => tab.browserSession === ses);
    const identity = workspaceIdentityForSession(ses);
    const policies = identity ? workspacePolicyMap('workspaceSiteCookiePolicies', identity.workspaceId) : Object.create(null);
    const policy = detachedCookiePolicy(settings.cookiePolicy, policies, sessionTabs.map(tab => tab.cookiePolicyOverride?.policy).filter(Boolean));
    if (policy === 'allow') return;
    const host = cookie.domain.replace(/^\./, '');
    const firstParty = policy !== 'block-all' && sessionTabs.some(tab => {
      const frame = tab.pageView?.webContents;
      return frame && !frame.isDestroyed() && frame.mainFrame.origin === new URL(tab.url || 'nacre://app/').origin && primaryDomain(host) === primaryDomain(hostOf(tab.url));
    });
    if (!firstParty) {
      const name = cookie.name;
      let removalUrl;
      try { removalUrl = cookieRemovalUrl(cookie); } catch { return; }
      ses.cookies.remove(removalUrl, name).then(() => {
        // The writer frame is unknown here. Never invent a visited site, and
        // never mix private session data into the normal-session journal.
        if (workspaceIdentityForSession(ses) && protectionActivity.record({ host, cookieName: name, action: 'cookie-purged' })) scheduleAdblockState();
      }).catch(() => {});
    }
  });
  ses.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    if (!Object.hasOwn(SITE_PERMISSIONS, permission)) return false;
    // Detached workers and destroyed documents can reach this check with no
    // WebContents. Deny rather than dereferencing an absent or dead sender.
    if (!_contents || _contents.isDestroyed()) return false;
    const host = requestingHost(details, _contents);
    if (!host) return false;
    if (privatePermissionDecisions.get(privatePermissionKey(_contents, host, permission)) === 'allow') return true;
    return permissionMode(host, permission, tabByContentsId.get(_contents.id)) === 'allow';
  });
  // No source picker is implemented. Never offer a grant which cannot safely
  // select a screen, and explicitly deny capture rather than using a default.
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    let answered = false;
    const finish = (allowed) => { if (answered) return; answered = true; callback(Boolean(allowed)); };
    if (!Object.hasOwn(SITE_PERMISSIONS, permission)) return finish(false);
    const host = requestingHost(details, contents);
    if (!host || !/^https?:$/.test((() => { try { return new URL(contents.getURL()).protocol; } catch { return ''; } })())) return finish(false);
    const tab = tabByContentsId.get(contents.id);
    const mode = permissionMode(host, permission, tab);
    if (mode === 'allow') return finish(true);
    if (mode === 'deny') return finish(false);
    const promptKey = privatePermissionKey(contents, host, permission);
    if (pendingPermissionPrompts.has(promptKey) || pendingPermissionPrompts.size >= 8) return finish(false);
    pendingPermissionPrompts.add(promptKey);
    const promptUrl = contents.getURL();
    const promptEpoch = tab?.siteControlsEpoch || 0;
    const language = settings.language;
    const permissionLabel = translate('siteControls.permission.' + permission.replace(/-/g, ''), language);
    const detail = permission === 'media' && details && Array.isArray(details.mediaTypes)
      ? translate('dialog.sitePermission.requests', language) + ': ' + details.mediaTypes.join(', ')
      : translate('dialog.sitePermission.requested', language).replace('{host}', host);
    dialog.showMessageBox(win, {
      type: 'question', title: translate('dialog.sitePermission.title', language), message: translate('dialog.sitePermission.message', language).replace('{host}', host).replace('{permission}', permissionLabel),
      detail, buttons: [translate('dialog.sitePermission.once', language), translate('dialog.sitePermission.always', language), translate('dialog.sitePermission.deny', language)], defaultId: 2, cancelId: 2, noLink: true
    }).then(({ response }) => {
      if (contents.isDestroyed() || contents.getURL() !== promptUrl || !tab || tabs.get(tab.id) !== tab
        || tab.pageView?.webContents !== contents || (tab.siteControlsEpoch || 0) !== promptEpoch
        || removingWorkspaceIds.has(tab.workspaceId) || retiredSessions.has(ses)) return finish(false);
      if (response === 0) {
        privatePermissionDecisions.set(privatePermissionKey(contents, host, permission), 'allow');
        finish(true);
      } else if (response === 1) {
        setSitePermission(host, permission, 'allow', tab);
        finish(true);
      } else finish(false);
      sendState();
    }).catch(() => finish(false)).finally(() => pendingPermissionPrompts.delete(promptKey));
  });

  registerRequestFilter(ses.webRequest, { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (retiredSessions.has(ses)) return callback({ cancel: true });
    const tab = tabByContentsId.get(details.webContentsId);
    const requestContext = filterContext(details, tab?.url || '');
    const { requestHost, topHost, thirdParty, topUrl, sourceUrl } = requestContext;
    const kind = String(details.resourceType || 'other');
    const context = { host: requestHost, site: topHost, resourceType: kind, thirdParty: requestHost && topHost ? thirdParty : null };
    const isHttp = isHttpUrl(details.url) || details.url.startsWith('ws:');
    const httpAllowed = !isHttp || !settings.httpsOnly || Boolean(tab && (
      (details.resourceType === 'mainFrame' && tab.allowHttpOnce === details.url)
      || shouldAllowHttpRequest(details.url, true, tab.httpAcceptedUrl, tab.url, details.resourceType === 'mainFrame')
    ));
    if (!httpAllowed) {
      if (tab && details.resourceType === 'mainFrame') queueHttpWarning(tab, details.url);
      if (recordSessionProtectionActivity(ses, tab, { ...context, action: 'http-blocked', reason: 'https-only' })) scheduleAdblockState();
      callback({ cancel: true });
      return;
    }
    if (tab && isHttp && settings.httpsOnly && details.resourceType === 'mainFrame' && tab.allowHttpOnce === details.url) {
      tab.httpAcceptedUrl = details.url;
      tab.allowHttpOnce = '';
    }
    const exception = Boolean(topUrl && adBlockExceptionFor(topUrl));
    const active = Boolean(!tab?.internal && settings.adBlockEnabled && !exception && blocker);
    let result = null;
    let matchSucceeded = false;
    if (active) {
      try { result = blocker.match(fromElectronDetails({ ...details, referrer: sourceUrl })); matchSucceeded = Boolean(result && typeof result === 'object'); } catch {}
    }
    const strictThirdParty = active && shouldBlockStrictThirdParty(settings.adBlockMode, thirdParty !== false, kind, Boolean(result && result.exception));
    if (active && result && result.redirect && result.redirect.dataUrl) {
      if (recordSessionProtectionActivity(ses, tab, { ...context, action: 'request-redirected', reason: 'filter-rule', ruleId: filterIdentifier(result.filter) })) scheduleAdblockState();
      callback({ redirectURL: result.redirect.dataUrl });
      return;
    }
    if (active && result && result.rewrite && result.rewrite.url && result.rewrite.url !== details.url) {
      if (recordSessionProtectionActivity(ses, tab, { ...context, action: 'request-rewritten', reason: 'filter-rule', ruleId: filterIdentifier(result.filter) })) scheduleAdblockState();
      callback({ redirectURL: result.rewrite.url });
      return;
    }
    if (strictThirdParty || (active && result && result.match)) {
      if (tab) { tab.blocked += 1; tab.adBlockBlocked = (tab.adBlockBlocked || 0) + 1; }
      const identity = sessionIdentities.get(ses);
      const statistics = tab?.private ? tab.privateStats : identity?.kind === 'private' ? tabs.get(identity.tabId)?.privateStats : identity?.kind === 'workspace' ? adBlockStats : null;
      if (statistics) recordBlockedRequest(statistics, topHost || requestHost, kind);
      recordSessionProtectionActivity(ses, tab, { ...context, action: 'request-blocked', reason: strictThirdParty ? 'strict-mode' : 'filter-rule', ruleId: strictThirdParty ? '' : filterIdentifier(result.filter) });
      scheduleAdblockState();
      callback({ cancel: true });
      return;
    }
    if (!tab?.internal) {
      const reason = !settings.adBlockEnabled ? 'blocking-disabled' : exception ? 'site-exception' : !blocker || (active && !matchSucceeded) ? 'unknown' : result?.exception ? 'filter-exception' : 'no-matching-rule';
      // Passing this hook is an observed decision, never a claim that a request
      // reached the destination. Keep ordinary allowed browsing out of the log.
      if ((thirdParty && attribution(requestHost).company) || ['site-exception', 'filter-exception'].includes(reason)) {
        if (recordSessionProtectionActivity(ses, tab, { ...context, action: 'request-allowed', reason, ruleId: reason === 'filter-exception' ? filterIdentifier(result.exception) : '' })) scheduleAdblockState();
      }
    }
    callback({ cancel: false });
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (retiredSessions.has(ses)) return callback({ cancel: true });
    const headers = { ...details.requestHeaders };
    const tab = tabByContentsId.get(details.webContentsId);
    let requestHost = '';
    let initiatorHost = '';
    try { requestHost = new URL(details.url).hostname.toLowerCase(); } catch {}
    try { initiatorHost = new URL(details.initiatorOrigin || details.initiator || '').hostname.toLowerCase(); } catch {}
    const thirdParty = Boolean(initiatorHost && requestHost && !isSameSite(initiatorHost, requestHost));
    const shouldBlockCookies = shouldBlockRequestCookies(requestCookiePolicy(details,tab,ses),
      cookieContextForRequest(details, tab ? tab.url : ''));

    applyPrivacySignals(headers, settings);
    if (shouldBlockCookies) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'cookie') {
          if (tab) {
            const names = cookieNamesFromHeader(headers[key]);
            tab.cookieBlocked = Math.min(Number.MAX_SAFE_INTEGER, (tab.cookieBlocked || 0) + names.length);
            for (const cookieName of names) recordTabProtectionActivity(tab, { host: requestHost, site: hostOf(tab.url), cookieName, action: 'cookie-send-blocked', reason: 'cookie-policy', resourceType: details.resourceType, thirdParty: requestHost && hostOf(tab.url) ? !isSameSite(requestHost, hostOf(tab.url)) : null });
          }
          delete headers[key];
          if (tab) { tab.blocked += 1; sendState(); }
          break;
        }
      }
    }
    if (thirdParty) {
      const referrerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'referer');
      if (referrerKey) {
        try {
          const referrer = new URL(headers[referrerKey]);
          headers[referrerKey] = referrer.origin + '/';
        } catch {}
      }
    }
    headers['Accept-Language'] = 'en-US,en;q=0.9';
    headers['User-Agent'] = buildChromeUserAgent(process.versions.chrome);
    const clientHints = buildClientHintHeaders(process.versions.chrome);
    const lowEntropyHints = new Set(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);
    for (const [name, value] of Object.entries(clientHints)) {
      const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
      if (lowEntropyHints.has(name.toLowerCase())) headers[existing || name] = value;
      else if (existing) headers[existing] = value;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (retiredSessions.has(ses)) return callback({ cancel: true });
    const responseHeaders = { ...details.responseHeaders };
    const tab = tabByContentsId.get(details.webContentsId);
    let requestHost = '';
    let initiatorHost = '';
    try { requestHost = new URL(details.url).hostname.toLowerCase(); } catch {}
    try { initiatorHost = new URL(details.initiatorOrigin || details.initiator || '').hostname.toLowerCase(); } catch {}
    const thirdParty = Boolean(initiatorHost && requestHost && !isSameSite(initiatorHost, requestHost));
    const shouldBlockCookies = shouldBlockRequestCookies(requestCookiePolicy(details,tab,ses),
      cookieContextForRequest(details, tab ? tab.url : ''));
    if (shouldBlockCookies) {
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'set-cookie' || key.toLowerCase() === 'set-cookie2') {
          if (tab) {
            const names = cookieNamesFromHeader(responseHeaders[key], true);
            tab.cookieBlocked = Math.min(Number.MAX_SAFE_INTEGER, (tab.cookieBlocked || 0) + names.length);
            for (const cookieName of names) recordTabProtectionActivity(tab, { host: requestHost, site: hostOf(tab.url), cookieName, action: 'cookie-set-blocked', reason: 'cookie-policy', resourceType: details.resourceType, thirdParty: requestHost && hostOf(tab.url) ? !isSameSite(requestHost, hostOf(tab.url)) : null });
          }
          delete responseHeaders[key];
          if (tab) { tab.blocked += 1; sendState(); }
        }
      }
    }
    callback({ responseHeaders });
  });
  configuredSessions.add(ses);
}

function applyLayout() {
  if (!win || !chromeView) return;
  const [width, height] = win.getContentSize();
  browserSize = { ...browserSize, width, height };
  chromeView.setBounds({ x: 0, y: 0, width, height });
  if (splitTabIds.length && !canSplit(tabs.get(splitTabIds[0]), tabs.get(splitTabIds[1]))) splitTabIds = [];
  const bounds = pageBounds({ width, height, chromeHeight: browserSize.chromeHeight, sidebarWidth: settings.verticalTabs ? 232 : 0, split: splitTabIds.length === 2, ratio: splitRatio });
  if (settings.verticalTabs && isRightToLeft(settings.language)) for (const bound of bounds) bound.x -= 232;
  const visible = splitTabIds.length === 2 && bounds.length === 2 ? splitTabIds : [activeTabId];
  const overlayAbovePages = expandedOverlay && setChromeViewOnTop(true);
  if (!expandedOverlay) setChromeViewOnTop(false);
  for (const tab of tabs.values()) {
    if (!tab.pageView || tab.pageView.webContents.isDestroyed()) continue;
    if (visible.includes(tab.id) && tab.workspaceId === activeWorkspaceId && tab.url && (!expandedOverlay || overlayAbovePages)) {
      tab.pageView.setBounds(bounds[visible.indexOf(tab.id)] || bounds[0]);
    } else {
      tab.pageView.setBounds({ x: 0, y: height, width: 0, height: 0 });
    }
  }
}

// Returns true when the chrome view now sits at the requested depth. If
// reordering fails, callers fall back to hiding the pages under an overlay.
function setChromeViewOnTop(onTop) {
  if (!win || !chromeView) return false;
  if (chromeViewOnTop === onTop) return true;
  try {
    if (onTop) win.contentView.addChildView(chromeView);
    else win.contentView.addChildView(chromeView, 0);
    chromeViewOnTop = onTop;
    if (onTop && !chromeView.webContents.isDestroyed()) chromeView.webContents.focus();
    return true;
  } catch (error) {
    console.warn('Could not reorder the browser chrome view.', error.message);
    return false;
  }
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (!splitTabIds.includes(id)) splitTabIds = [];
  activeTabId = id;
  activeWorkspaceId = tab.workspaceId;
  tab.lastActiveAt = Date.now();
  if (!tab.private) settings.activeWorkspace = tab.workspaceId;
  if (tab.suspended) resumeTab(tab).catch((error) => console.warn('Suspended tab not restored.', error.message));
  applyLayout(); sendState();
}

async function resumeTab(tab) {
  if (!tab || !tab.suspended || !tabs.has(tab.id) || identityLifecycleBusy || quittingAfterClear) return;
  const url = tab.suspendedUrl || tab.url;
  const scroll = Number(tab.suspendedScroll) || 0;
  tab.suspended = false;
  tab.suspendedUrl = '';
  tab.suspendedScroll = 0;
  tab.lastActiveAt = Date.now();
  if (!tab.browserSession) return;
  ensureView(tab, tab.browserSession, Boolean(url && url.startsWith('nacre:')));
  if (tab.suspendedMuted && tab.pageView && !tab.pageView.webContents.isDestroyed()) tab.pageView.webContents.setAudioMuted(true);
  if (!url) { sendState(); return; }
  const load = navigateTab(tab, url);
  const contents = tab.pageView && tab.pageView.webContents;
  if (contents && scroll > 0) {
    contents.once('did-finish-load', () => {
      if (!contents.isDestroyed()) contents.executeJavaScript('window.scrollTo(0, ' + Math.max(0, Math.floor(scroll)) + ')').catch(() => {});
    });
  }
  await load;
  if (tabs.get(tab.id) === tab) sendState();
}

function tabIsSuspendable(tab) {
  if (!tab || tab.suspended || !tab.pageView || tab.pageView.webContents.isDestroyed()
    || tab.internal || !safeURL(tab.url) || tab.pinned || tab.loading || tab.id === activeTabId
    || splitTabIds.includes(tab.id)) return false;
  try { return !tab.pageView.webContents.isCurrentlyAudible(); }
  catch { return false; }
}

async function suspendTab(tab) {
  if (!tabIsSuspendable(tab) || identityLifecycleBusy || quittingAfterClear || expandedOverlay) return false;
  const contents = tab.pageView.webContents;
  const epoch = tab.siteControlsEpoch || 0;
  let scroll = 0;
  try { scroll = Number(await contents.executeJavaScript('window.scrollY || 0')); } catch {}
  if (tabs.get(tab.id) !== tab || !tab.pageView || tab.pageView.webContents !== contents || contents.isDestroyed()
    || !tabIsSuspendable(tab) || identityLifecycleBusy || quittingAfterClear || expandedOverlay
    || (tab.siteControlsEpoch || 0) !== epoch) return false;
  tab.suspendedUrl = tab.url;
  tab.suspendedScroll = Number.isFinite(scroll) ? Math.max(0, Math.min(10_000_000, scroll)) : 0;
  tab.suspendedMuted = contents.isAudioMuted();
  tab.suspended = true;
  tab.loading = false;
  discardTabDocument(tab);
  sendState();
  return true;
}

function checkTabSuspension() {
  if (!settings.suspendInactiveTabs || identityLifecycleBusy || quittingAfterClear || expandedOverlay) return;
  const candidates = Array.from(tabs.values()).filter(tabIsSuspendable);
  const chosen = tabsToSleep(candidates, { delayMs: Number(settings.suspendAfterMinutes || 15) * 60 * 1000, freeRatio: os.freemem() / os.totalmem() });
  for (const tab of chosen) suspendTab(tab).catch((error) => console.warn('Suspension d’onglet impossible.', error.message));
}

function startTabSuspensionTimer() {
  if (tabSuspensionTimer) return;
  tabSuspensionTimer = setInterval(checkTabSuspension, 60_000);
  tabSuspensionTimer.unref?.();
}

async function switchWorkspace(id) {
  if (id !== 'private' && !settings.workspaces.some(item => item.id === id)) return;
  const existing = Array.from(tabs.values()).find(tab => tab.workspaceId === id);
  if (existing) activateTab(existing.id);
  else await createTab('', id === 'private', { workspaceId: id });
    if (activeWorkspaceId === id && id !== 'private') { settings.activeWorkspace = id; saveSettings(); }
}

function navigateTab(tab, destination) {
  if (!tab || !tabs.has(tab.id) || removingWorkspaceIds.has(tab.workspaceId) || retiredSessions.has(tab.browserSession)) return;
  const intent = tab.navigationIntent = (tab.navigationIntent || 0) + 1;
  const pendingClear = pendingSiteClears.get(tab.browserSession);
  if (pendingClear) return pendingClear.then(() => {
    if (tabs.get(tab.id) === tab && tab.navigationIntent === intent) return navigateTab(tab, destination);
  });
  let normalized = safeNavigationURL(destination);
  if (!normalized) {
    notify('toast.invalidAddress', {}, 'warning');
    return;
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) normalized = cleanLinkForCopy(normalized);
  if (tab.pendingPhishingToken && !normalized.startsWith('nacre://phishing/')) {
    phishingNotices.delete(tab.pendingPhishingToken);
    tab.pendingPhishingToken = '';
    tab.pendingPhishingUrl = '';
  }
  const isWebNavigation = /^https?:/i.test(normalized);
  if (isWebNavigation && settings.phishingGuardEnabled && tab.phishingAcceptedUrl !== normalized) {
    const verdict = phishingVerdict(normalized, { enabled: true, blocklist: settings.phishingBlocklist });
    if (verdict.action !== 'allow') return showPhishingWarning(tab, normalized, verdict);
  }
  if (normalized.startsWith('http://') && settings.httpsOnly && tab.allowHttpOnce !== normalized) {
    tab.pendingHttpUrl = normalized;
    normalized = 'nacre://settings/?page=http-warning';
  }
  if (normalized.startsWith('http://') && settings.httpsOnly && tab.allowHttpOnce === normalized) tab.httpAcceptedUrl = normalized;
  else tab.httpAcceptedUrl = '';
  const wantsInternalAPI = normalized.startsWith('nacre:');
  if (settings.torCountry && !torRuntime && !wantsInternalAPI) tab.torResumeUrl = normalized;
  if (!tab.pageView) {
    if (!tab.browserSession) {
      notify('toast.tabNotRestorable', {}, 'warning');
      return Promise.resolve();
    }
    tab.suspended = false;
    tab.suspendedUrl = '';
    ensureView(tab, tab.browserSession, wantsInternalAPI);
  }
  if (tab.pageView && Boolean(tab.hasPreload) !== wantsInternalAPI) {
    const ses = tab.pageView.webContents.session;
    const oldContents = tab.pageView.webContents;
    tabByContentsId.delete(oldContents.id);
    win.contentView.removeChildView(tab.pageView);
    if (!oldContents.isDestroyed()) oldContents.close();
    tab.pageView = null;
    ensureView(tab, ses, wantsInternalAPI);
  }
  forgetfulSites.remember(tab, tab.url, settings.forgetSiteOnClose);
  forgetfulSites.remember(tab, normalized, settings.forgetSiteOnClose);
  tab.url = normalized;
  if (tab.pageView && !normalized.startsWith('nacre:') && normalized.startsWith('http')) {
    tab.pageView.webContents.setZoomFactor(zoomPercentFor(tab, normalized) / 100);
  }
  if (tab.allowHttpOnce === normalized) tab.allowHttpOnce = '';
  tab.title = translate('settings.profileLocationLoading', settings.language);
  tab.loading = true;
  tab.internal = wantsInternalAPI;
  tab.lastActiveAt = Date.now();
  // A new tab starts off-screen while it shows the home page. Recalculate
  // bounds after assigning its first URL so the web view becomes visible
  // immediately instead of depending on a later resize event.
  applyLayout();
  sendState();
  return tab.pageView.webContents.loadURL(normalized);
}

function ensureView(tab, ses, internalAPI = Boolean(tab.internal)) {
  addNetworkRules(ses);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron gates frame preloads behind this option. The renderer remains
      // sandboxed, Node is disabled, and no page-world Node API is exposed.
      nodeIntegrationInSubFrames: true,
      sandbox: true,
      webSecurity: true,
      webgl: false,
      autoplayPolicy: 'user-gesture-required',
      plugins: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      ...(internalAPI ? { preload: path.join(__dirname, 'preload.cjs') } : {})
    }
  });
  applyWebRTCIPPolicy(view.webContents);
  tab.pageView = view;
  tab.hasPreload = Boolean(internalAPI);
  view.webContents.setZoomFactor(Number(settings.defaultZoom || 100) / 100);
  // The WebContents object no longer exposes its id once the 'destroyed'
  // event fires, so retain it before teardown for reliable map cleanup.
  const contentsId = view.webContents.id;
  tabByContentsId.set(contentsId, tab);
  win.contentView.addChildView(view);
  // A new page view lands on top. If the chrome view was raised, its depth is
  // now unknown: force the next layout to reorder it either way.
  if (chromeViewOnTop !== false) chromeViewOnTop = null;
  view.webContents.on('did-finish-load', () => {
    if (tab.phishingAcceptedUrl && tab.phishingAcceptedUrl === tab.url) tab.phishingAcceptedUrl = '';
    sendState();
  });
  view.webContents.on('focus', () => {
    tab.lastActiveAt = Date.now();
    if (splitTabIds.includes(tab.id) && activeTabId !== tab.id) activateTab(tab.id);
  });
  view.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    if (!tab.preserveCookiePolicyOnReload) tab.cookiePolicyOverride = null;
    tab.preserveCookiePolicyOnReload = false;
    tab.siteControlsEpoch = (tab.siteControlsEpoch || 0) + 1;
    const prefix = contentsId + '|';
    for (const key of privatePermissionDecisions.keys()) if (key.startsWith(prefix)) privatePermissionDecisions.delete(key);
  });

  let popupGestureAt = 0;
  let lastPopupAt = 0;
  const recordGesture = (_event, input) => {
    if (activeTabId === tab.id && (input.type === 'mouseUp' || input.type === 'keyDown')) popupGestureAt = Date.now();
  };
  view.webContents.on('before-input-event', recordGesture);
  view.webContents.on('before-mouse-event', recordGesture);
  view.webContents.setWindowOpenHandler(({ url, disposition }) => {
    const destination = safeURL(url);
    const now = Date.now();
    const gestured = popupGestureAt > 0 && now - popupGestureAt < 1000;
    popupGestureAt = 0;
    if (destination && gestured && now - lastPopupAt > 1500 && disposition !== 'other') {
      lastPopupAt = now;
      createTab(destination, tab.private, { background: true, workspaceId: tab.workspaceId });
    }
    return { action: 'deny' };
  });
  view.webContents.on('context-menu', (_event, details) => {
    if (tab.internal) return;
    const targetLink = safeURL(details.linkURL || '');
    const targetImage = safeURL(details.srcURL || '');
    const selected = String(details.selectionText || '').trim();
    const menuItems = [];
    if (targetLink) {
      menuItems.push(
        { label: translate("ui.maincjs.textd17775707f", settings.language), click: () => createTab(targetLink, tab.private) },
        { label: translate("ui.maincjs.textd6c01b7cf7", settings.language), click: () => createTab(targetLink, true) },
        { label: translate("ui.maincjs.textb17133f7ab", settings.language), click: () => clipboard.writeText(cleanLinkForCopy(targetLink)) },
        { type: 'separator' }
      );
    }
    if (targetImage) menuItems.push(
      { label: translate("ui.maincjs.textf7f25c311d", settings.language), click: () => view.webContents.downloadURL(targetImage) },
      { label: translate("ui.maincjs.text259e0dcc4e", settings.language), click: async () => {
        try {
          const response = await ses.fetch(targetImage, { redirect: 'error', signal: AbortSignal.timeout(12000) });
          const type = response.headers.get('content-type') || '';
          const length = Number(response.headers.get('content-length') || 0);
          if (!response.ok || !type.toLowerCase().startsWith('image/') || length > 8_000_000) throw new Error('Image non prise en charge ou trop volumineuse.');
          const bytes = await readBoundedBody(response, 8_000_000);
          if (bytes.length > 8_000_000) throw new Error('Image trop volumineuse.');
          const image = nativeImage.createFromBuffer(bytes);
          if (image.isEmpty()) throw new Error('Image non décodable.');
          clipboard.writeImage(image);
        } catch (error) { if (error.message) tell(error.message, 'warning'); else notify('toast.copyImageFailed', {}, 'warning'); }
      } },
      { label: translate("ui.maincjs.text6b0347bcd0", settings.language), click: () => clipboard.writeText(targetImage) }
    );
    if (selected) menuItems.push(
      { label: translate("ui.maincjs.text6052e2df28", settings.language), click: () => clipboard.writeText(selected) },
      { label: translate('context.searchSelection', settings.language).replace('{selection}', selected.slice(0, 50)), click: () => createTab(searchURL(selected), tab.private) },
      { type: 'separator' }
    );
    menuItems.push({ label: translate("ui.maincjs.text98d1213e19", settings.language), click: () => view.webContents.reload() });
    if (details.x !== undefined && details.y !== undefined) menuItems.push({ label: translate("ui.maincjs.text99c5331d4b", settings.language), click: () => view.webContents.inspectElement(details.x, details.y) });
    Menu.buildFromTemplate(menuItems).popup({ window: win });
  });
  view.webContents.on('will-navigate', (event, legacyUrl) => {
    // Electron 44 puts navigation details on the event; retain the deprecated
    // URL argument only as a compatibility fallback for older Electron builds.
    const url = event && typeof event.url === 'string' ? event.url : legacyUrl;
    if (!safeNavigationURL(url)) { event.preventDefault(); return; }
    if (url.startsWith('nacre:') && !tab.internal) { event.preventDefault(); return; }
    if (pendingSiteClears.has(ses)) { event.preventDefault(); navigateTab(tab, url)?.catch(() => {}); return; }
    if (settings.phishingGuardEnabled && /^https?:/i.test(url) && tab.phishingAcceptedUrl !== url) {
      const verdict = phishingVerdict(url, { enabled: true, blocklist: settings.phishingBlocklist });
      if (verdict.action !== 'allow') {
        event.preventDefault();
        queuePhishingWarning(tab, url);
        return;
      }
    }
    if (event.isMainFrame !== false && tab.hasPreload && /^https?:/.test(url)) {
      event.preventDefault();
      navigateTab(tab, url)?.catch(() => {});
    }
  });
  view.webContents.on('will-redirect', (event) => {
    if (!safeNavigationURL(event.url) || (event.url.startsWith('nacre:') && !tab.internal)) { event.preventDefault(); return; }
    if (event.defaultPrevented) return;
    if (settings.phishingGuardEnabled && /^https?:/i.test(event.url) && tab.phishingAcceptedUrl !== event.url) {
      const verdict = phishingVerdict(event.url, { enabled: true, blocklist: settings.phishingBlocklist });
      if (verdict.action !== 'allow') {
        event.preventDefault();
        queuePhishingWarning(tab, event.url);
        return;
      }
    }
    const clean = /^https?:/.test(event.url) ? stripTrackingParameters(event.url) : event.url;
    if (event.isMainFrame && clean !== event.url) { event.preventDefault(); navigateTab(tab, clean)?.catch(() => {}); return; }
    if (event.isMainFrame && tab.hasPreload && /^https?:/.test(event.url)) { event.preventDefault(); navigateTab(tab, event.url)?.catch(() => {}); }
  });
  view.webContents.on('did-navigate', (_event, url) => {
    forgetfulSites.remember(tab, tab.url, settings.forgetSiteOnClose);
    forgetfulSites.remember(tab, url, settings.forgetSiteOnClose);
    if (originOf(url) !== originOf(tab.url)) { tab.favicon = ''; tab.faviconSource = ''; }
    tab.url = safeNavigationURL(url) || '';
    tab.internal = tab.url.startsWith('nacre:');
    tab.loading = false;
    sendState();
  });
  view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = safeNavigationURL(view.webContents.getURL()) || tab.url;
    tab.internal = tab.url.startsWith('nacre:');
    sendState();
  });
  view.webContents.on('page-favicon-updated', (_event, favicons) => {
    updateTabFavicon(tab, ses, favicons).catch(() => {});
  });
  view.webContents.on('page-title-updated', (_event, title) => {
    tab.title = title || translate('commands.untitled', settings.language);
    sendState();
  });
  view.webContents.on('found-in-page', (_event, result) => {
    if (chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.send('nacre:find-results', result);
  });
  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    sendState();
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    sendState();
  });
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || safeURL(validatedURL) !== tab.url) return;
    tab.loading = false;
    const failedUrl = safeURL(validatedURL);
    tab.title = translate('error.title', settings.language);
    if (failedUrl && !tab.errorRedirecting) {
      tab.errorRedirecting = true;
      const dnsHint = isStrictDnsFailure(errorDescription, settings.secureDnsMode, dnsRouteUsesProxy) ? '&reason=dns-strict' : '';
      navigateTab(tab, 'nacre://error/?url=' + encodeURIComponent(failedUrl) + '&code=' + encodeURIComponent(String(errorCode)) + dnsHint);
      setTimeout(() => { tab.errorRedirecting = false; }, 0);
    }
    sendState();
  });
  view.webContents.on('render-process-gone', () => {
    tab.loading = false;
    tab.title = translate('diagnostic.maincjs.textfa58a2d915', settings.language);
    notify('toast.pageInterrupted', {}, 'warning');
    sendState();
  });
  view.webContents.on('before-input-event', (event, input) => {
    tab.lastActiveAt = Date.now();
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.control && key === 'k') {
      event.preventDefault(); chromeView.webContents.send('nacre:commands');
    } else if (input.control && key === 'l') {
      event.preventDefault();
      chromeView.webContents.send('nacre:focus-address');
    } else if (input.control && ['+', '=', '-', '0'].includes(key)) {
      event.preventDefault();
      setTabZoom(tab, key === '0' ? 'reset' : key === '-' ? 'out' : 'in', { reveal: true });
    } else if (key === 'f11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (key === 'f12') {
      event.preventDefault();
      view.webContents.toggleDevTools();
    } else if (input.control && input.shift && key === 'b') {
      event.preventDefault();
      settings.showBookmarksBar = !settings.showBookmarksBar;
      saveSettings();
      sendState();
    } else if (input.control && input.shift && key === 'a') {
      event.preventDefault();
      chromeView.webContents.send('nacre:tab-search');
    }
  });
  // Ctrl+wheel: Electron reports the request but leaves the zoom to the app.
  view.webContents.on('zoom-changed', (_event, direction) => {
    if (direction === 'in' || direction === 'out') setTabZoom(tab, direction, { reveal: true });
  });
  view.webContents.on('destroyed', () => tabByContentsId.delete(contentsId));
  view.setBounds({ x: 0, y: browserSize.height, width: 0, height: 0 });
  return view;
}

function createTab(url, privateMode, context = {}) {
  if (identityLifecycleBusy || quittingAfterClear) return Promise.resolve(undefined);
  const pending = createTabImpl(url, privateMode, context);
  pendingTabCreations.add(pending);
  pending.finally(() => pendingTabCreations.delete(pending)).catch(() => {});
  return pending;
}

async function createTabImpl(url, privateMode, context = {}) {
  privateMode = privateMode === undefined ? activeWorkspaceId === 'private' : Boolean(privateMode);
  if (tabs.size >= 24) {
    notify('toast.tabLimit', {}, 'warning');
    return;
  }
  const id = nextTabId++;
  const workspaceId = workspaceForTab({ private: privateMode, workspaceId: context.workspaceId }, settings.workspaces, activeWorkspaceId);
  if (removingWorkspaceIds.has(workspaceId)) return;
  let ses = privateMode ? null : workspaceSession(workspaceId);
  let partition = null;
  if (privateMode) {
    partition = 'nacre-private-' + crypto.randomBytes(10).toString('hex');
    ses = session.fromPartition(partition, { cache: false });
    privateSessionObjects.add(ses);
    sessionIdentities.set(ses, { kind: 'private', tabId: id });
    registerNacreProtocolForSession(ses);
  }
  const tab = {
    id,
    workspaceId,
    contextTabId: Number.isSafeInteger(context.contextTabId) ? context.contextTabId : null,
    privateStats: { total: 0, byType: {}, bySite: {}, lastUpdated: 0 },
    privateActivity: createProtectionActivity({ scope: 'private' }),
    url: '',
    title: translate(privateMode ? 'tabs.privateTitle' : 'tabs.newTitle', settings.language),
    loading: false,
    private: Boolean(privateMode),
    privateSitePermissions: Object.create(null),
    privateSiteZoom: Object.create(null),
    privatePartition: partition,
    browserSession: ses,
    internal: Boolean(safeNavigationURL(url || '')?.startsWith('nacre:')),
    hasPreload: Boolean(safeNavigationURL(url || '')?.startsWith('nacre:')),
    suspended: false,
    suspendedUrl: '',
    suspendedScroll: 0,
    lastActiveAt: Date.now(),
    blocked: 0,
    pageView: null
  };
  tabs.set(id, tab);
  try { await prepareBrowserSession(ses, settings.torCountry && torRuntime ? await torSessionProxyConfig(torRuntime, ses) : effectiveProxyConfig()); }
  catch {
    tabs.delete(id);
    notify('toast.newTabNetworkFailed', {}, 'warning');
    return;
  }
  if (tabs.get(id) !== tab || removingWorkspaceIds.has(workspaceId) || identityLifecycleBusy || quittingAfterClear) { tabs.delete(id); return; }
  // Background startup pages wait, asleep, until the user opens them: a
  // renderer per restored page is the largest memory cost at launch.
  const deferredUrl = context.deferred && context.background && !privateMode && !tab.internal ? safeURL(url) : '';
  if (deferredUrl) {
    Object.assign(tab, { url: deferredUrl, title: hostOf(deferredUrl) || tab.title, suspended: true, suspendedUrl: deferredUrl });
    applyLayout(); sendState();
    return id;
  }
  ensureView(tab, ses, tab.internal);
  tabs.set(id, tab);
  if (!context.background) {
    activeTabId = id;
    activeWorkspaceId = tab.workspaceId;
    splitTabIds = [];
  }
  applyLayout();
  if (url) navigateTab(tab, url);
  sendState();
  return id;
}

function closeTab(id, options = {}) {
  tabs.get(id)?.privateActivity?.clear();
  const tab = tabs.get(id);
  if (!tab) return;
  forgetTabDocuments(tab.id);
  if (!options.discard && !tab.private && !settings.clearOnQuit && tab.url && safeURL(tab.url)) {
    recentlyClosedTabs.unshift({ url: tab.url, title: tab.title, workspaceId: tab.workspaceId });
    recentlyClosedTabs.splice(8);
  }
  tabs.delete(id);
  if (splitTabIds.includes(id)) splitTabIds = [];
  if (tab.private) {
    for (const [downloadId, record] of downloads) {
      if (record.tabId !== id) continue;
      if (record.item && ['downloading', 'waiting', 'choosing'].includes(record.state)) record.item.cancel();
      downloads.delete(downloadId);
    }
  }
  if (tab.pageView && !tab.pageView.webContents.isDestroyed()) {
    const closedContentsId = tab.pageView.webContents.id;
    tabByContentsId.delete(closedContentsId);
    const prefix = closedContentsId + '|';
    for (const key of privatePermissionDecisions.keys()) if (key.startsWith(prefix)) privatePermissionDecisions.delete(key);
    win.contentView.removeChildView(tab.pageView);
    tab.pageView.webContents.close();
  }
  forgetClosedSiteData(tab);
  if (tab.privatePartition && !Array.from(tabs.values()).some((item) => item.privatePartition === tab.privatePartition)) {
    const privateSession = tab.browserSession || session.fromPartition(tab.privatePartition);
    retiredSessions.add(privateSession);
    const bridge = torRuntime && torRuntime.bridges.get(privateSession);
    if (bridge) {
      const tokens = bridge.tokens();
      if (torRuntime.control) torRuntime.control.closeCircuitsForTokens(tokens).catch(() => {});
      torRuntime.bridges.delete(privateSession);
      bridge.close().catch(() => {});
    }
    setSessionProxy(privateSession, closedProxyConfig()).then(() => privateSession.closeAllConnections()).then(() => waitForAll([
      privateSession.clearData({ dataTypes: ['cookies', 'cache', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'] }),
      privateSession.clearAuthCache(),
      privateSession.closeAllConnections()
    ])).catch((error) => console.error('Impossible d’effacer la session privée.', error));
  }
  if (activeTabId === id) {
    const remaining = Array.from(tabs.values()).filter(item => item.workspaceId === activeWorkspaceId).map(item => item.id);
    activeTabId = remaining.length ? remaining[remaining.length - 1] : null;
  }
  if (activeTabId === null && !options.discard && !identityLifecycleBusy && !removingWorkspaceIds.has(tab.workspaceId)) createTab();
  applyLayout();
  sendState();
}

function forgetClosedSiteData(tab) {
  if (!tab || tab.private || !tab.browserSession || quittingAfterClear) return;
  forgetfulSites.remember(tab, tab.url, settings.forgetSiteOnClose);
  const ses = tab.browserSession;
  const origins = forgetfulSites.release(tab);
  if (!origins.length) return;
  // Serialize origin clears within an identity and retain failed obligations
  // for a retry at shutdown. Never drop them just because tab.url is internal.
  const previous = pendingSiteClears.get(ses) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    for (const origin of origins) {
      if (!forgetfulSites.ready(ses).includes(origin)) continue;
      await clearOriginData(ses, origin);
      forgetfulSites.complete(ses, origin);
    }
  }).catch(error => {
    console.warn('Site data was not cleared on close.', error.message);
    notify('experience.failed', {}, 'warning');
  }).finally(() => { if (pendingSiteClears.get(ses) === operation) pendingSiteClears.delete(ses); });
  pendingSiteClears.set(ses, operation);
}

function reopenLastTab() {
  const last = recentlyClosedTabs.shift();
  if (last && settings.workspaces.some(item => item.id === last.workspaceId) && safeURL(last.url)) createTab(last.url, false, { workspaceId: last.workspaceId });
}

function cancelIdentityDownloads(ses, tabId = null) {
  for (const [id, record] of downloads) {
    if (tabId !== null ? record.tabId !== tabId : record.session !== ses) continue;
    downloads.delete(id);
    try { record.item?.cancel(); } catch {}
  }
}

function discardTabDocument(tab) {
  const contents = tab.pageView?.webContents;
  if (contents && !contents.isDestroyed()) {
    const prefix = contents.id + '|';
    for (const key of privatePermissionDecisions.keys()) if (key.startsWith(prefix)) privatePermissionDecisions.delete(key);
    tabByContentsId.delete(contents.id);
    win.contentView.removeChildView(tab.pageView);
    contents.close();
  }
  tab.pageView = null;
  tab.siteControlsEpoch = (tab.siteControlsEpoch || 0) + 1;
}

async function moveWorkspaceTab(tab, workspaceId) {
  if (tab.private || tab.workspaceId === workspaceId) return;
  const ses = workspaceSession(workspaceId);
  await prepareBrowserSession(ses, settings.torCountry && torRuntime ? await torSessionProxyConfig(torRuntime, ses) : effectiveProxyConfig());
  if (tabs.get(tab.id) !== tab) return;
  const url = tab.url;
  cancelIdentityDownloads(tab.browserSession, tab.id);
  discardTabDocument(tab);
  forgetClosedSiteData(tab);
  tab.workspaceId = workspaceId;
  tab.browserSession = ses;
  tab.contextTabId = null;
  tab.cookiePolicyOverride = null;
  tab.pendingHttpUrl = tab.allowHttpOnce = tab.httpAcceptedUrl = tab.torResumeUrl = '';
  tab.blocked = 0;
  tab.internal = Boolean(url.startsWith('nacre:'));
  ensureView(tab, ses, tab.internal);
  if (tab.id === activeTabId) activateTab(tab.id);
  if (url) await navigateTab(tab, url);
}

async function removeWorkspaceIdentity(id) {
  const next = removeWorkspace(settings.workspaces, id);
  if (next === settings.workspaces) return;
  const answer = await dialog.showMessageBox(win, {
    type: 'warning', message: translate('experience.removeNote', settings.language),
    buttons: [translate('experience.remove', settings.language), translate('common.cancel', settings.language)],
    defaultId: 1, cancelId: 1, noLink: true
  });
  if (answer.response !== 0) return;
  removingWorkspaceIds.add(id);
  const ses = workspaceSessionObjects.get(id);
  try {
    await Promise.allSettled([...pendingTabCreations]);
    // Electron sessions cannot be destroyed. Keep the retired object blocked
    // through every later route transition, including after a failed clear.
    retiredSessions.add(ses);
    await setSessionProxy(ses, closedProxyConfig());
    cancelIdentityDownloads(ses);
    for (const tab of [...tabs.values()]) if (tab.workspaceId === id) closeTab(tab.id, { discard: true });
    for (let i = recentlyClosedTabs.length - 1; i >= 0; i--) if (recentlyClosedTabs[i].workspaceId === id) recentlyClosedTabs.splice(i, 1);
    await ses.closeAllConnections();
    await ses.clearData({ dataTypes: ['cookies', 'cache', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'] });
    await ses.clearAuthCache();
    const bridge = torRuntime?.bridges.get(ses);
    if (bridge) { if (torRuntime.control) await torRuntime.control.closeCircuitsForTokens(bridge.tokens()).catch(() => {}); await bridge.close(); torRuntime.bridges.delete(ses); }
    const previous = {
      workspaces: settings.workspaces, workspaceLegacyOwner: settings.workspaceLegacyOwner,
      workspaceSessionPartitions: settings.workspaceSessionPartitions, workspaceSitePermissions: settings.workspaceSitePermissions,
      workspaceSiteCookiePolicies: settings.workspaceSiteCookiePolicies
    };
    settings.workspaces = next;
    if (settings.workspaceLegacyOwner === id) settings.workspaceLegacyOwner = null;
    normalizeCurrentWorkspaceIdentities();
    if (!saveSettings()) { Object.assign(settings, previous); throw new Error(translate('experience.failed', settings.language)); }
    workspaceSessionObjects.delete(id);
    sessionIdentities.set(ses, { kind: 'retired' });
    regularSession = normalSessionForNetwork();
    if (activeWorkspaceId === id || !activeTab()) await switchWorkspace(next[0].id);
  } finally { removingWorkspaceIds.delete(id); }
}

function openSource(tab) {
  const url = safeURL(tab && tab.url);
  if (url) createTab('nacre://source/?url=' + encodeURIComponent(url), tab.private);
}

async function openReaderForTab(tab) {
  if (!tab || tab.internal || !tab.pageView || tab.pageView.webContents.isDestroyed() || !safeURL(tab.url)) {
    notify('reader.unavailable', {}, 'warning');
    return false;
  }
  const contents = tab.pageView.webContents;
  const expectedUrl = contents.getURL();
  let raw;
  try { raw = await contents.executeJavaScript(readerExtractionSource, false); }
  catch (error) {
    console.warn('Reader extraction failed.', error.message);
    notify('reader.unavailable', {}, 'warning');
    return false;
  }
  if (contents.isDestroyed() || tab.pageView?.webContents !== contents || contents.getURL() !== expectedUrl) return false;
  const document = normalizeReaderDocument(raw);
  if (!document) {
    notify('reader.empty', {}, 'warning');
    return false;
  }
  if (document.blocks.length > 1 && document.blocks[0]?.type === 'h1' && document.blocks[0].text === document.title) document.blocks.shift();
  if (!document.blocks.length) {
    notify('reader.empty', {}, 'warning');
    return false;
  }
  document.byline = document.byline || '';
  document.site = document.site || hostOf(tab.url);
  const id = newDocumentId();
  rememberDocument(readerDocuments, { id, tabId: tab.id, url: safeURL(tab.url), sourceTitle: tab.title, createdAt: Date.now(), document });
  await navigateTab(tab, 'nacre://reader/?id=' + id);
  return true;
}

function openShareForTab(tab) {
  const url = safeURL(tab && tab.url);
  if (!tab || tab.internal || !url) {
    notify('share.unavailable', {}, 'warning');
    return false;
  }
  const id = newDocumentId();
  rememberDocument(shareDocuments, { id, tabId: tab.id, url, title: tab.title || hostOf(url), createdAt: Date.now() });
  navigateTab(tab, 'nacre://share/?id=' + id)?.catch(() => {});
  return true;
}

function internalDocument(event, store, hostname) {
  const tab = tabByContentsId.get(event.sender.id);
  if (!tab || !tab.internal) return null;
  let url;
  try { url = new URL(tab.url); } catch { return null; }
  if (url.hostname !== hostname) return null;
  const id = url.searchParams.get('id') || '';
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const record = store.get(id);
  if (!record || record.tabId !== tab.id || Date.now() - record.createdAt > 30 * 60 * 1000) return null;
  return { tab, record };
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

// The content blocker sees this request as an image loaded by the tab's page,
// so image and domain-scoped rules apply. Any matching failure skips the icon.
function faviconAllowedByBlocker(tab, target) {
  if (!settings.adBlockEnabled || !blocker || adBlockExceptionFor(tab.url)) return true;
  try {
    const result = blocker.match(fromElectronDetails({ id: 0, url: target, method: 'GET', resourceType: 'image', referrer: tab.url, webContentsId: tab.pageView?.webContents.id }));
    return Boolean(result && typeof result === 'object' && !result.match && !result.redirect);
  } catch { return false; }
}

// See favicon.cjs for the rules: page origin only, tab session, no cookies,
// blocker check, bounded size and dimensions, re-encoded as a small PNG.
async function updateTabFavicon(tab, ses, candidates) {
  if (!tab || !ses || !tab.url || tab.internal) return;
  const origin = originOf(tab.url);
  const target = pickFaviconUrl(candidates, tab.url);
  if (!target || target === tab.faviconSource) return;
  tab.faviconSource = target;
  if (!faviconAllowedByBlocker(tab, target)) return;
  const bytes = await fetchFaviconBytes((url, init) => ses.fetch(url, init), target, readBoundedBody);
  if (!tabs.has(tab.id) || tab.faviconSource !== target || originOf(tab.url) !== origin) return;
  const encoded = encodeFavicon(bytes, nativeImage);
  if (!encoded) return;
  tab.favicon = encoded;
  rememberTabIcon(tab);
  sendState();
}

// Home shortcut and bookmark icons: see site-icons.cjs. Missing icons are
// fetched only through Tor, from a dedicated in-memory session that never
// carries cookies and is closed again once the batch is done.
let siteIcons = null;
// Shortcut icons and the wallpaper reveal as much as the bookmarks, so the
// optional vault encrypts them with the settings.
const VAULTED_PURPOSES = new Set(['settings', 'site-icons', 'home-wallpaper']);
let siteIconSession = null;
let siteIconBatch = null;
const SITE_ICON_PARALLEL = 4;

function wantedIconHosts() {
  return new Set([...settings.home.shortcuts, ...settings.bookmarks.slice(0, 40)].map((item) => iconHost(item.url)).filter(Boolean));
}

// A page often lives on another subdomain than the shortcut (google.com ->
// www.google.com), so an icon is shared by every wanted host of the same site.
function rememberTabIcon(tab) {
  if (!siteIcons || !tab || tab.private || !isSafeFaviconDataUrl(tab.favicon)) return;
  const host = hostOf(tab.url);
  if (!host) return;
  const site = primaryDomain(host);
  for (const wanted of wantedIconHosts()) {
    if (wanted === host || (site && primaryDomain(wanted) === site)) siteIcons.set(wanted, tab.favicon);
  }
}

function torIsConnected() {
  return Boolean(settings.torCountry && torRuntime && torRuntime.ready && torRuntime.process && torRuntime.process.exitCode === null && !torConnectingCountry);
}

// Fetches up to limit missing icons through runtime, a few hosts at a time,
// while alive() holds. The session is left closed to the network afterwards.
async function fetchSiteIconBatch(ses, runtime, alive, limit) {
  const queue = siteIcons.due([...wantedIconHosts()]).slice(0, limit);
  if (!queue.length) return;
  const urls = new Map([...settings.home.shortcuts, ...settings.bookmarks.slice(0, 40)].map((item) => [iconHost(item.url), item.url]));
  ses.setUserAgent(buildChromeUserAgent(process.versions.chrome));
  try {
    await setSessionProxy(ses, await torSessionProxyConfig(runtime, ses));
    const worker = async () => {
      while (queue.length && alive()) {
        const host = queue.shift();
        siteIcons.attempted(host);
        const icon = await fetchSiteIcon({ fetcher: (url, init) => ses.fetch(url, init), pageUrl: urls.get(host), nativeImage, readBoundedBody });
        if (icon && alive() && wantedIconHosts().has(host) && siteIcons.set(host, icon)) sendState();
      }
    };
    await Promise.all(Array.from({ length: Math.min(SITE_ICON_PARALLEL, queue.length) }, worker));
  } catch (error) { console.warn('Site icons not fetched.', error.message); }
  finally {
    await setSessionProxy(ses, torProxyConfig(1)).catch(() => {});
    await ses.closeAllConnections().catch(() => {});
    await ses.clearStorageData().catch(() => {});
  }
}

function refreshSiteIcons() {
  if (!siteIcons || siteIconBatch || !torIsConnected()) return;
  const runtime = torRuntime;
  siteIconSession ||= session.fromPartition('nacre-site-icons', { cache: false });
  siteIconBatch = fetchSiteIconBatch(siteIconSession, runtime, () => torRuntime === runtime && torIsConnected(), 12)
    .finally(() => { siteIconBatch = null; });
}

// Without a Tor connection, missing icons are fetched by a temporary Tor
// started for that alone (Settings › Privacy, on by default): a separate
// tor.exe with its own temporary folder and in-memory session, never used by
// tabs. It stops once the icons are fetched, or after ICON_TOR_MAX_MS, and its
// folder is removed. It runs after an import and, at most every
// ICON_TOR_INTERVAL_MS, when a shortcut without an icon is added. A manual
// proxy or a Tor connection chosen by the user is never bypassed.
const ICON_TOR_MAX_MS = 4 * 60 * 1000;
const ICON_TOR_INTERVAL_MS = 3 * 60 * 60 * 1000;
let iconTor = null;
let iconTorLastRun = 0;

function fetchIconsInBackground({ afterImport = false } = {}) {
  if (!siteIcons || iconTor || !settings.iconTorBackground) return;
  if (torIsConnected()) { refreshSiteIcons(); return; }
  if (torConnectingCountry || settings.torCountry || settings.proxy.enabled) return;
  if (!afterImport && Date.now() - iconTorLastRun < ICON_TOR_INTERVAL_MS) return;
  if (!siteIcons.due([...wantedIconHosts()]).length) return;
  iconTorLastRun = Date.now();
  const job = { runtime: null, stopped: false, promise: null };
  iconTor = job;
  const deadline = setTimeout(() => { stopIconTor(job).catch(() => {}); }, ICON_TOR_MAX_MS);
  job.promise = (async () => {
    const ses = session.fromPartition('nacre-site-icons-temporary', { cache: false });
    try {
      const runtime = await startTor(TOR_EXIT_AUTO, { background: true, onSpawn: (spawned) => { job.runtime = spawned; } });
      if (!job.stopped) await fetchSiteIconBatch(ses, runtime, () => !job.stopped && !runtime.stopping, 120);
    } catch (error) { if (!job.stopped) console.warn('Temporary Tor for site icons unavailable.', error.message); }
    finally {
      clearTimeout(deadline);
      job.stopped = true;
      await closeTorRuntime(job.runtime);
      if (iconTor === job) iconTor = null;
    }
  })();
}

// Stops the temporary icon Tor (the current one when job is omitted) and
// resolves once tor.exe has exited and its folder is removed.
function stopIconTor(job = iconTor) {
  if (!job) return Promise.resolve();
  job.stopped = true;
  if (job.runtime) closeTorRuntime(job.runtime).catch(() => {});
  return job.promise || Promise.resolve();
}

function siteIconsFor(hosts) {
  const result = {};
  if (!siteIcons || !Array.isArray(hosts)) return result;
  for (const host of hosts.slice(0, 80)) {
    if (typeof host === 'string' && siteIcons.has(host)) result[host] = siteIcons.get(host);
  }
  refreshSiteIcons();
  return result;
}

function updateHomeShortcuts(request) {
  if (request && request.action === 'add-current') {
    const tab = activeTab();
    if (!tab || !tab.url || tab.internal) { notify('toast.bookmarkOpenFirst'); return false; }
    if (tab.private) { notify('toast.privateShortcut', {}, 'warning'); return false; }
    request = { action: 'add', title: tab.title || hostOf(tab.url), url: tab.url };
  }
  const next = applyShortcutAction(settings.home.shortcuts, request);
  if (!next) return false;
  settings.home = normalizeHome({ ...settings.home, shortcuts: next });
  for (const tab of tabs.values()) rememberTabIcon(tab);
  siteIcons?.retain(wantedIconHosts());
  saveSettings();
  sendState();
  fetchIconsInBackground();
  return true;
}

// Custom home background: re-encoded as JPEG (at most 2560 px wide) and kept
// in a signed profile file, so the home page only receives an inert data: URL.
const MAX_WALLPAPER_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_WALLPAPER_SOURCE_DIMENSION = 12000;

function wallpaperPath() {
  return path.join(app.getPath('userData'), 'home-wallpaper.json');
}

function readWallpaper() {
  if (!settings.homeWallpaper) return '';
  try {
    const stored = profileIntegrity.open('home-wallpaper', fs.readFileSync(wallpaperPath(), 'utf8'));
    return stored && stored.id === settings.homeWallpaper && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(stored.dataUrl) ? stored.dataUrl : '';
  } catch { return ''; }
}

// Re-seals the wallpaper and icon files after the vault is enabled, disabled
// or re-keyed, so they stay readable with the new protection.
function profileExtras() {
  const wallpaper = readWallpaper();
  return {
    restore() {
      try { if (wallpaper) profileIntegrity.write(wallpaperPath(), 'home-wallpaper', { id: settings.homeWallpaper, dataUrl: wallpaper }); } catch {}
      siteIcons?.persist();
    }
  };
}

function removeWallpaper() {
  settings.homeWallpaper = '';
  try { fs.rmSync(wallpaperPath(), { force: true }); } catch {}
}

async function chooseWallpaper(owner) {
  const result = await dialog.showOpenDialog(owner, {
    properties: ['openFile'], buttonLabel: translate('common.open', settings.language),
    filters: [{ name: translate('wallpaper.images', settings.language), extensions: ['jpg', 'jpeg', 'png'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const descriptor = fs.openSync(result.filePaths[0], 'r');
  let bytes;
  try {
    if (fs.fstatSync(descriptor).size > MAX_WALLPAPER_SOURCE_BYTES) throw new Error(translate('wallpaper.tooLarge', settings.language));
    const buffer = Buffer.alloc(MAX_WALLPAPER_SOURCE_BYTES);
    bytes = buffer.subarray(0, fs.readSync(descriptor, buffer));
  } finally { fs.closeSync(descriptor); }
  const size = imageDimensions(bytes);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_WALLPAPER_SOURCE_DIMENSION || size.height > MAX_WALLPAPER_SOURCE_DIMENSION) throw new Error(translate('wallpaper.invalid', settings.language));
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error(translate('wallpaper.invalid', settings.language));
  if (image.getSize().width > 2560) image = image.resize({ width: 2560, quality: 'best' });
  const dataUrl = 'data:image/jpeg;base64,' + image.toJPEG(84).toString('base64');
  const id = crypto.randomBytes(16).toString('hex');
  profileIntegrity.write(wallpaperPath(), 'home-wallpaper', { id, dataUrl });
  settings.homeWallpaper = id;
  saveSettings();
  sendState();
  return { ok: true };
}

function showNavigationError(tab, url, reason) {
  if (!tab || !tabs.has(tab.id)) return;
  const target = safeURL(url);
  if (!target) return;
  const params = new URLSearchParams({ url: target, reason: String(reason || 'network').slice(0, 64) });
  navigateTab(tab, 'nacre://error/?' + params.toString());
}

function goBack(id) {
  const tab = tabs.get(id || activeTabId);
  if (!tab) return;
  if (tab.suspended) { resumeTab(tab).catch(() => {}); return; }
  if (tab.pageView && !tab.pageView.webContents.isDestroyed() && tab.pageView.webContents.navigationHistory.canGoBack()) tab.pageView.webContents.navigationHistory.goBack();
}

function goForward(id) {
  const tab = tabs.get(id || activeTabId);
  if (!tab) return;
  if (tab.suspended) { resumeTab(tab).catch(() => {}); return; }
  if (tab.pageView && !tab.pageView.webContents.isDestroyed() && tab.pageView.webContents.navigationHistory.canGoForward()) tab.pageView.webContents.navigationHistory.goForward();
}

function reloadTab(id) {
  const tab = tabs.get(id || activeTabId);
  if (!tab) return;
  if (tab.suspended) { resumeTab(tab).catch(() => {}); return; }
  if (tab.pageView && !tab.pageView.webContents.isDestroyed() && tab.url) tab.pageView.webContents.reload();
}

function showHomeTab() {
  const tab = activeTab();
  if (!tab) return;
  const ses = tab.browserSession || tab.pageView?.webContents.session;
  if (!ses) return;
  discardTabDocument(tab);
  tab.suspended = false;
  tab.suspendedUrl = '';
  tab.suspendedScroll = 0;
  tab.lastActiveAt = Date.now();
  tab.url = '';
  tab.title = translate(tab.private ? 'tabs.privateTitle' : 'tabs.newTitle', settings.language);
  tab.loading = false;
  tab.internal = false;
  tab.pendingHttpUrl = '';
  ensureView(tab, ses);
  applyLayout();
  sendState();
}

function addBookmark() {
  const tab = activeTab();
  if (!tab || !tab.url) return notify('toast.bookmarkOpenFirst');
  if (tab.private) return notify('toast.privateBookmark', {}, 'warning');
  const existing = settings.bookmarks.findIndex((item) => item.url === tab.url);
  if (existing >= 0) settings.bookmarks.splice(existing, 1);
  else settings.bookmarks.unshift({ title: tab.title || hostOf(tab.url), url: tab.url, folder: '' });
  settings.bookmarks = settings.bookmarks.slice(0, 500);
  saveSettings();
  sendState();
  notify(existing >= 0 ? 'toast.bookmarkRemoved' : 'toast.bookmarkSaved');
}

function clearData(options = {}, behavior = {}) {
  return workspaceMutations.run(async () => {
    if (quittingAfterClear) return;
    identityLifecycleBusy = true;
    try {
      await Promise.allSettled([...pendingTabCreations]);
      await clearDataImpl(options, behavior);
    } finally { identityLifecycleBusy = false; }
    if (!activeTab()) await createTab();
  });
}

async function panicCleanup() {
  if (panicBusy) { notify('panic.busy', {}, 'warning'); return false; }
  panicBusy = true;
  try {
    await stopIconTor();
    await clearData({ dataTypes: ['cookies', 'cache', 'siteData', 'downloads', 'filterCache'] }, { skipConfirmation: true });
    clipboard.clear();
    readerDocuments.clear();
    shareDocuments.clear();
    phishingNotices.clear();
    notify('panic.done');
    return true;
  } catch (error) {
    console.error('Panic cleanup failed.', error);
    notify('experience.failed', {}, 'warning');
    return false;
  } finally { panicBusy = false; }
}

async function clearDataImpl(options = {}, behavior = {}) {
  const availableTypes = ['cookies', 'cache', 'siteData', 'downloads', 'filterCache'];
  const requested = options && typeof options === 'object' && !Array.isArray(options) && Array.isArray(options.dataTypes) && options.dataTypes.length <= availableTypes.length
    ? options.dataTypes.filter((type) => availableTypes.includes(type)) : availableTypes;
  const dataTypes = [...new Set(requested)];
  if (!dataTypes.length) return notify('toast.clearTypeRequired', {}, 'warning');
  if (dataTypes.includes('cookies') || dataTypes.includes('cache') || dataTypes.includes('siteData')) recentlyClosedTabs.length = 0;
  const language = settings.language;
  if (!behavior || behavior.skipConfirmation !== true) {
    const confirmed = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [translate('dialog.clearData.confirm', language), translate('common.cancel', language)],
      defaultId: 1,
      cancelId: 1,
      title: translate('dialog.clearData.title', language),
      message: translate('dialog.clearData.message', language),
      detail: translate('dialog.clearData.detail', language)
    });
    if (confirmed.response !== 0) return;
  }
  if (dataTypes.includes('cookies') || dataTypes.includes('cache') || dataTypes.includes('siteData')) protectionActivity.clear();
  const sessions = new Set(browserSessions());
  for (const tab of tabs.values()) {
    if (tab.privatePartition) sessions.add(session.fromPartition(tab.privatePartition));
  }
  const closingTabs = Array.from(tabs.values());
  for (const tab of closingTabs) {
    if (tab.private) {
      tab.privateActivity.clear();
      for (const [downloadId, record] of downloads) {
        if (record.tabId !== tab.id) continue;
        if (record.item && ['downloading', 'waiting', 'choosing'].includes(record.state)) record.item.cancel();
        downloads.delete(downloadId);
      }
    }
    if (tab.pageView && !tab.pageView.webContents.isDestroyed()) {
      const contentsId = tab.pageView.webContents.id;
      tabByContentsId.delete(contentsId);
      const prefix = contentsId + '|';
      for (const key of privatePermissionDecisions.keys()) if (key.startsWith(prefix)) privatePermissionDecisions.delete(key);
      win.contentView.removeChildView(tab.pageView);
      tab.pageView.webContents.close();
    }
  }
  tabs.clear();
  recentlyClosedTabs.length = 0;
  for (const tab of closingTabs) forgetClosedSiteData(tab);
  await Promise.allSettled([...pendingSiteClears.values()]);
  readerDocuments.clear();
  shareDocuments.clear();
  phishingNotices.clear();
  activeTabId = null;
  activeWorkspaceId = settings.workspaces.some((workspace) => workspace.id === settings.activeWorkspace) && settings.activeWorkspace !== 'private'
    ? settings.activeWorkspace
    : settings.workspaces[0].id;
  if (torRuntime) {
    for (const [ses, bridge] of Array.from(torRuntime.bridges.entries())) {
      if (ses === regularSession) continue;
      if (torRuntime.control) await torRuntime.control.closeCircuitsForTokens(bridge.tokens()).catch(() => {});
      torRuntime.bridges.delete(ses);
      await bridge.close().catch(() => {});
    }
  }
  const chromiumTypes = clearDataTypesForSelection(dataTypes);
  await waitForAll(Array.from(sessions, async (ses) => {
    const failures = [];
    const attempt = async operation => { try { await operation(); } catch (error) { failures.push(error); } };
    await attempt(() => ses.closeAllConnections());
    if (chromiumTypes.length) await attempt(() => ses.clearData({ dataTypes: [...new Set(chromiumTypes)] }));
    if (dataTypes.includes('cookies')) await attempt(() => ses.clearAuthCache());
    if (failures.length) throw new AggregateError(failures, 'Session data could not be fully cleared');
  }));
  if (dataTypes.includes('downloads')) {
    for (const [id, record] of downloads) {
      if (!canRemoveDownloadRecord(record)) continue;
      downloads.delete(id);
    }
  }
  if (dataTypes.includes('filterCache')) {
    const filterCache = path.join(app.getPath('userData'), 'filters');
    await fs.promises.rm(filterCache, { recursive: true, force: true });
    adBlockSourcesCache = {};
  }
  await createTab();
  expandedOverlay = false;
  applyLayout();
  sendState();
  notify('toast.dataCleared');
}

function buildMenu() {
  const template = [
    {
      label: translate('menu.file', settings.language),
      submenu: [
        { label: translate('menu.newTab', settings.language), accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        { label: translate('menu.newPrivateTab', settings.language), accelerator: 'CmdOrCtrl+Shift+N', click: () => createTab('', true) },
        { type: 'separator' },
        { label: translate('menu.closeTab', settings.language), accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeTabId) },
        { label: translate('menu.reopenTab', settings.language), accelerator: 'CmdOrCtrl+Shift+T', click: () => reopenLastTab() },
        { label: translate('menu.quit', settings.language), role: 'quit' }
      ]
    },
    {
      label: translate('menu.navigation', settings.language),
      submenu: [
        { label: translate('menu.back', settings.language), accelerator: 'Alt+Left', click: () => goBack() },
        { label: translate('menu.forward', settings.language), accelerator: 'Alt+Right', click: () => goForward() },
        { label: translate('menu.reload', settings.language), accelerator: 'F5', click: () => reloadTab() },
        { label: translate('menu.find', settings.language), accelerator: 'CmdOrCtrl+F', click: () => chromeView.webContents.send('nacre:find-in-page') },
        { label: translate('menu.searchTabs', settings.language), accelerator: 'CmdOrCtrl+Shift+A', click: () => chromeView.webContents.send('nacre:tab-search') },
        { label: translate('menu.source', settings.language), accelerator: 'CmdOrCtrl+U', click: () => openSource(activeTab()) },
        { label: translate('menu.print', settings.language), accelerator: 'CmdOrCtrl+P', click: () => { const tab = activeTab(); if (tab && !tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed()) tab.pageView.webContents.print({ silent: false }); } },
        { label: translate('menu.clearData', settings.language), accelerator: 'CmdOrCtrl+Shift+Delete', click: () => chromeView.webContents.send('nacre:confirm-clear') }
      ]
    },
    {
      label: translate('menu.help', settings.language),
      submenu: [
        { label: translate('menu.shortcuts', settings.language), click: () => createTab('nacre://shortcuts/') },
        { label: translate('menu.about', settings.language), click: () => chromeView.webContents.send('nacre:open-settings', 'privacy') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIPC() {
  ipcMain.handle('nacre:phishing-feed-status', event => {
    if (!isTrustedUIEvent(event)) throw new Error('Open Nacre settings.');
    return getPhishingFeedStatus();
  });
  let diagnosticsBusy = false;
  ipcMain.handle('nacre:diagnostic-run', async (event, external) => {
    if (!isTrustedUIEvent(event) || event.senderFrame !== event.sender.mainFrame || !/^nacre:\/\/leak-tests\/(?:[?#].*)?$/.test(event.senderFrame.url)) throw new Error('Open the diagnostics page.');
    const policy = { torExpected: Boolean(settings.torCountry || torConnectingCountry), fingerprintExpected: settings.antiFingerprint };
    const build = getReleaseValidationReport({ appVersion: app.getVersion(), sourceRoot: __dirname });
    if (external !== true) return { ...policy, build, web: null };
    if (diagnosticsBusy) throw new Error('A diagnostic run is already in progress.');
    diagnosticsBusy = true;
    let id;
    const source = tabByContentsId.get(event.sender.id);
    const endpoint = 'https://check.torproject.org/api/ip';
    try {
      const consent = await dialog.showMessageBox(win, { type: 'question', title: 'External network diagnostic', message: 'Contact Tor Project to check this connection?', detail: 'This opens one temporary background test page at check.torproject.org. Tor Project receives a request and the Tor exit address when routing works, or your public IP in direct mode. No history or bookmarks are sent. DNS leaks and independent packet capture are not covered.', buttons: ['Run Tor Project check', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      if (consent.response !== 0) return { ...policy, build, web: null, error: 'External diagnostic cancelled.' };
      id = await createTab(endpoint, Boolean(source?.private), { background: true, workspaceId: source?.workspaceId });
      const tab = tabs.get(id);
      if (!tab) throw new Error('Could not create the temporary test page.');
      const wc = tab.pageView.webContents;
      const deadline = Date.now() + 20000;
      while (!wc.isDestroyed() && (wc.isLoading() || wc.getURL() !== endpoint)) {
        if (Date.now() > deadline) throw new Error('External diagnostic page timed out.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (wc.isDestroyed() || wc.getURL() !== endpoint) throw new Error('Diagnostic page unavailable.');
      let timer;
      try {
        const web = await Promise.race([wc.executeJavaScript(webProbeSource), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Web probes timed out.')), 8000); })]);
        if (web?.network && (typeof web.network.IsTor !== 'boolean' || !net.isIP(String(web.network.IP || '')))) web.network = null;
        return { ...policy, build, web };
      } finally { clearTimeout(timer); }
    } catch (error) { return { ...policy, build, web: null, error: String(error.message).slice(0, 200) }; }
    finally { if (id && tabs.has(id)) closeTab(id, { discard: true }); diagnosticsBusy = false; }
  });
  let privacyMutationBusy = false;
  ipcMain.handle('nacre:privacy-center', async (event, action, data) => {
    if (!isTrustedUIEvent(event) || event.senderFrame !== event.sender.mainFrame || !/^nacre:\/\/settings\/(?:[?#].*)?$/.test(event.senderFrame.url)) throw new Error('Open Nacre settings to use this action.');
    if (action === 'snapshot') {
      const profiles = ensureLocalProfiles();
      const running = profiles.getRunningProfile().id;
      return { check: privacyCheck(settings, { torConnected: Boolean(torRuntime?.ready && torRuntime?.process?.exitCode === null) }), profiles: profiles.listProfiles().map(item => ({ id: item.id, name: item.name, active: item.id === running })), vaultEnabled: profileVault.isConfigured(), cleanTrackingLinks: settings.cleanTrackingLinks !== false };
    }
    if (privacyMutationBusy) throw new Error('Another privacy action is in progress.');
    privacyMutationBusy = true;
    try {
      if (action === 'apply') {
        if (typeof data !== 'string' || !applyPrivacyAction(settings, data)) return false;
        if (!saveSettings()) throw new Error('Could not save the privacy change.');
        reloadCookieGuards(Array.from(tabs.values()));
        if (data === 'adBlockEnabled') await loadBlocker(false);
        sendState(); return true;
      }
      if (action === 'tracking-links') { settings.cleanTrackingLinks = data === true; if (!saveSettings()) throw new Error('Could not save the setting.'); return true; }
      if (action === 'profile-create') { ensureLocalProfiles().createProfile(data); return true; }
      if (action === 'profile-select') { ensureLocalProfiles().selectProfile(data); return true; }
      if (action === 'profile-retire') { ensureLocalProfiles().removeProfile(data); return true; }
      if (action === 'vault-change') {
        if (!profileVault.isConfigured()) return false;
        const current = await promptVault({ BrowserWindow, ipcMain, parent: win, message: 'Enter your current primary password.' });
        if (current === null) return false;
        await profileVault.verifyPassword(current);
        const next = await promptVault({ BrowserWindow, ipcMain, parent: win, confirm: true, message: 'Choose a new primary password. There is no password recovery.' });
        if (next === null) return false;
        const extras = profileExtras();
        await profileVault.changePassword(next); extras.restore(); return true;
      }
      if (action === 'vault-enable') {
        if (profileVault.isConfigured()) return false;
        const password = await promptVault({ BrowserWindow, ipcMain, parent: win, confirm: true, message: 'Create a primary password. Older backups are not encrypted automatically.' });
        if (password === null) return false;
        if (!saveSettings()) throw new Error('Could not save settings before enabling the vault.');
        const extras = profileExtras();
        await profileVault.enable(password, fs.readFileSync(settingsPath(), 'utf8'));
        extras.restore();
        if (!saveSettings()) throw new Error('Vault enabled, but the latest settings could not be saved.');
        return true;
      }
      if (action === 'vault-disable') {
        if (!profileVault.isConfigured()) return false;
        const password = await promptVault({ BrowserWindow, ipcMain, parent: win, message: 'Enter the primary password to remove settings-vault protection.' });
        if (password === null) return false;
        await profileVault.verifyPassword(password);
        const extras = profileExtras();
        profileVault.disable(); extras.restore(); return true;
      }
      throw new Error('Unknown privacy action.');
    } finally { privacyMutationBusy = false; }
  });
  ipcMain.handle('nacre:apply-site-cookies', (event, data) => {
    if (!isTrustedUIEvent(event)) return;
    if(!data||typeof data!=='object'||Array.isArray(data))return false;
    const tab=tabs.get(data.tabId),sender=tabByContentsId.get(event.sender.id);
    let origin;try{origin=new URL(tab&&tab.url);}catch{return false;}
    if(!tab||tab.internal||!['http:','https:'].includes(origin.protocol)||origin.origin!==data.origin
      ||data.documentEpoch!==(tab.siteControlsEpoch||0)
      ||(!COOKIE_POLICIES.has(data.policy)&&data.policy!=='default')||!['temporary','persistent'].includes(data.scope)
      ||(sender&&(sender.contextTabId!==tab.id||!sameIdentity(sender,tab))))return false;
    const host=origin.hostname.toLowerCase();
    if(!validHost(host))return false;
    if(data.scope==='temporary'||tab.private)tab.cookiePolicyOverride=data.policy==='default'?null:{host,policy:data.policy};
    else {
      tab.cookiePolicyOverride=null;
      const policies=normalizeSiteCookiePolicies(policiesForTab('workspaceSiteCookiePolicies',tab));
      if(data.policy==='default')delete policies[host];else if(Object.hasOwn(policies,host)||Object.keys(policies).length<1000)policies[host]=data.policy;else return false;
      setWorkspacePolicyMap('workspaceSiteCookiePolicies',tab.workspaceId,policies);saveSettings();
    }
    reloadCookieGuards(data.scope === 'temporary' || tab.private ? [tab] : Array.from(tabs.values()).filter(item => !item.private && item.workspaceId === tab.workspaceId && hostOf(item.url) === host));
    sendState();return true;
  });
  ipcMain.handle('nacre:overlay', (event, value) => {
    if (!isTrustedUIEvent(event)) return;
    if (event.sender.id !== chromeView.webContents.id || typeof value !== 'boolean') return false;
    expandedOverlay = value; applyLayout(); return true;
  });
  ipcMain.handle('nacre:workspace', async (event, data) => {
    if (!isTrustedUIEvent(event) || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (event.sender !== chromeView.webContents) return null;
    return workspaceMutations.run(async () => {
    if (quittingAfterClear || identityLifecycleBusy) return null;
    if (data.action === 'select' && typeof data.id === 'string') await switchWorkspace(data.id);
    else if (data.action === 'create' && typeof data.name === 'string') {
      const id = 'space-' + crypto.randomBytes(8).toString('hex');
      const next = createWorkspace(settings.workspaces, data.name, id);
      if (next !== settings.workspaces) {
        const previous = { workspaces: settings.workspaces, workspaceSessionPartitions: settings.workspaceSessionPartitions,
          workspaceSitePermissions: settings.workspaceSitePermissions, workspaceSiteCookiePolicies: settings.workspaceSiteCookiePolicies };
        settings.workspaces = next;
        normalizeCurrentWorkspaceIdentities();
        if (!saveSettings()) { Object.assign(settings, previous); throw new Error(translate('experience.failed', settings.language)); }
        await prepareBrowserSession(workspaceSession(id));
        await switchWorkspace(id);
      }
    } else if (data.action === 'rename') settings.workspaces = renameWorkspace(settings.workspaces, data.id, data.name);
    else if (data.action === 'remove') {
      await removeWorkspaceIdentity(data.id);
    } else if (data.action === 'move' && Number.isSafeInteger(data.tabId) && settings.workspaces.some(item => item.id === data.id)) {
      const tab = tabs.get(data.tabId);
      if (tab && !tab.private) await moveWorkspaceTab(tab, data.id);
    }
    settings.activeWorkspace = persistWorkspaceState(settings.workspaces, activeWorkspaceId).activeId;
    saveSettings(); applyLayout(); sendState();
    return publicWorkspaceState(settings.workspaces, activeWorkspaceId, Array.from(tabs.values()));
    });
  });
  ipcMain.handle('nacre:split-view', (event, data) => {
    if (!isTrustedUIEvent(event)) return;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (data.action === 'close') splitTabIds = [];
    else if (data.action === 'ratio' && typeof data.ratio === 'number' && Number.isFinite(data.ratio)) splitRatio = Math.max(.25, Math.min(.75, data.ratio));
    else if (data.action === 'open' && Number.isSafeInteger(data.peerId) && canSplit(activeTab(), tabs.get(data.peerId))) splitTabIds = [activeTabId, data.peerId];
    else return false;
    applyLayout(); sendState(); return true;
  });
  ipcMain.handle('nacre:apply-site-permission', (event, data) => {
    if (!isTrustedUIEvent(event)) return;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const tab = tabs.get(data.tabId);
    let origin;
    try { origin = new URL(tab && tab.url); } catch { return false; }
    if (!tab || tab.internal || origin.origin !== data.origin || !['http:', 'https:'].includes(origin.protocol)
      || data.documentEpoch !== (tab.siteControlsEpoch || 0)
      || !Object.hasOwn(SITE_PERMISSIONS, data.permission) || !['deny', 'ask', 'allow'].includes(data.mode)
      || !['temporary', 'persistent'].includes(data.scope)) return false;
    const sender = tabByContentsId.get(event.sender.id);
    if (sender && (sender.contextTabId !== tab.id || !sameIdentity(sender, tab))) return false;
    const host = origin.hostname.toLowerCase();
    const contents = tab.pageView?.webContents;
    if (!contents && data.scope === 'temporary') return false;
    const key = contents ? privatePermissionKey(contents, host, data.permission) : '';
    if (data.scope === 'temporary' || tab.private) { if (key) privatePermissionDecisions.set(key, data.mode); }
    else { if (key) privatePermissionDecisions.delete(key); setSitePermission(host, data.permission, data.mode, tab); }
    sendState(); return true;
  });
  ipcMain.on('nacre:cookie-frame-policy', (event) => {
    const frame = event.senderFrame;
    const tab = tabByContentsId.get(event.sender.id);
    if (!tab || !frame || frame.isDestroyed() || frame.top !== event.sender.mainFrame || !/^https?:/.test(frame.url)) { event.returnValue = true; return; }
    const details = { url: frame.url, resourceType: frame === frame.top ? 'mainFrame' : 'other', frame };
    event.returnValue = shouldBlockRequestCookies(requestCookiePolicy(details, tab, event.sender.session), cookieContextForRequest(details, tab.url));
  });
  ipcMain.on('nacre:adblock:prepare-frame', (event, frameUrl) => {
    const contents = event.sender;
    const frame = event.senderFrame;
    const tab = tabByContentsId.get(contents.id);
    if (!tab || tab.internal || !frame || frame.isDestroyed() || frame.top !== contents.mainFrame || typeof frameUrl !== 'string' || frameUrl.length > 4096 || frame.url !== frameUrl || !/^https?:\/\//i.test(frame.url)) { event.returnValue = null; return; }
    const payload = getCosmeticsForFrame(contents, frameUrl);
    // Setting returnValue sends the synchronous response immediately. Assign
    // exactly once, after the payload has been calculated.
    event.returnValue = payload || null;
  });
  ipcMain.on('nacre:fingerprint-seed', (event, requestedHost) => {
    const tab = tabByContentsId.get(event.sender.id);
    const frame = event.senderFrame;
    const host = typeof requestedHost === 'string' ? requestedHost.toLowerCase() : '';
    const webglMode = 'disabled';
    if (!tab || tab.internal || !frame || frame.isDestroyed() || frame.top !== event.sender.mainFrame || !/^https?:\/\//i.test(frame.url) || !/^(?=.{1,253}$)[a-z0-9.-]+$/.test(host) || host !== hostOf(frame.url)) { event.returnValue = { secret: '', metadata: buildChromeUserAgentMetadata(process.versions.chrome), webglMode }; return; }
    const ses = event.sender.session;
    const domain = primaryDomain(host);
    // Trusted sites keep the same values across launches so the service does
    // not see a new device each time; other sites get fresh values per launch.
    const secret = trustedSiteHost(host, tab) ? trustedFingerprintSeed(trustedSiteSecret(), tab.workspaceId, domain) : fingerprintSeeds.forSite(ses, domain);
    event.returnValue = { secret, metadata: buildChromeUserAgentMetadata(process.versions.chrome), webglMode };
  });
  ipcMain.handle('nacre:get-language', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    return settings.language;
  });
  ipcMain.handle('nacre:get-messages', (event, language) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const requestedLanguage = isAvailableLanguage(language) ? language : 'en';
    const translated = getMessages(requestedLanguage);
    const english = getMessages('en');
    const englishKeys = new Set(Object.keys(english));
    return { ...english, ...Object.fromEntries(Object.entries(translated).filter(([key]) => englishKeys.has(key))) };
  });
  ipcMain.handle('nacre:get-tor-log', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    return lastTorLog || 'Aucune ligne de journal Tor disponible pour cette tentative.';
  });
  ipcMain.handle('nacre:add-adblock-list-url', async (event, rawUrl) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux paramètres de Nacre.');
    const url = safeFilterListUrl(rawUrl);
    if (!url) throw new Error('Indique une adresse HTTPS publique valide pour la liste.');
    if (settings.adBlockCustomLists.some((item) => item.url === url)) throw new Error('Cette liste est déjà ajoutée.');
    if (settings.adBlockCustomLists.length >= 20) throw new Error('La limite de 20 listes personnalisées est atteinte.');
    const addedList = { url, id: customListId(url), enabled: true, updatedAt: '' };
    settings.adBlockCustomLists = [...settings.adBlockCustomLists, addedList];
    saveSettings();
    sendState();
    try { await loadBlocker(true); return { ok: true }; }
    catch (error) {
      // Remove only this add: a concurrent successful add must survive.
      settings.adBlockCustomLists = settings.adBlockCustomLists.filter((item) => item.id !== addedList.id);
      saveSettings();
      sendState();
      throw new Error(error.message || 'La liste n’a pas été ajoutée : son téléchargement a échoué.');
    }
  });
  ipcMain.on('nacre:open-protection', (event) => {
    if (isTrustedUIEvent(event)) { const source = activeTab(); createTab('nacre://protection/', source && source.private, { contextTabId: source && source.id, workspaceId: source && source.workspaceId }); }
  });
  ipcMain.on('nacre:clear-protection-stats', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const sender = tabByContentsId.get(event.sender.id);
    const target = sender ? tabs.get(sender.contextTabId) || sender : activeTab();
    if (target && target.private) { target.privateStats = { total: 0, byType: {}, bySite: {}, lastUpdated: 0 }; target.adBlockBlocked = 0; target.cookieBlocked = 0; target.privateActivity.clear(); }
    else { adBlockStats = { total: 0, byType: {}, bySite: {}, lastUpdated: 0 }; protectionActivity.clear(); for (const tab of tabs.values()) if (!tab.private) { tab.adBlockBlocked = 0; tab.cookieBlocked = 0; } }
    sendState();
  });
  ipcMain.handle('nacre:copy-adblock-report', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const tab = activeTab();
    const report = [
      'Rapport local Nacre — bloqueur de publicités',
      'Site : ' + (tab ? hostOf(tab.url) || '[page interne]' : '[aucun onglet]'),
      'Requêtes bloquées dans cet onglet : ' + Number(tab && tab.adBlockBlocked || 0),
      'Date des listes : ' + (settings.adBlockUpdatedAt || 'snapshot intégré'),
      'Aucune URL complète, requête ou donnée de navigation n’est incluse. Ce texte reste dans le presse-papiers local.'
    ].join('\n');
    clipboard.writeText(report);
    return true;
  });
  ipcMain.handle('nacre:copy-transparency-report', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const sender = tabByContentsId.get(event.sender.id);
    // The dashboard's captured private context wins over whichever tab is now
    // active. A closed or mismatched context produces an empty private report.
    const candidate = sender ? tabs.get(sender.contextTabId) : null;
    const source = candidate && candidate.private === sender.private ? candidate : sender || activeTab();
    const isPrivate = sender ? sender.private : Boolean(source?.private);
    const journal = isPrivate ? source?.privateActivity : protectionActivity;
    const activity = journal ? journal.snapshot() : createProtectionActivity({ scope: isPrivate ? 'private' : 'normal' }).snapshot();
    clipboard.writeText(createTransparencyReport(activity));
    return true;
  });
  ipcMain.handle('nacre:zap-element', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const tab = activeTab();
    if (!tab || tab.internal || !tab.pageView || tab.pageView.webContents.isDestroyed() || !hostOf(tab.url)) throw new Error('Ouvre une page Web avant de choisir un élément.');
    notify('toast.zapperSelect', {}, 'info');
    const picker = "new Promise(resolve=>{let current=null,done=false;const finish=value=>{if(done)return;done=true;document.removeEventListener('pointerover',over,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);if(current)current.style.removeProperty('outline');resolve(value)};const over=e=>{if(!e.isTrusted)return;if(current)current.style.removeProperty('outline');current=e.target;current.style.setProperty('outline','3px solid #ff835e','important')};const selector=el=>{const esc=s=>/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(s)?s:'';if(esc(el.id)){const id='#'+esc(el.id);if(document.querySelectorAll(id).length===1)return id}const parts=[];for(let node=el;node&&node.nodeType===1&&parts.length<6&&node!==document.documentElement;node=node.parentElement){let part=node.localName;if(esc(node.id)){part+='#'+esc(node.id);parts.unshift(part);break}const classes=[...node.classList].filter(esc).slice(0,2);if(classes.length)part+='.'+classes.map(esc).join('.');const parent=node.parentElement;if(parent){const same=[...parent.children].filter(x=>x.localName===node.localName);if(same.length>1)part+=':nth-of-type('+(same.indexOf(node)+1)+')'}parts.unshift(part)}return parts.join(' > ').slice(0,500)};const click=e=>{if(!e.isTrusted)return;e.preventDefault();e.stopImmediatePropagation();finish(selector(e.target))};const key=e=>{if(!e.isTrusted)return;if(e.key==='Escape'){e.preventDefault();finish('')}};document.addEventListener('pointerover',over,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)});";
    const pickerContents = tab.pageView.webContents;
    const pickerUrl = pickerContents.getURL();
    const selector = await pickerContents.executeJavaScriptInIsolatedWorld(1004, [{ code: picker }], false);
    if (pickerContents.isDestroyed() || tab.pageView.webContents !== pickerContents || pickerContents.getURL() !== pickerUrl) return false;
    if (!selector) return false;
    if (!validZapperSelector(selector)) throw new Error('Le sélecteur produit n’est pas valide.');
    const host = hostOf(tab.url);
    const rule = host + '##' + selector;
    const current = validateCustomFilters(settings.adBlockCustomFilters) || '';
    if (!current.split('\n').includes(rule)) {
      const validated = validateCustomFilters([current, rule].filter(Boolean).join('\n'));
      if (validated === null) throw new Error('La limite de taille des filtres personnalisés serait dépassée.');
      settings.adBlockCustomFilters = validated;
      saveSettings();
      rebuildBlockerFromAvailableSources();
    }
    try { await tab.pageView.webContents.insertCSS(`${selector}{display:none !important;}`, { cssOrigin: 'user' }); } catch {}
    notify('toast.zapperAdded', { host });
    return true;
  });
  ipcMain.handle('nacre:get-source', async (event, value) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à la visionneuse de code source.');
    const tab = tabByContentsId.get(event.sender.id);
    if (!tab || !tab.internal || !tab.url.startsWith('nacre://source/')) throw new Error('Action réservée à la visionneuse de code source.');
    const target = safeURL(value);
    if (!target) throw new Error('Adresse source invalide.');
    const expected = safeURL(new URL(tab.url).searchParams.get('url'));
    if (!expected || target !== expected || tab.browserSession !== event.sender.session) throw new Error(translate('common.operationFailed', settings.language));
    const response = await tab.pageView.webContents.session.fetch(target, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'text/plain, text/html;q=0.9, */*;q=0.1' }
    });
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let truncated = false;
    while (length < 2_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = 2_000_000 - length;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      length += chunk.byteLength;
      if (value.byteLength > remaining) { truncated = true; await reader.cancel(); break; }
    }
    if (length >= 2_000_000) truncated = true;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, text: new TextDecoder().decode(bytes), truncated };
  });
  ipcMain.handle('nacre:check-updates', async (event, requestedRepository) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux paramètres de Nacre.');
    const repository = typeof requestedRepository === 'string' ? requestedRepository.trim() : settings.releaseRepository;
    if (repository && !isGitHubRepository(repository)) throw new Error('Indique un dépôt public au format propriétaire/projet.');
    if (repository !== settings.releaseRepository) {
      settings.releaseRepository = repository;
      saveSettings();
    }
    if (!regularSession) throw new Error('La session réseau du navigateur n’est pas encore prête.');
    if (!settings.torCountry || !torRuntime || !torRuntime.ready || !torRuntime.process || torRuntime.process.exitCode !== null) {
      throw new Error('Connectez Tor avant de rechercher des mises à jour. Aucune requête directe n’est envoyée.');
    }
    const electronCurrent = process.versions.electron || app.getVersion();
    const results = await Promise.all([
      latestGitHubRelease(regularSession, 'electron/electron').then((release) => ({
        current: electronCurrent,
        latest: release.version,
        updateAvailable: compareVersions(electronCurrent, release.version) < 0,
        url: release.url
      })).catch((error) => ({ current: electronCurrent, error: error.message || 'Vérification Electron impossible.' })),
      repository
        ? latestGitHubRelease(regularSession, repository).then((release) => ({
          current: app.getVersion(),
          latest: release.version,
          updateAvailable: compareVersions(app.getVersion(), release.version) < 0,
          url: release.url
        })).catch((error) => ({ current: app.getVersion(), error: error.message || 'Vérification Nacre impossible.' }))
        : Promise.resolve({ current: app.getVersion(), unconfigured: true })
    ]);
    return { electron: results[0], nacre: results[1] };
  });
  ipcMain.handle('nacre:get-site-permissions', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux paramètres de Nacre.');
    const sender = tabByContentsId.get(event.sender.id);
    const tab = siteControlTarget(sender);
    const currentHost = tab && !tab.internal ? hostOf(tab.url) : '';
    const privateContext = Boolean((tab || sender) && (tab || sender).private);
    const policies = policiesForTab('workspaceSitePermissions', tab || sender);
    const sites = Object.entries(policies).filter(([, values]) => values && typeof values === 'object').map(([host, values]) => ({
      host,
      permissions: Object.entries(SITE_PERMISSIONS).map(([key, label]) => ({ key, label, mode: values[key] === 'allow' || values[key] === 'ask' ? values[key] : 'deny' }))
    }));
    if (currentHost && !sites.some((site) => site.host === currentHost)) {
      sites.unshift({ host: currentHost, permissions: Object.entries(SITE_PERMISSIONS).map(([key, label]) => ({ key, label, mode: 'deny' })) });
    }
    const current = currentHost ? { tabId: tab.id, origin: new URL(tab.url).origin, host: currentHost, documentEpoch: tab.siteControlsEpoch || 0,
      permissions: Object.entries(SITE_PERMISSIONS).map(([key, label]) => ({ key, label, mode: permissionMode(currentHost, key, tab), temporary: Boolean(tab.pageView?.webContents && privatePermissionDecisions.has(privatePermissionKey(tab.pageView.webContents, currentHost, key))) })),
      cookies: { global: settings.cookiePolicy,
        override: tab.cookiePolicyOverride?.host===currentHost ? tab.cookiePolicyOverride.policy : (!privateContext && Object.hasOwn(policiesForTab('workspaceSiteCookiePolicies',tab),currentHost) ? policiesForTab('workspaceSiteCookiePolicies',tab)[currentHost] : 'default'),
        effective: siteCookiePolicy(settings.cookiePolicy,currentHost,policiesForTab('workspaceSiteCookiePolicies',tab),tab.cookiePolicyOverride),
        temporary: tab.cookiePolicyOverride?.host===currentHost }
    } : null;
    return { currentHost, current, sites, labels: SITE_PERMISSIONS, private: privateContext, cookiePolicy: settings.cookiePolicy };
  });
  ipcMain.handle('nacre:get-site-info', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const tab = activeTab();
    if (!tab || !/^https?:$/.test((() => { try { return new URL(tab.url).protocol; } catch { return ''; } })())) return { host: '', transport: translate('site.none', settings.language), cookies: 0, blocked: 0 };
    const cookies = await tab.browserSession.cookies.get({ url: tab.url }).catch(() => []);
    const host = hostOf(tab.url);
    const permissions = Object.keys(SITE_PERMISSIONS).map(key => translate('siteControls.permission.' + key.replace(/-/g, ''), settings.language) + ': ' + translate('siteControls.' + permissionMode(host, key, tab), settings.language)).join('\n');
    return { host, transport: translate(tab.url.startsWith('https:') ? 'diagnostic.maincjs.text9802cb29e6' : 'diagnostic.maincjs.textbcf8f973c4', settings.language), cookies: cookies.length, permissions, blocked: tab.blocked };
  });
  ipcMain.on('nacre:open-reader', (event) => {
    if (!isTrustedUIEvent(event)) return;
    openReaderForTab(activeTab()).catch((error) => console.warn('Reader mode failed.', error.message));
  });
  ipcMain.on('nacre:exit-reader', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const found = internalDocument(event, readerDocuments, 'reader');
    if (!found || !safeURL(found.record.url)) return;
    readerDocuments.delete(found.record.id);
    navigateTab(found.tab, found.record.url)?.catch(() => {});
  });
  ipcMain.handle('nacre:get-reader', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Reserved for reader mode.');
    const found = internalDocument(event, readerDocuments, 'reader');
    if (!found) return null;
    return { ...found.record.document, url: found.record.url, sourceTitle: found.record.sourceTitle || '' };
  });
  ipcMain.on('nacre:open-share', (event) => {
    if (!isTrustedUIEvent(event)) return;
    openShareForTab(activeTab());
  });
  ipcMain.handle('nacre:get-share', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Reserved for sharing.');
    const found = internalDocument(event, shareDocuments, 'share');
    if (!found) return null;
    return { url: found.record.url, title: found.record.title };
  });
  ipcMain.handle('nacre:copy-share', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Reserved for sharing.');
    const found = internalDocument(event, shareDocuments, 'share');
    if (!found) return false;
    clipboard.writeText(found.record.url);
    return true;
  });
  ipcMain.on('nacre:close-share', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const found = internalDocument(event, shareDocuments, 'share');
    if (!found || !safeURL(found.record.url)) return;
    shareDocuments.delete(found.record.id);
    navigateTab(found.tab, found.record.url)?.catch(() => {});
  });
  ipcMain.handle('nacre:get-phishing', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Reserved for the phishing filter.');
    const found = internalDocument(event, phishingNotices, 'phishing');
    if (!found) return null;
    return { url: found.record.url, reasons: found.record.reasons, blocked: found.record.blocked };
  });
  ipcMain.on('nacre:continue-phishing', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const found = internalDocument(event, phishingNotices, 'phishing');
    if (!found || !safeURL(found.record.url)) return;
    const { tab, record } = found;
    phishingNotices.delete(record.id);
    tab.pendingPhishingToken = '';
    tab.pendingPhishingUrl = '';
    tab.phishingAcceptedUrl = record.url;
    navigateTab(tab, record.url)?.catch(() => {});
  });
  ipcMain.on('nacre:cancel-phishing', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const found = internalDocument(event, phishingNotices, 'phishing');
    if (!found) return;
    const { tab, record } = found;
    phishingNotices.delete(record.id);
    tab.pendingPhishingToken = '';
    tab.pendingPhishingUrl = '';
    if (safeURL(record.returnUrl)) navigateTab(tab, record.returnUrl)?.catch(() => {});
    else if (tab.id === activeTabId) showHomeTab();
    else navigateTab(tab, 'nacre://settings/')?.catch(() => {});
  });
  ipcMain.on('nacre:site-zoom', (event, action) => {
    if (!isTrustedUIEvent(event) || !['in', 'out', 'reset'].includes(action)) return;
    setTabZoom(activeTab(), action);
  });
  ipcMain.handle('nacre:home-shortcuts', (event, request) => {
    if (!isTrustedUIEvent(event) || event.sender !== chromeView.webContents) return;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
    const data = { action: String(request.action || ''), title: String(request.title || '').slice(0, 200), url: String(request.url || '').slice(0, 2048), index: Number(request.index), to: Number(request.to) };
    if (!['add', 'add-current', 'update', 'remove', 'move'].includes(data.action)) return false;
    return updateHomeShortcuts(data);
  });
  ipcMain.on('nacre:focus-page', (event) => {
    if (!isTrustedUIEvent(event) || event.sender !== chromeView.webContents || expandedOverlay) return;
    const tab = activeTab();
    if (tab && tab.url && tab.pageView && !tab.pageView.webContents.isDestroyed()) tab.pageView.webContents.focus();
  });
  ipcMain.handle('nacre:site-icons', (event, hosts) => {
    if (!isTrustedUIEvent(event) || event.sender !== chromeView.webContents) return;
    return siteIconsFor(hosts);
  });
  ipcMain.handle('nacre:custom-language', async (event, action) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    if (action === 'create') {
      const file = createCustomLanguage(settings.language);
      shell.showItemInFolder(file);
      sendState();
      return { file: path.basename(file) };
    }
    if (action === 'open-folder') {
      fs.mkdirSync(path.join(app.getPath('userData'), 'languages'), { recursive: true });
      await shell.openPath(path.join(app.getPath('userData'), 'languages'));
      return {};
    }
    return null;
  });
  ipcMain.handle('nacre:wallpaper', async (event, action) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    if (action === 'get') return readWallpaper();
    if (action === 'clear') { removeWallpaper(); saveSettings(); sendState(); return { ok: true }; }
    if (action === 'choose') return chooseWallpaper(win);
    return null;
  });
  ipcMain.on('nacre:panic', (event) => {
    if (!isTrustedUIEvent(event)) return;
    panicCleanup().catch(() => {});
  });
  ipcMain.handle('nacre:get-bookmarks', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux favoris Nacre.');
    return settings.bookmarks.map((item) => ({ ...item }));
  });
  ipcMain.handle('nacre:save-bookmarks', (event, items) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux favoris Nacre.');
    if (!Array.isArray(items) || items.length > 500) throw new Error('La liste de favoris est invalide.');
    const next = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const url = safeURL(item.url);
      if (!url) continue;
      if (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 200)) continue;
      if (item.folder !== undefined && (typeof item.folder !== 'string' || item.folder.length > 80)) continue;
      next.push({ title: item.title || hostOf(url), url, folder: item.folder || '' });
    }
    settings.bookmarks = next;
    saveSettings();
    sendState();
    return next.length;
  });
  ipcMain.handle('nacre:import-bookmarks', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux favoris Nacre.');
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], buttonLabel: translate('common.open', settings.language), filters: [{ name: translate('bookmarks.html', settings.language), extensions: ['html', 'htm'] }] });
    if (result.canceled || !result.filePaths[0]) return { imported: 0, cancelled: true };
    const descriptor = fs.openSync(result.filePaths[0], 'r');
    let source;
    try {
      if (fs.fstatSync(descriptor).size > 5_000_000) throw new Error('Bookmark file exceeds size limit');
      const bytes = Buffer.alloc(5_000_000);
      source = bytes.subarray(0, fs.readSync(descriptor, bytes)).toString('utf8');
    } finally { fs.closeSync(descriptor); }
    const imported = parseBookmarkHtml(source, safeURL);
    // Icons embedded in the file are re-encoded like any favicon; no request is made.
    const importedIcons = new Map();
    for (const item of imported) {
      const host = iconHost(item.url);
      if (item.icon && host && !importedIcons.has(host)) {
        try { const encoded = encodeFavicon(Buffer.from(item.icon.slice(item.icon.indexOf(',') + 1), 'base64'), nativeImage); if (encoded) importedIcons.set(host, encoded); } catch {}
      }
      delete item.icon;
    }
    const unique = new Map(settings.bookmarks.map((item) => [item.url, item]));
    for (const item of imported) if (!unique.has(item.url)) unique.set(item.url, item);
    settings.bookmarks = Array.from(unique.values()).slice(0, 500);
    const wanted = wantedIconHosts();
    for (const [host, icon] of importedIcons) if (wanted.has(host)) siteIcons?.set(host, icon);
    saveSettings(); sendState();
    fetchIconsInBackground({ afterImport: true });
    return { imported: imported.length, total: settings.bookmarks.length };
  });
  ipcMain.handle('nacre:export-bookmarks', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux favoris Nacre.');
    const result = await dialog.showSaveDialog(win, { defaultPath: 'Nacre-Bookmarks.html', buttonLabel: translate('common.save', settings.language), filters: [{ name: translate('bookmarks.html', settings.language), extensions: ['html'] }] });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const folders = new Map();
    for (const item of settings.bookmarks) { const folder = item.folder || ''; if (!folders.has(folder)) folders.set(folder, []); folders.get(folder).push(item); }
    const body = Array.from(folders, ([folder, items]) => `${folder ? `<DT><H3>${esc(folder)}</H3><DL><p>` : ''}${items.map((item) => `<DT><A HREF="${esc(item.url)}">${esc(item.title)}</A>`).join('\n')}${folder ? '</DL><p>' : ''}`).join('\n');
    fs.writeFileSync(result.filePath, `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Favoris Nacre</TITLE><H1>Favoris</H1><DL><p>\n${body}\n</DL>\n`, 'utf8');
    return { exported: settings.bookmarks.length };
  });
  ipcMain.handle('nacre:import-sources', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    return describeSources(findBrowserSources());
  });
  ipcMain.handle('nacre:import-from-browser', (event, id) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    // Paths are found again here; the interface only names a source.
    const source = typeof id === 'string' && findBrowserSources().find((item) => item.id === id);
    if (!source) throw new Error(translate('import.notFound', settings.language));
    let imported;
    try { imported = readSourceBookmarks(source, safeURL); }
    catch { throw new Error(translate('import.failed', settings.language)); }
    const merged = mergeBookmarks(settings.bookmarks, imported);
    settings.bookmarks = merged.bookmarks;
    // Icons the other browser already stored locally; no request is made.
    let iconsAdded = 0;
    try {
      const wanted = [...wantedIconHosts()];
      for (const [host, bytes] of readSourceIcons(source, wanted)) {
        const encoded = encodeFavicon(bytes, nativeImage);
        if (encoded && siteIcons?.set(host, encoded)) iconsAdded++;
      }
    } catch {}
    saveSettings(); sendState();
    fetchIconsInBackground({ afterImport: true });
    return { found: imported.length, imported: merged.added, icons: iconsAdded, total: settings.bookmarks.length, full: settings.bookmarks.length >= 500 };
  });
  ipcMain.handle('nacre:trusted-sites', (event, data) => {
    if (!isTrustedUIEvent(event) || !data || typeof data !== 'object') throw new Error('Action réservée à l’interface de Nacre.');
    let next = settings.trustedSites;
    if (data.action === 'presets' && Array.isArray(data.ids)) {
      // Presets the user left unchecked are removed; added domains are kept.
      const all = new Set(TRUSTED_SITE_PRESETS.flatMap((preset) => preset.domains));
      const chosen = presetDomains(data.ids.filter((value) => typeof value === 'string'));
      next = [...settings.trustedSites.filter((domain) => !all.has(domain)), ...chosen];
    } else if (data.action === 'add' && typeof data.domain === 'string') {
      const host = data.domain.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0];
      const domain = validHost(host) ? primaryDomain(host) : '';
      if (!domain.includes('.')) throw new Error(translate('trusted.invalid', settings.language));
      next = [...settings.trustedSites, domain];
    } else if (data.action === 'current') {
      const tab = activeTab();
      const host = tab && !tab.internal && !tab.private ? hostOf(tab.url) : '';
      if (!validHost(host)) throw new Error(translate('trusted.invalid', settings.language));
      const domain = primaryDomain(host);
      next = settings.trustedSites.includes(domain) ? settings.trustedSites.filter((item) => item !== domain) : [...settings.trustedSites, domain];
    } else if (data.action === 'remove' && typeof data.domain === 'string') {
      next = settings.trustedSites.filter((item) => item !== data.domain);
    } else throw new Error(translate('trusted.invalid', settings.language));
    settings.trustedSites = normalizeTrustedSites(next).slice(0, MAX_TRUSTED_SITES);
    // A site the user now trusts is no longer forgotten when its tab closes.
    const forgotten = settings.forgetSiteOnClose.filter((host) => isTrustedDomain(primaryDomain(host), settings.trustedSites));
    if (forgotten.length) {
      settings.forgetSiteOnClose = settings.forgetSiteOnClose.filter((host) => !forgotten.includes(host));
      for (const host of forgotten) forgetfulSites.disable(host);
    }
    saveSettings(); sendState();
    return settings.trustedSites;
  });
  ipcMain.handle('nacre:welcome-done', (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    settings.welcomeDone = true;
    saveSettings(); sendState();
    return true;
  });
  ipcMain.handle('nacre:new-identity', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    if (!settings.torCountry || !torRuntime || !torRuntime.control) throw new Error('Connecte Tor avant de demander une nouvelle identité.');
    if (torIdentityChanging) throw new Error('Une nouvelle identité est déjà en cours.');
    torIdentityChanging = true;
    torExitIp = '';
    sendState();
    try {
      await torRuntime.control.signalNewnym();
      for (const bridge of torRuntime.bridges.values()) bridge.renewIdentity();
      await waitForAll(browserSessions().map((ses) => ses.closeAllConnections().catch(() => {})));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { ip: await updateTorExitIp() };
    } finally {
      torIdentityChanging = false;
      sendState();
    }
  });
  ipcMain.on('nacre:layout', (event, data) => {
    if (!isTrustedUIEvent(event) || !data || typeof data !== 'object' || Array.isArray(data) || typeof data.chromeHeight !== 'number' || !Number.isFinite(data.chromeHeight) || data.chromeHeight < 80 || data.chromeHeight > 2000 || typeof data.expanded !== 'boolean') return;
    browserSize.chromeHeight = Math.min(Math.max(data.chromeHeight, 80), browserSize.height - 100);
    expandedOverlay = data.expanded;
    applyLayout();
  });
  ipcMain.on('nacre:navigate', (event, value) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = activeTab();
    if (!tab) return;
    if (typeof value !== 'string' || value.length > 8192) return;
    const input = value.trim();
    if (!input) return;
    let destination;
    if (safeNavigationURL(input)?.startsWith('nacre:')) destination = safeNavigationURL(input);
    else if (isLocalAddressInput(input)) destination = safeURL('http://' + input);
    else if (/^(?:[^\s./:#?]+\.)+[^\s./:#?]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(input)) destination = safeURL('https://' + input);
    else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) destination = safeURL(input);
    else destination = searchURL(input);
    if (destination) navigateTab(tab, destination);
    else notify('toast.invalidAddress', {}, 'warning');
  });
  ipcMain.on('nacre:search', (event, value) => {
    if (!isTrustedUIEvent(event)) return;
    if (typeof value !== 'string' || value.length > 2048) return;
    const query = value.trim();
    if (query) navigateTab(activeTab(), searchURL(query));
  });
  ipcMain.on('nacre:open-settings-tab', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const existing = Array.from(tabs.values()).find((tab) => tab.url === 'nacre://settings/' && tab.private === Boolean(activeTab()?.private));
    if (existing) activateTab(existing.id);
    else createTab('nacre://settings/');
  });
  ipcMain.on('nacre:open-site-settings', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const source = activeTab();
    createTab('nacre://settings/sites', source && source.private, { contextTabId: source && source.id, workspaceId: source && source.workspaceId });
  });
  ipcMain.on('nacre:open-leak-tests', (event) => {
    if (!isTrustedUIEvent(event)) return;
    createTab('nacre://leak-tests/#run');
  });
  // The page only asks to open the donation page; the address is fixed here.
  ipcMain.on('nacre:open-donation', (event) => {
    if (!isTrustedUIEvent(event)) return;
    createTab(DONATION_URL);
  });
  ipcMain.on('nacre:open-downloads', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const existing = Array.from(tabs.values()).find((tab) => tab.url === 'nacre://downloads/' && tab.private === Boolean(activeTab()?.private));
    if (existing) activateTab(existing.id);
    else createTab('nacre://downloads/');
  });
  ipcMain.on('nacre:open-bookmarks', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const existing = Array.from(tabs.values()).find((tab) => tab.url === 'nacre://bookmarks/' && tab.private === Boolean(activeTab()?.private));
    if (existing) activateTab(existing.id);
    else createTab('nacre://bookmarks/');
  });
  ipcMain.on('nacre:open-shortcuts', (event) => { if (isTrustedUIEvent(event)) createTab('nacre://shortcuts/'); });
  ipcMain.on('nacre:open-offline', (event) => { if (isTrustedUIEvent(event)) createTab('nacre://offline/'); });
  ipcMain.on('nacre:choose-download-directory', async (event) => {
    if (!isTrustedUIEvent(event)) return;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: translate("ui.maincjs.textf3a34fee4f", settings.language), defaultPath: settings.downloadDirectory || app.getPath('downloads') });
    if (result.canceled || !result.filePaths[0]) return;
    settings.downloadDirectory = path.resolve(result.filePaths[0]);
    saveSettings();
    sendState();
  });
  ipcMain.on('nacre:choose-profile-location', async (event) => {
    if (!isTrustedUIEvent(event)) return;
    const current = app.getPath('userData');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: translate("ui.maincjs.textf9a0b90d5c", settings.language),
      defaultPath: current
    });
    if (result.canceled || !result.filePaths[0]) return;
    const destination = path.resolve(result.filePaths[0]);
    const language = settings.language;
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning', title: translate('dialog.profileLocation.title', language),
      message: translate('dialog.profileLocation.message', language),
      detail: translate('dialog.profileLocation.detail', language),
      buttons: [translate('dialog.profileLocation.confirm', language), translate('common.cancel', language)], defaultId: 1, cancelId: 1, noLink: true
    });
    if (confirmation.response !== 0) return;
    const pointer = path.join(app.getPath('appData'), 'Nacre', 'profile-location.json');
    try {
      writeProfileLocation(pointer, destination, fs);
      notify('toast.profileLocationRestart');
    } catch (error) { notify('toast.profileLocationSaveFailed', { error: localizeText(error.message, settings.language) }, 'warning'); }
  });
  ipcMain.on('nacre:download-action', (event, id, action) => {
    if (!isTrustedUIEvent(event)) return;
    if (action === 'folder-root' && id === -1) { shell.openPath(settings.downloadDirectory || app.getPath('downloads')); return; }
    if (!Number.isSafeInteger(id) || !['pause', 'resume', 'cancel', 'open', 'folder'].includes(action)) return;
    const record = downloads.get(id);
    if (!record || !record.path || !record.item) return;
    if (action === 'pause' && record.item.canResume()) record.item.pause();
    else if (action === 'resume' && record.item.isPaused()) record.item.resume();
    else if (action === 'cancel') record.item.cancel();
    else if (action === 'open' && record.state === 'completed') openDownloadedFile(record).catch((error) => notify('toast.openDownloadFailed', { error: localizeText(error.message, settings.language) }, 'warning'));
    else if (action === 'folder') shell.showItemInFolder(record.path);
    sendState();
  });
  ipcMain.on('nacre:show-settings-panel', (event) => {
    if (!isTrustedUIEvent(event) || !chromeView || chromeView.webContents.isDestroyed()) return;
    chromeView.webContents.send('nacre:open-settings', 'settings');
  });
  ipcMain.on('nacre:continue-http', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = tabByContentsId.get(event.sender.id);
    if (!tab || !tab.internal || !tab.pendingHttpUrl || !safeURL(tab.pendingHttpUrl)?.startsWith('http://')) return;
    const destination = tab.pendingHttpUrl;
    tab.pendingHttpUrl = '';
    tab.allowHttpOnce = destination;
    navigateTab(tab, destination);
  });
  ipcMain.on('nacre:cancel-http', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = tabByContentsId.get(event.sender.id);
    if (!tab || !tab.internal) return;
    tab.pendingHttpUrl = '';
    navigateTab(tab, 'nacre://settings/');
  });
  ipcMain.on('nacre:update-preferences', (event, payload) => {
    const hasLanguage = payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'language');
    const language = hasLanguage ? payload.language : undefined;
    const validatedPayload = hasLanguage
      ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'language'))
      : payload;
    if (!isTrustedUIEvent(event) || !validateSettingsPayload(validatedPayload) || (hasLanguage && !isAvailableLanguage(language))) return;
    const next = { ...settings };
    if (hasLanguage) next.language = language;
    applyScalarPatch(next, payload);
    if (typeof payload.releaseRepository === 'string' && (payload.releaseRepository === '' || isGitHubRepository(payload.releaseRepository))) next.releaseRepository = payload.releaseRepository;
    if (typeof payload.customSearchUrl === 'string' && payload.customSearchUrl.length <= 500 && payload.customSearchUrl.includes('%s')) {
      const probe = payload.customSearchUrl.replaceAll('%s', 'nacre');
      if (safeURL(probe)) next.customSearchUrl = payload.customSearchUrl;
    }
    if (Array.isArray(payload.startupPages)) next.startupPages = payload.startupPages.filter((item) => typeof item === 'string' && safeURL(item)).slice(0, 10);
    if (['none', 'obfs4', 'snowflake', 'custom'].includes(payload.torBridgeMode) && typeof payload.torBridgeLines === 'string' && payload.torBridgeLines.length <= 8192) {
      const mode = payload.torBridgeMode;
      const validation = mode === 'none' || (!payload.torBridgeLines.trim() && mode !== 'custom')
        ? { valid: true }
        : validateBridgeLines(mode, payload.torBridgeLines);
      if (validation.valid) {
        next.torBridgeMode = mode;
        next.torBridgeLines = payload.torBridgeLines;
      } else {
        tell(validation.error, 'warning');
        return;
      }
    }
    if (['allow', 'block-third-party', 'block-all'].includes(payload.cookiePolicy)) {
      next.cookiePolicy = payload.cookiePolicy;
      next.blockThirdPartyCookies = payload.cookiePolicy !== 'allow';
    }
    if (typeof payload.blockThirdPartyCookies === 'boolean') {
      next.blockThirdPartyCookies = payload.blockThirdPartyCookies;
      if (!Object.hasOwn(payload, 'cookiePolicy')) next.cookiePolicy = payload.blockThirdPartyCookies ? 'block-third-party' : 'allow';
    }
    if (typeof payload.adBlockEnabled === 'boolean' || typeof payload.blockTrackers === 'boolean') {
      next.adBlockEnabled = typeof payload.adBlockEnabled === 'boolean' ? payload.adBlockEnabled : payload.blockTrackers;
      next.blockTrackers = next.adBlockEnabled;
    }
    if (payload.adBlockListStates && typeof payload.adBlockListStates === 'object' && !Array.isArray(payload.adBlockListStates)) {
      next.adBlockListStates = normalizeListStates(payload.adBlockListStates);
      for (const id of bundledFilterListIds()) next.adBlockListStates[id].enabled = true;
    }
    if (Array.isArray(payload.adBlockCustomLists)) {
      next.adBlockCustomLists = payload.adBlockCustomLists.slice(0, 20).map((item) => ({
        url: safeFilterListUrl(item && item.url), id: safeFilterListUrl(item && item.url) ? customListId(safeFilterListUrl(item && item.url)) : '', enabled: Boolean(item && item.enabled !== false),
        updatedAt: typeof (item && item.updatedAt) === 'string' ? item.updatedAt.slice(0, 40) : ''
      })).filter((item) => item.url);
    }
    if (typeof payload.adBlockCustomFilters === 'string') {
      const customFilters = validateCustomFilters(payload.adBlockCustomFilters);
      if (customFilters === null) { notify('toast.filtersTooLarge', {}, 'warning'); return; }
      next.adBlockCustomFilters = customFilters;
    }
    if (Array.isArray(payload.adBlockSiteExceptions)) next.adBlockSiteExceptions = payload.adBlockSiteExceptions
      .filter((host) => typeof host === 'string' && /^(?=.{1,253}$)[a-z0-9.-]+$/i.test(host) && !host.startsWith('.') && !host.endsWith('.'))
      .map((host) => host.toLowerCase()).slice(0, 1000);
    // Ignore legacy/forged renderer-masking preferences; WebGL stays disabled.
    next.blockThirdPartyCookies = next.cookiePolicy !== 'allow';
    if (typeof payload.phishingBlocklist === 'string' && payload.phishingBlocklist.length <= 40000) next.phishingBlocklist = payload.phishingBlocklist;
    // Shortcuts change only through nacre:home-shortcuts.
    if (Object.hasOwn(payload, 'home')) next.home = normalizeHome({ ...(payload.home && typeof payload.home === 'object' ? payload.home : {}), shortcuts: settings.home.shortcuts });
    next.webglMode = 'disabled';
    const bridgeSettingsChanged = next.torBridgeMode !== settings.torBridgeMode || next.torBridgeLines !== settings.torBridgeLines;
    const rulesChanged = next.adBlockMode !== settings.adBlockMode || JSON.stringify(next.adBlockListStates) !== JSON.stringify(settings.adBlockListStates) || next.adBlockCustomFilters !== settings.adBlockCustomFilters || JSON.stringify(next.adBlockCustomLists) !== JSON.stringify(settings.adBlockCustomLists);
    const languageChanged = next.language !== settings.language;
    const cookiesChanged = next.cookiePolicy !== settings.cookiePolicy;
    const dnsModeChanged = next.secureDnsMode !== settings.secureDnsMode;
    settings = next;
    forgetfulSites.syncEnabled(settings.forgetSiteOnClose);
    if (!settings.iconTorBackground) stopIconTor().catch(() => {});
    if (cookiesChanged) reloadCookieGuards();
    if (dnsModeChanged) configureDnsForRoute(dnsRouteUsesProxy);
    applyLayout();
    if (languageChanged) buildMenu();
    updateTitleBarOverlay();
    saveSettings();
    scheduleAdblockWeeklyUpdate();
    if (rulesChanged && blocker) {
      try { rebuildBlockerFromAvailableSources(); }
      catch (error) { notify('toast.settingsSavedFilterFailed', { error: localizeText(error.message, settings.language) }, 'warning'); }
    }
    if (torRuntime && bridgeSettingsChanged) {
      notify('toast.bridgesNextTor');
    }
    for (const ses of browserSessions()) { registerPrivacyPreloads(ses); applySessionLocale(ses); }
  for (const tab of tabs.values()) {
    if (!tab.pageView || tab.pageView.webContents.isDestroyed() || tab.internal) continue;
    tab.pageView.webContents.setZoomFactor(zoomPercentFor(tab) / 100);
  }
    sendState();
  });
  ipcMain.handle('nacre:update-filter-lists', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée aux paramètres de Nacre.');
    try {
      await loadBlocker(true);
      const reloadedYoutubeTabs = reloadYouTubeTabs(Array.from(tabs.values()));
      if (reloadedYoutubeTabs) notify('toast.listsRefreshedYoutube', { count: reloadedYoutubeTabs });
      else notify('toast.listsRefreshed');
      return { ok: true, reloadedYoutubeTabs };
    } catch (error) {
      console.error('Mise à jour des filtres impossible.', error);
      notify('toast.filterUpdateFailed', {}, 'warning');
      throw new Error(error.message || 'Mise à jour impossible. La version en cache reste active.');
    }
  });
  ipcMain.on('nacre:reset-preferences', async (event) => {
    if (!isTrustedUIEvent(event)) return;
    return workspaceMutations.run(async () => {
    const language = settings.language;
    const answer = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [translate('dialog.resetPreferences.confirm', language), translate('common.cancel', language)], defaultId: 1, cancelId: 1,
      title: translate('dialog.resetPreferences.title', language),
      message: translate('dialog.resetPreferences.message', language),
      detail: translate('dialog.resetPreferences.detail', language)
    });
    if (answer.response !== 0) return;
    return identityLifecycle(async () => {
    const sessions = browserSessions();
    try { await waitForAll(sessions.map((ses) => setSessionProxy(ses, closedProxyConfig()))); }
    catch { notify('toast.networkResetFailed', {}, 'warning'); return; }
    await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
    await closeTorRuntime(torRuntime);
    await stopIconTor();
    torRuntime = null;
    torExitIp = '';
    torStartupError = '';
    torConnectingCountry = '';
    const identities = { workspaces: settings.workspaces, activeWorkspace: settings.activeWorkspace,
      workspaceLegacyOwner: settings.workspaceLegacyOwner, workspaceSessionPartitions: settings.workspaceSessionPartitions,
      workspaceSitePermissions: settings.workspaceSitePermissions, workspaceSiteCookiePolicies: settings.workspaceSiteCookiePolicies };
    settings = { ...structuredClone(defaults), ...identities, directMode: false };
    removeWallpaper();
    siteIcons?.clear();
    forgetfulSites.syncEnabled(settings.forgetSiteOnClose);
    privatePermissionDecisions.clear();
    splitTabIds = [];
    for (const tab of tabs.values()) {
      tab.cookiePolicyOverride = null;
      tab.siteControlsEpoch = (tab.siteControlsEpoch || 0) + 1;
    }
    activeWorkspaceId = activeTab()?.workspaceId || settings.workspaces[0].id;
    for (const ses of sessions) { unregisterTorWebRTCBlocker(ses); registerPrivacyPreloads(ses); applySessionLocale(ses); }
    configureDnsForRoute(Boolean(settings.torCountry || settings.proxy.enabled));
    saveSettings();
    for (const tab of tabs.values()) {
      if (tab.pageView && !tab.pageView.webContents.isDestroyed()) {
        tab.pageView.webContents.setZoomFactor(1);
        const url = tab.torResumeUrl;
        tab.torResumeUrl = '';
        if (url) navigateTab(tab, url);
      }
    }
    applyLayout(); sendState();
    notify('toast.preferencesReset');
    });
    });
  });
  ipcMain.on('nacre:new-tab', (event) => { if (isTrustedUIEvent(event)) createTab(); });
  ipcMain.on('nacre:new-private-tab', (event) => { if (isTrustedUIEvent(event)) createTab('', true); });
  ipcMain.on('nacre:activate-tab', (event, id) => {
    if (!isTrustedUIEvent(event) || !Number.isSafeInteger(id) || !tabs.has(id)) return;
    activateTab(id);
  });
  ipcMain.on('nacre:set-tab-group', (event, id, name, color) => {
    if (!isTrustedUIEvent(event) || !Number.isSafeInteger(id) || !tabs.has(id) || typeof name !== 'string' || name.length > 32 || typeof color !== 'string' || !['mint', 'blue', 'violet', 'amber', 'coral'].includes(color)) return;
    const tab = tabs.get(id);
    const safeName = name.trim();
    const colors = { mint: '#78d8b2', blue: '#79aef5', violet: '#bd96ef', amber: '#e1b86e', coral: '#e99482' };
    tab.group = safeName;
    tab.groupColor = safeName ? (colors[color] || colors.mint) : '';
    sendState();
  });
  ipcMain.on('nacre:reorder-tabs', (event, ids) => {
    if (!isTrustedUIEvent(event) || !Array.isArray(ids) || ids.length !== tabs.size || !ids.every(Number.isSafeInteger)) return;
    const ordered = ids;
    if (new Set(ordered).size !== tabs.size || ordered.some((id) => !tabs.has(id))) return;
    const next = new Map(ordered.map((id) => [id, tabs.get(id)]));
    tabs.clear();
    for (const [id, tab] of next) tabs.set(id, tab);
    sendState();
  });
  ipcMain.on('nacre:tab-context', (event, id) => {
    if (!isTrustedUIEvent(event) || !Number.isSafeInteger(id) || !tabs.has(id)) return;
    const tab = tabs.get(id);
    Menu.buildFromTemplate([
      { label: translate('menu.duplicate', settings.language), click: () => createTab(tab.url, tab.private) },
      { label: translate('menu.copyAddress', settings.language), enabled: Boolean(tab.url), click: () => {
        if (tabs.get(id) !== tab) return;
        const contents = tab.pageView?.webContents;
        const url = contents
          ? (contents.isDestroyed() ? null : safeNavigationURL(contents.getURL()))
          : safeNavigationURL(tab.url);
        if (url) clipboard.writeText(cleanLinkForCopy(url));
      } },
      { label: tab.pageView?.webContents.isAudioMuted() ? translate('menu.unmute', settings.language) : translate('menu.mute', settings.language), enabled: Boolean(tab.pageView && !tab.pageView.webContents.isDestroyed()), click: () => {
        const contents = tab.pageView?.webContents;
        if (!contents || contents.isDestroyed()) return;
        contents.setAudioMuted(!contents.isAudioMuted()); sendState();
      } },
      { label: translate('menu.muteOthers', settings.language), enabled: tabs.size > 1, click: () => {
        if (tabs.get(id) !== tab) return;
        for (const other of tabs.values()) {
          if (other.id !== id && other.pageView && !other.pageView.webContents.isDestroyed()) other.pageView.webContents.setAudioMuted(true);
        }
        sendState();
      } },
      { label: tab.pinned ? translate('menu.unpin', settings.language) : translate('menu.pin', settings.language), click: () => { tab.pinned = !tab.pinned; sendState(); } },
      { label: tab.group ? translate('menu.editGroup', settings.language).replace('{name}', tab.group) : translate('menu.addGroup', settings.language), click: () => chromeView.webContents.send('nacre:edit-tab-group', tab.id) },
      { label: translate('menu.removeGroup', settings.language), enabled: Boolean(tab.group), click: () => { tab.group = ''; tab.groupColor = ''; sendState(); } },
      { type: 'separator' },
      { label: translate('menu.closeRight', settings.language), click: () => { const ordered = Array.from(tabs.keys()); for (const otherId of ordered.slice(ordered.indexOf(tab.id) + 1)) closeTab(otherId); activeTabId = tab.id; applyLayout(); sendState(); } },
      { label: translate('menu.closeOthers', settings.language), click: () => { for (const other of Array.from(tabs.values())) if (other.id !== tab.id) closeTab(other.id); activeTabId = tab.id; applyLayout(); sendState(); } },
      { label: translate('menu.closeThis', settings.language), click: () => closeTab(tab.id) }
    ]).popup({ window: win });
  });
  ipcMain.on('nacre:close-tab', (event, id) => { if (isTrustedUIEvent(event) && Number.isSafeInteger(id)) closeTab(id); });
  ipcMain.on('nacre:back', (event) => { if (isTrustedUIEvent(event)) goBack(); });
  ipcMain.on('nacre:home', (event) => { if (isTrustedUIEvent(event)) showHomeTab(); });
  ipcMain.on('nacre:forward', (event) => { if (isTrustedUIEvent(event)) goForward(); });
  ipcMain.on('nacre:reload', (event) => { if (isTrustedUIEvent(event)) reloadTab(); });
  ipcMain.on('nacre:find', (event, query, forward) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = activeTab();
    if (tab && !tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed() && typeof query === 'string' && query.length <= 256 && typeof forward === 'boolean') tab.pageView.webContents.findInPage(query, { findNext: forward, forward });
  });
  ipcMain.on('nacre:stop-find', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = activeTab();
    if (tab && !tab.internal && tab.pageView && !tab.pageView.webContents.isDestroyed()) tab.pageView.webContents.stopFindInPage('clearSelection');
  });
  ipcMain.on('nacre:bookmark', (event) => { if (isTrustedUIEvent(event)) addBookmark(); });
  ipcMain.on('nacre:clear-data', (event, options) => {
    if (!isTrustedUIEvent(event)) return;
    return clearData(options).catch(error => {
      console.error('Explicit data clearing failed.', error);
      notify('experience.failed', {}, 'warning');
    });
  });
  ipcMain.on('nacre:toggle-site-protection', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const tab = activeTab();
    const host = tab && hostOf(tab.url);
    if (!host) return;
    const disabled = settings.adBlockSiteExceptions.includes(host) || settings.siteExceptions.includes(host);
    settings.adBlockSiteExceptions = settings.adBlockSiteExceptions.filter((item) => item !== host);
    settings.siteExceptions = settings.siteExceptions.filter((item) => item !== host);
    if (!disabled) settings.adBlockSiteExceptions.push(host);
    saveSettings();
    sendState();
  });
  ipcMain.on('nacre:set-site-permission', (event, host, permission, mode) => {
    if (!isTrustedUIEvent(event)) return;
    const normalizedHost = typeof host === 'string' ? host.trim().toLowerCase() : '';
    if (!/^(?=.{1,253}$)[a-z0-9.-]+$/.test(normalizedHost) || normalizedHost.startsWith('.') || normalizedHost.endsWith('.')) return;
    const sender = tabByContentsId.get(event.sender.id);
    const tab = sender ? siteControlTarget(sender) : activeTab();
    if (sender && (!tab || !sameIdentity(sender, tab))) return;
    if (!setSitePermission(normalizedHost, String(permission || ''), String(mode || ''), tab)) return;
    sendState();
  });
  ipcMain.on('nacre:reset-site-permissions', (event, host) => {
    if (!isTrustedUIEvent(event)) return;
    if (typeof host !== 'string') return;
    host = host.toLowerCase();
    if (host !== '*' && !validHost(host)) return;
    const sender = tabByContentsId.get(event.sender.id);
    const tab = sender ? siteControlTarget(sender) : activeTab();
    if (sender && (!tab || !sameIdentity(sender, tab))) return;
    const policies = policiesForTab('workspaceSitePermissions', tab);
    if (host === '*') { if (tab && tab.private) tab.privateSitePermissions = Object.create(null); else setWorkspacePolicyMap('workspaceSitePermissions',tab?.workspaceId || activeWorkspaceId,Object.create(null)); }
    else if (typeof host === 'string') delete policies[host.toLowerCase()];
    if (!(tab && tab.private)) {
      if (host === '*') setWorkspacePolicyMap('workspaceSiteCookiePolicies',tab?.workspaceId || activeWorkspaceId,Object.create(null));
      else if (typeof host === 'string') delete policiesForTab('workspaceSiteCookiePolicies',tab)[host.toLowerCase()];
    }
    const affectedTabs = tab && tab.private ? [tab] : Array.from(tabs.values()).filter(item => !item.private && item.workspaceId === (tab?.workspaceId || activeWorkspaceId));
    for (const affected of affectedTabs) {
      if (host === '*' || affected.cookiePolicyOverride?.host === host) affected.cookiePolicyOverride = null;
      if (affected.pageView && !affected.pageView.webContents.isDestroyed()) {
        const prefix = affected.pageView.webContents.id + '|';
        for (const key of privatePermissionDecisions.keys()) if (key.startsWith(prefix) && (host === '*' || key.split('|')[1] === host)) privatePermissionDecisions.delete(key);
      }
    }
    if (!(tab && tab.private)) saveSettings();
    reloadCookieGuards(affectedTabs);
    sendState();
  });
  ipcMain.on('nacre:toggle-forget-site', (event) => {
    if (!isTrustedUIEvent(event)) return;
    const sender = tabByContentsId.get(event.sender.id);
    const tab = siteControlTarget(sender) || activeTab();
    const host = tab && !tab.internal && !tab.private ? hostOf(tab.url) : '';
    if (!validHost(host)) return;
    const enabled = settings.forgetSiteOnClose.includes(host);
    settings.forgetSiteOnClose = enabled
      ? settings.forgetSiteOnClose.filter((item) => item !== host)
      : [...settings.forgetSiteOnClose, host].slice(0, 500);
    if (enabled) forgetfulSites.disable(host);
    else for (const candidate of tabs.values()) forgetfulSites.remember(candidate, candidate.url, settings.forgetSiteOnClose);
    saveSettings();
    sendState();
  });
  ipcMain.handle('nacre:forget-site', async (event) => {
    if (!isTrustedUIEvent(event)) throw new Error('Action réservée à l’interface de Nacre.');
    const sender = tabByContentsId.get(event.sender.id);
    const tab = siteControlTarget(sender) || activeTab();
    if (!tab || tab.internal || !tab.url) return false;
    return forgetSiteData(tab, hostOf(tab.url));
  });
  ipcMain.on('nacre:update-setting', (event, key, value) => {
    if (!isTrustedUIEvent(event)) return;
    if (!['blockTrackers', 'blockThirdPartyCookies', 'sendGpc', 'clearOnQuit', 'showBookmarksBar', 'httpsOnly'].includes(key)) return;
    if (typeof value !== 'boolean') return;
    settings[key] = value;
    if (key === 'blockTrackers') settings.adBlockEnabled = settings.blockTrackers;
    if (key === 'blockThirdPartyCookies') { settings.cookiePolicy = value ? 'block-third-party' : 'allow'; reloadCookieGuards(); }
    saveSettings();
    sendState();
  });
  ipcMain.on('nacre:configure-proxy', async (event, payload) => {
    if (!isTrustedUIEvent(event)) return;
    try { await configureProxy(payload, true); }
    catch (error) { if (error.message) tell(error.message, 'warning'); else notify('toast.proxyEnableFailed', {}, 'warning'); }
  });
  ipcMain.on('nacre:disable-proxy', async (event) => {
    if (!isTrustedUIEvent(event)) return;
    return workspaceMutations.run(async () => {
    if (settings.torCountry || settings.proxy.enabled || !settings.directMode) {
      const language = settings.language;
      const confirmation = await dialog.showMessageBox(win, {
        type: 'warning', buttons: [translate('common.apply', language), translate('common.cancel', language)], defaultId: 1, cancelId: 1,
        title: translate('dialog.directMode.title', language),
        message: translate('dialog.directMode.message', language),
        detail: translate('dialog.directMode.detail', language), noLink: true
      });
      if (confirmation.response !== 0) return;
    }
    return identityLifecycle(async () => {
    try {
      await configureProxyImpl({}, false);
      settings.directMode = true;
      await waitForAll(browserSessions().map((ses) => setSessionProxy(ses, { mode: 'system' })));
      await waitForAll(browserSessions().map((ses) => ses.closeAllConnections().catch(() => {})));
      configureDnsForRoute(false);
      saveSettings();
      sendState();
    } catch (error) {
      // If the explicit system-route change fails, do not retain a direct-mode
      // preference that could affect a later navigation or restart.
      settings.directMode = false;
      settings.torCountry = '';
      for (const ses of browserSessions()) await setSessionProxy(ses, closedProxyConfig()).catch(() => {});
      saveSettings();
      if (error.message) tell(error.message, 'warning'); else notify('toast.directModeFailed', {}, 'warning');
      sendState();
    }
    });
    });
  });
  ipcMain.on('nacre:connect-tor', async (event, country) => {
    if (!isTrustedUIEvent(event)) return;
    try { await connectTor(country); }
    catch (error) { if (error.message) tell(error.message, 'warning'); else notify('toast.torConnectFailed', {}, 'warning'); }
  });
  ipcMain.on('nacre:choose-tor-country', (event, country) => {
    if (!isTrustedUIEvent(event)) return;
    try { chooseTorCountry(country); }
    catch (error) { tell(error.message, 'warning'); }
  });
}

function titleBarOverlayOptions() {
  const light = settings.theme === 'light' || (settings.theme === 'system' && !nativeTheme.shouldUseDarkColors);
  return {
    color: light ? '#dfe3e8' : settings.darkBackground || '#202124',
    symbolColor: light ? '#1d2228' : '#e8eaed',
    height: 40
  };
}

function updateTitleBarOverlay() {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try { win.setTitleBarOverlay(titleBarOverlayOptions()); } catch {}
}

nativeTheme.on('updated', updateTitleBarOverlay);

  app.on('certificate-error', (event, contents, url, error, _certificate, callback, isMainFrame) => {
    // Always reject Chromium certificate failures. The internal page explains
    // the failure but never offers a bypass or trusts the presented certificate.
    event.preventDefault();
    callback(false);
    if (!isMainFrame || !contents) return;
    const tab = tabByContentsId.get(contents.id);
    if (tab && !tab.internal) showNavigationError(tab, url, 'certificate:' + String(error || 'TLS'));
  });

function createWindow() {
  // The chrome and tabs already own WebContentsViews. A BrowserWindow here
  // would also allocate an unused, blank renderer for the native container.
  win = new BaseWindow({
    width: 1440,
    height: 960,
    minWidth: 920,
    minHeight: 680,
    show: false,
    backgroundColor: '#202124',
    icon: path.join(__dirname, 'icon.ico'),
    title: APP_NAME,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32'
      ? titleBarOverlayOptions()
      : undefined
  });
  updateTitleBarOverlay();
  chromeView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webgl: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  applyWebRTCIPPolicy(chromeView.webContents);
  // Transparent so a raised overlay shows the page underneath; the chrome
  // itself and the new tab page paint their own opaque backgrounds.
  chromeView.setBackgroundColor('#00000000');
  win.contentView.addChildView(chromeView);
  chromeViewOnTop = false;
  registerFrameLocaleOverrides(chromeView.webContents);
  chromeView.webContents.loadURL('nacre://app/');
  chromeView.webContents.on('did-finish-load', () => {
    win.show();
    if (settings.startupMode === 'pages' && settings.startupPages.length) {
      settings.startupPages.forEach((page, index) => createTab(page, false, index ? { background: true, deferred: true } : {}));
    } else createTab();
    applyLayout();
  });
  win.on('resize', applyLayout);
  win.on('closed', () => {
    // BaseWindow does not destroy child WebContents. Release them explicitly,
    // including on macOS where closing the window need not quit the app.
    for (const tab of tabs.values()) {
      const contents = tab.pageView?.webContents;
      if (contents && !contents.isDestroyed()) contents.close();
    }
    if (chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.close();
    win = null;
    chromeView = null;
    tabs.clear();
  });
}

app.setName(APP_NAME);
app.on('login', (event, contents, details, authInfo, callback) => {
  event.preventDefault();
  const proxy = settings.proxy;
  if (authInfo.isProxy) {
    if (!proxy.enabled || !proxy.encryptedPassword || !details.firstAuthAttempt || String(authInfo.host).toLowerCase() !== proxy.host || Number(authInfo.port) !== proxy.port) return callback();
    try { callback(proxy.username, safeStorage.decryptString(Buffer.from(proxy.encryptedPassword, 'base64'))); } catch { callback(); }
    return;
  }
  const tab = contents && !contents.isDestroyed() && tabByContentsId.get(contents.id);
  const url = safeURL(details.url);
  if (!tab || tab.internal || !url || !details.firstAuthAttempt || hostOf(url) !== String(authInfo.host).toLowerCase() || Number(authInfo.port) !== Number(new URL(url).port || (url.startsWith('https:') ? 443 : 80))) return callback();
  const origin = new URL(url).origin;
  const initialUrl = contents.getURL();
  if (new URL(tab.url).origin !== origin) return callback();
  promptHttpAuth({ BrowserWindow, ipcMain, parent: win, contents, url, realm: authInfo.realm, language: settings.language }).then(credentials => {
    if (!credentials || contents.isDestroyed() || contents.getURL() !== initialUrl) return callback();
    callback(credentials.username, credentials.password);
  }).catch(() => callback());
});
app.whenReady().then(async () => {
  profileVault = createProfileVault(app.getPath('userData'));
  if (!profileVault.isConfigured() && fs.existsSync(settingsPath()) && fs.statSync(settingsPath()).size <= 7_000_000 && isVaultEnvelope(fs.readFileSync(settingsPath(), 'utf8'))) {
    throw new Error('Missing vault key file. Protected settings have been preserved.');
  }
  if (profileVault.isConfigured()) {
    let message = 'Unlock your Nacre settings and bookmarks.';
    while (!profileVault.isUnlocked()) {
      const password = await promptVault({ BrowserWindow, ipcMain, message });
      if (password === null) { app.exit(0); return; }
      try { await profileVault.unlock(password); } catch { message = 'Unable to unlock. Check the password. Damaged vault data also causes this error.'; }
    }
  }
  const integrity = createProfileIntegrity(app.getPath('userData'), safeStorage);
  profileIntegrity = {
    ...integrity,
    open: (purpose, text) => integrity.open(purpose, VAULTED_PURPOSES.has(purpose) && profileVault.isConfigured() ? profileVault.open(purpose, text) : text),
    write: (file, purpose, data) => {
      if (!VAULTED_PURPOSES.has(purpose) || !profileVault.isConfigured()) return integrity.write(file, purpose, data);
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, profileVault.seal(purpose, integrity.seal(purpose, data)), { mode: 0o600 });
      fs.renameSync(temporary, file);
    }
  };
  await readSettings();
  siteIcons = createSiteIconStore({
    read: () => profileIntegrity.open('site-icons', fs.readFileSync(path.join(app.getPath('userData'), 'site-icons.json'), 'utf8')),
    write: (data) => profileIntegrity.write(path.join(app.getPath('userData'), 'site-icons.json'), 'site-icons', data)
  });
  siteIcons.retain(wantedIconHosts());
  const setupChoice = readStartupChoice(path.join(path.dirname(app.getPath('exe')), 'startup-choice.json'));
  settings = applyStartupRoute(applyStartupChoice(settings, setupChoice, systemSupportedLanguage()));
  saveSettings();
  protocol.handle('nacre', handleNacreRequest);
  for (const { workspaceId } of workspaceSessionEntries(settings.workspaces, settings.workspaceSessionPartitions)) {
    const ses = workspaceSession(workspaceId);
    registerNacreProtocolForSession(ses);
    addNetworkRules(ses);
  }
  try { await loadBlocker(false); }
  catch (error) { console.warn('Le moteur de filtres intégré ne peut pas être chargé.', error); }
  scheduleAdblockWeeklyUpdate();
  try { await prepareWorkspaceSessions(); }
  catch (error) {
    torStartupError = explainTorFailure(error.message, lastTorLog, settings.torBridgeMode);
    console.error(torStartupError, error.message, lastTorLog);
  }
  configureDnsForRoute(Boolean(settings.torCountry || settings.proxy.enabled));
  registerIPC();
  buildMenu();
  createWindow();
  startupGateActive = false;
  startTabSuspensionTimer();
  if (profileIntegrityWarning) dialog.showMessageBox(win, { type: 'warning', title: translate('profile.integrityTitle', settings.language), message: localizeText(profileIntegrityWarning, settings.language) }).catch(() => {});
  if (settings.torCountry) {
    const country = settings.torCountry;
    torConnectingCountry = country;
    startTor(country).then(async (runtime) => {
      const sessions = browserSessions();
      try {
        await waitForAll(sessions.map(async (ses) => setSessionProxy(ses, await torSessionProxyConfig(runtime, ses))));
      } catch (error) {
        await closeTorRuntime(runtime);
        throw error;
      }
      torRuntime = runtime;
      torStartupError = '';
      scheduleAdblockWeeklyUpdate();
      await waitForAll(sessions.map((ses) => ses.closeAllConnections().catch(() => {})));
      for (const tab of tabs.values()) {
        const url = torStartupResumeUrl(tab);
        tab.torResumeUrl = '';
        if (url && tab.pageView && !tab.pageView.webContents.isDestroyed()) navigateTab(tab, url);
      }
      notify('toast.torConnected', { country: countryName(country) });
      refreshSiteIcons();
      updateTorExitIp().catch((error) => console.warn('Adresse IP de sortie Tor non vérifiée.', error.message));
    }).catch((error) => {
      torStartupError = explainTorFailure(error.message, lastTorLog, settings.torBridgeMode);
      console.error(torStartupError, error.message, lastTorLog);
      tell(torStartupError, 'warning');
    }).finally(() => {
      torConnectingCountry = '';
      sendState();
    });
  }
  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(async () => {
  await dialog.showMessageBox({ type: 'error', title: 'Nacre profile', message: 'This profile could not be opened safely. Its files have been preserved. Restore a backup or choose another profile.' });
  app.exit(1);
});

app.on('before-quit', async (event) => {
  if (quittingAfterClear) return;
  event.preventDefault();
  quittingAfterClear = true;
  try {
    identityLifecycleBusy = true;
    await workspaceMutations.idle();
    await Promise.allSettled([...pendingTabCreations]);
    recentlyClosedTabs.length = 0;
    const sessions = browserSessions();
    await Promise.allSettled([...pendingSiteClears.values()]);
    for (const tab of tabs.values()) {
      forgetfulSites.remember(tab, tab.url, settings.forgetSiteOnClose);
      try { discardTabDocument(tab); } catch (error) { console.error('Could not close a document during cleanup.', error); }
    }
    const forgetOrigins = forgetfulSites.snapshot();
    for (const ses of sessions) { retiredSessions.add(ses); cancelIdentityDownloads(ses); }
    const attempt = async operation => {
      try { await operation(); } catch (error) { console.error('Session cleanup failed.', error); }
    };
    await Promise.allSettled(sessions.map(async ses => {
      await attempt(() => setSessionProxy(ses, closedProxyConfig()));
      await attempt(() => ses.closeAllConnections());
    }));
    const runtime = torRuntime;
    torRuntime = null;
    await attempt(() => closeTorRuntime(runtime));
    await attempt(() => stopIconTor());
    // "Forget on close" also applies when the application itself closes with
    // the site still open, not only when its last tab is closed by hand.
    for (const [ses, origins] of forgetOrigins) {
      await attempt(() => ses.clearData({
        dataTypes: ['cookies', 'cache', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'],
        origins: Array.from(origins), originMatchingMode: 'origin-in-all-contexts'
      }));
    }
    if (settings.clearOnQuit) {
      await Promise.allSettled(sessions.map(async ses => {
        // Trusted sites stay signed in; private sessions never keep anything.
        let keep = [];
        if (settings.trustedSites.length && workspaceIdentityForSession(ses)) {
          try { keep = trustedOrigins(settings.trustedSites, (await ses.cookies.get({})).map(cookie => cookie.domain), primaryDomain); } catch {}
        }
        await attempt(() => ses.clearData({ dataTypes: ['cookies', 'cache', 'indexedDB', 'localStorage', 'fileSystems', 'serviceWorkers', 'webSQL', 'backgroundFetch'], ...(keep.length ? { excludeOrigins: keep } : {}) }));
        await attempt(() => ses.clearAuthCache());
        await attempt(() => ses.flushStorageData());
        await attempt(() => ses.cookies.flushStore());
      }));
      downloads.clear();
    }
  } finally {
    profileVault?.lock();
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (!startupGateActive && process.platform !== 'darwin') app.quit();
});
