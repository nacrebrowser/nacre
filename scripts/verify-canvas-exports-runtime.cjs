'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./test-support/electron-fixture.cjs');

const root = path.resolve(__dirname, '..');
const cacheRoot = path.join(root, '.cache', 'canvas-exports'); fs.mkdirSync(cacheRoot, { recursive: true });
const temporaryRoot = fs.mkdtempSync(path.join(cacheRoot, 'run-'));
const reportPath = path.join(temporaryRoot, 'report.json');
const entryPath = path.join(temporaryRoot, 'main.cjs');
let failure = null;

const main = `
'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const temporaryRoot = ${JSON.stringify(temporaryRoot)};
const output = ${JSON.stringify(reportPath)};
const preload = ${JSON.stringify(path.join(root, 'src', 'fingerprint-preload.cjs'))};
const seed = 'nacre-canvas-export-test-seed';
let stage = 'startup';
app.setPath('userData', path.join(temporaryRoot, 'profile'));
app.setPath('sessionData', path.join(temporaryRoot, 'profile', 'session'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP b.test 127.0.0.1');

const imageServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
  response.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>');
});
const pageServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(request.url === '/frame'
    ? '<!doctype html><meta charset="utf-8"><p>canvas frame fixture</p>'
    : '<!doctype html><meta charset="utf-8"><iframe src="http://b.test:' + pageServer.address().port + '/frame"></iframe><p>canvas export fixture</p>');
});
ipcMain.on('nacre:fingerprint-seed', event => { event.returnValue = { secret: seed, metadata: null, webglMode: 'disabled' }; });

const inspectHtmlCanvas = async (imageUrl) => {
  const width = 320, height = 180, x = 200, y = 100;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'rgb(100, 120, 140)'; context.fillRect(0, 0, width, height);
  const before = context.getImageData(x, y, 1, 1).data[0];
  const firstUrl = canvas.toDataURL('image/png');
  const secondUrl = canvas.toDataURL('image/png');
  const readImagePixel = async (source) => {
    const image = new Image(); image.src = source; await image.decode();
    const target = document.createElement('canvas'); target.width = width; target.height = height;
    const targetContext = target.getContext('2d', { willReadFrequently: true });
    targetContext.drawImage(image, 0, 0);
    return targetContext.getImageData(x, y, 1, 1).data[0];
  };
  const dataUrlRed = await readImagePixel(firstUrl);
  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob(resolve, 'image/png'); } catch (error) { reject(error); }
  });
  const blobUrl = URL.createObjectURL(blob);
  const blobRed = await readImagePixel(blobUrl);
  URL.revokeObjectURL(blobUrl);
  const after = context.getImageData(x, y, 1, 1).data[0];

  const zero = document.createElement('canvas'); zero.width = 0; zero.height = 0;
  const zeroUrl = zero.toDataURL();
  const zeroBlob = await new Promise((resolve, reject) => {
    try { zero.toBlob(resolve); } catch (error) { reject(error); }
  });

  const image = new Image(); image.src = imageUrl; await image.decode();
  const tainted = document.createElement('canvas'); tainted.width = 4; tainted.height = 4;
  tainted.getContext('2d').drawImage(image, 0, 0);
  let dataUrlTaint = 'no-error';
  try { tainted.toDataURL(); } catch (error) { dataUrlTaint = error.name; }
  let blobTaint = 'no-error';
  try { tainted.toBlob(() => {}); } catch (error) { blobTaint = error.name; }
  return {
    href: location.href,
    isTopFrame: window === top,
    before,
    dataUrlRed,
    blobRed,
    after,
    dataUrlChanged: dataUrlRed !== before,
    blobChanged: blobRed !== before,
    repeatStable: firstUrl === secondUrl,
    blobType: blob && blob.type,
    blobSize: blob && blob.size,
    sourceUnchanged: before === after,
    zeroUrl,
    zeroBlobIsNull: zeroBlob === null,
    dataUrlTaint,
    blobTaint
  };
};

const inspectOffscreenCanvas = async (imageUrl) => {
  const width = 320, height = 180, x = 200, y = 100;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'rgb(100, 120, 140)'; context.fillRect(0, 0, width, height);
  const sourceProbe = document.createElement('canvas'); sourceProbe.width = width; sourceProbe.height = height;
  const sourceContext = sourceProbe.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(canvas, 0, 0);
  const before = sourceContext.getImageData(x, y, 1, 1).data[0];
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const resultProbe = document.createElement('canvas'); resultProbe.width = width; resultProbe.height = height;
  const resultContext = resultProbe.getContext('2d', { willReadFrequently: true });
  resultContext.drawImage(bitmap, 0, 0); bitmap.close();
  const exported = resultContext.getImageData(x, y, 1, 1).data[0];
  const after = sourceContext.getImageData(x, y, 1, 1).data[0];

  const image = new Image(); image.src = imageUrl; await image.decode();
  const tainted = new OffscreenCanvas(4, 4);
  tainted.getContext('2d').drawImage(image, 0, 0);
  let taint = 'no-error';
  try { await tainted.convertToBlob(); } catch (error) { taint = error.name; }
  const zero = new OffscreenCanvas(0, 0);
  let zeroSize = 'no-error';
  try { await zero.convertToBlob(); } catch (error) { zeroSize = error.name; }
  return { href: location.href, isTopFrame: window === top, changed: exported !== before, sourceUnchanged: before === after, blobType: blob.type, taint, zeroSize };
};

const waitFor = async (check, label) => {
  const start = Date.now();
  while (!await check()) {
    if (Date.now() - start > 10000) throw new Error(label + ' timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

app.whenReady().then(async () => {
  const defaultSession = session.defaultSession;
  stage = 'register preload';
  defaultSession.registerPreloadScript({ type: 'frame', filePath: preload });
  await Promise.all([
    new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve)),
    new Promise(resolve => pageServer.listen(0, '127.0.0.1', resolve))
  ]);
  const imageUrl = 'http://127.0.0.1:' + imageServer.address().port + '/pixel.svg';
  const window = new BrowserWindow({ show: false, webPreferences: {
    session: defaultSession, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: true, sandbox: true, webSecurity: true
  } });
  stage = 'page load';
  await window.loadURL('http://127.0.0.1:' + pageServer.address().port + '/');
  stage = 'frame load';
  await waitFor(() => window.webContents.mainFrame.frames.some(frame => frame.url.startsWith('http://b.test:')), 'frame load');
  const runInMain = (probe) => window.webContents.executeJavaScript('(' + probe.toString() + ')(' + JSON.stringify(imageUrl) + ')');
  const runInFrame = (probe) => {
    const frameSource = '(' + probe.toString() + ')(' + JSON.stringify(imageUrl) + ')';
    const frame = window.webContents.mainFrame.frames.find(candidate => candidate.url.startsWith('http://b.test:'));
    return frame.executeJavaScript(frameSource);
  };
  const result = {
    // Keep stage labels around the independent frame evaluations for useful failure output.
    main: await runInMain(inspectHtmlCanvas),
    frameHtml: await (stage = 'frame HTML', runInFrame(inspectHtmlCanvas)),
    frameOffscreen: await (stage = 'frame OffscreenCanvas', runInFrame(inspectOffscreenCanvas))
  };
  fs.writeFileSync(output, JSON.stringify({ result, chrome: process.versions.chrome }, null, 2));
  await window.destroy();
  imageServer.close(); pageServer.close();
  app.quit();
}).catch(error => {
  fs.writeFileSync(output, JSON.stringify({ stage, error: error.stack || String(error) }, null, 2));
  app.exit(1);
});
`;

