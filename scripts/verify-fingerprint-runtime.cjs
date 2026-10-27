'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { launch } = require('./test-support/electron-fixture.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.NACRE_FINGERPRINT_OUTPUT || path.join(root, '.cache', 'audit-remediation', 'fingerprint-runtime-after.json'));
const cacheRoot = path.join(root, '.cache', 'fingerprint-runtime'); fs.mkdirSync(cacheRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cacheRoot, 'run-'));
const timeoutMs = Math.max(20_000, Number(process.env.NACRE_FINGERPRINT_TIMEOUT_MS) || 90_000);

const fixtureMain = String.raw`
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');
const Module = require('node:module');
const root = process.env.NACRE_PROJECT_ROOT;
const profile = process.env.NACRE_FINGERPRINT_PROFILE;
const output = process.env.NACRE_FINGERPRINT_REPORT;
const antiFingerprintEnabled = process.env.NACRE_FINGERPRINT_ENABLED === '1';
if (!root || !profile || !output) throw new Error('The runtime fixture requires explicit project, profile and report paths.');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('appData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.commandLine.appendSwitch('user-data-dir', profile);
app.commandLine.appendSwitch('lang', 'en-US');
process.env.TZ = 'UTC';

const realmProbe = async function realmProbe(kind) {
  const nav = globalThis.navigator;
  const timezoneParts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', timeZoneName: 'long' }).formatToParts(new Date(0));
  const timezoneName = timezoneParts.find((part) => part.type === 'timeZoneName')?.value || null;
  const width = 257;
  const height = 129;
  const expectedPixel = (x, y) => [64 + ((x * 3 + y * 5) % 127), 40 + ((x * 7 + y * 11) % 127), 20 + ((x * 13 + y * 19) % 127), 255];
  const toBase64 = (bytes) => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    return btoa(binary);
  };
  const canvasMeasurement = async () => {
    if (typeof OffscreenCanvas !== 'function') return { available: false, reason: 'OffscreenCanvas unavailable' };
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { available: false, reason: 'OffscreenCanvas 2D context unavailable', width, height };
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        image.data.set(expectedPixel(x, y), offset);
      }
    }
    context.putImageData(image, 0, 0);
    const read = context.getImageData(0, 0, width, height).data;
    const readRgbaBase64 = toBase64(read);
    if (typeof canvas.convertToBlob !== 'function') return { available: true, width, height, readRgbaBase64, exportAvailable: false, exportReason: 'convertToBlob unavailable' };
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const png = new Uint8Array(await blob.arrayBuffer());
    return { available: true, width, height, readRgbaBase64, exportAvailable: true, exportType: blob.type, exportPngBase64: toBase64(png) };
  };
  const webgl = (() => {
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : null);
      if (!canvas) return null;
      return Boolean(canvas.getContext('webgl'));
    } catch { return null; }
  })();
  const result = {
    kind,
    href: globalThis.location?.href || null,
    isTopFrame: typeof window === 'undefined' ? null : window === window.top,
    ua: nav.userAgent,
    language: nav.language,
    languages: [...nav.languages],
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneName: timezoneName,
    localDate: new Date(2026, 0, 2, 13, 4).toLocaleString(),
    date: new Date(0).toString(),
    offset: new Date().getTimezoneOffset(),
    webgl,
    offscreenCanvas2d: await canvasMeasurement()
  };
  if (typeof document !== 'undefined') {
    result.plugins = [...(nav.plugins || [])].map((plugin) => ({ name: plugin.name, filename: plugin.filename, description: plugin.description, types: [...plugin].map((mime) => ({ type: mime.type, suffixes: mime.suffixes, description: mime.description })) }));
    result.mimeTypes = [...(nav.mimeTypes || [])].map((mime) => ({ type: mime.type, suffixes: mime.suffixes, description: mime.description, plugin: mime.enabledPlugin?.name || null }));
    result.pdfViewerEnabled = nav.pdfViewerEnabled;
  }
  return result;
};

const rendererProbe = async () => {
  const result = await window.__nacreRealmProbe('page');
  if (navigator.userAgentData) {
    result.brands = navigator.userAgentData.brands;
    result.formFactors = navigator.userAgentData.formFactors || null;
    const high = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness', 'formFactors']);
    result.highBrands = high.fullVersionList;
    result.highFormFactors = high.formFactors;
  } else {
    result.brands = null;
    result.formFactors = null;
    result.highBrands = null;
    result.highFormFactors = null;
  }
  const workerProbeSource = '(' + window.__nacreRealmProbe.toString() + ')';
  const workerCode = 'const probe=' + workerProbeSource + ';onmessage=async()=>{try{postMessage(await probe("dedicatedWorker"));}catch(error){postMessage({probeError:String(error)});}}';
  result.worker = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const timer = setTimeout(() => reject(new Error('dedicated worker timeout')), 10_000);
    worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve(event.data); };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); reject(new Error(event.message || 'dedicated worker error')); };
    worker.postMessage('measure');
  });

  const sharedWorkerCode = 'const probe=' + workerProbeSource + ';onconnect=event=>{const port=event.ports[0];port.onmessage=async()=>{try{port.postMessage(await probe("sharedWorker"));}catch(error){port.postMessage({probeError:String(error)});}};port.start();};';
  result.sharedWorker = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([sharedWorkerCode], { type: 'text/javascript' }));
    const worker = new SharedWorker(url);
    const timer = setTimeout(() => reject(new Error('shared worker timeout')), 10_000);
    worker.port.onmessage = (event) => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(event.data); };
    worker.port.onmessageerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error('shared worker message decode error')); };
    worker.port.start();
    worker.port.postMessage('measure');
  });

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const serviceWorker = registration.active || registration.waiting || registration.installing;
  if (!serviceWorker) throw new Error('No active service worker was available for measurement.');
  result.serviceWorker = await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('service worker timeout')), 10_000);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); channel.port1.close(); };
    serviceWorker.postMessage('measure', [channel.port2]);
  });
  return result;
};

const enabled = process.env.NACRE_FINGERPRINT_ENABLED === '1';
let capturedHeaders = null;
const server = http.createServer((request, response) => {
  capturedHeaders ||= request.headers;
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/frame-same' || pathname === '/frame-cross') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.end('<!doctype html><meta charset="utf-8"><p>frame fixture</p>');
  }
  if (pathname === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    const source = 'const probe=(' + realmProbe.toString() + ');self.addEventListener("message",async event=>{if(!event.ports||!event.ports[0])return;try{event.ports[0].postMessage(await probe("serviceWorker"));}catch(error){event.ports[0].postMessage({probeError:String(error)});}});';
    return response.end(source);
  }
  if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const probe = '<script>window.__nacreRealmProbe=' + realmProbe.toString() + ';</script>';
  const port = server.address().port;
  response.end('<!doctype html><meta charset="utf-8"><iframe src="/frame-same"></iframe><iframe src="http://b.test:' + port + '/frame-cross"></iframe>' + probe + '<p>runtime probe</p>');
});

app.commandLine.appendSwitch('lang', 'en-US');
app.commandLine.appendSwitch('user-data-dir', profile);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1, EXCLUDE 127.0.0.1');
BrowserWindow.prototype.show = function hideFixtureChrome() {};
app.whenReady().then(() => {
  const profileIntegrity = require(path.join(root, 'src/profile-integrity.cjs')).createProfileIntegrity(profile, safeStorage);
  profileIntegrity.write(path.join(profile, 'settings.json'), 'settings', {
    directMode: true,
    torCountry: '',
    httpsOnly: false,
    clearOnQuit: false,
    adBlockEnabled: false,
    antiFingerprint: enabled,
    cookiePolicy: 'allow',
    language: 'en'
  });
});
const mainPath = path.join(root, 'src/main.cjs');
const mainModule = new Module(mainPath, module);
mainModule.filename = mainPath;
mainModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
// The real main owns frame-locale setup (registerFrameLocaleOverrides(win.webContents)); this fixture does not register a competing handler.
mainModule._compile(fs.readFileSync(mainPath, 'utf8') + '\nmodule.exports={tabs,createTab,closeTab,navigateTab,snapshot,browserSessions,settings:()=>settings,chrome:()=>chromeView};', mainPath);
const nacre = mainModule.exports;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(check, label) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return;
    await wait(20);
  }
  throw new Error('Timed out waiting for ' + label);
}
app.whenReady().then(async () => {
  await until(() => nacre.chrome() && nacre.tabs.size, 'Nacre startup');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const tabId = await nacre.createTab(origin + '/', false);
  const tab = nacre.tabs.get(tabId);
  if (!tab?.pageView?.webContents) throw new Error('Nacre did not create a page WebContents for the runtime fixture.');
  const contents = tab.pageView.webContents;
  await until(() => !contents.isLoading() && contents.getURL() === origin + '/', 'Nacre test page');
  const result = await contents.executeJavaScript('(' + rendererProbe.toString() + ')()');
  await until(() => {
    const urls = contents.mainFrame.framesInSubtree.map((frame) => frame.url);
    return urls.some((url) => url.endsWith('/frame-same')) && urls.some((url) => url.endsWith('/frame-cross'));
  }, 'same-origin and cross-origin subframes');
  const frames = contents.mainFrame.framesInSubtree;
  const sameOriginFrame = frames.find((frame) => frame.url.endsWith('/frame-same'));
  const crossOriginFrame = frames.find((frame) => frame.url.endsWith('/frame-cross'));
  const frameProbe = (frame, kind) => frame.executeJavaScript('(' + realmProbe.toString() + ')(' + JSON.stringify(kind) + ')');
  result.sameOriginFrame = await frameProbe(sameOriginFrame, 'sameOriginFrame');
  result.crossOriginFrame = await frameProbe(crossOriginFrame, 'crossOriginFrame');
  result.iframe = result.sameOriginFrame;
  result.frameUrls = { sameOrigin: sameOriginFrame.url, crossOrigin: crossOriginFrame.url };
  await new Promise((resolve) => setTimeout(resolve, 200));
  const report = {
    result,
    requestHeaders: capturedHeaders,
    chrome: process.versions.chrome,
    antiFingerprintEnabled: Boolean(nacre.settings().antiFingerprint),
    userDataExplicit: path.resolve(app.getPath('userData')) === path.resolve(profile),
    measurementSource: 'real Nacre main.cjs, createTab WebContents, and main-owned preload/IPC registration'
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  await nacre.closeTab(tabId, { discard: true });
  await new Promise((resolve) => server.close(resolve));
  app.quit();
}).catch(async (error) => {
  try { fs.writeFileSync(output, JSON.stringify({ error: error.stack || String(error), antiFingerprintEnabled: enabled, userDataExplicit: path.resolve(app.getPath('userData')) === path.resolve(profile) }, null, 2)); } catch {}
  try { server.close(); } catch {}
  app.exit(1);
});
`;

