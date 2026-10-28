'use strict';

const path = require('node:path');
const { fuseConfig, verifyFuseWire, loadFuseApi } = require('./electron-fuse-policy.cjs');
const { flipFuses, getCurrentFuseWire } = loadFuseApi();

module.exports = async function flipAndVerifyFuses(context) {
  const executable = path.join(context.appOutDir, context.electronPlatformName === 'linux' ? 'nacre' : 'Nacre.exe');
  await flipFuses(executable, fuseConfig());
  const wire = await getCurrentFuseWire(executable);
  if (!verifyFuseWire(wire)) throw new Error('Les fuses Electron de Nacre ne correspondent pas à la politique de sécurité attendue.');
};
