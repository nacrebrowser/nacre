'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let fingerprintConfig = { secret: '', metadata: null, webglMode: 'disabled' };
try { fingerprintConfig = ipcRenderer.sendSync('nacre:fingerprint-seed', location.hostname) || fingerprintConfig; } catch {}

contextBridge.executeInMainWorld({ func: (config) => {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  let seed = 2166136261;
  for (const char of config.secret || '') seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const noiseAt = (index) => { let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0; value ^= value >>> 16; value = Math.imul(value, 0x45d9f3b); value ^= value >>> 16; return (value & 1) ? 1 : -1; };
  const define = (object, name, getter) => { try { Object.defineProperty(object, name, { configurable: false, enumerable: true, get: getter }); } catch {} };
  define(Navigator.prototype, 'hardwareConcurrency', () => 8);
  define(Navigator.prototype, 'deviceMemory', () => 8);
  define(Navigator.prototype, 'connection', () => undefined);
  define(Navigator.prototype, 'getBattery', () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError')));
  const mediaDevicesPrototype = globalThis.MediaDevices && MediaDevices.prototype;
  const originalEnumerate = mediaDevicesPrototype && mediaDevicesPrototype.enumerateDevices;
  try { if (typeof originalEnumerate === 'function') Object.defineProperty(mediaDevicesPrototype, 'enumerateDevices', { configurable: false, value: () => Promise.resolve([]) }); } catch {}
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(...args) {
    const result = originalGetImageData.apply(this, args);
    for (let i = 0; i < result.data.length; i += 4) result.data[i] = Math.max(0, Math.min(255, result.data[i] + noiseAt(i >>> 2)));
    return result;
  };
  const maximumExportTilePixels = 16_384;
  const alterCanvas = (canvas, createCopy, getImageData = originalGetImageData) => {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return canvas;

    const copy = createCopy(width, height);
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas export protection could not create a 2D context');
    context.drawImage(canvas, 0, 0);

    // Keep each temporary ImageData allocation bounded, even for very large canvases.
    const tileWidth = Math.min(width, maximumExportTilePixels);
    const tileHeight = Math.max(1, Math.floor(maximumExportTilePixels / tileWidth));
    for (let y = 0; y < height; y += tileHeight) {
      const currentHeight = Math.min(tileHeight, height - y);
      for (let x = 0; x < width; x += tileWidth) {
        const currentWidth = Math.min(tileWidth, width - x);
        const image = getImageData.call(context, x, y, currentWidth, currentHeight);
        for (let row = 0; row < currentHeight; row++) {
          const firstPixel = (y + row) * width + x;
          const firstByte = row * currentWidth * 4;
          for (let column = 0; column < currentWidth; column++) {
            const byte = firstByte + column * 4;
            image.data[byte] = Math.max(0, Math.min(255, image.data[byte] + noiseAt(firstPixel + column)));
          }
        }
        context.putImageData(image, x, y);
      }
    }
    return copy;
  };
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    return originalToDataURL.apply(alterCanvas(this, (width, height) => {
      const copy = document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      return copy;
    }), args);
  };
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(...args) {
    // Let the native binding report invalid callback arguments before preparing an export.
    if (typeof args[0] !== 'function') return originalToBlob.apply(this, args);
    return originalToBlob.apply(alterCanvas(this, (width, height) => {
      const copy = document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      return copy;
    }), args);
  };
  const Offscreen = globalThis.OffscreenCanvas;
  const originalConvertToBlob = Offscreen && Offscreen.prototype.convertToBlob;
  if (typeof originalConvertToBlob === 'function') {
    const originalOffscreenGetImageData = globalThis.OffscreenCanvasRenderingContext2D?.prototype?.getImageData || originalGetImageData;
    Offscreen.prototype.convertToBlob = function(...args) {
      let copy;
      try {
        copy = alterCanvas(this, (width, height) => new Offscreen(width, height), originalOffscreenGetImageData);
      } catch (error) {
        // convertToBlob is promise-based, so protection failures remain rejections.
        return Promise.reject(error);
      }
      return originalConvertToBlob.apply(copy, args);
    };
  }
  for (const prototype of [WebGLRenderingContext.prototype, globalThis.WebGL2RenderingContext && WebGL2RenderingContext.prototype].filter(Boolean)) {
    const originalGetParameter = prototype.getParameter;
    prototype.getParameter = function(parameter) {
      if (parameter === 0x9245) return 'WebKit';
      if (parameter === 0x9246) return 'WebKit WebGL';
      return originalGetParameter.call(this, parameter);
    };
    const originalGetExtension = prototype.getExtension;
    prototype.getExtension = function(name) {
      if (String(name).toLowerCase() === 'webgl_debug_renderer_info') return null;
      return originalGetExtension.call(this, name);
    };
    const originalGetSupportedExtensions = prototype.getSupportedExtensions;
    prototype.getSupportedExtensions = function() {
      return (originalGetSupportedExtensions.call(this) || []).filter((name) => String(name).toLowerCase() !== 'webgl_debug_renderer_info');
    };
    const original = prototype.readPixels;
    prototype.readPixels = function(...args) {
      const result = original.apply(this, args);
      const output = args[6];
      if (output && ArrayBuffer.isView(output)) {
        const floating = output instanceof Float32Array || output instanceof Float64Array;
        const maximum = floating ? 1 : output instanceof Uint8Array || output instanceof Uint8ClampedArray ? 255 : 65535;
        for (let pixel = 0, offset = 0; offset < output.length && pixel < 256; pixel++, offset += 4) {
          output[offset] = Math.max(0, Math.min(maximum, Number(output[offset]) + noiseAt(pixel + 1) * (floating ? 1e-7 : 1)));
        }
      }
      return result;
    };
  }
  const originalChannel = AudioBuffer.prototype.getChannelData;
  const protectedAudio = new WeakSet();
  const protectChannel = (buffer, channel) => {
    const source = originalChannel.call(buffer, channel);
    if (!protectedAudio.has(source)) {
      for (let i = 0; i < source.length; i += 97) source[i] += noiseAt(i) * 1e-7;
      protectedAudio.add(source);
    }
    return source;
  };
  AudioBuffer.prototype.getChannelData = function(channel) { return protectChannel(this, channel); };
  const originalCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
  if (typeof originalCopyFromChannel === 'function') {
    AudioBuffer.prototype.copyFromChannel = function(destination, channel, ...rest) {
      protectChannel(this, channel);
      return originalCopyFromChannel.call(this, destination, channel, ...rest);
    };
  }
  define(Screen.prototype, 'colorDepth', () => 24);
  define(Screen.prototype, 'pixelDepth', () => 24);
  // Capture native accessors before replacing them: reading screen.width from
  // its own getter recurses. Availability uses the same bucket, not raw pixels.
  for (const [dimension, minimum] of [['width', 1024], ['height', 768]]) {
    const nativeGetter = Object.getOwnPropertyDescriptor(Screen.prototype, dimension)?.get;
    if (typeof nativeGetter !== 'function') continue;
    const bucket = function() { return Math.max(minimum, Math.round(nativeGetter.call(this) / 100) * 100); };
    define(Screen.prototype, dimension, bucket);
    define(Screen.prototype, dimension === 'width' ? 'availWidth' : 'availHeight', bucket);
  }
}, args: [fingerprintConfig] });
