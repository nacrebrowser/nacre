# Runs inside Windows Sandbox only (see prepare-windows-sandbox-check.cjs).
# Installs Nacre silently, launches it, uninstalls it and writes a report.
param([ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or -not (Test-Path -LiteralPath 'C:\NacreInput\verify.ps1')) { throw 'Run this only inside the Nacre Windows Sandbox configuration.' }

$output = 'C:\NacreResults'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Nacre'
$profile = Join-Path $env:APPDATA 'Nacre'
$report = [ordered]@{ status = 'RUNNING'; version = $Version; network = 'disabled'; results = @() }

# The host may be reading the report while it is rewritten: write a temporary
# file, then retry the replace for a few seconds.
function Save-Report {
  $target = Join-Path $output 'installation-report.json'
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$target.tmp" -Encoding UTF8
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { Move-Item -LiteralPath "$target.tmp" -Destination $target -Force; return } catch { Start-Sleep -Milliseconds 250 }
  }
}
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $report.results += [ordered]@{ name = $name; status = $(if ($ok) { 'PASS' } else { 'FAIL' }); detail = $detail }
  Save-Report
  if (-not $ok) { throw $name }
}
function Wait-Until([scriptblock]$condition, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $condition) { return $true }; Start-Sleep -Milliseconds 500 }
  return [bool](& $condition)
}
function Uninstall-Entry {
  Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'Nacre*' } | Select-Object -First 1
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Wizard {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, s.Capacity); return s.ToString().Replace("&", ""); }
  static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  static List<IntPtr> Windows(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => { uint owner; GetWindowThreadProcessId(h, out owner); if (owner == pid && IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  static List<IntPtr> Children(IntPtr parent) {
    var found = new List<IntPtr>();
    EnumChildWindows(parent, (h, l) => { if (IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  // Every visible text of the process windows, to report what the installer showed.
  public static string Describe(uint pid) {
    var lines = new List<string>();
    foreach (var w in Windows(pid)) {
      var parts = new List<string> { Text(w) };
      foreach (var c in Children(w)) { var t = Text(c).Trim(); if (t.Length > 0) parts.Add(t); }
      lines.Add(string.Join(" | ", parts));
    }
    return string.Join("\n", lines);
  }
  // Clicks the first enabled button whose label is in the list, in order of preference.
  // BM_CLICK is ignored while the dialog is inactive, so the parent receives the
  // same WM_COMMAND/BN_CLICKED notification a real click sends. It is posted:
  // NSIS shows the next custom page inside that handler and would block a send.
  public static string Click(uint pid, string[] labels) {
    foreach (var label in labels)
      foreach (var w in Windows(pid))
        foreach (var c in Children(w))
          if (Class(c) == "Button" && IsWindowEnabled(c) && Text(c).Trim() == label) { PostMessage(GetParent(c), 0x0111, (IntPtr)GetDlgCtrlID(c), c); return label; }
    return null;
  }
  // Unticks a checkbox, such as "Run Nacre" on the last page.
  public static void Uncheck(uint pid, string label) {
    foreach (var w in Windows(pid))
      foreach (var c in Children(w))
        if (Class(c) == "Button" && Text(c).Trim() == label) SendMessage(c, 0x00F1, IntPtr.Zero, IntPtr.Zero);
  }
}
'@

try {
  # Run from the local disk with a fresh temp folder: the mapped input folder
  # is read-only and the logon command can start before %TEMP% is usable.
  $work = 'C:\NacreWork'
  New-Item -ItemType Directory -Force -Path (Join-Path $work 'temp') | Out-Null
  $env:TEMP = $env:TMP = Join-Path $work 'temp'
  $setup = Join-Path $work ("Nacre Setup $Version.exe")
  Copy-Item -LiteralPath (Join-Path 'C:\NacreInput' ("Nacre Setup $Version.exe")) -Destination $setup
  $report.setupSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLower()
  # Walk the wizard the way a user would and record every screen it shows.
  $install = Start-Process -FilePath $setup -PassThru
  $screens = [Collections.Generic.List[string]]::new()
  $deadline = (Get-Date).AddMinutes(5)
  while (-not $install.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $screen = [Wizard]::Describe([uint32]$install.Id)
    if ($screen -and $screens[-1] -ne $screen) { $screens.Add($screen) }
    if ($screen -match 'Run Nacre') { [Wizard]::Uncheck([uint32]$install.Id, 'Run Nacre') }
    if ($screen -match '\| Retry') { [void][Wizard]::Click([uint32]$install.Id, @('Cancel')) }
    else { $clicked = [Wizard]::Click([uint32]$install.Id, @('Finish', 'Install', 'Next >', 'OK')); if ($clicked) { $screens.Add("clicked: $clicked") } }
    $install.Refresh()
  }
  $report.installerScreens = @($screens)
  Check 'The setup wizard completes with code 0' ($install.HasExited -and $install.ExitCode -eq 0) "exit $(if ($install.HasExited) { $install.ExitCode } else { 'still running' })"
  Get-Process Nacre -ErrorAction SilentlyContinue | Stop-Process -Force
  Check 'Nacre.exe is installed' (Wait-Until { Test-Path -LiteralPath (Join-Path $installRoot 'Nacre.exe') } 60) $installRoot
  $entry = Uninstall-Entry
  Check "Windows lists Nacre $Version in installed apps" ($entry -and $entry.DisplayVersion -eq $Version) "$($entry.DisplayName) $($entry.DisplayVersion)"
  Check 'Tor is the default protection mode' ((Get-Content -Raw -LiteralPath (Join-Path $installRoot 'startup-choice.json')) -match '"tor"')

  $app = Start-Process -FilePath (Join-Path $installRoot 'Nacre.exe') -PassThru -RedirectStandardOutput (Join-Path $output 'nacre-stdout.txt') -RedirectStandardError (Join-Path $output 'nacre-stderr.txt')
  $window = Wait-Until { $app.Refresh(); -not $app.HasExited -and $app.MainWindowHandle -ne 0 } 60
  Check 'Nacre starts and shows a window' $window "pid $($app.Id)"
  Start-Sleep -Seconds 10
  $app.Refresh()
  Check 'Nacre is still running after 10 seconds without network' (-not $app.HasExited)
  $saved = Wait-Until { Test-Path -LiteralPath (Join-Path $profile 'settings.json') } 30
  $files = (Get-ChildItem -LiteralPath $profile -Name -ErrorAction SilentlyContinue) -join ', '
  if (-not $saved) {
    $report.settingsFound = @(Get-ChildItem -Path 'C:\Users' -Recurse -Force -Filter 'settings.json*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    $report.roamingFolders = @(Get-ChildItem -LiteralPath $env:APPDATA -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + ': ' + ((Get-ChildItem -LiteralPath $_.FullName -Force -Name -ErrorAction SilentlyContinue) -join ', ') })
    $report.windowTitles = @(Get-Process Nacre -ErrorAction SilentlyContinue | Where-Object MainWindowTitle | Select-Object -ExpandProperty MainWindowTitle)
  }
  Check 'The profile is created in AppData' $saved "$profile : $files"
  [void]$app.CloseMainWindow()
  if (-not (Wait-Until { $app.HasExited } 20)) { Get-Process Nacre -ErrorAction SilentlyContinue | Stop-Process -Force }
  Check 'Nacre closes' (Wait-Until { -not (Get-Process Nacre -ErrorAction SilentlyContinue) } 20)

  $uninstaller = ($entry.QuietUninstallString, $entry.UninstallString | Where-Object { $_ } | Select-Object -First 1)
  $exe = [regex]::Match($uninstaller, '^"([^"]+)"').Groups[1].Value
  Start-Process -FilePath $exe -ArgumentList '/S' -Wait
  Check 'Uninstall removes the program' (Wait-Until { -not (Test-Path -LiteralPath (Join-Path $installRoot 'Nacre.exe')) } 90)
  Check 'Uninstall removes the installed-apps entry' (Wait-Until { -not (Uninstall-Entry) } 30)
  Check 'Uninstall keeps the profile' (Test-Path -LiteralPath (Join-Path $profile 'settings.json'))
  $report.status = 'PASS'
} catch {
  $report.status = 'FAIL'
  $report.error = $_.Exception.Message
} finally {
  $report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  Save-Report
  Stop-Computer -Force
}
