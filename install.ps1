<#
.SYNOPSIS
  One-key installer for this English-learning setup, for Windows.

.DESCRIPTION
  Installs two things into %USERPROFILE%\.config\opencode:
    1. the `lookup` TUI plugin  - offline word cards + Chinese translation cards
    2. the reply-style rules    - AGENTS.md (English replies with Chinese glosses)

  Windows has no `unzip` and no bash, which is why this script exists next to
  install.sh. Anything it replaces is first moved to .backup-<timestamp>\.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -WithDict -Key sk-xxxx
#>
[CmdletBinding()]
param(
  # Symlink the files instead of copying them (needs Developer Mode or admin).
  [switch]$Link,
  # Also build the 327 MB offline dictionary (needs bun).
  [switch]$WithDict,
  # Your translation API key. Stored in lookup.key, never in the repository.
  [string]$Key,
  # Install somewhere else. Mainly for testing.
  [string]$ConfigDir
)

$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Text) Write-Host "`n== $Text" }
function Write-Say  { param([string]$Text) Write-Host "   $Text" }
function Stop-With  { param([string]$Text) Write-Host "   error: $Text" -ForegroundColor Red; exit 1 }

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path $RepoDir "opencode"

if (-not (Test-Path $Src)) { Stop-With "cannot find $Src - run this script from the repository" }

if (-not $ConfigDir) {
  if ($env:OPENCODE_CONFIG_DIR) { $ConfigDir = $env:OPENCODE_CONFIG_DIR }
  elseif ($env:XDG_CONFIG_HOME) { $ConfigDir = Join-Path $env:XDG_CONFIG_HOME "opencode" }
  else { $ConfigDir = Join-Path $env:USERPROFILE ".config\opencode" }
}

Write-Step "Checking the environment"
Write-Say "repository: $RepoDir"
Write-Say "config dir: $ConfigDir"

$OpenCode = Get-Command opencode -ErrorAction SilentlyContinue
if ($OpenCode) { Write-Say "opencode:   $($OpenCode.Source)" }
else { Write-Say "warning: 'opencode' is not on PATH. Install OpenCode first, then re-run." }

$Bun = Get-Command bun -ErrorAction SilentlyContinue
if ($Bun) { Write-Say "bun:        $($Bun.Source)" } else { Write-Say "bun:        (not found)" }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $ConfigDir ".backup-$Stamp"
New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir "commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir "plugins")  | Out-Null

