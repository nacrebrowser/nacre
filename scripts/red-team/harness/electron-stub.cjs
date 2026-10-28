'use strict';

// Dev-only red-team harness (never packaged). It loads the real src/main.cjs
// with a recording stub substituted for the `electron` module, then runs the
// real startup path (whenReady -> registerIPC -> createWindow). Nothing here
// touches the network: the ad-block engine is replaced by a stub that fails
// closed, and net.fetch reads only local files under src/.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { fileURLToPath } = require('node:url');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const MAIN = path.join(SRC, 'main.cjs');

// Each harness gets a throwaway profile (with, on Linux, a ~65 MB Tor
// runtime copy). They are removed when this test process exits, and folders
// left by interrupted runs are purged once they are an hour old (younger ones
// may belong to test files running in parallel).
const SCRATCH_DIRECTORIES = new Set();
const STALE_SCRATCH_MS = 60 * 60 * 1000;
function trackScratch(directory) {
  if (SCRATCH_DIRECTORIES.size === 0) {
    process.once('exit', () => { for (const item of SCRATCH_DIRECTORIES) fs.rmSync(item, { recursive: true, force: true, maxRetries: 3 }); });
    const parent = path.dirname(directory);
    for (const entry of fs.readdirSync(parent)) {
      const old = path.join(parent, entry);
      try { if (entry.startsWith('nacre-harness-') && Date.now() - fs.statSync(old).mtimeMs > STALE_SCRATCH_MS) fs.rmSync(old, { recursive: true, force: true }); } catch {}
    }
  }
  SCRATCH_DIRECTORIES.add(directory);
  return directory;
}