function expectedPixel(x, y) {
  return [64 + ((x * 3 + y * 5) % 127), 40 + ((x * 7 + y * 11) % 127), 20 + ((x * 13 + y * 19) % 127), 255];
}

function analyzeRgba(pixels, width, height) {
  if (pixels.length !== width * height * 4) throw new Error(`RGBA pixel length mismatch: ${pixels.length}`);
  let changedPixels = 0;
  let changedBeyond64 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const expected = expectedPixel(x, y);
      const changed = pixels[offset] !== expected[0] || pixels[offset + 1] !== expected[1] || pixels[offset + 2] !== expected[2] || pixels[offset + 3] !== expected[3];
      if (changed) {
        changedPixels++;
        if (x >= 64 || y >= 64) changedBeyond64++;
      }
    }
  }
  const points = [[0, 0], [63, 63], [64, 64], [65, 65], [128, 100], [256, 128]];
  const samples = points.map(([x, y]) => {
    const offset = (y * width + x) * 4;
    return { x, y, actual: [...pixels.subarray(offset, offset + 4)], expected: expectedPixel(x, y) };
  });
  return { decoded: true, width, height, changedPixels, changedBeyond64, samplePoints: samples };
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodePngRgba(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 8 || !png.subarray(0, 8).equals(signature)) throw new Error('Canvas export was not a PNG image.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const imageChunks = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error('Truncated PNG chunk.');
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') imageChunks.push(data);
    else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) throw new Error(`Unsupported PNG layout: ${width}x${height}, depth ${bitDepth}, interlace ${interlace}.`);
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}.`);
  const bytesPerRow = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(imageChunks));
  if (inflated.length !== height * (bytesPerRow + 1)) throw new Error('Unexpected PNG decompressed byte length.');
  const raw = Buffer.alloc(height * bytesPerRow);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++];
    const rowOffset = y * bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const value = inflated[sourceOffset++];
      const left = x >= channels ? raw[rowOffset + x - channels] : 0;
      const above = y > 0 ? raw[rowOffset + x - bytesPerRow] : 0;
      const upperLeft = y > 0 && x >= channels ? raw[rowOffset + x - bytesPerRow - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}.`);
      raw[rowOffset + x] = (value + predictor) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const input = pixel * channels;
    const outputOffset = pixel * 4;
    if (colorType === 6) raw.copy(rgba, outputOffset, input, input + 4);
    else if (colorType === 2) {
      rgba[outputOffset] = raw[input]; rgba[outputOffset + 1] = raw[input + 1]; rgba[outputOffset + 2] = raw[input + 2]; rgba[outputOffset + 3] = 255;
    } else if (colorType === 0) {
      rgba[outputOffset] = raw[input]; rgba[outputOffset + 1] = raw[input]; rgba[outputOffset + 2] = raw[input]; rgba[outputOffset + 3] = 255;
    } else if (colorType === 4) {
      rgba[outputOffset] = raw[input]; rgba[outputOffset + 1] = raw[input]; rgba[outputOffset + 2] = raw[input]; rgba[outputOffset + 3] = raw[input + 1];
    } else {
      const paletteOffset = raw[input] * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw new Error('PNG palette index is invalid.');
      rgba[outputOffset] = palette[paletteOffset]; rgba[outputOffset + 1] = palette[paletteOffset + 1]; rgba[outputOffset + 2] = palette[paletteOffset + 2];
      rgba[outputOffset + 3] = transparency && raw[input] < transparency.length ? transparency[raw[input]] : 255;
    }
  }
  return { width, height, rgba };
}

