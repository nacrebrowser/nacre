'use strict';
const path = require('node:path');
const base = require('./electron-builder.setup.cjs');
const publisher = process.env.NACRE_SIGNING_PUBLISHER;
if (!publisher || !process.env.CSC_LINK || !process.env.NACRE_UPDATE_FEED) throw new Error('Signed release requires NACRE_SIGNING_PUBLISHER, CSC_LINK and NACRE_UPDATE_FEED.');
const feed = new URL(process.env.NACRE_UPDATE_FEED);
if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash) throw new Error('The update feed must be an HTTPS URL without credentials or query.');
module.exports = {
  ...base,
  electronDist: path.join(__dirname, '..', 'node_modules', 'electron', 'dist'),
  afterPack: require('../scripts/flip-fuses.cjs'),
  forceCodeSigning: true,
  win: { ...base.win, target: ['nsis'], signExecutable: true, signtoolOptions: { publisherName: publisher } },
  publish: [{ provider: 'generic', url: feed.href }]
};
