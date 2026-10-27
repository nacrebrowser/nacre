'use strict';

// Behavioral probe for Electron/Chromium fingerprinting surfaces. This script
// intentionally does not change Nacre's runtime policy. It compares stock
// Electron, Chromium feature switches, direct Blink runtime switches, and the
// current Nacre frame preloads in disposable sessions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.resolve(root, process.argv[2] || '.cache/security-051/stabilization-fingerprint');
if (!evidenceRoot.startsWith(path.join(root, '.cache') + path.sep)) throw new Error('Fingerprint evidence must stay in the workspace cache');
const fixtureRoot = path.join(evidenceRoot, 'fixture');
const resultsRoot = path.join(evidenceRoot, 'results');
fs.mkdirSync(fixtureRoot, { recursive: true });
fs.mkdirSync(resultsRoot, { recursive: true });

const scenarios = Object.freeze([
  { id: 'baseline', label: 'Stock Electron 44.9.0' },
  { id: 'canvas-noise-feature', label: 'Chromium CanvasNoise feature and regular-mode parameter' },
  { id: 'canvas-noise-feature-plus-blink', label: 'CanvasNoise plus direct CanvasInterventions Blink runtime feature' },
  { id: 'block-readback-feature', label: 'Chromium BlockCanvasReadback feature and regular-mode parameter' },
  { id: 'block-readback-blink', label: 'Direct BlockCanvasReadback Blink runtime feature' },
  { id: 'nacre-seed-a', label: 'Current Nacre preloads, fixed seed A' },
  { id: 'nacre-seed-b', label: 'Current Nacre preloads, fixed seed B' }
]);