function analyzeCanvas(realm) {
  if (!realm || realm.probeError) throw new Error(`Realm measurement failed: ${realm?.probeError || 'no result'}`);
  const measurement = realm.offscreenCanvas2d;
  if (!measurement?.available) return { available: false, reason: measurement?.reason || '2D OffscreenCanvas unavailable' };
  const { width, height } = measurement;
  const readPixels = Buffer.from(measurement.readRgbaBase64 || '', 'base64');
  const read = analyzeRgba(readPixels, width, height);
  delete measurement.readRgbaBase64;
  let exported;
  if (measurement.exportAvailable) {
    const decoded = decodePngRgba(Buffer.from(measurement.exportPngBase64, 'base64'));
    if (decoded.width !== width || decoded.height !== height) throw new Error(`Export dimensions changed: ${decoded.width}x${decoded.height}`);
    exported = { format: measurement.exportType, ...analyzeRgba(decoded.rgba, width, height) };
    delete measurement.exportPngBase64;
  } else {
    exported = { decoded: false, reason: measurement.exportReason || '2D export unavailable' };
  }
  return { available: true, api: 'OffscreenCanvas 2D getImageData and convertToBlob PNG decoded by Node zlib', read, export: exported };
}

function assert(condition, label, actual) {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(actual)}`);
  console.log(`PASS ${label}`);
}

function summarizeRealm(realm) {
  return {
    href: realm.href,
    isTopFrame: realm.isTopFrame,
    userAgent: realm.ua,
    language: realm.language,
    languages: realm.languages,
    hardwareConcurrency: realm.hardwareConcurrency,
    deviceMemory: realm.deviceMemory,
    locale: realm.locale,
    timeZone: realm.zone,
    timeZoneName: realm.zoneName,
    localDate: realm.localDate,
    date: realm.date,
    offset: realm.offset,
    webgl: realm.webgl,
    ...(realm.brands ? { brands: realm.brands, formFactors: realm.formFactors, highBrands: realm.highBrands, highFormFactors: realm.highFormFactors } : {}),
    ...(realm.plugins ? { plugins: realm.plugins.map((plugin) => plugin.name), mimeTypes: realm.mimeTypes.map((mime) => mime.type), pdfViewerEnabled: realm.pdfViewerEnabled } : {})
  };
}

function summarizeScenario(scenario) {
  const result = scenario.result;
  return {
    requestHeaders: scenario.report.requestHeaders,
    realms: {
      page: summarizeRealm(result),
      sameOriginFrame: summarizeRealm(result.sameOriginFrame),
      crossOriginFrame: summarizeRealm(result.crossOriginFrame),
      dedicatedWorker: summarizeRealm(result.worker),
      sharedWorker: summarizeRealm(result.sharedWorker),
      serviceWorker: summarizeRealm(result.serviceWorker)
    }
  };
}

function runScenario(enabled) {
  const name = enabled ? 'enabled' : 'disabled';
  const fixture = path.join(scratch, name);
  const profile = path.join(fixture, 'user-data');
  const reportPath = path.join(fixture, 'report.json');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'main.cjs'), fixtureMain, 'utf8');
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'nacre-fingerprint-runtime-fixture', version: '1.0.0', main: 'main.cjs' }), 'utf8');
  const childEnv = { ...process.env, TZ: 'UTC', NACRE_PROJECT_ROOT: root, NACRE_FINGERPRINT_PROFILE: profile, NACRE_FINGERPRINT_REPORT: reportPath, NACRE_FINGERPRINT_ENABLED: enabled ? '1' : '0' };
  const child = launch([fixture, '--user-data-dir=' + profile], { cwd: root, env: childEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  if (child.error) {
    const diagnostics = [child.stderr, child.stdout].filter((text) => String(text || '').trim()).join('\n').replaceAll(root, '<project>');
    throw new Error(`Electron ${name} run failed: ${child.error.message}${diagnostics ? '\n' + diagnostics : ''}${fs.existsSync(reportPath) ? '\n' + fs.readFileSync(reportPath, 'utf8') : ''}`);
  }
  if (child.status !== 0) {
    const diagnostics = [child.stderr, child.stdout].filter((text) => String(text || '').trim()).join('\n').replaceAll(root, '<project>');
    throw new Error(`Electron ${name} run exited with ${child.status}.${diagnostics ? '\n' + diagnostics : ''}${fs.existsSync(reportPath) ? '\n' + fs.readFileSync(reportPath, 'utf8') : ''}`);
  }
  if (!fs.existsSync(reportPath)) throw new Error(`Electron ${name} run produced no report.`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.error) throw new Error(`Electron ${name} runtime probe failed: ${report.error}`);
  if (!report.userDataExplicit || report.antiFingerprintEnabled !== enabled) throw new Error(`Electron ${name} profile or preference control was not applied.`);
  const result = report.result;
  for (const type of ['page', 'iframe', 'crossOriginFrame', 'worker', 'sharedWorker', 'serviceWorker']) {
    const realm = type === 'page' ? result : type === 'iframe' ? result.iframe : result[type];
    realm.offscreenCanvas2d = analyzeCanvas(realm);
  }
  result.sameOriginFrame = result.iframe;
  return { report, result };
}

try {
  const disabled = runScenario(false);
  const enabled = runScenario(true);
  const chrome = enabled.report.chrome;
  for (const scenario of [disabled, enabled]) {
    const { result, requestHeaders } = scenario.report;
    assert(result.ua.includes(`Chrome/${chrome.split('.')[0]}.0.0.0`) && !/Nacre|Electron/i.test(result.ua), 'UA reduced Chrome without Nacre/Electron', result.ua);
    assert(result.brands?.some((item) => item.brand === 'Google Chrome'), 'navigator.userAgentData advertises Google Chrome', result.brands);
    assert(requestHeaders && /Google Chrome/.test(requestHeaders['sec-ch-ua'] || '') && /Chrome\//.test(requestHeaders['user-agent'] || ''), 'local HTTP receives UA / Client Hints headers', requestHeaders);
    assert(requestHeaders['sec-gpc'] === '1' && !requestHeaders.dnt, 'GPC sent and DNT absent by default', requestHeaders);
    for (const [name, value] of Object.entries({ language: 'en-US', locale: 'en-US', zone: 'UTC', zoneName: 'Coordinated Universal Time', offset: 0 })) assert(result[name] === value, `${scenario.report.antiFingerprintEnabled ? 'enabled' : 'disabled'} page Date/Intl ${name}`, result[name]);
    assert(result.date.includes('GMT+0000') && result.date.includes('Coordinated Universal Time'), 'Date.toString reports UTC', result.date);
    assert(result.localDate.includes('1/2/2026') && /PM/.test(result.localDate), 'Date.toLocaleString format en-US', result.localDate);
    assert(result.pdfViewerEnabled === true && result.plugins.length > 0 && result.mimeTypes.some((mime) => mime.type === 'application/pdf') && result.plugins.some((plugin) => plugin.types.some((mime) => mime.type === 'application/pdf')), 'plugins/mimeTypes agree with Chromium PDF viewer', { plugins: result.plugins, mimeTypes: result.mimeTypes, pdfViewerEnabled: result.pdfViewerEnabled });
    assert(JSON.stringify(result.languages) === JSON.stringify(['en-US', 'en']), 'page navigator.languages matches Accept-Language', result.languages);
    assert(JSON.stringify(result.formFactors) === JSON.stringify(['Desktop']) && JSON.stringify(result.highFormFactors) === JSON.stringify(['Desktop']), 'Client Hints formFactors Desktop', { direct: result.formFactors, high: result.highFormFactors });
    assert(result.webgl === false, 'WebGL unavailable in page', result.webgl);
    assert(result.iframe.webgl === false, 'WebGL unavailable in iframe', result.iframe.webgl);
    assert(result.iframe.isTopFrame === false && result.iframe.href.endsWith('/frame-same'), 'same-origin frame probe ran in the frame realm', { href: result.iframe.href, isTopFrame: result.iframe.isTopFrame });
    assert(result.crossOriginFrame.isTopFrame === false && result.crossOriginFrame.href.includes('b.test:') && result.crossOriginFrame.href.endsWith('/frame-cross'), 'cross-origin frame probe ran in the frame realm', { href: result.crossOriginFrame.href, isTopFrame: result.crossOriginFrame.isTopFrame });
    assert(result.crossOriginFrame.webgl === false, 'WebGL unavailable in cross-origin frame', result.crossOriginFrame.webgl);
    for (const type of ['worker', 'sharedWorker', 'serviceWorker']) {
      const value = result[type];
      assert(value.webgl === false || value.webgl === null, `${type} WebGL remains unavailable or absent`, value.webgl);
      assert(value && value.locale === 'en-US' && value.zone === 'UTC' && value.zoneName === 'Coordinated Universal Time' && value.offset === 0 && value.date.includes('Coordinated Universal Time') && value.localDate.includes('1/2/2026'), `${type} Date/Intl/timezone control`, value);
    }
    assert(result.iframe.language === 'en-US' && JSON.stringify(result.iframe.languages) === JSON.stringify(['en-US', 'en']) && result.iframe.locale === 'en-US' && result.iframe.zone === 'UTC' && result.iframe.zoneName === 'Coordinated Universal Time' && result.iframe.offset === 0 && result.iframe.date.includes('Coordinated Universal Time') && result.iframe.localDate.includes('1/2/2026'), 'iframe Date/Intl/timezone control', result.iframe);
    assert(result.crossOriginFrame.language === 'en-US' && JSON.stringify(result.crossOriginFrame.languages) === JSON.stringify(['en-US', 'en']) && result.crossOriginFrame.locale === 'en-US' && result.crossOriginFrame.zone === 'UTC' && result.crossOriginFrame.zoneName === 'Coordinated Universal Time' && result.crossOriginFrame.offset === 0 && result.crossOriginFrame.date.includes('Coordinated Universal Time') && result.crossOriginFrame.localDate.includes('1/2/2026'), 'cross-origin iframe Date/Intl/timezone control', result.crossOriginFrame);
  }

  const enabledPage = enabled.result.offscreenCanvas2d;
  const enabledFrame = enabled.result.iframe.offscreenCanvas2d;
  const enabledCrossFrame = enabled.result.crossOriginFrame.offscreenCanvas2d;
  const disabledPage = disabled.result.offscreenCanvas2d;
  const disabledFrame = disabled.result.iframe.offscreenCanvas2d;
  const disabledCrossFrame = disabled.result.crossOriginFrame.offscreenCanvas2d;
  assert(enabledPage.available && enabledPage.read.decoded && enabledPage.export.decoded && enabledPage.export.changedBeyond64 > 0, 'enabled page OffscreenCanvas read and decoded export measurements available', { read: enabledPage.read, export: enabledPage.export });
  assert(enabledFrame.available && enabledFrame.read.decoded && enabledFrame.export.decoded, 'enabled frame OffscreenCanvas read and decoded export measurements available', { read: enabledFrame.read, export: enabledFrame.export });
  assert(enabledCrossFrame.available && enabledCrossFrame.read.decoded && enabledCrossFrame.export.decoded, 'cross-origin frame OffscreenCanvas measurements available', { read: enabledCrossFrame.read, export: enabledCrossFrame.export });
  console.log(`LIMITATION page OffscreenCanvas 2D getImageData: ${enabledPage.read.changedPixels} pixels changed; decoded convertToBlob export changed ${enabledPage.export.changedPixels}.`);
  console.log(`LIMITATION same-origin frame hardwareConcurrency=${enabled.result.iframe.hardwareConcurrency}, deviceMemory=${enabled.result.iframe.deviceMemory}; OffscreenCanvas 2D getImageData changed ${enabledFrame.read.changedPixels} pixels and decoded convertToBlob export changed ${enabledFrame.export.changedPixels}.`);
  console.log(`MEASURED cross-origin frame b.test hardwareConcurrency=${enabled.result.crossOriginFrame.hardwareConcurrency}, deviceMemory=${enabled.result.crossOriginFrame.deviceMemory}, UA contains Nacre/Electron=${/Nacre|Electron/i.test(enabled.result.crossOriginFrame.ua)}; OffscreenCanvas read changed ${enabledCrossFrame.read.changedPixels} pixels and decoded export changed ${enabledCrossFrame.export.changedPixels}.`);
  assert(disabledPage.available && disabledPage.read.changedPixels === 0 && disabledPage.export.decoded && disabledPage.export.changedPixels === 0, 'disabled page OffscreenCanvas control preserves pixels', { read: disabledPage.read, export: disabledPage.export });
  assert(disabledFrame.available && disabledFrame.read.changedPixels === 0 && disabledFrame.export.decoded && disabledFrame.export.changedPixels === 0, 'disabled frame OffscreenCanvas control preserves pixels', { read: disabledFrame.read, export: disabledFrame.export });
  assert(disabledCrossFrame.available && disabledCrossFrame.read.changedPixels === 0 && disabledCrossFrame.export.decoded && disabledCrossFrame.export.changedPixels === 0, 'disabled cross-origin frame OffscreenCanvas control preserves pixels', { read: disabledCrossFrame.read, export: disabledCrossFrame.export });

  const workerTypes = ['worker', 'sharedWorker', 'serviceWorker'];
  const workerLimitations = [];
  for (const type of workerTypes) {
    const off = disabled.result[type];
    const on = enabled.result[type];
    for (const [name, value] of [['disabled', off], ['enabled', on]]) {
      if (value.probeError) throw new Error(`${type} ${name} runtime measurement failed: ${value.probeError}`);
      if (!value.offscreenCanvas2d.available) throw new Error(`${type} ${name} OffscreenCanvas 2D measurement unavailable: ${value.offscreenCanvas2d.reason}`);
    }
    workerLimitations.push({
      realm: type,
      status: 'measured-limitation',
      variant: type === 'serviceWorker' ? 'active classic HTTP service worker' : 'classic Blob worker',
      enabled: { hardwareConcurrency: on.hardwareConcurrency, deviceMemory: on.deviceMemory, languages: on.languages, offscreenCanvas2d: on.offscreenCanvas2d },
      disabled: { hardwareConcurrency: off.hardwareConcurrency, deviceMemory: off.deviceMemory, languages: off.languages, offscreenCanvas2d: off.offscreenCanvas2d },
      interpretation: 'Observed worker signals and pixels are recorded as exposed surfaces; these measurements do not establish worker protection.'
    });
    console.log(`LIMITATION ${type}: enabled hardwareConcurrency=${JSON.stringify(on.hardwareConcurrency)}, deviceMemory=${JSON.stringify(on.deviceMemory)}, languages=${JSON.stringify(on.languages)}; OffscreenCanvas read changed ${on.offscreenCanvas2d.read.changedPixels} pixels and decoded export changed ${on.offscreenCanvas2d.export.changedPixels} pixels.`);
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  if (fs.existsSync(scratch)) throw new Error('Temporary Electron profiles were not removed.');
  const finalReport = {
    purpose: 'Bounded application-backed fingerprint realm runtime comparison',
    status: 'partial page guards; same-origin frame, cross-origin frame, and worker coverage is measured separately',
    engine: { electron: require('electron/package.json').version, chrome },
    profiles: { explicitUserData: true, disposable: true, removedBeforeReport: true, antiFingerprintControls: ['disabled', 'enabled'] },
    testedVariants: ['main page', 'same-origin HTTP frame', 'cross-origin HTTP frame on b.test', 'dedicated classic Blob worker', 'shared classic Blob worker', 'active classic HTTP service worker'],
    untestedVariants: ['nested workers', 'module workers', 'inactive service-worker restart/reactivation', 'private and workspace session partitions'],
    nativeWorkerEnforcement: 'open',
    pageControls: {
      disabled: { hardwareConcurrency: disabled.result.hardwareConcurrency, deviceMemory: disabled.result.deviceMemory, languages: disabled.result.languages, offscreenCanvas2d: disabled.result.offscreenCanvas2d },
      enabled: { hardwareConcurrency: enabled.result.hardwareConcurrency, deviceMemory: enabled.result.deviceMemory, languages: enabled.result.languages, offscreenCanvas2d: enabled.result.offscreenCanvas2d },
      frameDisabled: { hardwareConcurrency: disabled.result.iframe.hardwareConcurrency, deviceMemory: disabled.result.iframe.deviceMemory, languages: disabled.result.iframe.languages, offscreenCanvas2d: disabled.result.iframe.offscreenCanvas2d },
      frameEnabled: { hardwareConcurrency: enabled.result.iframe.hardwareConcurrency, deviceMemory: enabled.result.iframe.deviceMemory, languages: enabled.result.iframe.languages, offscreenCanvas2d: enabled.result.iframe.offscreenCanvas2d },
      sameOriginFrameDisabled: { hardwareConcurrency: disabled.result.sameOriginFrame.hardwareConcurrency, deviceMemory: disabled.result.sameOriginFrame.deviceMemory, languages: disabled.result.sameOriginFrame.languages, offscreenCanvas2d: disabled.result.sameOriginFrame.offscreenCanvas2d },
      sameOriginFrameEnabled: { hardwareConcurrency: enabled.result.sameOriginFrame.hardwareConcurrency, deviceMemory: enabled.result.sameOriginFrame.deviceMemory, languages: enabled.result.sameOriginFrame.languages, offscreenCanvas2d: enabled.result.sameOriginFrame.offscreenCanvas2d },
      crossOriginFrameDisabled: { hardwareConcurrency: disabled.result.crossOriginFrame.hardwareConcurrency, deviceMemory: disabled.result.crossOriginFrame.deviceMemory, languages: disabled.result.crossOriginFrame.languages, offscreenCanvas2d: disabled.result.crossOriginFrame.offscreenCanvas2d },
      crossOriginFrameEnabled: { hardwareConcurrency: enabled.result.crossOriginFrame.hardwareConcurrency, deviceMemory: enabled.result.crossOriginFrame.deviceMemory, languages: enabled.result.crossOriginFrame.languages, offscreenCanvas2d: enabled.result.crossOriginFrame.offscreenCanvas2d }
    },
    frameLimitations: [
      {
        realm: 'sameOriginFrame',
        status: 'measured-limitation',
        enabled: { hardwareConcurrency: enabled.result.sameOriginFrame.hardwareConcurrency, deviceMemory: enabled.result.sameOriginFrame.deviceMemory, userAgent: enabled.result.sameOriginFrame.ua, offscreenCanvas2d: enabled.result.sameOriginFrame.offscreenCanvas2d },
        interpretation: 'The same-origin frame still exposes measured hardwareConcurrency/deviceMemory and its OffscreenCanvas read/export pixels are unchanged; this result is retained explicitly.'
      },
      {
        realm: 'crossOriginFrame',
        status: 'measured-limitation',
        enabled: { href: enabled.result.crossOriginFrame.href, isTopFrame: enabled.result.crossOriginFrame.isTopFrame, hardwareConcurrency: enabled.result.crossOriginFrame.hardwareConcurrency, deviceMemory: enabled.result.crossOriginFrame.deviceMemory, userAgent: enabled.result.crossOriginFrame.ua, offscreenCanvas2d: enabled.result.crossOriginFrame.offscreenCanvas2d },
        interpretation: 'The b.test cross-origin frame is probed through WebFrameMain.executeJavaScript; its own measured signals are recorded and do not establish complete frame protection.'
      }
    ],
    workerLimitations,
    verifiedControls: ['Date.toString', 'Date.toLocaleString', 'Intl locale and timezone in page/same-origin frame/cross-origin frame/workers', 'UA and Client Hints in main page request; frame UA recorded per realm', 'GPC/DNT headers', 'plugins and PDF MIME types', 'WebGL availability in page/frames/workers'],
    scenarios: { disabled: summarizeScenario(disabled), enabled: summarizeScenario(enabled) }
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(finalReport, null, 2), 'utf8');
  console.log(`REPORT ${output}`);
} catch (error) {
  process.stderr.write((error.stack || String(error)).replaceAll(root, '<project>') + '\n');
  process.exitCode = 1;
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (error) {
    process.stderr.write(`Could not remove temporary Electron profile: ${error.message}\n`);
    process.exitCode = 1;
  }
}
