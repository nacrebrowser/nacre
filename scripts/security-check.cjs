'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const packageInfo = require('../package.json');
const { verifyPinnedTorFiles, TOR_FILE_PINS } = require('../src/tor-integrity.cjs');
const { isFilterMetadataFor } = require('../src/filter-metadata.cjs');
const { verifyFuseWire, loadFuseApi } = require('./electron-fuse-policy.cjs');

const root = path.resolve(__dirname, '..');
const results = [];
let failed = false;

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failed = true;
}

function pnpmCommand() {
  const execPath = process.env.npm_execpath;
  if (execPath) {
    const resolved = path.resolve(execPath);
    if (/pnpm(?:-native)?\.exe$/i.test(resolved)) return { executable: resolved, prefixArgs: [] };
    if (/pnpm\.c?js$/i.test(resolved)) return { executable: process.execPath, prefixArgs: [resolved] };
    if (/pnpm\.cmd$/i.test(resolved) && process.platform === 'win32') return { executable: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', resolved] };
    try {
      const command = JSON.parse(fs.readFileSync(resolved, 'utf8')).command;
      if (typeof command === 'string' && /pnpm/i.test(command)) return { executable: process.execPath, prefixArgs: [path.resolve(path.dirname(resolved), command)] };
    } catch {}
  }
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  if (fs.existsSync(local)) return process.platform === 'win32'
    ? { executable: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', local] }
    : { executable: local, prefixArgs: [] };
  return process.platform === 'win32'
    ? { executable: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'pnpm'] }
    : { executable: 'pnpm', prefixArgs: [] };
}

function run(label, executable, args, options = {}) {
  process.stdout.write(`\n[${label}]\n`);
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 180_000,
    maxBuffer: 12 * 1024 * 1024,
    // Keep shell disabled for all fixed maintenance commands. Windows exposes
    // pnpm through a .cmd shim, so invoke cmd.exe explicitly with a constant
    // command; no file names or user input are interpolated into it.
    shell: false,
    env: {
      ...process.env,
      ...(options.offline ? { npm_config_offline: 'true', PNPM_CONFIG_OFFLINE: 'true', npm_config_audit: 'false' } : {})
    }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return { ok: result.status === 0, status: result.status, error: result.error && result.error.message, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// Advisories accepted only when they are absent from the production tree
// (`pnpm ls --prod`, offline). Each entry is an exact advisory/module/version
// triple; anything else still fails the check.
const ACCEPTED_DEV_ONLY_ADVISORIES = Object.freeze([
  Object.freeze({
    id: 'GHSA-hp3w-g68c-fv3c',
    module: 'sprintf-js',
    version: '1.1.3',
    reason: 'chaîne devDependency electron-builder > app-builder-lib > @electron/get > global-agent > roarr; aucune version corrigée publiée (1.1.3 reste la dernière)'
  })
]);

function parseAuditJson(audit) {
  const text = `${audit.stdout || ''}\n${audit.stderr || ''}`.trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) try { parsed = JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return parsed;
}

function parseAuditAdvisories(audit) {
  const parsed = parseAuditJson(audit);
  const advisories = parsed && parsed.advisories && typeof parsed.advisories === 'object' ? Object.values(parsed.advisories) : [];
  return advisories.map((advisory) => ({
    id: advisory.github_advisory_id || '',
    module: advisory.module_name || '',
    version: advisory.findings?.[0]?.version || ''
  }));
}

// Accepts a finding only when every advisory is an exact ACCEPTED entry AND the
// production tree listing contains no copy of that module.
function evaluateAuditWithDevException(audit, prodListing) {
  const summary = parseAuditSummary(audit);
  if (summary.ok) return summary;
  const advisories = parseAuditAdvisories(audit);
  if (!advisories.length) return summary;
  const accepted = (advisory) => ACCEPTED_DEV_ONLY_ADVISORIES.some((entry) => entry.id === advisory.id && entry.module === advisory.module && entry.version === advisory.version);
  if (!advisories.every(accepted)) return summary;
  if (!String(prodListing || '').trim()) return { ok: false, detail: `${summary.detail}; arbre de production illisible, exception refusée` };
  const inProduction = String(prodListing || '').split(/\r?\n/).some((line) => /[\\/]sprintf-js(?:[\\/]|$)/.test(line));
  if (inProduction) return { ok: false, detail: `${summary.detail}; avis accepté présent dans l’arbre de production` };
  const reasons = advisories.map((advisory) => `${advisory.module}@${advisory.version} ${advisory.id}: ${ACCEPTED_DEV_ONLY_ADVISORIES.find((entry) => entry.id === advisory.id).reason}`);
  return { ok: true, detail: `avis dev-only accepté (absent de pnpm ls --prod) — ${reasons.join('; ')}` };
}

function parseAuditSummary(audit) {
  const parsed = parseAuditJson(audit);
  const advisories = parsed && parsed.advisories && typeof parsed.advisories === 'object' ? Object.values(parsed.advisories) : [];
  const findings = advisories.map((advisory) => `${advisory.module_name || 'package'}@${advisory.findings?.[0]?.version || 'version inconnue'} (${advisory.severity || 'sévérité inconnue'}, ${advisory.github_advisory_id || advisory.url || 'avis local'})`);
  if (findings.length) return { ok: false, detail: `${findings.length} avis identifié(s): ${findings.join('; ')}` };
  const vulnerabilityCount = Number(parsed?.metadata?.vulnerabilities?.total || 0);
  if (vulnerabilityCount > 0) return { ok: false, detail: `${vulnerabilityCount} vulnérabilité(s) dans le rapport JSON local` };
  if (audit.status === 0) return { ok: true, detail: 'aucun avis dans la base locale hors ligne' };
  const reason = parsed?.error?.message || audit.error || `exit=${audit.status ?? 'unknown'}`;
  return { ok: false, detail: `audit inconclusif (${reason}); aucun accès réseau autorisé` };
}

function trackedAndWorkingFiles() {
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (listed.status !== 0) throw new Error('Git ne peut pas inventorier les fichiers publiables.');
  return [...new Set(listed.stdout.split(/\r?\n/).filter(Boolean))].filter((relative) => {
    const normalized = relative.replace(/\\/g, '/');
    return !normalized.startsWith('.git/') && !normalized.startsWith('node_modules/') && !normalized.startsWith('dist/') && !normalized.startsWith('.cache/') && normalized !== 'RECAP_NACRE.md';
  });
}

function main() {
  const tests = run('Tests unitaires', process.execPath, ['--test']);
  report('Tests unitaires', tests.ok, tests.ok ? 'node --test' : `exit=${tests.status ?? tests.error ?? 'unknown'}`);

  const appExe = path.join(path.resolve(root, process.argv[2] || 'dist/win-unpacked'), 'Nacre.exe');
  try {
    if (!fs.existsSync(appExe)) throw new Error(`${appExe} absent; build the candidate first or pass its unpacked directory.`);
    const fuseApi = loadFuseApi();
    Promise.resolve(fuseApi.getCurrentFuseWire(appExe)).then((wire) => {
      report('Fuses de l’exécutable empaqueté', verifyFuseWire(wire), verifyFuseWire(wire) ? 'état attendu relu' : 'état différent');
      continueChecks();
    }).catch((error) => {
      report('Fuses de l’exécutable empaqueté', false, error.message);
      continueChecks();
    });
  } catch (error) {
    report('Fuses de l’exécutable empaqueté', false, error.message);
    continueChecks();
  }

  function continueChecks() {
    // pnpm audit is explicitly offline: this command never sends the dependency
    // graph to a registry. An absent cache/advisory database is a hard, honest
    // failure that requires a separately approved online audit.
    const pnpm = pnpmCommand();
    const audit = run('Audit de dépendances hors ligne', pnpm.executable, [...pnpm.prefixArgs, 'audit', '--offline', '--json'], { offline: true, timeout: 60_000 });
    const prodListing = run('Arbre de production hors ligne', pnpm.executable, [...pnpm.prefixArgs, 'ls', '--prod', '--depth', 'Infinity', '--parseable'], { offline: true, timeout: 60_000 });
    const auditSummary = evaluateAuditWithDevException(audit, prodListing.ok ? prodListing.stdout : '');
    report('Audit de dépendances (avis locaux uniquement)', auditSummary.ok, auditSummary.detail);

    const scan = runStaticChecks();
    for (const item of scan) report(item.name, item.ok, item.detail);
    report('Empreintes des binaires Tor', verifyPinnedTorFiles(path.join(root, 'vendor', 'tor')).valid, Object.keys(TOR_FILE_PINS).join(', '));
    const engineFile = path.join(root, 'vendor', 'filters', 'engine.bin');
    const metadataFile = path.join(root, 'vendor', 'filters', 'metadata.json');
    let filterIntegrity = false;
    try { filterIntegrity = isFilterMetadataFor(fs.readFileSync(engineFile), JSON.parse(fs.readFileSync(metadataFile, 'utf8'))); } catch {}
    report('Intégrité du snapshot filtres', filterIntegrity, 'SHA-256 local comparé aux métadonnées intégrées');
    validateLicenses();
    process.stdout.write(`\nRésultat security-check : ${failed ? 'ÉCHEC / vulnérabilité connue ou contrôles incomplets' : 'TOUS LES CONTRÔLES PASSENT'}\n`);
    if (failed) process.exitCode = 1;
  }
}

function runStaticChecks() {
  const files = trackedAndWorkingFiles();
  const contents = new Map();
  for (const relative of files) {
    const absolute = path.join(root, relative);
    try { if (fs.statSync(absolute).isFile()) contents.set(relative.replace(/\\/g, '/'), fs.readFileSync(absolute, 'utf8')); } catch {}
  }
  const product = [...contents.entries()].filter(([file]) => file.startsWith('src/') && /\.(?:cjs|js|html)$/.test(file));
  const dangerous = [];
  for (const [file, text] of product) {
    for (const [kind, pattern] of [['eval()', /\beval\s*\(/], ['new Function', /\bnew\s+Function\s*\(/]]) {
      if (pattern.test(text)) dangerous.push(`${file}: ${kind}`);
    }
    if (/\bnet\.request\s*\(/.test(text)) dangerous.push(`${file}: net.request direct`);
    if (/\bshell\.openExternal\s*\(/.test(text)) dangerous.push(`${file}: shell.openExternal doit passer par le helper contrôlé`);
  }

  const main = contents.get('src/main.cjs') || '';
  const fetchBypasses = findUnproxiedFetchCalls(main);
  const fetchLines = main.split(/\r?\n/).filter((line) => /\bfetch\s*\(/.test(line));
  const ipcTest = contents.get('test/electron-security.test.cjs') || '';
  const ipcInventoryTest = /every privileged IPC handler checks the trusted internal frame/.test(ipcTest)
    && ipcTest.includes('assert.match(firstLines, /isTrustedUIEvent\\(event\\)/');
  const username = os.userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const localPattern = new RegExp(`[A-Z]:[\\\\/]Users[\\\\/]${username}(?:[\\\\/]|$)`, 'i');
  const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/;
  const pathLeaks = [];
  const secretLeaks = [];
  for (const [file, text] of contents) {
    if (localPattern.test(text)) pathLeaks.push(file);
    if (secretPattern.test(text)) secretLeaks.push(file);
  }
  return [
    { name: 'Motifs dangereux (eval/new Function/net.request/shell.openExternal)', ok: dangerous.length === 0, detail: dangerous.join('; ') || 'aucun motif dans les fichiers applicatifs' },
    { name: 'Requêtes main process sans session proxifiée', ok: fetchBypasses.length === 0 && fetchLines.length > 0, detail: fetchBypasses.join('; ') || `${fetchLines.length} lignes inspectées; electronNet.fetch limité aux URL file: du protocole nacre://` },
    { name: 'Validation IPC de l’émetteur couverte', ok: ipcInventoryTest, detail: 'test/electron-security.test.cjs inspecte tous les handlers main' },
    { name: 'Chemins locaux personnels absents', ok: pathLeaks.length === 0, detail: pathLeaks.join(', ') || 'aucun chemin utilisateur/repo détecté' },
    { name: 'Secrets évidents absents', ok: secretLeaks.length === 0, detail: secretLeaks.join(', ') || 'aucune clé privée ou clé API reconnue' }
  ];
}

function findUnproxiedFetchCalls(source) {
  const violations = [];
  for (const [lineNumber, line] of String(source).split(/\r?\n/).entries()) {
    const matcher = /\b((?:[A-Za-z_$][\w$]*\.)*)fetch\s*\(/g;
    let match;
    while ((match = matcher.exec(line))) {
      const owner = String(match[1] || '').replace(/\.$/, '').replace(/\s/g, '');
      const sessionOwned = ['regularSession', 'ses', 'tab.pageView.webContents.session'].includes(owner);
      const internalFile = owner === 'electronNet' && /electronNet\.fetch\s*\(\s*pathToFileURL\s*\(/.test(line);
      if (!sessionOwned && !internalFile) violations.push(`ligne ${lineNumber + 1}: ${line.trim().slice(0, 160)}`);
    }
  }
  return violations;
}

function validateLicenses() {
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const bom = JSON.parse(fs.readFileSync(path.join(root, 'SBOM.cdx.json'), 'utf8'));
  const direct = Object.keys(packageInfo.dependencies || {}).concat(Object.keys(packageInfo.devDependencies || {}));
  const entries = new Set(bom.components.map((component) => `${component.group ? component.group + '/' : ''}${component.name}`));
  const missingSbom = direct.filter((name) => !entries.has(name));
  const missingNotices = direct.filter((name) => !notices.includes(name));
  const badLicenses = bom.components.filter((component) => !Array.isArray(component.licenses) || component.licenses.length === 0 || !component.licenses[0].license);
  report('SBOM CycloneDX et dépendances directes', bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.5' && missingSbom.length === 0, missingSbom.join(', ') || `${bom.components.length} composants`);
  report('Notices des dépendances directes', missingNotices.length === 0, missingNotices.join(', ') || 'chaque dépendance directe documentée');
  report('Licences déclarées dans le SBOM', badLicenses.length === 0, badLicenses.map((component) => component.name).join(', ') || 'aucun champ de licence vide; NOASSERTION reste explicitement possible');
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { findUnproxiedFetchCalls, parseAuditSummary, evaluateAuditWithDevException, pnpmCommand, ACCEPTED_DEV_ONLY_ADVISORIES };
