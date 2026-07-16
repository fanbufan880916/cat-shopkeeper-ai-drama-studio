function Get-SkillQuickValidatorPath {
  $UserProfile = [Environment]::GetFolderPath("UserProfile")
  $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $UserProfile ".codex" }
  $Candidates = @(
    (Join-Path $CodexHome "skills\.system\skill-creator\scripts\quick_validate.py")
  )
  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) { return $Candidate }
  }
  throw "Codex skill-creator/quick_validate.py was not found. Install Codex or set CODEX_HOME."
}
