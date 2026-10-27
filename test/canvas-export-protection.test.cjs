'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'fingerprint-preload.cjs'), 'utf8');
const maximumTilePixels = 16_384;

function createHarness(secret) {
  const state = { reads: [], nativeHtmlExports: 0, nativeOffscreenExports: 0, failure: null };

  class CanvasRenderingContext2D {
    constructor(canvas) { this.canvas = canvas; }
    drawImage(source) {
      this.canvas.pixels.set(source.pixels);
      if (source.tainted) this.canvas.tainted = true;
    }
    getImageData(x, y, width, height) {
      state.reads.push({ x, y, width, height });
      if (this.canvas.tainted) throw new DOMException('Canvas is not origin-clean', 'SecurityError');
      if (state.failure) throw state.failure;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        const sourceStart = ((y + row) * this.canvas.width + x) * 4;
        data.set(this.canvas.pixels.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
      }
      return { data, width, height };
    }
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row++) {
        const targetStart = ((y + row) * this.canvas.width + x) * 4;
        this.canvas.pixels.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), targetStart);
      }
    }
  }

  class MockCanvas {
    constructor(width = 0, height = 0) {
      this._width = 0;
      this._height = 0;
      this.pixels = new Uint8ClampedArray(0);
      this.tainted = false;
      this.context2d = new CanvasRenderingContext2D(this);
      this.width = width;
      this.height = height;
    }
    get width() { return this._width; }
    set width(value) { this._width = Number(value); this.#resize(); }
    get height() { return this._height; }
    set height(value) { this._height = Number(value); this.#resize(); }
    #resize() { this.pixels = new Uint8ClampedArray(this._width * this._height * 4); this.tainted = false; }
    getContext(type) { return type === '2d' ? this.context2d : null; }
    toDataURL() {
      state.nativeHtmlExports++;
      if (this.tainted) throw new DOMException('Canvas is not origin-clean', 'SecurityError');
      if (!this.width || !this.height) return 'data:,';
      return JSON.stringify(Array.from(this.pixels));
    }
    toBlob(callback, type = 'image/png') {
      state.nativeHtmlExports++;
      if (typeof callback !== 'function') throw new TypeError('Callback must be a function');
      if (this.tainted) throw new DOMException('Canvas is not origin-clean', 'SecurityError');
      callback(this.width && this.height ? { pixels: new Uint8ClampedArray(this.pixels), type } : null);
    }
  }

  class HTMLCanvasElement extends MockCanvas {}
  class OffscreenCanvas extends MockCanvas {
    convertToBlob(options = {}) {
      state.nativeOffscreenExports++;
      if (this.tainted) return Promise.reject(new DOMException('Canvas is not origin-clean', 'SecurityError'));
      if (!this.width || !this.height) return Promise.reject(new DOMException('Canvas has no bitmap', 'IndexSizeError'));
      return Promise.resolve({ pixels: new Uint8ClampedArray(this.pixels), type: options.type || 'image/png' });
    }
  }
  class Navigator {}
  class MediaDevices { enumerateDevices() { return Promise.resolve([{ kind: 'audioinput' }]); } }
  class Screen {}
  class WebGLRenderingContext {
    getParameter(parameter) { return parameter; }
    getExtension() { return {}; }
    getSupportedExtensions() { return ['EXT_test']; }
    readPixels() {}
  }
  class WebGL2RenderingContext extends WebGLRenderingContext {}
  class AudioBuffer {
    constructor() { this.samples = new Float32Array(64).fill(0.25); }
    getChannelData() { return this.samples; }
  }

  const electron = {
    contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
    ipcRenderer: { sendSync: () => ({ secret, metadata: null, webglMode: 'disabled' }) }
  };
  const sandbox = {
    require: () => electron,
    location: { hostname: 'site.example', protocol: 'https:' },
    Navigator, MediaDevices, Screen, CanvasRenderingContext2D, HTMLCanvasElement, OffscreenCanvas,
    WebGLRenderingContext, WebGL2RenderingContext, AudioBuffer,
    document: { createElement: (name) => name === 'canvas' ? new HTMLCanvasElement() : null },
    screen: { width: 1920, height: 1080 },
    DOMException, Promise
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(preload, sandbox);
  return { state, HTMLCanvasElement, OffscreenCanvas };
}

function paint(canvas, red = 100) {
  for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
    const offset = pixel * 4;
    canvas.pixels[offset] = red;
    canvas.pixels[offset + 1] = 120;
    canvas.pixels[offset + 2] = 140;
    canvas.pixels[offset + 3] = 255;
  }
}

function assertEveryPixelWasNoised(source, exported) {
  for (let pixel = 0; pixel < source.length / 4; pixel++) {
    const offset = pixel * 4;
    assert.ok(Math.abs(exported[offset] - source[offset]) === 1, `red channel changed at pixel ${pixel}`);
    assert.equal(exported[offset + 1], source[offset + 1]);
    assert.equal(exported[offset + 2], source[offset + 2]);
    assert.equal(exported[offset + 3], source[offset + 3]);
  }
}

test('HTML canvas data URL and Blob exports noise the full image deterministically in bounded tiles', () => {
  const harness = createHarness('a'.repeat(64));
  const canvas = new harness.HTMLCanvasElement(409, 257);
  paint(canvas);
  const original = new Uint8ClampedArray(canvas.pixels);

  harness.state.reads.length = 0;
  const dataUrlPixels = Uint8ClampedArray.from(JSON.parse(canvas.toDataURL()));
  const dataUrlTiles = harness.state.reads.splice(0);
  assertEveryPixelWasNoised(original, dataUrlPixels);
  assert.ok(dataUrlTiles.length > 1);
  assert.ok(dataUrlTiles.every(({ width, height }) => width * height <= maximumTilePixels));
  assert.equal(dataUrlTiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), canvas.width * canvas.height);
  assert.deepEqual(canvas.pixels, original, 'the source bitmap is unchanged after toDataURL');

  harness.state.reads.length = 0;
  let blob;
  canvas.toBlob((value) => { blob = value; }, 'image/png');
  assert.equal(blob.type, 'image/png');
  assertEveryPixelWasNoised(original, blob.pixels);
  assert.ok(harness.state.reads.every(({ width, height }) => width * height <= maximumTilePixels));
  assert.equal(harness.state.reads.reduce((sum, tile) => sum + tile.width * tile.height, 0), canvas.width * canvas.height);
  assert.deepEqual(canvas.pixels, original, 'the source bitmap is unchanged after toBlob');

  const repeated = createHarness('a'.repeat(64));
  const repeatedCanvas = new repeated.HTMLCanvasElement(409, 257);
  paint(repeatedCanvas);
  assert.equal(repeatedCanvas.toDataURL(), JSON.stringify(Array.from(dataUrlPixels)));

  const nextSession = createHarness('b'.repeat(64));
  const nextCanvas = new nextSession.HTMLCanvasElement(409, 257);
  paint(nextCanvas);
  assert.notDeepEqual(JSON.parse(nextCanvas.toDataURL()), Array.from(dataUrlPixels));
});

