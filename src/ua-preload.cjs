'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let metadata = null;
try { metadata = ipcRenderer.sendSync('nacre:fingerprint-seed', location.hostname)?.metadata || null; } catch {}
if (metadata) {
  contextBridge.executeInMainWorld({ func: (ua) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    // Keep Chromium's actual PluginArray/MimeTypeArray. A hand-built PDF list
    // is both structurally distinctive and can disagree with pdfViewerEnabled.
    try { Object.defineProperty(Navigator.prototype, 'language', { configurable: false, enumerable: true, get: () => 'en-US' }); } catch {}
    const languages = Object.freeze(['en-US', 'en']);
    try { Object.defineProperty(Navigator.prototype, 'languages', { configurable: false, enumerable: true, get: () => languages }); } catch {}
    if (!('userAgentData' in Navigator.prototype)) return;
    const nativePrototype = globalThis.NavigatorUAData?.prototype || Object.prototype;
    const brands = Object.freeze(ua.brands.map((item) => Object.freeze({ ...item })));
    const fullVersionList = Object.freeze(ua.fullVersionList.map((item) => Object.freeze({ ...item })));
    const values = {
      brands,
      formFactors: Object.freeze(['Desktop']),
      mobile: Boolean(ua.mobile),
      platform: ua.platform,
      toJSON() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },
      async getHighEntropyValues(hints) {
        const result = { ...this.toJSON() };
        for (const hint of Array.isArray(hints) ? hints : []) {
          if (hint === 'architecture') result.architecture = ua.architecture;
          else if (hint === 'bitness') result.bitness = ua.bitness;
          else if (hint === 'model') result.model = ua.model;
          else if (hint === 'platformVersion') result.platformVersion = ua.platformVersion;
          else if (hint === 'uaFullVersion') result.uaFullVersion = fullVersionList.find((item) => item.brand === 'Google Chrome')?.version || '';
          else if (hint === 'fullVersionList') result.fullVersionList = fullVersionList;
          else if (hint === 'wow64') result.wow64 = ua.wow64;
          else if (hint === 'formFactors') result.formFactors = this.formFactors;
        }
        return result;
      }
    };
    Object.setPrototypeOf(values, nativePrototype);
    try { Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: false, enumerable: true, get: () => values }); } catch {}
  }, args: [metadata] });
}