const probeSource = String.raw`
'use strict';

const bytesOf = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

async function sha256(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function failure(error) {
  return { ok: false, name: error && error.name || 'Error', message: String(error && error.message || error) };
}

async function capture(operation, map = value => value) {
  try { return { ok: true, value: await map(await operation()) }; }
  catch (error) { return failure(error); }
}

function drawFingerprint(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#19324d');
  gradient.addColorStop(0.47, '#e0a15b');
  gradient.addColorStop(1, '#f6f0e5');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(21, 36, 51, .91)';
  context.font = '18px Arial, sans-serif';
  context.fillText('Nacre fingerprint 0.5.1 Δ', 7, 25);
  context.beginPath();
  context.arc(211.25, 37.75, 17.5, 0, Math.PI * 1.73);
  context.strokeStyle = '#7f2d54';
  context.lineWidth = 2.25;
  context.stroke();
  context.shadowColor = 'rgba(1, 2, 3, .35)';
  context.shadowBlur = 2.5;
  context.fillStyle = '#28755f';
  context.fillText('0123456789', 97.5, 51.5);
}

async function probeCanvas(kind) {
  const width = 256;
  const height = 64;
  const canvas = kind === 'html' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { available: false, reason: '2d context unavailable' };
  drawFingerprint(context, width, height);
  const imageData = await capture(
    () => context.getImageData(0, 0, width, height),
    async value => ({ sha256: await sha256(value.data), first16: [...value.data.slice(0, 16)] })
  );
  const result = { available: true, imageData };
  if (kind === 'html') {
    result.dataUrl = await capture(
      () => canvas.toDataURL('image/png'),
      value => ({ sha256: null, prefix: value.slice(0, 30), length: value.length, raw: value })
    );
    if (result.dataUrl.ok) {
      result.dataUrl.value.sha256 = await sha256(new TextEncoder().encode(result.dataUrl.value.raw));
      delete result.dataUrl.value.raw;
    }
    result.blob = await capture(
      () => new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('toBlob returned null')), 'image/png')),
      async value => ({ sha256: await sha256(await value.arrayBuffer()), size: value.size, type: value.type })
    );
  } else {
    result.blob = await capture(
      () => canvas.convertToBlob({ type: 'image/png' }),
      async value => ({ sha256: await sha256(await value.arrayBuffer()), size: value.size, type: value.type })
    );
  }
  return result;
}

async function probeAudio() {
  const result = {
    audioBufferType: typeof AudioBuffer,
    offlineAudioContextType: typeof OfflineAudioContext
  };
  if (typeof AudioBuffer === 'function') {
    result.buffer = await capture(async () => {
      const buffer = new AudioBuffer({ length: 512, sampleRate: 44100, numberOfChannels: 1 });
      const input = new Float32Array(512);
      for (let index = 0; index < input.length; index++) input[index] = Math.sin(index / 11) * 0.25;
      buffer.copyToChannel(input, 0);
      const copy = new Float32Array(512);
      buffer.copyFromChannel(copy, 0);
      const view = buffer.getChannelData(0);
      return {
        copySha256: await sha256(bytesOf(copy)),
        viewSha256: await sha256(bytesOf(view)),
        sameBytes: await sha256(bytesOf(copy)) === await sha256(bytesOf(view)),
        samples: [...view.slice(0, 8)]
      };
    });
  }
  if (typeof OfflineAudioContext === 'function') {
    result.offlineRender = await capture(async () => {
      const context = new OfflineAudioContext(1, 2048, 44100);
      const oscillator = context.createOscillator();
      const compressor = context.createDynamicsCompressor();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 987.654;
      compressor.threshold.value = -37;
      compressor.knee.value = 29;
      compressor.ratio.value = 11;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.19;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      const rendered = await context.startRendering();
      const channel = rendered.getChannelData(0);
      return { sha256: await sha256(bytesOf(channel)), samples: [...channel.slice(128, 136)] };
    });
  }
  return result;
}

async function probeWebGL(kind) {
  if (typeof OffscreenCanvas !== 'function' && kind === 'offscreen') return { available: false, reason: 'OffscreenCanvas unavailable' };
  const canvas = kind === 'html' ? document.createElement('canvas') : new OffscreenCanvas(16, 16);
  canvas.width = 16;
  canvas.height = 16;
  const typeResults = {};
  for (const type of ['webgl', 'webgl2']) {
    typeResults[type] = await capture(() => {
      const gl = canvas.getContext(type, { preserveDrawingBuffer: true });
      if (!gl) return { available: false };
      gl.clearColor(0.25, 0.5, 0.75, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixels = new Uint8Array(16 * 16 * 4);
      gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        available: true,
        pixels,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        debugVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        debugRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null
      };
    }, async value => value.available ? {
      available: true,
      sha256: await sha256(value.pixels),
      vendor: value.vendor,
      renderer: value.renderer,
      debugVendor: value.debugVendor,
      debugRenderer: value.debugRenderer
    } : value);
  }
  return typeResults;
}

async function runRealmProbe(realm) {
  const hasDocument = typeof document === 'object' && document;
  const result = {
    realm,
    secureContext: globalThis.isSecureContext,
    userAgent: navigator.userAgent,
    offscreenCanvasType: typeof OffscreenCanvas,
    htmlCanvas: hasDocument ? await probeCanvas('html') : null,
    offscreenCanvas: typeof OffscreenCanvas === 'function' ? await probeCanvas('offscreen') : null,
    audio: await probeAudio(),
    webgl: {
      html: hasDocument ? await probeWebGL('html') : null,
      offscreen: typeof OffscreenCanvas === 'function' ? await probeWebGL('offscreen') : null
    }
  };
  if (hasDocument) {
    result.nativeShape = {
      imageData: Function.prototype.toString.call(CanvasRenderingContext2D.prototype.getImageData),
      toDataURL: Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL),
      audioChannel: typeof AudioBuffer === 'function' ? Function.prototype.toString.call(AudioBuffer.prototype.getChannelData) : null,
      offscreenImageData: typeof OffscreenCanvasRenderingContext2D === 'function' ? Function.prototype.toString.call(OffscreenCanvasRenderingContext2D.prototype.getImageData) : null
    };
  }
  return result;
}

globalThis.runRealmProbe = runRealmProbe;
`;

