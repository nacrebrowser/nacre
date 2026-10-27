$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Nacre'
$archivePath = Join-Path $PSScriptRoot 'nacre-app.zip'
$startMenuRoot = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Nacre'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nacre.lnk'

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  throw 'Installation archive not found.'
}
if (Get-Process -Name Nacre -ErrorAction SilentlyContinue) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Close Nacre before installing this update.', 'Nacre Setup') | Out-Null
  exit 2
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$modeForm = New-Object System.Windows.Forms.Form
$modeForm.Text = 'Nacre Setup - Choose your protection'
$modeForm.ClientSize = New-Object System.Drawing.Size(600, 330)
$modeForm.StartPosition = 'CenterScreen'
$modeForm.FormBorderStyle = 'FixedDialog'
$modeForm.MaximizeBox = $false
$modeForm.MinimizeBox = $false
$modeForm.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$heading = New-Object System.Windows.Forms.Label
$heading.Text = 'How would you like Nacre to connect?'
$heading.SetBounds(24, 20, 550, 30)
$torMode = New-Object System.Windows.Forms.RadioButton
$torMode.Text = 'Tor protection - connect automatically on every launch'
$torMode.SetBounds(24, 66, 550, 30)
$torDetail = New-Object System.Windows.Forms.Label
$torDetail.Text = 'Hides your IP through Tor. Startup and browsing can be slower.' + "`r`n" + 'Web traffic stays blocked until Tor connects; no direct fallback.'
$torDetail.SetBounds(46, 100, 530, 50)
$standardMode = New-Object System.Windows.Forms.RadioButton
$standardMode.Text = 'Standard protection - start without Tor'
$standardMode.SetBounds(24, 163, 550, 30)
$standardDetail = New-Object System.Windows.Forms.Label
$standardDetail.Text = 'Connects immediately using your normal network; your IP is visible.' + "`r`n" + 'You can turn on Tor whenever you want from the toolbar.'
$standardDetail.SetBounds(46, 197, 530, 50)
$shared = New-Object System.Windows.Forms.Label
$shared.Text = 'Both modes include ad blocking and third-party cookie blocking.'
$shared.SetBounds(24, 254, 550, 24)
$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = 'Install'
$installButton.Enabled = $false
$installButton.SetBounds(456, 288, 120, 30)
$installButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$torMode.Add_CheckedChanged({ $installButton.Enabled = $torMode.Checked -or $standardMode.Checked })
$standardMode.Add_CheckedChanged({ $installButton.Enabled = $torMode.Checked -or $standardMode.Checked })
$modeForm.Controls.AddRange(@($heading, $torMode, $torDetail, $standardMode, $standardDetail, $shared, $installButton))
$modeForm.AcceptButton = $installButton
$modeResult = $modeForm.ShowDialog()
if ($modeResult -ne [System.Windows.Forms.DialogResult]::OK) { $modeForm.Dispose(); exit 0 }
$selectedMode = if ($torMode.Checked) { 'tor' } else { 'standard' }
$modeForm.Dispose()

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot -Force
$exe = Join-Path $installRoot 'Nacre.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw 'Nacre.exe is missing after extraction.'
}
$startupChoice = @{ version = 1; id = [guid]::NewGuid().ToString(); mode = $selectedMode } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $installRoot 'startup-choice.json'), $startupChoice, (New-Object System.Text.UTF8Encoding($false)))

$uninstaller = Join-Path $installRoot 'Désinstaller Nacre.ps1'
@'
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nacre'
$profileRoaming = Join-Path $env:APPDATA 'Nacre'
$profileLocal = Join-Path $env:LOCALAPPDATA 'Nacre'
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Nacre'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nacre.lnk'
if (Get-Process -Name Nacre -ErrorAction SilentlyContinue) { throw 'Fermez Nacre avant la désinstallation.' }
Add-Type -AssemblyName System.Windows.Forms
$choice = [System.Windows.Forms.MessageBox]::Show('Supprimer aussi les données du profil Nacre standard (préférences, favoris et cache) ? Les profils déplacés manuellement ne seront pas supprimés.', 'Désinstallation de Nacre', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
Remove-Item -LiteralPath $menu -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $desktop -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $root -Recurse -Force
if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
  Remove-Item -LiteralPath $profileRoaming -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $profileLocal -Recurse -Force -ErrorAction SilentlyContinue
}
'@ | Set-Content -LiteralPath $uninstaller -Encoding UTF8

New-Item -ItemType Directory -Force -Path $startMenuRoot | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($desktopShortcut, (Join-Path $startMenuRoot 'Nacre.lnk'))) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Save()
}
$uninstallShortcut = $shell.CreateShortcut((Join-Path $startMenuRoot 'Désinstaller Nacre.lnk'))
$uninstallShortcut.TargetPath = 'powershell.exe'
$uninstallShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $uninstaller + '"'
$uninstallShortcut.WorkingDirectory = $installRoot
$uninstallShortcut.Save()

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nacre'
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Nacre'
Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.4.0'
Set-ItemProperty -Path $uninstallKey -Name Publisher -Value 'Nacre contributors'
Set-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot
Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $uninstaller + '"')
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show('Nacre 0.4.0 is installed. Shortcuts were added to your desktop and Start menu. Your protection choice will apply when you launch Nacre.', 'Installation complete') | Out-Null
