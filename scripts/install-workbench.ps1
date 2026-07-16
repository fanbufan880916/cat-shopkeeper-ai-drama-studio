$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Push-Location $Root
try {
  $Node = Get-Command node -ErrorAction SilentlyContinue
  $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $Node -or -not $Npm) {
    throw "Node.js was not found. Install Node.js 22 or newer from https://nodejs.org/"
  }
  $NodeMajor = [int](node -p "process.versions.node.split('.')[0]")
  if ($NodeMajor -lt 22) { throw "Node.js $NodeMajor is too old. Version 22 or newer is required." }

  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg was not found. Audio slicing, last-frame extraction, and preview export will be unavailable."
  }

  & (Join-Path $PSScriptRoot "configure-codex.ps1")
  npm install
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Workbench build failed." }

  Write-Host ""
  Write-Host "Installation complete. API settings remain empty and no publisher API is included."
  Write-Host "Next: open this folder in Codex, then run the workbench launcher."
} finally {
  Pop-Location
}
