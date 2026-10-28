$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$version = $package.nacreVersion
if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw 'Invalid public version.' }
$destination = Join-Path ([Environment]::GetFolderPath('UserProfile')) ('Downloads\Nacre-' + $version)
$files = @("Nacre-Setup-${version}.exe", "Nacre-${version}-Portable.zip", "SHA256SUMS-${version}.txt") | ForEach-Object { Join-Path (Join-Path $repo 'dist') $_ }
& (Join-Path $PSScriptRoot 'export-windows-artifacts.ps1') -Destination $destination -Source $files
$record = @{version=$version;directory=$destination;setup=(Join-Path $destination ('Nacre-Setup-' + $version + '.exe'))} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $repo '.cache\latest-windows-export.json'), $record, [Text.UTF8Encoding]::new($false))
