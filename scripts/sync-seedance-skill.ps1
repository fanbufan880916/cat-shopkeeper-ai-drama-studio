param(
  [string]$Source = $env:SEEDANCE_SKILL_SOURCE
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DestinationRoot = Join-Path $Root ".agents\skills"
$Destination = Join-Path $DestinationRoot "seedance-20"

if (-not $Source) {
  throw "Specify the seedance-2.0 upstream repository with -Source or SEEDANCE_SKILL_SOURCE."
}
if (-not (Test-Path -LiteralPath $Source)) {
  throw "Seedance source directory does not exist: $Source"
}

python (Join-Path $Source "scripts\install_codex_skill.py") --dest $DestinationRoot --force

# The upstream installer excludes release images and CI files, while its strict
# validator requires those files. Copy only the omitted validation dependencies.
$SourceAssets = Join-Path $Source "assets"
$DestinationAssets = Join-Path $Destination "assets"
New-Item -ItemType Directory -Force -Path $DestinationAssets | Out-Null
Get-ChildItem -LiteralPath $SourceAssets -File | Where-Object { $_.Extension -in ".png", ".jpg", ".jpeg" } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $DestinationAssets $_.Name) -Force
}

$WorkflowSource = Join-Path $Source ".github\workflows\validate-skills.yml"
$WorkflowDestination = Join-Path $Destination ".github\workflows"
New-Item -ItemType Directory -Force -Path $WorkflowDestination | Out-Null
Copy-Item -LiteralPath $WorkflowSource -Destination (Join-Path $WorkflowDestination "validate-skills.yml") -Force

$PreviousSource = $env:SEEDANCE_SKILL_SOURCE
$env:SEEDANCE_SKILL_SOURCE = [IO.Path]::GetFullPath($Source)
try {
  & (Join-Path $PSScriptRoot "validate-seedance-skill.ps1")
} finally {
  if ($null -eq $PreviousSource) { Remove-Item Env:SEEDANCE_SKILL_SOURCE -ErrorAction SilentlyContinue } else { $env:SEEDANCE_SKILL_SOURCE = $PreviousSource }
}
Write-Host "Seedance skill synced and validated."
