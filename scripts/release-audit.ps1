$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RequiredIgnored = @(".data/", ".backups/", ".uploads/", ".tmp/", ".tmp-shot-prompts/", ".workbuddy/", ".codex/config.toml", ".env")
$Errors = [Collections.Generic.List[string]]::new()
$PublisherHomePattern = [regex]::Escape([IO.Path]::GetFullPath([Environment]::GetFolderPath("UserProfile")))
$PublisherRootPattern = [regex]::Escape([IO.Path]::GetFullPath($Root))

Push-Location $Root
try {
  $IgnoreText = Get-Content -Raw -Encoding UTF8 ".gitignore"
  foreach ($Entry in $RequiredIgnored) {
    if ($IgnoreText -notmatch [regex]::Escape($Entry)) { $Errors.Add(".gitignore is missing: $Entry") }
  }

  $Files = @(git -c core.quotepath=false ls-files --cached --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw "Unable to read Git release candidate files." }
  foreach ($Relative in $Files) {
    $Normalized = $Relative.Replace("\", "/")
    if ($Normalized -match '(^|/)(\.data|\.backups|\.uploads|\.tmp|\.tmp-shot-prompts|\.workbuddy|node_modules|dist)(/|$)') {
      $Errors.Add("Forbidden local directory is a release candidate: $Relative")
      continue
    }
    if ($Normalized -eq ".codex/config.toml" -or $Normalized -match '\.(sqlite|sqlite-shm|sqlite-wal)$') {
      $Errors.Add("Forbidden local config or database is a release candidate: $Relative")
      continue
    }
    $FullPath = Join-Path $Root $Relative
    if (-not (Test-Path -LiteralPath $FullPath) -or (Get-Item -LiteralPath $FullPath).Length -gt 5MB) { continue }
    try { $Text = Get-Content -Raw -Encoding UTF8 -LiteralPath $FullPath -ErrorAction Stop } catch { continue }
    if ($Text -match 'sk-[A-Za-z0-9]{20,}' -or $Text -match 'gh[oprsu]_[A-Za-z0-9]{20,}' -or $Text -match 'AKIA[0-9A-Z]{16}') {
      $Errors.Add("Possible real secret: $Relative")
    }
    if ($Text -match $PublisherHomePattern -or $Text -match $PublisherRootPattern) {
      $Errors.Add("Publisher-local absolute path: $Relative")
    }
    if ($Text -match 'dpapi:[A-Za-z0-9+/=]{20,}') { $Errors.Add("DPAPI ciphertext found: $Relative") }
  }

  if (-not (Test-Path -LiteralPath "LICENSE")) { $Errors.Add("LICENSE is missing. Choose a license before public release.") }
  if ($Errors.Count) {
    Write-Host "Public release audit: FAIL"
    $Errors | ForEach-Object { Write-Host "ERROR: $_" }
    exit 1
  }
  Write-Host "Public release audit: PASS ($($Files.Count) candidate files, no local data or obvious secrets)"
} finally {
  Pop-Location
}
