$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Skill = Join-Path $Root ".agents\skills\gpt-image-2-storyboard"
$env:PYTHONUTF8 = "1"
. (Join-Path $PSScriptRoot "skill-validator-path.ps1")
$QuickValidate = Get-SkillQuickValidatorPath

python $QuickValidate $Skill
if ($LASTEXITCODE -ne 0) { throw "GPT-Image-2 skill structure validation failed." }
python (Join-Path $Skill "scripts\prompt_lint.py") --self-test
if ($LASTEXITCODE -ne 0) { throw "GPT-Image-2 prompt lint failed." }

$Files = Get-ChildItem -LiteralPath $Skill -Recurse -File | Where-Object { $_.Name -ne ".validated.json" } | Sort-Object FullName
$HashInput = ($Files | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ""
$Bytes = [Text.Encoding]::UTF8.GetBytes($HashInput)
$Stream = [IO.MemoryStream]::new($Bytes)
$Checksum = (Get-FileHash -InputStream $Stream -Algorithm SHA256).Hash.ToLowerInvariant()
$Marker = [ordered]@{
  name = "gpt-image-2-storyboard"
  version = "1.0.0"
  source = "OpenAI official guides + APIMart API docs"
  commitHash = ""
  checksum = $Checksum
  valid = $true
  details = "Skill structure and prompt lint self-test passed; sources verified 2026-07-14."
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Skill ".validated.json") -Encoding UTF8
