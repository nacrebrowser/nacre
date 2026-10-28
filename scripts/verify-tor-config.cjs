'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTorBridgeArguments } = require('../src/tor-bridge-config.cjs');
const { buildTorRuntimeArguments } = require('../src/tor-runtime-config.cjs');
const { verifyPinnedTorFiles, torExecutableNames, torVendorName, torProcessEnvironment } = require('../src/tor-integrity.cjs');

// Uses the bundle prepared for this platform, with the same names, pins and
// library environment as Nacre itself.
const root = path.join(__dirname, '..');
const torDirectory = path.join(root, 'vendor', torVendorName());
const executables = torExecutableNames();
const tor = path.join(torDirectory, executables.tor);
const geoip = path.join(torDirectory, 'geoip');
const geoip6 = path.join(torDirectory, 'geoip6');
const transports = path.join(torDirectory, 'pluggable_transports', executables.lyrebird);
const configPath = path.join(torDirectory, 'pt_config.json');
if (![tor, geoip, geoip6, transports, configPath].every(fs.existsSync)) {
  throw new Error('Exécute d’abord `npm run prepare:tor` pour préparer le bundle Tor complet.');
}
const integrity = verifyPinnedTorFiles(torDirectory);
if (!integrity.valid) throw new Error('Les empreintes Tor locales diffèrent des valeurs épinglées : ' + integrity.mismatches.map((item) => item.file).join(', '));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-tor-verify-'));
try {
  for (const mode of ['none', 'obfs4', 'snowflake']) {
    const lines = mode === 'none' ? '' : (config.bridges[mode] || []).join('\n');
    const bridgeArgs = buildTorBridgeArguments(mode, lines, transports);
    const args = ['--verify-config', ...buildTorRuntimeArguments({
      socksPort: 19050, controlPort: 19051,
      cookiePath: path.join(dataDirectory, 'control_auth_cookie'),
      dataDirectory, geoip, geoip6, country: 'GB', bridgeArgs
    })];
    const result = spawnSync(tor, args, { encoding: 'utf8', env: torProcessEnvironment(torDirectory), windowsHide: true, timeout: 15000 });
    const output = (result.stdout || '') + (result.stderr || '');
    if (result.error || result.status !== 0 || !/Configuration was valid/i.test(output)) {
      throw new Error(`${mode}: ${executables.tor} --verify-config a échoué (code ${result.status}).\n${output}`);
    }
    process.stdout.write(`Configuration Tor validée : ${mode}.\n`);
  }
} finally {
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