try {
  fs.writeFileSync(entryPath, main, 'utf8');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = launch([entryPath], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    const status = child.status === null ? `timeout (${child.error?.code || 'unknown'})` : `code ${child.status}`;
    const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
    throw new Error(`Electron canvas fixture exited with ${status}.\n${child.stderr || child.stdout || ''}${report}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.error) throw new Error(report.error);
  const { main: mainResult, frameHtml, frameOffscreen } = report.result;
  const assertRuntime = (condition, label, actual) => {
    assert.ok(condition, `${label}: ${JSON.stringify(actual)}`);
    process.stdout.write(`PASS ${label}\n`);
  };
  assertRuntime(mainResult.isTopFrame === true && mainResult.href.startsWith('http://127.0.0.1:'), 'main probe runs in the top frame', mainResult);
  for (const value of [frameHtml, frameOffscreen]) {
    assertRuntime(value.isTopFrame === false && value.href.startsWith('http://b.test:'), 'frame probe runs in the native cross-origin frame realm', value);
  }
  for (const [label, value] of [['main HTML canvas', mainResult], ['frame HTML canvas', frameHtml]]) {
    assertRuntime(value.dataUrlChanged && value.blobChanged, `${label} export pixels change beyond 64x64`, value);
    assertRuntime(value.repeatStable && value.sourceUnchanged, `${label} export is deterministic and source stays unchanged`, value);
    assertRuntime(value.blobType === 'image/png' && value.blobSize > 0, `${label} normal Blob export remains valid`, value);
    assertRuntime(value.zeroUrl === 'data:,' && value.zeroBlobIsNull, `${label} zero-size native export behavior`, value);
    assertRuntime(value.dataUrlTaint === 'SecurityError' && value.blobTaint === 'SecurityError', `${label} tainted export keeps SecurityError`, value);
  }
  assertRuntime(frameOffscreen.changed && frameOffscreen.sourceUnchanged, 'frame OffscreenCanvas export pixels change and source stays unchanged', frameOffscreen);
  assertRuntime(frameOffscreen.blobType === 'image/png', 'frame OffscreenCanvas normal Blob export remains valid', frameOffscreen);
  assertRuntime(frameOffscreen.taint === 'SecurityError', 'frame OffscreenCanvas tainted export rejects with SecurityError', frameOffscreen);
  assertRuntime(frameOffscreen.zeroSize === 'IndexSizeError', 'frame OffscreenCanvas zero-size native rejection', frameOffscreen);
  process.stdout.write(`Chromium ${report.chrome}; hidden local fixtures only. This probe covers the main page and a cross-origin frame; same-origin frame and worker exports are measured separately by verify-fingerprint-runtime.cjs and remain uncovered here.\n`);
} catch (error) {
  failure = error;
} finally {
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch {}
}

if (failure) {
  process.stderr.write(`${failure.stack || failure}\n`);
  process.exitCode = 1;
}
