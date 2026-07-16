$ErrorActionPreference = "Stop"
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$ConfigDir = Join-Path $Root ".codex"
$ConfigPath = Join-Path $ConfigDir "config.toml"
$EscapedRoot = $Root.Replace("\", "\\").Replace('"', '\"')

$Content = @"
# Generated for this local checkout by scripts/configure-codex.ps1. Not committed to Git.
[mcp_servers.cat_studio]
command = "npm.cmd"
args = ["run", "mcp"]
cwd = "$EscapedRoot"
startup_timeout_sec = 60

[agents]
max_threads = 8
max_depth = 1
"@

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
[IO.File]::WriteAllText($ConfigPath, $Content, [Text.UTF8Encoding]::new($false))
Write-Host "Codex project config updated: $ConfigPath"
