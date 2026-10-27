'use strict';

function chromeMajor(version) {
  const major = Number.parseInt(String(version || '').split('.')[0], 10);
  if (!Number.isInteger(major) || major < 1 || major > 999) throw new TypeError('Version Chromium invalide.');
  return major;
}

function buildChromeUserAgent(version, platform = 'Windows NT 10.0; Win64; x64') {
  const major = chromeMajor(version);
  if (!/^[A-Za-z0-9 ;._()-]{1,100}$/.test(platform)) throw new TypeError('Plateforme invalide.');
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function buildChromeUserAgentMetadata(version, platform = 'Windows', platformVersion = '10.0.0') {
  const major = String(chromeMajor(version));
  return {
    brands: [
      { brand: 'Not_A Brand', version: '99' },
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major }
    ],
    fullVersionList: [
      { brand: 'Not_A Brand', version: '99.0.0.0' },
      { brand: 'Chromium', version: `${major}.0.0.0` },
      { brand: 'Google Chrome', version: `${major}.0.0.0` }
    ],
    platform,
    platformVersion,
    architecture: 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false
  };
}

function buildClientHintHeaders(version, platform = 'Windows') {
  const major = String(chromeMajor(version));
  const brands = `"Not_A Brand";v="99", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
  const fullBrands = `"Not_A Brand";v="99.0.0.0", "Chromium";v="${major}.0.0.0", "Google Chrome";v="${major}.0.0.0"`;
  return {
    'Sec-CH-UA': brands,
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': `"${platform}"`,
    'Sec-CH-UA-Full-Version': `"${major}.0.0.0"`,
    'Sec-CH-UA-Full-Version-List': fullBrands,
    'Sec-CH-UA-Platform-Version': '"10.0.0"',
    'Sec-CH-UA-Arch': '"x86"',
    'Sec-CH-UA-Bitness': '"64"',
    'Sec-CH-UA-Model': '""',
    'Sec-CH-UA-WoW64': '?0',
    'Sec-CH-UA-Form-Factors': '"Desktop"'
  };
}

function applyPrivacySignals(headers, preferences = {}) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'dnt' || key.toLowerCase() === 'sec-gpc') delete headers[key];
  }
  if (preferences.sendGpc !== false) headers['Sec-GPC'] = '1';
  if (preferences.sendDnt === true) headers.DNT = '1';
  return headers;
}

module.exports = { chromeMajor, buildChromeUserAgent, buildChromeUserAgentMetadata, buildClientHintHeaders, applyPrivacySignals };
