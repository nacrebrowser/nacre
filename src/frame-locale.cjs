'use strict';

const FRAME_LANGUAGE_OVERRIDE = `(() => {
  const languages = Object.freeze(['en-US', 'en']);
  try { Object.defineProperty(Navigator.prototype, 'language', { configurable: false, enumerable: true, get: () => 'en-US' }); } catch {}
  try { Object.defineProperty(Navigator.prototype, 'languages', { configurable: false, enumerable: true, get: () => languages }); } catch {}
})();`;

function registerFrameLocaleOverrides(contents) {
  if (!contents || typeof contents.on !== 'function') throw new TypeError('WebContents requis.');
  contents.on('frame-created', (_event, details) => {
    const frame = details && details.frame;
    if (!frame || frame === contents.mainFrame) return;
    try { Promise.resolve(frame.executeJavaScript(FRAME_LANGUAGE_OVERRIDE)).catch(() => {}); } catch {}
  });
}

module.exports = { FRAME_LANGUAGE_OVERRIDE, registerFrameLocaleOverrides };
