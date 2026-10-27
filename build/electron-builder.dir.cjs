'use strict';

const path = require('node:path');
const packageConfig = require('../package.json').build;

module.exports = {
  ...packageConfig,
  // Build from the exact Electron package already installed; avoid fetching a
  // second copy from GitHub during packaging. Nacre artifacts are unsigned.
  electronDist: path.join(__dirname, '..', 'node_modules', 'electron', 'dist'),
  afterPack: require('../scripts/flip-fuses.cjs'),
  win: { ...packageConfig.win, target: ['dir'], signExecutable: false }
};
