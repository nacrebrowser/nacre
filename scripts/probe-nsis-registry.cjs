'use strict';
// Only a fresh fixture registry key is written and removed.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(root, '.cache', 'nsis-registry-'));
const cache = path.join(root, '.cache/electron-builder/nsis@1.2.1');
const bundle = fs.readdirSync(cache).find(n => fs.existsSync(path.join(cache, n, 'windows/Bin/makensis.exe')));
const nsis = process.argv[2] ? path.resolve(process.argv[2]) : path.join(cache, bundle, 'windows');
const compiler = fs.existsSync(path.join(nsis, 'Bin/makensis.exe')) ? path.join(nsis, 'Bin/makensis.exe') : path.join(nsis, 'makensis.exe');
const key = 'Software\\NacreProbe-' + crypto.randomUUID();
const output = path.join(folder, 'result.txt');
const exe = path.join(folder, 'probe.exe'), script = path.join(folder, 'probe.nsi');
let source = `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nOutFile "${exe}"\nSection\nFileOpen $9 "${output}" w\n`;
source += `System::Call 'advapi32::OpenProcessToken(p -1, i 8, *p.r0)i.r1'\nFileWrite $9 "open-token=$1 handle=$0$\\r$\\n"\nSystem::Call 'advapi32::GetTokenInformation(p r0,i 29,*i.r2,i 4,*i.r3)i.r1'\nFileWrite $9 "token-info=$1 appcontainer=$2$\\r$\\n"\nSystem::Alloc 128\nPop $4\nSystem::Call 'advapi32::GetTokenInformation(p r0,i 25,p r4,i 128,*i.r3)i.r1'\nIntCmp $1 0 skip_integrity\nSystem::Call '*$4(p.r5)'\nSystem::Call 'advapi32::GetSidSubAuthority(p r5,i 0)p.r6'\nSystem::Call '*$6(i.r7)'\nFileWrite $9 "integrity-rid=$7$\\r$\\n"\nskip_integrity:\nSystem::Free $4\nSystem::Call 'kernel32::CloseHandle(p r0)'\nReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\04e7985e-e5f5-5e1a-9988-74f54e7da266" "DisplayVersion"\nFileWrite $9 "existing-version=$0$\\r$\\n"\n`;
for (const view of [32, 64]) source += `SetRegView ${view}\nClearErrors\nWriteRegStr HKCU "${key}" "value" "test"\nIfErrors 0 +3\nFileWrite $9 "write${view}=ERROR$\\r$\\n"\nGoto +2\nFileWrite $9 "write${view}=OK$\\r$\\n"\nSystem::Call 'kernel32::GetLastError()i.r1'\nReadRegStr $0 HKCU "${key}" "value"\nFileWrite $9 "view${view} value=$0 lastError=$1$\\r$\\n"\nDeleteRegKey HKCU "${key}"\n`;
source += `System::Call 'advapi32::RegCreateKeyExW(p 0x80000001, w "${key}", i 0, p 0, i 0, i 0x2001f, p 0, *p.r0, p 0)i.r1'\nFileWrite $9 "direct-create=$1$\\r$\\n"\nSystem::Call 'advapi32::RegCloseKey(p r0)'\nSystem::Call 'advapi32::RegDeleteKeyW(p 0x80000001, w "${key}")i.r1'\nFileWrite $9 "direct-delete=$1$\\r$\\n"\nFileClose $9\nSectionEnd\n`;
fs.writeFileSync(script, source);
for (const [program, args] of [[compiler, ['/V2', script]], [exe, ['/S']]]) {
  const r = spawnSync(program, args, { env: { ...process.env, NSISDIR: nsis }, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error(String(r.error || '') + r.stdout + r.stderr);
}
const result = fs.readFileSync(output, 'utf8');
console.log(result.split(/\r?\n/).filter(line => !line.startsWith('groups=') && !line.startsWith('"')).join('\n'));
console.log('Fixture: ' + folder);
