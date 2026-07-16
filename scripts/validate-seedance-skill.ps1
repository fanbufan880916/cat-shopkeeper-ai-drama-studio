$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Skill = Join-Path $Root ".agents\skills\seedance-20"
$env:PYTHONUTF8 = "1"

$SkillFull = [IO.Path]::GetFullPath($Skill).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($CachePath in @((Join-Path $Skill "scripts\__pycache__"), (Join-Path $Skill "tests\__pycache__"))) {
  $CacheFull = [IO.Path]::GetFullPath($CachePath)
  if (-not $CacheFull.StartsWith($SkillFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean cache outside Seedance skill: $CacheFull" }
  if (Test-Path -LiteralPath $CacheFull) { Remove-Item -LiteralPath $CacheFull -Recurse -Force }
}

Push-Location $Skill
try {
  python "scripts\validate_skills.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance structure validation failed." }
  python "scripts\content_audit.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance content audit failed." }
  python "scripts\eval_schema_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance eval schema validation failed." }
  python "scripts\design_audit.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance design audit failed." }
  python "scripts\source_registry_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance source registry validation failed." }
  python "scripts\vocab_schema_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance vocabulary schema validation failed." }
  python "scripts\project_state_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance project state validation failed." }
  python "scripts\continuity_chain_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance continuity validation failed." }
  python "scripts\behavior_contract_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance behavior contract validation failed." }
  python "scripts\sequence_eval_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance sequence eval validation failed." }
  python "scripts\generation_run_check.py" --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance generation run validation failed." }
  python "scripts\prompt_lint.py" --self-test --strict
  if ($LASTEXITCODE -ne 0) { throw "Seedance prompt lint failed." }
  python -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) { throw "Seedance unit tests failed." }
  $CompileCache = Join-Path ([IO.Path]::GetTempPath()) ("cat-studio-seedance-pyc-" + [Guid]::NewGuid().ToString("N"))
  $PreviousPycachePrefix = $env:PYTHONPYCACHEPREFIX
  $env:PYTHONPYCACHEPREFIX = $CompileCache
  try {
    python -m compileall -q scripts tests
    if ($LASTEXITCODE -ne 0) { throw "Seedance Python compile validation failed." }
  } finally {
    if ($null -eq $PreviousPycachePrefix) { Remove-Item Env:PYTHONPYCACHEPREFIX -ErrorAction SilentlyContinue } else { $env:PYTHONPYCACHEPREFIX = $PreviousPycachePrefix }
    $TempFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $CompileCacheFull = [IO.Path]::GetFullPath($CompileCache)
    if (-not $CompileCacheFull.StartsWith($TempFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean compile cache outside temp: $CompileCacheFull" }
    if (Test-Path -LiteralPath $CompileCacheFull) { Remove-Item -LiteralPath $CompileCacheFull -Recurse -Force }
  }
} finally {
  Pop-Location
}

$ExistingMarkerPath = Join-Path $Skill ".validated.json"
$ExistingCommit = if (Test-Path -LiteralPath $ExistingMarkerPath) { (Get-Content -Raw -Encoding UTF8 $ExistingMarkerPath | ConvertFrom-Json).commitHash } else { "" }
$SourceMirror = $env:SEEDANCE_SKILL_SOURCE
$Commit = if ($SourceMirror -and (Test-Path -LiteralPath (Join-Path $SourceMirror ".git"))) { (git -C $SourceMirror rev-parse HEAD).Trim() } else { [string]$ExistingCommit }
if (-not $Commit) { $Commit = "unavailable-vendored-snapshot" }
$Files = Get-ChildItem -LiteralPath $Skill -Recurse -File | Where-Object { $_.Name -ne ".validated.json" } | Sort-Object FullName
$HashInput = ($Files | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ""
$Bytes = [Text.Encoding]::UTF8.GetBytes($HashInput)
$Stream = [IO.MemoryStream]::new($Bytes)
$Checksum = (Get-FileHash -InputStream $Stream -Algorithm SHA256).Hash.ToLowerInvariant()
$Marker = [ordered]@{
  name = "seedance-20"
  version = "6.6.0"
  source = "https://github.com/Emily2040/seedance-2.0"
  commitHash = $Commit
  checksum = $Checksum
  valid = $true
  details = "Vendored upstream snapshot. Full v6.6 validation suite passed: structure, content, schemas, sources, state, continuity, sequence, behavior, generation, lint, unit tests and compile checks."
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$Marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Skill ".validated.json") -Encoding UTF8
