'use strict';

// Run existing security fixtures using the ordinary OS sandbox throughout.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, '.cache/memory/verification');
fs.mkdirSync(out, { recursive: true });
const safeHelper = path.join(__dirname, 'test-support/sandboxed-electron-fixture.cjs');
const legacyHelper = path.join(__dirname, 'test-support/electron-fixture.cjs');
const env = { ...process.env, NACRE_ELECTRON_FIXTURE_HELPER: safeHelper };
const suiteOnly = process.argv.includes('--suite-only');
const resultPath = path.join(out, 'results.json');
const records = suiteOnly && fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : [];
function run(id, args, timeout = 180000) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 20000000 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(out, id + '.log'), output);
  const previous = records.findIndex(record => record.id === id);
  if (previous >= 0) records.splice(previous, 1);
  records.push({ id, startedAt, endedAt: new Date().toISOString(), exitCode: result.status, error: result.error?.message, output });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(records, null, 2));
  console.log('MEMORY_VERIFICATION ' + id + ' exit=' + result.status);
  if (result.status !== 0) { console.error(output.slice(-6000)); process.exitCode = 1; }
}
run('suite', ['--test', '--test-concurrency=1']);
if (suiteOnly) process.exit(process.exitCode || 0);
const bootstrap = `const safe=require(${JSON.stringify(safeHelper)});require.cache[require.resolve(${JSON.stringify(legacyHelper)})].exports=safe;require(process.argv[1]);`;
for (const [id, script] of [
  ['hardening', 'verify-hardening-runtime.cjs'],
  ['workspace-isolation', 'verify-workspace-isolation-runtime.cjs'],
  ['fingerprint', 'verify-fingerprint-runtime.cjs'],
  ['tor-control-offline', 'verify-tor-control-runtime.cjs']
]) run(id, ['-e', bootstrap, path.join(__dirname, script)], 240000);
const adblockProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'nacre-adblock-memory-'));
const adblockBootstrap = `const result=require(${JSON.stringify(safeHelper)}).launch([${JSON.stringify(path.join(__dirname, 'verify-adblock-delivery.cjs'))}],{env:{...process.env,NACRE_ADBLOCK_ROOT:${JSON.stringify(root)},NACRE_ADBLOCK_PROFILE:${JSON.stringify(adblockProfile)}},encoding:'utf8',timeout:90000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status===0?0:1);`;
run('ghostery-delivery', ['-e', adblockBootstrap]);