const workerSource = String.raw`
importScripts('/probe.js');
self.onmessage = event => {
  event.waitUntil ? event.waitUntil(runRealmProbe('serviceWorker').then(value => event.ports[0].postMessage(value)))
    : runRealmProbe('dedicatedWorker').then(value => postMessage(value));
};
`;

const sharedWorkerSource = String.raw`
importScripts('/probe.js');
self.onconnect = event => {
  const port = event.ports[0];
  port.onmessage = () => runRealmProbe('sharedWorker').then(value => port.postMessage(value));
  port.start();
};
`;

const fixtureMain = String.raw`
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const os = require('node:os');

const scenario = process.env.NACRE_FP_SCENARIO;
const output = process.env.NACRE_FP_OUTPUT;
const root = process.env.NACRE_FP_ROOT;
const fixtureRoot = process.env.NACRE_FP_FIXTURE;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-fp-'));
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

if (scenario === 'canvas-noise-feature' || scenario === 'canvas-noise-feature-plus-blink') {
  app.commandLine.appendSwitch('enable-features', 'CanvasNoise:enable_in_regular_mode/true');
}
if (scenario === 'canvas-noise-feature-plus-blink') {
  app.commandLine.appendSwitch('enable-blink-features', 'CanvasInterventions');
}
if (scenario === 'block-readback-feature') {
  app.commandLine.appendSwitch('enable-features', 'BlockCanvasReadback:enable_in_regular_mode/true');
}
if (scenario === 'block-readback-blink') {
  app.commandLine.appendSwitch('enable-blink-features', 'BlockCanvasReadback');
}
if (scenario.startsWith('nacre-seed-')) {
  require(path.join(root, 'src', 'webgl-policy.cjs')).applyWebglDisablePolicy(app);
}

const send = (port, value) => { try { port.postMessage(value); } catch {} };

app.whenReady().then(async () => {
  const probeSource = fs.readFileSync(path.join(fixtureRoot, 'probe.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(fixtureRoot, 'worker.js'), 'utf8');
  const sharedWorkerSource = fs.readFileSync(path.join(fixtureRoot, 'shared-worker.js'), 'utf8');
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/probe.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(probeSource);
    }
    if (request.url === '/worker.js' || request.url === '/sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(workerSource);
    }
    if (request.url === '/shared-worker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(sharedWorkerSource);
    }
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/frame') return response.end('<!doctype html><meta charset="utf-8"><script src="/probe.js"></script>');
    response.end('<!doctype html><meta charset="utf-8"><iframe src="/frame"></iframe><script src="/probe.js"></script>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });

  const ses = session.fromPartition('fingerprint-native-' + scenario + '-' + process.pid, { cache: false });
  if (scenario.startsWith('nacre-seed-')) {
    const secret = scenario.endsWith('-a') ? 'native-verifier-seed-a' : 'native-verifier-seed-b';
    ipcMain.on('nacre:fingerprint-seed', event => { event.returnValue = { secret, metadata: null, webglMode: 'disabled' }; });
    ses.registerPreloadScript({ type: 'frame', filePath: path.join(root, 'src', 'webgl-guard-preload.cjs') });
    ses.registerPreloadScript({ type: 'frame', filePath: path.join(root, 'src', 'fingerprint-preload.cjs') });
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webgl: !scenario.startsWith('nacre-seed-')
    }
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  await win.loadURL(url);
  const rendererProbe = async () => {
    const timeout = (promise, label) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout')), 15000))
    ]);
    const frame = document.querySelector('iframe');
    if (!frame.contentWindow.runRealmProbe) await new Promise((resolve, reject) => {
      frame.addEventListener('load', resolve, { once: true });
      setTimeout(() => frame.contentWindow.runRealmProbe ? resolve() : reject(new Error('iframe probe timeout')), 5000);
    });
    const main = await runRealmProbe('window');
    const iframe = await frame.contentWindow.runRealmProbe('iframe');
    const dedicatedWorker = await timeout(new Promise((resolve, reject) => {
      const worker = new Worker('/worker.js');
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = reject;
      worker.postMessage('probe');
    }), 'dedicated worker');
    const sharedWorker = await timeout(new Promise((resolve, reject) => {
      const worker = new SharedWorker('/shared-worker.js');
      worker.port.onmessage = event => { worker.port.close(); resolve(event.data); };
      worker.onerror = reject;
      worker.port.start();
      worker.port.postMessage('probe');
    }), 'shared worker');
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const active = registration.active || registration.waiting || registration.installing;
    const serviceWorker = await timeout(new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => resolve(event.data);
      channel.port1.onmessageerror = reject;
      active.postMessage('probe', [channel.port2]);
    }), 'service worker');
    await registration.unregister();
    return { main, iframe, dedicatedWorker, sharedWorker, serviceWorker };
  };
  const result = await win.webContents.executeJavaScript('(' + rendererProbe.toString() + ')()');
  const report = {
    scenario,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    commandLine: process.argv,
    result
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  win.destroy();
  await new Promise(resolve => server.close(resolve));
  app.quit();
}).catch(error => {
  fs.writeFileSync(output, JSON.stringify({ scenario, error: error && error.stack || String(error) }, null, 2));
  app.exit(1);
});
`;

