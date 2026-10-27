'use strict';

const { isTorExitSelection, TOR_EXIT_AUTO, TOR_EXIT_COUNTRY_ERROR } = require('./tor-exit-countries.cjs');

function buildTorRuntimeArguments({ socksPort = 'auto', controlPort = 'auto', controlPortFile, cookiePath, dataDirectory, geoip, geoip6, country, bridgeArgs = [] }) {
  if (socksPort !== 'auto' && (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65535)) throw new TypeError('Port SOCKS local invalide.');
  if (controlPort !== 'auto' && (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535)) throw new TypeError('Port ControlPort invalide.');
  if (!isTorExitSelection(country)) throw new TypeError(TOR_EXIT_COUNTRY_ERROR);
  for (const value of [cookiePath, dataDirectory, geoip, geoip6]) {
    if (typeof value !== 'string' || !value || /[\u0000-\u001f]/.test(value)) throw new TypeError('Chemin de configuration Tor invalide.');
  }
  if (!Array.isArray(bridgeArgs) || bridgeArgs.some((value) => typeof value !== 'string' || /[\u0000-\u001f]/.test(value))) throw new TypeError('Arguments de pont Tor invalides.');
  const controlTarget = controlPort === 'auto' ? 'auto' : `127.0.0.1:${controlPort}`;
  return [
    '--SocksPort', `${socksPort === 'auto' ? '127.0.0.1:auto' : `127.0.0.1:${socksPort}`} IsolateSOCKSAuth`,
    '--SocksPolicy', 'accept 127.0.0.1/32',
    '--SocksPolicy', 'reject *',
    '--ControlPort', controlTarget,
    ...(controlPort === 'auto' ? ['--ControlPortWriteToFile', controlPortFile || require('node:path').join(dataDirectory, 'control-port')] : []),
    '--CookieAuthentication', '1',
    '--CookieAuthFile', cookiePath,
    '--CookieAuthFileGroupReadable', '0',
    '--DataDirectory', dataDirectory,
    '--DataDirectoryGroupReadable', '0',
    '--AvoidDiskWrites', '1',
    '--SafeLogging', '1',
    '--DNSPort', '0',
    '--AutomapHostsOnResolve', '0',
    '--GeoIPFile', geoip,
    '--GeoIPv6File', geoip6,
    ...(country === TOR_EXIT_AUTO ? [] : ['--ExitNodes', `{${country.toLowerCase()}}`, '--StrictNodes', '1']),
    '--ClientOnly', '1',
    '--SafeSocks', '1',
    ...bridgeArgs,
    '--Log', 'notice stdout'
  ];
}

module.exports = { buildTorRuntimeArguments };
