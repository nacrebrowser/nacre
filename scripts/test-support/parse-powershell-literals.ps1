param([string]$InputFile)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($InputFile,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'PowerShell source did not parse.' }
$values = @($tree.FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] },$true) | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Value)) })
@{ version = $PSVersionTable.PSVersion.ToString(); values = $values } | ConvertTo-Json -Compress
