'use strict';

const { ipcRenderer, webFrame } = require('electron');

// The main process owns the rules and injects styles/scriptlets into this exact
// frame through WebFrameMain; no API or data is exposed to the page itself.
if (location.protocol === 'http:' || location.protocol === 'https:') {
  try {
    const payload = ipcRenderer.sendSync('nacre:adblock:prepare-frame', location.href);
    if (payload && typeof payload === 'object') {
      if (typeof payload.styles === 'string' && payload.styles) {
        const inserted = webFrame.insertCSS(payload.styles, { cssOrigin: 'user' });
        if (inserted && typeof inserted.catch === 'function') inserted.catch(() => {});
      }
      // The main process only returns bounded, allowlisted Ghostery resources
      // and Nacre-generated procedural selectors. Use Electron's frame API;
      // never eval arbitrary filter text in the renderer.
      if (typeof payload.scriptletBundle === 'string' && payload.scriptletBundle) {
        webFrame.executeJavaScript(payload.scriptletBundle).catch(() => {
          console.warn('Nacre: injection des filtres de page impossible.');
        });
      }
    }
  } catch {}
}
