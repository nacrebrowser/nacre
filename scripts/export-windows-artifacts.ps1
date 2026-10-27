param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string[]]$Source
)
$ErrorActionPreference = 'Stop'
# Stream bytes into new files inheriting the destination directory's security.
# Never copy the workspace's Low mandatory label, and never modify workspace ACLs.
$targetRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $targetRoot) { throw 'Export directory already exists; choose a new directory.' }
foreach ($item in $Source) {
  if (-not [IO.File]::Exists([IO.Path]::GetFullPath($item))) { throw 'Source artifact does not exist.' }
}
[IO.Directory]::CreateDirectory($targetRoot) | Out-Null
foreach ($item in $Source) {
  $sourceFile = [IO.Path]::GetFullPath($item)
  if (-not [IO.File]::Exists($sourceFile)) { throw 'Source artifact does not exist.' }
  $targetFile = Join-Path $targetRoot ([IO.Path]::GetFileName($sourceFile))
  $inputStream = [IO.File]::OpenRead($sourceFile)
  try {
    $outputStream = [IO.File]::Open($targetFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $inputStream.CopyTo($outputStream); $outputStream.Flush() } finally { $outputStream.Dispose() }
  } finally { $inputStream.Dispose() }
  $hashes = @()
  foreach ($file in @($sourceFile,$targetFile)) {
    $stream = [IO.File]::OpenRead($file)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $hashes += ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose(); $stream.Dispose() }
  }
  if ($hashes[0] -ne $hashes[1]) { throw 'Exported artifact checksum differs.' }
  Write-Output ($hashes[1] + '  ' + $targetFile)
}
