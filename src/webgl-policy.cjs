'use strict';

const WEBGL_DISABLE_SWITCHES = Object.freeze([
  'disable-3d-apis',
  'disable-webgl',
  'disable-gpu',
  'disable-software-rasterizer'
]);

function applyWebglDisablePolicy(app) {
  if (!app || !app.commandLine || typeof app.commandLine.appendSwitch !== 'function') throw new TypeError('API commandLine Electron requise.');
  if (typeof app.disableHardwareAcceleration === 'function') app.disableHardwareAcceleration();
  for (const name of WEBGL_DISABLE_SWITCHES) app.commandLine.appendSwitch(name);
}

module.exports = { WEBGL_DISABLE_SWITCHES, applyWebglDisablePolicy };
