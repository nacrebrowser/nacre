'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const scratch = fs.mkdtempSync(path.join(root, '.cache', 'nacre-redteam-mutation-'));

const mutations = [
  {
    name: 'fail-closed proxy',
    source: 'src/network-security.cjs',
    test: 'test/network-security.test.cjs',
    before: "    mode: 'fixed_servers',",
    after: "    mode: 'system',"
  },
  {
    name: 'IPC sender validation',
    source: 'src/security-core.cjs',
    test: 'test/electron-security.test.cjs',
    before: "return url.protocol === 'nacre:' && INTERNAL_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;",
    after: 'return true;'
  },
  {
    name: 'CSP on internal responses',
    source: 'src/internal-response.cjs',
    test: 'test/electron-security.test.cjs',
    before: "; frame-ancestors 'none'",
    after: ''
  },
  {
    name: 'permission denial by default',
    source: 'src/privacy-core.cjs',
    test: 'test/privacy-core.test.cjs',
    before: "return isAllowedPermissionMode(value) ? value : 'deny';",
    after: "return isAllowedPermissionMode(value) ? value : 'allow';"
  },
  {
    name: 'pinned Tor hash verification',
    source: 'src/tor-integrity.cjs',
    test: 'test/tor-hardening.test.cjs',
    before: 'if (actual !== expected) mismatches.push',
    after: 'if (false && actual !== expected) mismatches.push'
  },
  {
    name: 'TLS certificate validation in Tor downloader',
    source: 'scripts/download-tor.cjs',
    test: 'test/security-regressions.test.cjs',
    before: 'https.get(parsed, (response)',
    after: 'https.get(parsed, { rejectUnauthorized: false }, (response)'
  },
  {
    name: 'initiator-less third-party cookie blocking',
    source: 'src/network-security.cjs',
    test: 'test/network-security.test.cjs',
    before: 'return Boolean(isThirdParty || (!hasInitiator && resourceType !== \'mainFrame\'));',
    after: 'return false;'
  },
  {
    name: 'download filename sanitizing',
    source: 'src/data-policy.cjs',
    test: 'test/redteam-attacks.test.cjs',
    before: "const stem = filename.split('.')[0].replace(/ +$/, '');",
    after: "const stem = '';"
  },
  {
    name: 'site permission writes on inherited keys',
    source: 'src/privacy-core.cjs',
    test: 'test/privacy-core.test.cjs',
    before: "if (!Object.hasOwn(sitePermissions, host) || !sitePermissions[host] || typeof sitePermissions[host] !== 'object') {",
    after: 'if (false) {'
  },
  {
    name: 'automatic open of risky page-triggered downloads',
    source: 'src/main.cjs',
    test: 'test/electron-security.test.cjs',
    before: "if (automatic) { tell('Fichier non ouvert automatiquement",
    after: "if (false) { tell('Fichier non ouvert automatiquement"
  }
];

function copyTestEnvironment() {
  fs.cpSync(path.join(root, 'src'), path.join(scratch, 'src'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'test'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'scripts'), { recursive: true });
  for (const mutation of mutations) {
    const source = path.join(root, mutation.test);
    const destination = path.join(scratch, mutation.test);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  for (const file of ['scripts/electron-fuse-policy.cjs', 'scripts/download-tor.cjs']) {
    const source = path.join(root, file);
    const destination = path.join(scratch, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  for (const file of ['package.json']) fs.copyFileSync(path.join(root, file), path.join(scratch, file));
}

function runTest(file) {
  return spawnSync(process.execPath, ['--test', file], {
    cwd: scratch,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
}

function main() {
  copyTestEnvironment();
  const results = [];
  for (const mutation of mutations) {
    const source = path.join(scratch, mutation.source);
    const content = fs.readFileSync(source, 'utf8');
    if (!content.includes(mutation.before)) throw new Error(`Mutation anchor missing: ${mutation.name}`);
    fs.writeFileSync(source, content.replace(mutation.before, mutation.after), 'utf8');
    const result = runTest(mutation.test);
    fs.writeFileSync(source, content, 'utf8');
    const detected = result.status !== 0 && (result.stdout || '').includes('fail');
    results.push({ name: mutation.name, detected, exit: result.status, error: result.error && result.error.message });
    process.stdout.write(`${detected ? 'DETECTED' : 'MISSED'} ${mutation.name}\n`);
    if (!detected && result.stdout) process.stdout.write(result.stdout.slice(-4000));
  }
  const missed = results.filter((result) => !result.detected);
  process.stdout.write(`Mutation checks: ${results.length - missed.length}/${results.length} detected\n`);
  if (missed.length) process.exitCode = 1;
}

try { main(); }
catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
finally { fs.rmSync(scratch, { recursive: true, force: true }); }
