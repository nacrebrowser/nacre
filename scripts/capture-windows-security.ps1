param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root ('.cache\security-051\capture-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')) }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $root '.cache\security-051')) + [IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Capture output must stay in the security evidence directory.' }
if (Test-Path -LiteralPath $output) { throw 'Refusing to replace an existing capture.' }
New-Item -ItemType Directory -Path $output | Out-Null
$report = [ordered]@{ started = [DateTime]::UtcNow.ToString('o'); status = 'NOT_TESTED'; packetCapture = $false; scenarios = 'proxy,transitions,tor'; limitations = @('Packet attribution and positive controls must be reviewed; a successful harness is not proof of no leak.') }
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $elevated) {
  $report.status = 'BLOCKED'; $report.reason = 'Administrator token required by PktMon. No capture or scenario started.'
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'capture-report.json') -Encoding UTF8
  throw $report.reason
}
$started = $false
try {
  $status = & pktmon status 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($status | Out-String) }
  $status | Out-File -LiteralPath (Join-Path $output 'pktmon-status-before.txt') -Encoding utf8
  # Refuse to interfere with another user's capture. Enumeration detects active
  # PktMon ETW sessions independently of localized status strings.
  $sessions = & logman query -ets 2>&1
  $sessions | Out-File -LiteralPath (Join-Path $output 'etw-sessions-before.txt') -Encoding utf8
  if (($sessions | Out-String) -match '(?i)pktmon') { throw 'Existing PktMon session detected; refusing to stop or replace it.' }
  $filters = & pktmon filter list 2>&1
  $filters | Out-File -LiteralPath (Join-Path $output 'pktmon-filters-before.txt') -Encoding utf8
  # No global filters are added, removed or reset by this runner. Existing
  # filters can hide packets and therefore require manual review of evidence.
  $report.limitations += 'Existing PktMon filters are preserved; review their effect before interpreting absence.'
  $etl = Join-Path $output 'traffic.etl'
  & pktmon start --capture --pkt-size 0 --file-size 128 --log-mode circular --file-name $etl 2>&1 | Out-File -LiteralPath (Join-Path $output 'pktmon-start.txt') -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'PktMon failed to start.' }
  $started = $true
  Push-Location $root
  try {
    & rtk proxy node scripts/verify-security-051.cjs proxy,transitions,tor ('capture-' + [IO.Path]::GetFileName($output)) 2>&1 | Out-File -LiteralPath (Join-Path $output 'scenario.log') -Encoding utf8
    $report.scenarioExitCode = $LASTEXITCODE
  } finally { Pop-Location }
  & pktmon counters 2>&1 | Out-File -LiteralPath (Join-Path $output 'pktmon-counters.txt') -Encoding utf8
  $report.status = 'CAPTURED_REQUIRES_REVIEW'
} catch {
  $report.status = 'FAILED'; $report.reason = $_.Exception.Message
} finally {
  if ($started) {
    & pktmon stop 2>&1 | Out-File -LiteralPath (Join-Path $output 'pktmon-stop.txt') -Encoding utf8
    $report.stopExitCode = $LASTEXITCODE
    & pktmon etl2pcap $etl --out (Join-Path $output 'traffic.pcapng') 2>&1 | Out-File -LiteralPath (Join-Path $output 'conversion.txt') -Encoding utf8
    $report.conversionExitCode = $LASTEXITCODE
    $report.packetCapture = Test-Path -LiteralPath (Join-Path $output 'traffic.pcapng') -PathType Leaf
  }
  $report.finished = [DateTime]::UtcNow.ToString('o')
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'capture-report.json') -Encoding UTF8
}
if ($report.status -ne 'CAPTURED_REQUIRES_REVIEW') { throw $report.reason }
