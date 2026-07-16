$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Skill = Join-Path $Root ".agents\skills\creative-production-orchestration"
$env:PYTHONUTF8 = "1"
. (Join-Path $PSScriptRoot "skill-validator-path.ps1")
$QuickValidate = Get-SkillQuickValidatorPath

python $QuickValidate $Skill
if ($LASTEXITCODE -ne 0) { throw "Creative orchestration skill structure validation failed." }
python (Join-Path $Root "scripts\validate-workflow-contracts.py")
if ($LASTEXITCODE -ne 0) { throw "Agent and workflow contract validation failed." }

$Files = Get-ChildItem -LiteralPath $Skill -Recurse -File | Where-Object { $_.Name -ne ".validated.json" } | Sort-Object FullName
$HashInput = ($Files | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ""
$Bytes = [Text.Encoding]::UTF8.GetBytes($HashInput)
$Stream = [IO.MemoryStream]::new($Bytes)
$Checksum = (Get-FileHash -InputStream $Stream -Algorithm SHA256).Hash.ToLowerInvariant()
$Marker = [ordered]@{
  name = "creative-production-orchestration"
  version = "1.0.0"
  source = "Project role contracts + cited open-source production workflows"
  commitHash = ""
  checksum = $Checksum
  valid = $true
  details = "Skill structure, 14 model-agnostic Agent contracts, WORKFLOW tool names and MCP registry passed."
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Skill ".validated.json") -Encoding UTF8
