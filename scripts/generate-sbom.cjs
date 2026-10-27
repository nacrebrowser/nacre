'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const packageInfo = require('../package.json');

const root = path.resolve(__dirname, '..');
const store = path.join(root, 'node_modules', '.pnpm');
const components = new Map();
const directRuntime = new Set(Object.keys(packageInfo.dependencies || {}));
const directBuild = new Set(Object.keys(packageInfo.devDependencies || {}));

function packageLicense(manifest) {
  const raw = manifest.license;
  if (typeof raw === 'string' && raw !== 'UNLICENSED') {
    if (/^[A-Za-z0-9.+()-]+(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9.+()-]+)*$/.test(raw)) return raw.includes(' ') ? { expression: raw } : { id: raw };
    return { name: raw };
  }
  if (Array.isArray(manifest.licenses) && manifest.licenses.some((item) => typeof item.type === 'string')) {
    return { name: manifest.licenses.map((item) => item.type).filter(Boolean).join(' OR ') };
  }
  return { name: 'NOASSERTION' };
}

function addNpmPackage(manifest) {
  if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return;
  const key = `${manifest.name}@${manifest.version}`;
  const license = packageLicense(manifest);
  const component = {
    type: 'library',
    group: manifest.name.startsWith('@') ? manifest.name.split('/')[0] : undefined,
    name: manifest.name.startsWith('@') ? manifest.name.split('/')[1] : manifest.name,
    version: manifest.version,
    purl: `pkg:npm/${encodeURIComponent(manifest.name).replace(/%2F/gi, '/')}` + `@${manifest.version}`,
    licenses: [{ license }],
    properties: [{ name: 'nacre:dependency-role', value: directRuntime.has(manifest.name) ? 'direct-runtime' : directBuild.has(manifest.name) ? 'direct-build' : 'transitive-or-tooling' }]
  };
  if (manifest.homepage) component.externalReferences = [{ type: 'website', url: manifest.homepage }];
  components.set(key, component);
}

function walkInstalledPackages() {
  for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(store, entry.name, 'node_modules');
    if (!fs.existsSync(packageRoot)) continue;
    for (const top of fs.readdirSync(packageRoot, { withFileTypes: true })) {
      if (!top.isDirectory() || top.isSymbolicLink()) continue;
      const topPath = path.join(packageRoot, top.name);
      if (top.name.startsWith('@')) {
        for (const nested of fs.readdirSync(topPath, { withFileTypes: true })) {
          if (!nested.isDirectory() || nested.isSymbolicLink()) continue;
          const manifestPath = path.join(topPath, nested.name, 'package.json');
          try { addNpmPackage(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); } catch {}
        }
      } else {
        try { addNpmPackage(JSON.parse(fs.readFileSync(path.join(topPath, 'package.json'), 'utf8'))); } catch {}
      }
    }
  }
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function addFileComponent(name, version, relativePath, license) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return;
  components.set(`${name}@${version}`, {
    type: 'application', name, version, licenses: [{ license: { name: license } }],
    hashes: [{ alg: 'SHA-256', content: sha256(file) }],
    properties: [{ name: 'nacre:file', value: relativePath.replace(/\\/g, '/') }]
  });
}

function addExternalComponent(name, version, license, sourceUrl) {
  const key = `${name}@${version}`;
  const previous = components.get(key);
  if (previous) {
    if (!previous.externalReferences.some((reference) => reference.url === sourceUrl)) previous.externalReferences.push({ type: 'distribution', url: sourceUrl });
    return;
  }
  components.set(key, {
    type: 'file', name, version,
    licenses: [{ license: /^[A-Za-z0-9.+()-]+(?:\s+(?:AND|OR)\s+[A-Za-z0-9.+()-]+)*$/.test(license) ? (license.includes(' ') ? { expression: license } : { id: license }) : { name: license } }],
    externalReferences: [{ type: 'distribution', url: sourceUrl }],
    properties: [{ name: 'nacre:snapshot-sha256', value: filterMetadata.sha256 }]
  });
}

walkInstalledPackages();
const tor = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'tor', 'tor.sha256.json'), 'utf8'));
for (const [name, version, rel, license] of [
  ['Tor', tor.version, 'vendor/tor/tor.exe', 'BSD-3-Clause; notices bundled'],
  ['Lyrebird transports (obfs4/Snowflake)', tor.version, 'vendor/tor/pluggable_transports/lyrebird.exe', 'Multiple; see vendor/tor/licenses/lyrebird.txt'],
  ['Conjure client', tor.version, 'vendor/tor/pluggable_transports/conjure-client.exe', 'Multiple; see vendor/tor/licenses/conjure.txt'],
  ['Filter data snapshot', '2026-10-11', 'vendor/filters/engine.bin', 'Mixed/uncertain; see THIRD_PARTY_NOTICES.md']
]) addFileComponent(name, version, rel, license);
addFileComponent('Tor GeoIP IPv4 data', tor.version, 'vendor/tor/geoip', 'Tor bundle notices');
addFileComponent('Tor GeoIP IPv6 data', tor.version, 'vendor/tor/geoip6', 'Tor bundle notices');

const filterMetadata = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'filters', 'metadata.json'), 'utf8'));
for (const source of filterMetadata.sources || []) {
  const lower = source.toLowerCase();
  let name = 'Filter source';
  let license = 'NOASSERTION; review source license before redistribution';
  if (lower.includes('easyprivacy')) { name = 'EasyPrivacy'; license = 'GPL-3.0-or-later OR CC-BY-SA-3.0'; }
  else if (lower.includes('easylist')) { name = 'EasyList'; license = 'GPL-3.0-or-later OR CC-BY-SA-3.0'; }
  else if (lower.includes('peter-lowe')) { name = "Peter Lowe's list"; license = 'McRae General Public License v4.r53; redistribution review required'; }
  else if (lower.includes('ublock-origin')) { name = 'uBlock Origin uAssets'; license = 'GPL-3.0-or-later'; }
  addExternalComponent(name, `snapshot-${filterMetadata.sha256.slice(0, 12)}`, license, source);
}

const appComponent = { type: 'application', name: packageInfo.name, version: packageInfo.version };
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: { timestamp: new Date().toISOString(), component: appComponent },
  components: [...components.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
};
const output = path.join(root, 'SBOM.cdx.json');
fs.writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`);
process.stdout.write(`SBOM CycloneDX 1.5 : ${path.relative(root, output)} (${bom.components.length} composants)\n`);
