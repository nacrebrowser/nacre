'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildTorRuntimeArguments } = require('../src/tor-runtime-config.cjs');
const { connectTorControl, readControlPort } = require('../src/tor-control.cjs');
const { verifyPinnedTorFiles, secureTorRuntimeDirectory, torExecutableNames, torVendorName, torProcessEnvironment } = require('../src/tor-integrity.cjs');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'vendor', torVendorName());
if (!verifyPinnedTorFiles(bundle).valid) throw new Error('Invalid Tor bundle');
const parent = path.join(root, '.cache/tor-control-smoke');
fs.mkdirSync(parent, { recursive: true });
const data = fs.mkdtempSync(path.join(parent, 'runtime-'));
secureTorRuntimeDirectory(data);
const controlPortFile = path.join(data, 'port'), cookiePath = path.join(data, 'cookie');
const args = buildTorRuntimeArguments({ cookiePath, controlPortFile, dataDirectory: data, geoip: path.join(bundle,'geoip'), geoip6: path.join(bundle,'geoip6'), country: 'GB' });
const child = spawn(path.join(bundle, torExecutableNames().tor), [...args, '--DisableNetwork', '1'], { env: torProcessEnvironment(bundle), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let output = '';
child.stderr.on('data', bytes => { output += bytes.toString(); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  let control;
  try {
    for (let i = 0; i < 200 && !fs.existsSync(controlPortFile); i++) { if(child.exitCode !== null)throw new Error(output); await wait(50); }
    control = await connectTorControl(readControlPort(controlPortFile), cookiePath);
    // DisableNetwork intentionally closes SOCKS listeners. Authentication and
    // command framing are validated without connecting to the Tor network.
    await control.signalNewnym();
    console.log('TOR_CONTROL_RESULT SAFECOOKIE authenticated; auto ControlPort discovered; authenticated command accepted; network disabled');
  } finally {
    control?.close();
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
