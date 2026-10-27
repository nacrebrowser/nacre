'use strict';

function loadFuseApi() {
  try { return require('@electron/fuses'); }
  catch {
    return require('../node_modules/.pnpm/@electron+fuses@1.8.0/node_modules/@electron/fuses');
  }
}

const { FuseVersion, FuseV1Options } = loadFuseApi();

const expectedFuses = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
});

function fuseConfig() {
  return { version: FuseVersion.V1, ...expectedFuses };
}

function verifyFuseWire(wire) {
  if (!wire || wire.version !== FuseVersion.V1) return false;
  return Object.entries(expectedFuses).every(([key, enabled]) => wire[key] === (enabled ? 49 : 48));
}

module.exports = { expectedFuses, fuseConfig, verifyFuseWire, loadFuseApi };
