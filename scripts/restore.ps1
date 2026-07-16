param([Parameter(Mandatory=$true)][string]$Backup)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Root ".data"
if (-not (Test-Path -LiteralPath $Backup)) { throw "Backup file does not exist: $Backup" }
if (Test-Path -LiteralPath $Destination) {
  $Safety = Join-Path $Root ".backups\pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
  Compress-Archive -LiteralPath $Destination -DestinationPath $Safety -CompressionLevel Optimal
}
$Temp = Join-Path $env:TEMP "cat-studio-restore-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
Expand-Archive -LiteralPath $Backup -DestinationPath $Temp
$Restored = Join-Path $Temp ".data"
if (-not (Test-Path -LiteralPath $Restored)) { throw "Backup does not contain a .data directory." }
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
Move-Item -LiteralPath $Restored -Destination $Destination
Remove-Item -LiteralPath $Temp -Recurse -Force
Write-Host "Restore completed."