test('OffscreenCanvas convertToBlob is protected and keeps its promise error semantics', async () => {
  const harness = createHarness('c'.repeat(64));
  const canvas = new harness.OffscreenCanvas(257, 129);
  paint(canvas, 90);
  const original = new Uint8ClampedArray(canvas.pixels);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  assert.equal(blob.type, 'image/png');
  assertEveryPixelWasNoised(original, blob.pixels);
  assert.deepEqual(canvas.pixels, original, 'the OffscreenCanvas source bitmap is unchanged');

  const failed = new harness.OffscreenCanvas(8, 8);
  paint(failed);
  const protectionFailure = new Error('simulated OffscreenCanvas tile read failure');
  harness.state.failure = protectionFailure;
  const nativeExportsBeforeFailure = harness.state.nativeOffscreenExports;
  await assert.rejects(failed.convertToBlob(), (error) => error === protectionFailure);
  assert.equal(harness.state.nativeOffscreenExports, nativeExportsBeforeFailure, 'OffscreenCanvas native export is never called after protection fails');
  harness.state.failure = null;

  const tainted = new harness.OffscreenCanvas(2, 2);
  tainted.tainted = true;
  let rejection = null;
  try { await tainted.convertToBlob(); } catch (error) { rejection = error; }
  assert.equal(rejection?.name, 'SecurityError');

  const zero = new harness.OffscreenCanvas(0, 0);
  await assert.rejects(zero.convertToBlob(), { name: 'IndexSizeError' });
});

test('canvas taint and zero-size exports keep native outcomes, and preparation failures fail closed', () => {
  const harness = createHarness('d'.repeat(64));
  const tainted = new harness.HTMLCanvasElement(4, 4);
  tainted.tainted = true;
  assert.throws(() => tainted.toDataURL(), { name: 'SecurityError' });
  assert.throws(() => tainted.toBlob(() => {}), { name: 'SecurityError' });

  const zero = new harness.HTMLCanvasElement(0, 0);
  assert.equal(zero.toDataURL(), 'data:,');
  let zeroBlob = undefined;
  zero.toBlob((blob) => { zeroBlob = blob; });
  assert.equal(zeroBlob, null);

  const broken = new harness.HTMLCanvasElement(8, 8);
  paint(broken);
  const protectionFailure = new Error('simulated tile read failure');
  harness.state.failure = protectionFailure;
  const nativeExportsBeforeFailure = harness.state.nativeHtmlExports;
  assert.throws(() => broken.toDataURL(), (error) => error === protectionFailure);
  assert.equal(harness.state.nativeHtmlExports, nativeExportsBeforeFailure, 'the native exporter is never called after protection fails');
});
