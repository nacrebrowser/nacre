'use strict';

// Defense in depth for document realms. Chromium's startup switches and
// webPreferences.webgl=false remain the primary controls, including workers.
// This preload also prevents pages and iframe realms from creating WebGL
// contexts if a Chromium preference is ignored by a particular build.
const disableWebGLContexts = () => {
  const blocked = new Set(['webgl', 'webgl2', 'experimental-webgl', 'experimental-webgl2']);
  const blockOn = (prototype) => {
    if (!prototype || typeof prototype.getContext !== 'function') return;
    const original = prototype.getContext;
    try {
      Object.defineProperty(prototype, 'getContext', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: function getContext(type, ...args) {
          type = String(type);
          if (blocked.has(type.toLowerCase())) return null;
          return Reflect.apply(nativeGetContext, this, [type, ...args]);
        }
      });
    } catch {}
    function nativeGetContext(type, ...args) { return Reflect.apply(original, this, [type, ...args]); }
  };
  blockOn(globalThis.HTMLCanvasElement && HTMLCanvasElement.prototype);
  blockOn(globalThis.OffscreenCanvas && OffscreenCanvas.prototype);
};

try {
  const { contextBridge } = require('electron');
  contextBridge.executeInMainWorld({ func: disableWebGLContexts });
} catch {}
