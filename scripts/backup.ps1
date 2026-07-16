$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BackupRoot = Join-Path $Root ".backups"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Destination = Join-Path $BackupRoot "cat-studio-$Timestamp.zip"
$TempRoot = Join-Path $env:TEMP "cat-studio-backup-$(Get-Random)"
$Snapshot = Join-Path $TempRoot ".data"

New-Item -ItemType Directory -Force -Path $BackupRoot, $Snapshot | Out-Null
try {
  node (Join-Path $PSScriptRoot "backup-data.mjs") $Snapshot
  Compress-Archive -LiteralPath $Snapshot -DestinationPath $Destination -CompressionLevel Optimal
  Write-Host "Backup created: $Destination"
} finally {
  if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
}
