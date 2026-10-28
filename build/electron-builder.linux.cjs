'use strict';

const path = require('node:path');
const packageConfig = require('../package.json').build;
const version = require('../package.json').version;

// Linux package: a .deb for Ubuntu/Debian (amd64). Its post-install script
// keeps Chromium's sandbox on: an AppArmor profile where unprivileged user
// namespaces are restricted (Ubuntu 24.04+), or a setuid chrome-sandbox where
// user namespaces are unavailable.
module.exports = {
  ...packageConfig,
  electronDist: path.join(__dirname, '..', 'node_modules', 'electron', 'dist'),
  // Files installed under /opt must not be writable by other accounts,
  // whatever the permissions of the checkout they were copied from.
  async afterPack(context) {
    const fs = require('node:fs');
    const walk = (target) => {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) return;
      fs.chmodSync(target, stat.mode & 0o7755);
      if (stat.isDirectory()) for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
    };
    walk(context.appOutDir);
    await require('../scripts/flip-fuses.cjs')(context);
  },
  extraResources: [
    { from: 'vendor/tor-linux', to: 'tor', filter: ['**/*'] },
    ...packageConfig.extraResources.filter((entry) => entry.from !== 'vendor/tor')
  ],
  linux: {
    executableName: 'nacre',
    syncDesktopName: true,
    icon: 'src/icon.png',
    category: 'Network',
    synopsis: 'Privacy-focused web browser with Tor built in',
    description: 'Nacre is a privacy-focused web browser built on Chromium, with Tor built in, separate workspaces and local ad and tracker blocking.',
    maintainer: 'NacreDev <nacre-dev@users.noreply.github.com>',
    vendor: 'Nacre',
    target: ['deb'],
    desktop: { entry: { Name: 'Nacre', GenericName: 'Web Browser', Categories: 'Network;WebBrowser;', StartupWMClass: 'Nacre' } }
  },
  deb: {
    artifactName: require('../scripts/artifact-names.cjs').artifactNames(version).deb,
    // electron-builder's defaults plus the libraries Electron loads that a
    // minimal Ubuntu or Debian install may lack (Nacre does not start
    // without libasound). The t64 names are Ubuntu 24.04+, the others Debian 12.
    depends: [
      'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
      'libasound2t64 | libasound2', 'libgbm1', 'libdrm2', 'libxkbcommon0', 'libcups2t64 | libcups2'
    ],
    packageCategory: 'web'
  }
};