// Calls that perform a real-world action. Any of these made during an attack
// is recorded as a side effect.
const DANGEROUS = new Set([
  'openExternal', 'openPath', 'loadURL', 'loadFile', 'downloadURL',
  'executeJavaScript', 'setProxy', 'showOpenDialog', 'showSaveDialog',
  'writeText', 'writeImage', 'quit', 'relaunch', 'clearStorageData',
  'clearCache', 'openDevTools', 'inspectElement'
]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.cjs': 'text/javascript', '.json': 'application/json' };

// Electron exposes the bundled Chromium version on process.versions; plain Node does not.
// Set a placeholder so startup code that builds a user agent can run.
if (!process.versions.chrome) {
  Object.defineProperty(process.versions, 'chrome', { value: '130.0.6723.91', configurable: true, enumerable: true });
}

function createHarness() {
  const effects = [];
  const sends = [];
  const netFetched = [];
  const ipcHandlers = new Map();
  const appListeners = new Map();
  const views = [];
  const windows = [];
  const protocolHandlers = [];
  const scratch = path.resolve(SRC, '..', '.cache', 'headless-tests');
  fs.mkdirSync(scratch, { recursive: true });
  const state = { userData: trackScratch(fs.mkdtempSync(path.join(scratch, 'nacre-harness-'))), startup: null, dialogResult: null };
  let nextId = 1;

  const rec = (owner, method, args) => {
    if (DANGEROUS.has(method)) effects.push({ owner, method, args });
  };

  // Fallback for any Electron member not modelled explicitly: records dangerous
  // calls and returns a resolved promise so `.catch` and `await` keep working.
  function withFallback(owner, members) {
    return new Proxy(members, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') return undefined;
        return (...args) => { rec(owner, prop, args); return Promise.resolve(undefined); };
      }
    });
  }

  function makeContents(ses) {
    const listeners = new Map();
    const frame = { url: 'about:blank', parent: null, isDestroyed: () => false };
    frame.top = frame;
    const raw = {
      id: nextId++,
      listeners,
      mainFrame: frame,
      // Electron's webContents.session is the session the view was created with.
      session: ses || defaultSession,
      isDestroyed: () => false,
      getURL: () => frame.url,
      // Electron 44 moves history navigation to webContents.navigationHistory.
      navigationHistory: withFallback('navigationHistory', { canGoBack: () => false, canGoForward: () => false }),
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); return this; },
      once(event, fn) { return this.on(event, fn); },
      setWindowOpenHandler(handler) { raw.windowOpenHandler = handler; },
      send(channel, ...args) { sends.push({ channel, args }); },
      setWebRTCIPHandlingPolicy() {},
      loadURL(url) {
        rec('webContents', 'loadURL', [url]);
        // Electron emits did-finish-load once the chrome page is up; startup creates the first tab there.
        if (String(url).startsWith('nacre://app/') && !raw.chromeLoaded) {
          raw.chromeLoaded = true;
          setImmediate(() => { for (const fn of listeners.get('did-finish-load') || []) fn(); });
        }
        return Promise.resolve();
      },
      loadFile(file) { rec('webContents', 'loadFile', [file]); return Promise.resolve(); },
      downloadURL(url) { rec('webContents', 'downloadURL', [url]); }
    };
    const contents = withFallback('webContents', raw);
    // Electron emits app 'web-contents-created' for every WebContents; main.cjs attaches its navigation policy there.
    for (const fn of appListeners.get('web-contents-created') || []) fn({}, contents);
    return contents;
  }

  function WebContentsView(options) {
    const webPreferences = options && options.webPreferences;
    const view = withFallback('WebContentsView', { webContents: makeContents(webPreferences && webPreferences.session), setBounds() {}, setVisible() {} });
    views.push(view);
    return view;
  }

  function makeWindow(hasContents) {
    const win = withFallback('BrowserWindow', {
      ...(hasContents ? { webContents: makeContents() } : {}),
      contentView: withFallback('contentView', { addChildView() {}, removeChildView() {} }),
      getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 960 }),
      getContentSize: () => [1440, 960],
      isDestroyed: () => false,
      on() {},
      // Electron fires ready-to-show once the window is shown; startup creates the first tab there.
      once(event, fn) { if (event === 'ready-to-show') queueMicrotask(fn); },
      setTitleBarOverlay() {}, setTitle() {}
    });
    windows.push(win);
    return win;
  }
  function BrowserWindow() { return makeWindow(true); }
  function BaseWindow() { return makeWindow(false); }
  BaseWindow.getAllWindows = () => windows;
  BrowserWindow.getAllWindows = () => windows;
  BrowserWindow.fromWebContents = () => null;

  function makeSession() {
    return withFallback('session', {
      cookies: Object.assign(new (require('node:events').EventEmitter)(), { remove: async () => {} }),
      protocol: withFallback('session.protocol', {
        handle(scheme, fn) { if (scheme === 'nacre') protocolHandlers.push(fn); }
      }),
      webRequest: withFallback('webRequest', {
        onBeforeRequest(_filter, handler) { this.beforeRequest = handler; },
        onBeforeSendHeaders(_filter, handler) { this.beforeSendHeaders = handler; },
        onHeadersReceived(_filter, handler) { this.headersReceived = handler; }
      }),
      setProxy(config) { rec('session', 'setProxy', [config]); return Promise.resolve(); },
      setUserAgent() {},
      // Electron returns an id for each preload it registers; main.cjs passes it back to unregister.
      registerPreloadScript() { return `preload-${nextId++}`; },
      unregisterPreloadScript() {},
      setSpellCheckerEnabled() {},
      setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler; },
      setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler; },
      setCertificateVerifyProc() {}
    });
  }
  const sessions = new Map();
  const defaultSession = makeSession();

  const electron = {
    app: withFallback('app', {
      getPath: (name) => ({ userData: state.userData, appData: state.userData, exe: process.execPath, downloads: path.join(state.userData, 'downloads'), home: state.userData })[name] || state.userData,
      getVersion: () => '0.5.0',
      getName: () => 'Nacre',
      isPackaged: false,
      enableSandbox() {},
      setPath(name, value) { if (name === 'userData') state.userData = value; },
      setName() {},
      commandLine: withFallback('commandLine', { appendSwitch() {} }),
      on(event, fn) { if (!appListeners.has(event)) appListeners.set(event, []); appListeners.get(event).push(fn); },
      whenReady() {
        return { then(cb) { state.startup = Promise.resolve().then(cb); return state.startup; } };
      },
      quit() { rec('app', 'quit', []); },
      relaunch() { rec('app', 'relaunch', []); }
    }),
    protocol: withFallback('protocol', {
      registerSchemesAsPrivileged() {},
      handle(scheme, fn) { if (scheme === 'nacre') protocolHandlers.push(fn); }
    }),
    session: withFallback('sessionModule', {
      fromPartition(name) {
        if (!sessions.has(name)) sessions.set(name, makeSession());
        return sessions.get(name);
      },
      defaultSession
    }),
    ipcMain: withFallback('ipcMain', {
      handle(channel, fn) { ipcHandlers.set(channel, { kind: 'handle', fn }); },
      on(channel, fn) { ipcHandlers.set(channel, { kind: 'on', fn }); },
      removeHandler() {}
    }),
    BrowserWindow,
    BaseWindow,
    WebContentsView,
    Menu: withFallback('Menu', { buildFromTemplate: () => withFallback('menu', { popup() {} }) }),
    dialog: withFallback('dialog', {
      // Answer like a user who presses Cancel (cancelId 1 in the app's own confirm dialogs).
      showMessageBox(_win, options) { rec('dialog', 'showMessageBox', [options]); return Promise.resolve({ response: 1, checkboxChecked: false }); },
      // A user who presses Cancel: Electron resolves { canceled: true, filePath: undefined }.
      showSaveDialog(_win, options) { rec('dialog', 'showSaveDialog', [options]); return Promise.resolve({ canceled: true, filePath: undefined }); },
      showOpenDialog(_win, options) {
        rec('dialog', 'showOpenDialog', [options]);
        return Promise.resolve(state.dialogResult || { canceled: true, filePaths: [] });
      }
    }),
    // Deterministic test double only; production uses the OS-backed safeStorage.
    safeStorage: withFallback('safeStorage', { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test', encryptString: value => Buffer.from(value), decryptString: value => value.toString() }),
    net: withFallback('net', {
      fetch(url) {
        netFetched.push(String(url));
        try {
          const file = fileURLToPath(String(url));
          const body = fs.readFileSync(file);
          return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } }));
        } catch (error) { return Promise.reject(error); }
      }
    }),
    clipboard: withFallback('clipboard', {}),
    nativeImage: withFallback('nativeImage', { createFromBuffer: () => withFallback('image', { isEmpty: () => true }) }),
    nativeTheme: withFallback('nativeTheme', { shouldUseDarkColors: false }),
    shell: withFallback('shell', {
      openExternal(url) { rec('shell', 'openExternal', [url]); return Promise.resolve(); },
      openPath(target) { rec('shell', 'openPath', [target]); return Promise.resolve(''); }
    })
  };

  // The ad-block engine needs network lists. Fail closed here so startup
  // continues without an engine and nothing is downloaded.
  const blocker = {
    ElectronBlocker: {
      fromPrebuiltAdsAndTracking: () => Promise.reject(new Error('harness: ad-block engine disabled (no network)')),
      fromPrebuiltAdsOnly: () => Promise.reject(new Error('harness: ad-block engine disabled (no network)')),
      fromLists: () => Promise.reject(new Error('harness: ad-block engine disabled (no network)')),
      deserialize: () => Promise.reject(new Error('harness: ad-block engine disabled (no network)'))
    },
    fromElectronDetails: () => ({})
  };

  return {
    effects, sends, netFetched, ipcHandlers, appListeners, views, windows, protocolHandlers, state, electron, blocker,
    newContents(url) { const contents = makeContents(); contents.mainFrame.url = url; return contents; },
    get startup() { return state.startup; },
    get chrome() { return views[0] && views[0].webContents; },
    emitApp(event, ...args) { for (const fn of appListeners.get(event) || []) fn(...args); },
    fire(contents, event, ...args) { for (const fn of contents.listeners.get(event) || []) fn(...args); },
    protocolHandler() { return protocolHandlers[protocolHandlers.length - 1]; }
  };
}

