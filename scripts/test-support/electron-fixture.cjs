'use strict';

// Shared launcher for Electron-backed verification fixtures.
//
// Electron 44 aborts with STATUS_BREAKPOINT (0x80000003) before any application
// JavaScript runs on some Windows hosts, including the Windows 11 26200 build
// used for this checkout. On Windows the fixtures therefore run with
// --no-sandbox by default. The limitation is printed so the release capture
// records it: these fixtures still exercise Nacre's webPreferences, preload and
// IPC isolation, but they do not verify the Chromium OS-level sandbox.
// Set NACRE_ELECTRON_SANDBOX=1 to force the ordinary sandboxed launch; an
// observed STATUS_BREAKPOINT still triggers one documented retry.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const STATUS_BREAKPOINT = 0x80000003;
let limitationAnnounced = false;
let sandboxDecision = null;

// Chromium disk-cache paths can overflow MAX_PATH under a deep checkout. When
// Windows 8.3 names are available, use the short form of the fixture directory.
function shortWindowsPath(target) {
  if (process.platform !== 'win32' || /\s/.test(target)) return target;
  const result = spawnSync('cmd.exe', ['/d', '/c', `for %I in (${target}) do @echo %~sI`], { encoding: 'utf8', windowsHide: true });
  const value = String(result.stdout || '').trim().split(/\r?\n/).at(-1);
  return value && value.length < target.length && value !== target ? value : target;
}

// Chromium CacheStorage cannot create its index under a directory that
// inherits a Everyone "delete child" deny ACE (the DSH workspace ACL does).
// Scope the repair to the disposable fixture directory only.
function prepareWindowsFixtureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  if (process.platform !== 'win32') return directory;
  spawnSync('icacls', [directory, '/inheritance:d'], { encoding: 'utf8', windowsHide: true });
  spawnSync('icacls', [directory, '/remove:d', '*S-1-1-0'], { encoding: 'utf8', windowsHide: true });
  return directory;
}

function electronBinary() {
  return require('electron');
}

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function announceSandboxLimitation() {
  if (limitationAnnounced) return;
  limitationAnnounced = true;
  process.stderr.write(
    'LIMITATION Electron fixtures run with --no-sandbox on Windows in this validation environment '
    + '(Electron 44 aborts with 0x80000003 before app startup otherwise). '
    + 'Chromium OS-level sandbox isolation is not verified by these fixtures.\n'
  );
}

function useNoSandbox() {
  if (sandboxDecision === null) {
    sandboxDecision = process.platform === 'win32' && process.env.NACRE_ELECTRON_SANDBOX !== '1';
  }
  return sandboxDecision;
}

// Runs an Electron fixture. The ordinary sandboxed launch is attempted when the
// caller opts in; an observed STATUS_BREAKPOINT before application code triggers
// one retry with --no-sandbox.
function launch(args = [], options = {}) {
  const optionsWithEnvironment = { ...options, env: cleanEnvironment(options.env), windowsHide: true };
  const initialArgs = useNoSandbox() && !args.includes('--no-sandbox') ? ['--no-sandbox', ...args] : args;
  if (initialArgs.includes('--no-sandbox')) announceSandboxLimitation();
  let result = spawnSync(electronBinary(), initialArgs, optionsWithEnvironment);
  if (result.status !== STATUS_BREAKPOINT || initialArgs.includes('--no-sandbox')) return result;
  announceSandboxLimitation();
  sandboxDecision = true;
  result = spawnSync(electronBinary(), ['--no-sandbox', ...args], optionsWithEnvironment);
  return result;
}

function packagedSandboxArguments() {
  // The packaged smoke test starts the real Nacre.exe; apply the same explicit
  // workaround rather than failing before the application can be measured.
  if (process.platform !== 'win32' || process.env.NACRE_ELECTRON_SANDBOX === '1') return [];
  announceSandboxLimitation();
  return ['--no-sandbox'];
}

module.exports = {
  STATUS_BREAKPOINT,
  electronBinary,
  cleanEnvironment,
  launch,
  packagedSandboxArguments,
  announceSandboxLimitation,
  shortWindowsPath,
  prepareWindowsFixtureDirectory
};