function Test-SameContent {
  param([string]$A, [string]$B)
  if (-not (Test-Path $B)) { return $false }
  if ((Get-Item $A).PSIsContainer) {
    $diff = Compare-Object (Get-ChildItem -Recurse -File $A | ForEach-Object { $_.FullName.Substring($A.Length) }) `
                           (Get-ChildItem -Recurse -File $B | ForEach-Object { $_.FullName.Substring($B.Length) })
    if ($diff) { return $false }
    foreach ($file in Get-ChildItem -Recurse -File $A) {
      $other = Join-Path $B $file.FullName.Substring($A.Length)
      if (-not (Test-Path $other)) { return $false }
      if ((Get-FileHash $file.FullName).Hash -ne (Get-FileHash $other).Hash) { return $false }
    }
    return $true
  }
  return (Get-FileHash $A).Hash -eq (Get-FileHash $B).Hash
}

function Install-Item {
  param([string]$Source, [string]$Target)
  if ($Link) {
    if ((Test-Path $Target) -and (Get-Item $Target).LinkType -eq "SymbolicLink") {
      Write-Say "already linked: $Target"; return
    }
  }
  elseif (Test-SameContent $Source $Target) {
    Write-Say "up to date: $Target"; return
  }

  if (Test-Path $Target) {
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    Move-Item -Force $Target (Join-Path $Backup (Split-Path -Leaf $Target))
    Write-Say "backed up: $Target"
  }

  if ($Link) {
    try {
      New-Item -ItemType SymbolicLink -Path $Target -Target $Source -ErrorAction Stop | Out-Null
      Write-Say "linked: $Target"
      return
    }
    catch {
      Write-Say "warning: cannot create a symlink here (needs Developer Mode or admin) - copying instead"
    }
  }

  if ((Get-Item $Source).PSIsContainer) {
    Copy-Item -Recurse -Force $Source $Target
  } else {
    Copy-Item -Force $Source $Target
  }
  Write-Say "copied: $Target"
}

Write-Step "Installing files ($(if ($Link) { 'link' } else { 'copy' }) mode)"
Install-Item (Join-Path $Src "AGENTS.md")           (Join-Path $ConfigDir "AGENTS.md")
Install-Item (Join-Path $Src "commands\word.md")    (Join-Path $ConfigDir "commands\word.md")
Install-Item (Join-Path $Src "plugins\lookup")      (Join-Path $ConfigDir "plugins\lookup")

Write-Step "Registering the plugin in cli.json"
$CliJson = Join-Path $ConfigDir "cli.json"
try {
  $config = $null
  if (Test-Path $CliJson) {
    # -Encoding UTF8 matters: PowerShell 5.1 otherwise reads the file as ANSI
    # and would write back corrupted text.
    $raw = Get-Content -Raw -Path $CliJson -Encoding UTF8
    if ($raw -and $raw.Trim()) {
      try { $config = $raw | ConvertFrom-Json }
      catch { Stop-With "cli.json is not valid JSON ($_). Add this line yourself: `"package`": `"./plugins/lookup`"" }
    }
  }
  if ($null -eq $config) { $config = New-Object psobject }

  $plugins = @()
  if ($config.PSObject.Properties.Name -contains "plugins" -and $config.plugins) {
    $plugins = @($config.plugins)
  }

  if ($plugins | Where-Object { $_.package -eq "./plugins/lookup" }) {
    Write-Say "the ./plugins/lookup entry already exists"
  }
  else {
    $entry = New-Object psobject -Property @{ package = "./plugins/lookup"; options = (New-Object psobject) }
    $plugins = [object[]]($plugins + $entry)
    if ($config.PSObject.Properties.Name -contains "plugins") {
      $config.plugins = $plugins
    } else {
      $config | Add-Member -NotePropertyName plugins -NotePropertyValue $plugins
    }
    Write-Say "added the ./plugins/lookup entry"
  }

  $json = ConvertTo-Json -InputObject $config -Depth 100
  [System.IO.File]::WriteAllText($CliJson, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

  # Read it back: never leave a broken config behind.
  $check = (Get-Content -Raw -Path $CliJson -Encoding UTF8) | ConvertFrom-Json
  $names = @($check.plugins | ForEach-Object { $_.package })
  if ($names -notcontains "./plugins/lookup") { Stop-With "cli.json was written but does not list the plugin - check it by hand" }
  Write-Say "wrote $CliJson ($($names.Count) plugin entries: $($names -join ', '))"
}
catch {
  Stop-With "could not update cli.json ($_). Add this to its plugins array yourself: { `"package`": `"./plugins/lookup`", `"options`": {} }"
}

Write-Step "Translation API key (optional)"
$KeyFile = Join-Path $ConfigDir "lookup.key"
if ($Key) {
  [System.IO.File]::WriteAllText($KeyFile, $Key + "`n", (New-Object System.Text.UTF8Encoding($false)))
  try {
    # Windows has no chmod 600; drop inherited access and keep only this user.
    icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    Write-Say "wrote $KeyFile (access limited to $($env:USERNAME))"
  }
  catch {
    Write-Say "wrote $KeyFile (could not restrict access with icacls)"
  }
}
elseif (Test-Path $KeyFile) {
  Write-Say "kept the existing $KeyFile"
}
else {
  Write-Say "no key given - /dict works fully offline, and /zh falls back to free services."
  Write-Say "add one later with:  Set-Content -Path `"$KeyFile`" -Value 'YOUR_KEY' -NoNewline"
}

Write-Step "Offline dictionary"
$Db = if ($env:OPENCODE_LOOKUP_DB) { $env:OPENCODE_LOOKUP_DB } else { Join-Path $env:USERPROFILE ".local\share\lookup\dict.db" }
if (Test-Path $Db) {
  $size = [math]::Round((Get-Item $Db).Length / 1MB)
  Write-Say "already present: $Db ($size MB)"
}
elseif ($WithDict) {
  if (-not $Bun) { Stop-With "-WithDict needs bun (https://bun.sh)" }
  Write-Say "building $Db - this downloads a ~207 MB archive and takes a few minutes"
  Push-Location (Join-Path $Src "plugins\lookup")
  try { & bun build-db.ts } finally { Pop-Location }
  Write-Say "built: $Db"
}
else {
  Write-Say "not built yet. Build it with:  .\install.ps1 -WithDict"
}

Write-Step "Verifying"
if ($Bun) {
  Push-Location (Join-Path $Src "plugins\lookup")
  try { & bun test } finally { Pop-Location }
} else {
  Write-Say "bun not found, skipped the test run"
}

Write-Step "Done"
Write-Say "Restart OpenCode, then try:  /dict ubiquitous   /zh hello world   /word resilient"
if (Test-Path $Backup) { Write-Say "Previous files were moved to $Backup" }
