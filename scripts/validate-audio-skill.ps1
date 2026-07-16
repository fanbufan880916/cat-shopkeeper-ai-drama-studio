$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Skill = Join-Path $Root ".agents\skills\doubao-audio-generation"
$env:PYTHONUTF8 = "1"
. (Join-Path $PSScriptRoot "skill-validator-path.ps1")
$QuickValidate = Get-SkillQuickValidatorPath

python $QuickValidate $Skill
if ($LASTEXITCODE -ne 0) { throw "Doubao audio skill structure validation failed." }
python (Join-Path $Skill "scripts\prompt_lint.py") --self-test
if ($LASTEXITCODE -ne 0) { throw "Doubao audio prompt lint failed." }

$Files = Get-ChildItem -LiteralPath $Skill -Recurse -File | Where-Object { $_.Name -ne ".validated.json" } | Sort-Object FullName
$HashInput = ($Files | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ""
$Bytes = [Text.Encoding]::UTF8.GetBytes($HashInput)
$Stream = [IO.MemoryStream]::new($Bytes)
$Checksum = (Get-FileHash -InputStream $Stream -Algorithm SHA256).Hash.ToLowerInvariant()
$Marker = [ordered]@{
  name = "doubao-audio-generation"
  version = "1.0.0"
  source = "Volcengine Doubao official prompt patterns"
  commitHash = ""
  checksum = $Checksum
  valid = $true
  details = "Skill structure and positive/negative audio prompt lint regression tests passed."
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Skill ".validated.json") -Encoding UTF8
