param(
  [Parameter(Mandatory = $true)][ValidateSet('check','create-project','import-media','write-timeline','render','status','cancel')][string]$Operation,
  [string]$Executable = '',
  [string]$ProjectRoot = '',
  [string]$Manifest = '',
  [string]$Output = '',
  [string]$CommandJson = ''
)

$ErrorActionPreference = 'Stop'

function Write-Result($ok, $stdout = '', $stderr = '') {
  [Console]::Out.WriteLine((@{
    ok = [bool]$ok
    operation = $Operation
    stdout = [string]$stdout
    stderr = [string]$stderr
    projectRoot = $ProjectRoot
    manifest = $Manifest
    output = $Output
  } | ConvertTo-Json -Depth 8 -Compress))
}

try {
  if ($Operation -eq 'check') {
    if ([string]::IsNullOrWhiteSpace($Executable)) { Write-Result $false '' 'Jianying CLI executable is not configured.'; exit 2 }
    if ($Executable.Contains('\') -or $Executable.Contains('/')) {
      if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { Write-Result $false '' "Jianying CLI does not exist: $Executable"; exit 3 }
    } else {
      $command = Get-Command $Executable -ErrorAction SilentlyContinue
      if (-not $command) { Write-Result $false '' "Jianying CLI was not found in PATH: $Executable"; exit 3 }
    }
    Write-Result $true 'Jianying CLI path is available.' ''
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($CommandJson)) {
    Write-Result $false '' "No command template configured for operation: $Operation"
    exit 4
  }
  $template = @($CommandJson | ConvertFrom-Json)
  $command = New-Object System.Collections.Generic.List[string]
  foreach ($part in $template) {
    $value = [string]$part
    $value = $value.Replace('{executable}', $Executable).Replace('{projectRoot}', $ProjectRoot).Replace('{manifest}', $Manifest).Replace('{output}', $Output).Replace('{operation}', $Operation)
    $command.Add($value)
  }
  if ($command.Count -eq 0) { Write-Result $false '' "Command template is empty: $Operation"; exit 5 }
  if ($ProjectRoot) { New-Item -ItemType Directory -Force -Path $ProjectRoot | Out-Null }
  $program = $command[0]
  $arguments = @()
  if ($command.Count -gt 1) { $arguments = $command.GetRange(1, $command.Count - 1).ToArray() }
  $captured = @(& $program @arguments 2>&1 | ForEach-Object { [string]$_ })
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  $joined = $captured -join [Environment]::NewLine
  if ($exitCode -ne 0) { Write-Result $false $joined "Jianying CLI returned exit code $exitCode."; exit $exitCode }
  Write-Result $true $joined ''
  exit 0
} catch {
  Write-Result $false '' $_.Exception.Message
  exit 10
}
