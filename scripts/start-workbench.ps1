$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist\web\index.html"

Push-Location $Root
try {
  & (Join-Path $PSScriptRoot "configure-codex.ps1")
  if (-not (Test-Path -LiteralPath "node_modules")) {
    npm install
  }
  $SourceFiles = Get-ChildItem -Path (Join-Path $Root "src"), (Join-Path $Root "server"), (Join-Path $Root "shared") -Recurse -File -ErrorAction SilentlyContinue
  $LatestSourceWrite = ($SourceFiles | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
  $DistWrite = if (Test-Path -LiteralPath $Dist) { (Get-Item -LiteralPath $Dist).LastWriteTimeUtc } else { [DateTime]::MinValue }
  if (-not (Test-Path -LiteralPath $Dist) -or $LatestSourceWrite -gt $DistWrite) {
    npm run build
  }
  $Health = $null
  try { $Health = Invoke-RestMethod "http://127.0.0.1:4310/api/health" -TimeoutSec 2 } catch {}
  if ($Health) {
    $Connections = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue
    foreach ($Connection in $Connections) {
      Stop-Process -Id $Connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 20; $i++) {
      if (-not (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 250
    }
  }
  $Health = $null
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $Root -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { $Health = Invoke-RestMethod "http://127.0.0.1:4310/api/health" -TimeoutSec 2; break } catch {}
  }
  if (-not $Health) { throw "Workbench server did not start." }
  Start-Process "http://127.0.0.1:4310"
} finally {
  Pop-Location
}
