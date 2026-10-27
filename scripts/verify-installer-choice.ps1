$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-nacre.ps1') -Raw -Encoding UTF8
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw 'Installer PowerShell syntax failed.' }
# Evaluate only the form construction; never run extraction, registry or shortcuts.
$start = $source.IndexOf('Add-Type -AssemblyName System.Windows.Forms', $source.IndexOf('exit 2'))
$end = $source.IndexOf('$modeResult =')
if ($start -lt 0 -or $end -le $start) { throw 'Form boundaries not found.' }
. ([scriptblock]::Create($source.Substring($start, $end - $start)))
try {
  if ($installButton.Enabled -or $torMode.Checked -or $standardMode.Checked) { throw 'Explicit selection is required.' }
  $torMode.Checked = $true
  if (-not $installButton.Enabled -or $standardMode.Checked) { throw 'Tor selection failed.' }
  $standardMode.Checked = $true
  if (-not $installButton.Enabled -or $torMode.Checked) { throw 'Standard selection failed.' }
  $standardMode.Checked = $false
  $modeForm.ShowInTaskbar = $false
  $modeForm.StartPosition = 'Manual'
  $modeForm.Location = New-Object System.Drawing.Point(-32000, -32000)
  $modeForm.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $torMode.Checked = $false
  $standardMode.Checked = $false
  $bitmap = New-Object System.Drawing.Bitmap($modeForm.Width, $modeForm.Height)
  try {
    $modeForm.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $modeForm.Width, $modeForm.Height)))
    $folder = Join-Path $workspace '.cache/installer-choice'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $bitmap.Save((Join-Path $folder 'preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $bitmap.Dispose() }
  Write-Output 'INSTALLER_CHOICE_RESULT PASS: two exclusive choices, explicit selection, English copy, PowerShell syntax, offscreen preview.'
} finally { $modeForm.Close(); $modeForm.Dispose() }
