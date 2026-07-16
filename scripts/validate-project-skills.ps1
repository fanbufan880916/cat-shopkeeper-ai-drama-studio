$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

& (Join-Path $Root "scripts\validate-image-skill.ps1")
if ($LASTEXITCODE -ne 0) { throw "Image skill validation failed." }
& (Join-Path $Root "scripts\validate-audio-skill.ps1")
if ($LASTEXITCODE -ne 0) { throw "Audio skill validation failed." }
& (Join-Path $Root "scripts\validate-seedance-skill.ps1")
if ($LASTEXITCODE -ne 0) { throw "Seedance skill validation failed." }
& (Join-Path $Root "scripts\validate-creative-skill.ps1")
if ($LASTEXITCODE -ne 0) { throw "Creative orchestration validation failed." }

Write-Host "All project skills and workflow contracts: PASS"