fs.writeFileSync(path.join(fixtureRoot, 'main.cjs'), fixtureMain, 'utf8');
fs.writeFileSync(path.join(fixtureRoot, 'probe.js'), probeSource, 'utf8');
fs.writeFileSync(path.join(fixtureRoot, 'worker.js'), workerSource, 'utf8');
fs.writeFileSync(path.join(fixtureRoot, 'shared-worker.js'), sharedWorkerSource, 'utf8');
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'nacre-fingerprint-native-fixture', version: '1.0.0', main: 'main.cjs' }, null, 2));

const electronBinary = require('electron');
const reports = {};
const runLog = [];

for (const scenario of scenarios) {
  const output = path.join(resultsRoot, scenario.id + '.json');
  const childEnv = {
    ...process.env,
    NACRE_FP_SCENARIO: scenario.id,
    NACRE_FP_OUTPUT: output,
    NACRE_FP_ROOT: root,
    NACRE_FP_FIXTURE: fixtureRoot
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(electronBinary, [fixtureRoot], {
    cwd: root,
    env: childEnv,
    windowsHide: true,
    encoding: 'utf8',
    timeout: Math.max(30_000, Number(process.env.NACRE_FP_NATIVE_TIMEOUT_MS) || 120_000),
    maxBuffer: 4 * 1024 * 1024
  });
  runLog.push({
    scenario: scenario.id,
    status: child.status,
    signal: child.signal,
    error: child.error ? { code: child.error.code, message: child.error.message } : null,
    stdout: child.stdout,
    stderr: child.stderr
  });
  if (!fs.existsSync(output)) {
    throw new Error(`${scenario.id}: Electron did not create ${output}; ${child.error && child.error.message || child.stderr || child.stdout || 'no diagnostics'}`);
  }
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  if (report.error) throw new Error(`${scenario.id}: ${report.error}`);
  if (child.status !== 0) throw new Error(`${scenario.id}: Electron exited with ${child.status}: ${child.stderr || child.stdout}`);
  reports[scenario.id] = report;
  console.log(`PASS collected ${scenario.id}`);
}

fs.writeFileSync(path.join(evidenceRoot, 'run-log.json'), JSON.stringify(runLog, null, 2));

const realms = Object.freeze(['main', 'iframe', 'dedicatedWorker', 'sharedWorker', 'serviceWorker']);
for (const report of Object.values(reports)) {
  assert.equal(report.electron, '44.9.0', `${report.scenario}: unexpected Electron version`);
  assert.equal(report.chrome, '152.0.7977.167', `${report.scenario}: unexpected Chromium version`);
  for (const realm of realms) assert.ok(report.result[realm], `${report.scenario}: missing ${realm}`);
}

const methodHash = (scenario, realm, surface, method) => {
  const value = reports[scenario].result[realm][surface]?.[method];
  if (!value || !value.ok) return null;
  return value.value.sha256 || value.value.copySha256 || null;
};
const webglAvailable = (scenario, realm, surface, version) =>
  reports[scenario].result[realm].webgl?.[surface]?.[version]?.ok === true &&
  reports[scenario].result[realm].webgl[surface][version].value.available === true;

const comparisons = [];
const compare = (label, left, right) => comparisons.push({ label, equal: left !== null && right !== null ? left === right : null, left, right });

for (const nativeScenario of ['canvas-noise-feature', 'canvas-noise-feature-plus-blink', 'block-readback-feature']) {
  for (const realm of realms) {
    compare(
      `${nativeScenario}/${realm}/offscreen/imageData vs baseline`,
      methodHash(nativeScenario, realm, 'offscreenCanvas', 'imageData'),
      methodHash('baseline', realm, 'offscreenCanvas', 'imageData')
    );
    compare(
      `${nativeScenario}/${realm}/offscreen/blob vs baseline`,
      methodHash(nativeScenario, realm, 'offscreenCanvas', 'blob'),
      methodHash('baseline', realm, 'offscreenCanvas', 'blob')
    );
  }
  for (const realm of ['main', 'iframe']) {
    compare(
      `${nativeScenario}/${realm}/html/imageData vs baseline`,
      methodHash(nativeScenario, realm, 'htmlCanvas', 'imageData'),
      methodHash('baseline', realm, 'htmlCanvas', 'imageData')
    );
    compare(
      `${nativeScenario}/${realm}/html/dataUrl vs baseline`,
      methodHash(nativeScenario, realm, 'htmlCanvas', 'dataUrl'),
      methodHash('baseline', realm, 'htmlCanvas', 'dataUrl')
    );
  }
}

const currentCoverage = [];
for (const realm of realms) {
  for (const method of ['imageData', 'blob']) {
    const baseline = methodHash('baseline', realm, 'offscreenCanvas', method);
    const seedA = methodHash('nacre-seed-a', realm, 'offscreenCanvas', method);
    const seedB = methodHash('nacre-seed-b', realm, 'offscreenCanvas', method);
    currentCoverage.push({ realm, surface: 'offscreenCanvas', method, baseline, seedA, seedB, unchangedFromBaseline: baseline !== null && baseline === seedA && seedA === seedB });
  }
}
for (const realm of ['main', 'iframe']) {
  for (const method of ['imageData', 'dataUrl', 'blob']) {
    const baseline = methodHash('baseline', realm, 'htmlCanvas', method);
    const seedA = methodHash('nacre-seed-a', realm, 'htmlCanvas', method);
    const seedB = methodHash('nacre-seed-b', realm, 'htmlCanvas', method);
    currentCoverage.push({ realm, surface: 'htmlCanvas', method, baseline, seedA, seedB, changedFromBaseline: baseline !== seedA, changesWithSeed: seedA !== seedB });
  }
}

const directBlock = {};
for (const realm of realms) {
  directBlock[realm] = {
    offscreenImageData: reports['block-readback-blink'].result[realm].offscreenCanvas?.imageData || null,
    offscreenBlob: reports['block-readback-blink'].result[realm].offscreenCanvas?.blob || null,
    htmlImageData: reports['block-readback-blink'].result[realm].htmlCanvas?.imageData || null,
    htmlDataUrl: reports['block-readback-blink'].result[realm].htmlCanvas?.dataUrl || null
  };
}

const audio = {};
for (const scenario of scenarios.map(value => value.id)) {
  audio[scenario] = {};
  for (const realm of realms) audio[scenario][realm] = reports[scenario].result[realm].audio;
}

const webgl = {};
for (const scenario of scenarios.map(value => value.id)) {
  webgl[scenario] = {};
  for (const realm of realms) {
    webgl[scenario][realm] = {
      htmlWebgl: realm === 'main' || realm === 'iframe' ? webglAvailable(scenario, realm, 'html', 'webgl') : null,
      offscreenWebgl: webglAvailable(scenario, realm, 'offscreen', 'webgl'),
      offscreenWebgl2: webglAvailable(scenario, realm, 'offscreen', 'webgl2')
    };
  }
}

const nativeFeatureComparisons = comparisons.filter(item => item.label.startsWith('canvas-noise-'));
const nativeCanvasNoiseChanged = nativeFeatureComparisons.some(item => item.equal === false);
const featureBlockComparisons = comparisons.filter(item => item.label.startsWith('block-readback-feature'));
const featureBlockChanged = featureBlockComparisons.some(item => item.equal === false) || Object.values(reports['block-readback-feature'].result).some(value => value.offscreenCanvas?.imageData?.ok === false);
const directBlockFailures = Object.values(directBlock).flatMap(value => Object.values(value)).filter(Boolean);
const directBlinkBlockActive = directBlockFailures.some(value => value.ok === false && value.name === 'NotAllowedError');
const offscreenBypassConfirmed = currentCoverage.filter(item => item.surface === 'offscreenCanvas').every(item => item.unchangedFromBaseline === true);
const htmlSeededProtectionObserved = currentCoverage.filter(item => item.surface === 'htmlCanvas').some(item => item.changedFromBaseline && item.changesWithSeed);
const currentWebglDisabledEverywhere = realms.every(realm => !webgl['nacre-seed-a'][realm].offscreenWebgl && !webgl['nacre-seed-a'][realm].offscreenWebgl2) && !webgl['nacre-seed-a'].main.htmlWebgl && !webgl['nacre-seed-a'].iframe.htmlWebgl;

const summary = {
  generatedAt: new Date().toISOString(),
  versions: { electron: reports.baseline.electron, chromium: reports.baseline.chrome },
  scenarios,
  conclusions: {
    chromiumCanvasNoiseSwitchChangedBehavior: nativeCanvasNoiseChanged,
    chromiumBlockReadbackSwitchChangedBehavior: featureBlockChanged,
    directBlinkBlockReadbackActive: directBlinkBlockActive,
    currentHtmlCanvasSeededProtectionObserved: htmlSeededProtectionObserved,
    currentOffscreenCanvasBypassConfirmed: offscreenBypassConfirmed,
    currentWebglDisabledInAllProbedRealms: currentWebglDisabledEverywhere,
    nativeCanvasNoiseSafeToEnableInProduction: false,
    reason: nativeCanvasNoiseChanged
      ? 'Behavior changed in this build; policy, stability, origin scoping and uniqueness still require review before production.'
      : 'CanvasNoise command-line activation produced no behavioral change in Electron 44.9.0, even with CanvasInterventions enabled directly.',
    recommendation: directBlinkBlockActive
      ? 'Do not ship direct BlockCanvasReadback as an anti-fingerprinting substitute: it is a globally detectable API failure and causes broad canvas breakage. Keep S07 explicitly open; a coherent fix requires Electron embedder support or an engine patch plus cross-context and population-level validation.'
      : 'Keep S07 explicitly open. No effective native canvas intervention was demonstrated in this Electron build.'
  },
  comparisons,
  currentCoverage,
  directBlock,
  audio,
  webgl,
  evidence: scenarios.map(value => path.relative(root, path.join(resultsRoot, value.id + '.json')).replaceAll('\\', '/'))
};

fs.writeFileSync(path.join(evidenceRoot, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(evidenceRoot, 'report.json'), JSON.stringify(reports, null, 2));

console.log(JSON.stringify({
  status: 'PASS',
  versions: summary.versions,
  conclusions: summary.conclusions,
  evidence: path.relative(root, evidenceRoot).replaceAll('\\', '/')
}, null, 2));
