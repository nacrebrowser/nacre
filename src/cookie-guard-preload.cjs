'use strict';
const { contextBridge, ipcRenderer } = require('electron');
let blocked = true;
try { blocked = ipcRenderer.sendSync('nacre:cookie-frame-policy') !== false; } catch {}
if (blocked) contextBridge.executeInMainWorld({ func: () => {
  const deny = () => Promise.reject(new DOMException('Cookies blocked by Nacre', 'NotAllowedError'));
  try { Object.defineProperty(Document.prototype, 'cookie', { configurable: false, get: () => '', set: () => {} }); } catch {}
  // Block the native prototype as well as the global accessor: a page cannot
  // obtain unwrapped methods through cookieStore's prototype.
  const store = globalThis.cookieStore;
  if (store) {
    const prototype = Object.getPrototypeOf(store);
    for (const name of ['get', 'getAll', 'set', 'delete']) {
      try { Object.defineProperty(prototype, name, { configurable: false, writable: false, value: deny }); } catch {}
    }
    try { Object.defineProperty(globalThis, 'cookieStore', { configurable: false, get: () => undefined }); } catch {}
  }
} });