// Any real network or process launch made by the code under test is recorded as
// a side effect and refused. Only the test's own process is affected.
function guardHostEffects(record) {
  const block = (owner) => () => {
    record(owner, 'blocked', []);
    throw new Error(`harness: ${owner} blocked (no network or process launch in red-team runs)`);
  };
  for (const name of ['node:https', 'node:http']) {
    const mod = require(name);
    mod.request = block(name);
    mod.get = block(name);
  }
  const net = require('node:net');
  net.connect = block('node:net.connect');
  net.createConnection = block('node:net.createConnection');
  require('node:tls').connect = block('node:tls.connect');
  const cp = require('node:child_process');
  for (const fn of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[fn] = block(`child_process.${fn}`);
}

// Loads src/main.cjs once with the stubs in place and returns the harness after
// the real whenReady callback has finished (registerIPC and createWindow run).
async function loadMainHeadless(options = {}) {
  const harness = createHarness();
  if (options.startupChoice) {
    const getPath = harness.electron.app.getPath;
    harness.electron.app.getPath = name => name === 'exe' ? path.join(harness.state.userData, 'Nacre.exe') : getPath(name);
    fs.writeFileSync(path.join(harness.state.userData, 'startup-choice.json'), JSON.stringify(options.startupChoice));
  }
  if (options.legacySettings) {
    fs.writeFileSync(path.join(harness.state.userData, 'settings.json'), JSON.stringify(options.legacySettings));
    if (options.existingIntegrityKey) require('../../../src/profile-integrity.cjs').createProfileIntegrity(harness.state.userData, harness.electron.safeStorage).seal('test', {});
    harness.state.migrationDialogs = [];
    harness.electron.dialog.showMessageBox = (parent, settings) => {
      harness.state.migrationDialogs.push(settings || parent);
      return Promise.resolve({ response: options.importLegacy ? 0 : 1 });
    };
  }
  guardHostEffects((owner, method, args) => harness.effects.push({ owner, method, args }));
  const stubs = { electron: harness.electron, '@ghostery/adblocker-electron': harness.blocker };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, ...rest);
  };
  // Timers created during startup (ad-block weekly schedule) must not keep the test process alive.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...args) => { const timer = realSetTimeout(fn, ms, ...args); if (timer && timer.unref) timer.unref(); return timer; };
  try {
    delete require.cache[require.resolve(MAIN)];
    require(MAIN);
  } finally {
    global.setTimeout = realSetTimeout;
    Module._load = originalLoad;
  }
  await harness.startup;
  // did-finish-load fires on the next tick and the first tab is created after async session setup.
  for (let i = 0; i < 500 && harness.views.length < 2; i++) await new Promise((resolve) => setImmediate(resolve));
  if (harness.views.length < 2) throw new Error('harness: first tab was not created after startup');
  harness.chrome.mainFrame.url = 'nacre://app/';
  harness.effects.length = 0;
  harness.sends.length = 0;
  return harness;
}

module.exports = { loadMainHeadless, DANGEROUS, MAIN };
