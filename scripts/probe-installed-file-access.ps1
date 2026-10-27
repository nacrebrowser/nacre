param([Parameter(Mandatory=$true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NacreDeleteProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFileW(string p, uint a, uint s, IntPtr x, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Probe(string p) {
    var h = CreateFileW(p, 0x10000, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if(h == new IntPtr(-1)) return Marshal.GetLastWin32Error();
    CloseHandle(h); return 0;
  }
}
'@
$nacreRoot = [IO.Path]::GetFullPath($InstallDirectory)
$failures = @()
foreach ($file in (Get-ChildItem -LiteralPath $nacreRoot -Recurse -File)) {
  $result = [NacreDeleteProbe]::Probe($file.FullName)
  if ($result -ne 0) { $failures += [pscustomobject]@{File=$file.FullName.Substring($nacreRoot.Length); Error=$result} }
}
if ($failures.Count) { $failures | ConvertTo-Json } else { 'DELETE-access probe: all installed files accessible; no files modified' }
