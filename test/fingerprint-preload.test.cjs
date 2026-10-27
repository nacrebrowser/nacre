'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'fingerprint-preload.cjs'), 'utf8');

async function readFingerprint(secret) {
  class Navigator {}
  Object.defineProperty(Navigator.prototype, 'mediaDevices', { get() { throw new TypeError('Illegal invocation'); } });
  class MediaDevices { enumerateDevices() { return Promise.resolve([{ kind: 'audioinput' }]); } }
  class Screen {}
  class CanvasRenderingContext2D {
    constructor(canvas) { this.canvas = canvas; }
    drawImage(source) { this.canvas.pixels.set(source.pixels); }
    getImageData(_x, _y, width, height) { return { data: this.canvas.pixels.slice(0, width * height * 4) }; }
    putImageData(image) { this.canvas.pixels.set(image.data); }
  }
  class HTMLCanvasElement {
    constructor() {
      this.width = 64;
      this.height = 64;
      this.pixels = new Uint8ClampedArray(64 * 64 * 4).fill(128);
      this.context2d = new CanvasRenderingContext2D(this);
    }
    getContext(type) { return type === '2d' ? this.context2d : null; }
    toDataURL() { return Array.from(this.pixels).join(','); }
    toBlob(callback) { callback({ pixels: this.pixels }); }
  }
  class WebGLRenderingContext {
    getParameter(parameter) { return parameter; }
    getExtension() { return {}; }
    getSupportedExtensions() { return ['EXT_test']; }
    readPixels() {}
  }
  class WebGL2RenderingContext extends WebGLRenderingContext {}
  class AudioBuffer {
    constructor() { this.samples = new Float32Array(4096).fill(0.25); }
    getChannelData() { return this.samples; }
  }
  const electron = {
    contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
    ipcRenderer: { sendSync: () => ({ secret, metadata: null, webglMode: 'disabled' }) }
  };
  const sandbox = {
    require: () => electron,
    location: { hostname: 'site.example', protocol: 'https:' },
    Navigator,
    MediaDevices,
    Screen,
    CanvasRenderingContext2D,
    HTMLCanvasElement,
    WebGLRenderingContext,
    WebGL2RenderingContext,
    AudioBuffer,
    document: { createElement: (name) => name === 'canvas' ? new HTMLCanvasElement() : null },
    screen: { width: 1920, height: 1080 },
    DOMException
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(preload, sandbox);

  const canvas = new HTMLCanvasElement();
  const canvasData = canvas.toDataURL();
  const pixelData = canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
  const glOutput = new Uint8Array(256 * 4);
  new WebGLRenderingContext().readPixels(0, 0, 256, 1, 0, 0, glOutput);
  const audio = Array.from(new AudioBuffer().getChannelData(0));
  return { canvasData, pixelData: Array.from(pixelData), gl: Array.from(glOutput), audio, devices: await new MediaDevices().enumerateDevices() };
}

test('la précharge ne lit pas le getter prototype illégal et le bruit varie entre secrets', async () => {
  const firstSession = await readFingerprint('a'.repeat(64));
  const sameSession = await readFingerprint('a'.repeat(64));
  const nextSession = await readFingerprint('b'.repeat(64));
  assert.equal(JSON.stringify(firstSession), JSON.stringify(sameSession));
  assert.equal(JSON.stringify(firstSession.devices), '[]');
  assert.notEqual(firstSession.canvasData, nextSession.canvasData);
  assert.notDeepEqual(firstSession.pixelData, nextSession.pixelData);
  assert.notDeepEqual(firstSession.gl, nextSession.gl);
  assert.notDeepEqual(firstSession.audio, nextSession.audio);
});
