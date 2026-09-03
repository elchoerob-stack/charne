<#
.SYNOPSIS
  One-command installer for Foreman (CMS Agent) on Windows.

.DESCRIPTION
  Run from PowerShell (no admin needed for most steps):

    Set-ExecutionPolicy -Scope Process Bypass -Force
    .\setup.ps1

  Or straight from GitHub without cloning first:

    irm https://raw.githubusercontent.com/elchoerob-stack/charne/claude/grokbot-cms-agent-5vkq13/cms-agent/setup.ps1 | iex

  What it does (all idempotent, safe to re-run):
    1. Installs Node.js LTS and Git with winget if they are missing
    2. Clones the repo to Documents\charne (or updates it if already there)
    3. npm install + build the server
    4. Creates server\.env, asks for your Anthropic API key, generates a token,
       sets PUBLIC_URL to this PC's LAN address
    5. Adds a Windows Firewall rule for port 8787 (needs admin; skipped otherwise)
    6. Registers a Task Scheduler job so Foreman starts at logon
    7. Starts Foreman now and opens the console

.PARAMETER ApiKey
  Anthropic API key (optional; you will be prompted if omitted and no key exists).
.PARAMETER NoAutostart
  Skip the Task Scheduler registration.
.PARAMETER Port
  Port to listen on (default 8787).
#>
[CmdletBinding()]
param(
  [string]$ApiKey = "",
  [switch]$NoAutostart,
  [int]$Port = 8787,
  [string]$Branch = "claude/grokbot-cms-agent-5vkq13",
  [string]$InstallDir = (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "charne")
)
$ErrorActionPreference = "Stop"
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

Write-Host "Foreman (CMS Agent) installer" -ForegroundColor White

Step "1/7 Prerequisites"
if (-not (Have winget)) { Warn "winget not found. Install Node.js LTS from https://nodejs.org and Git from https://git-scm.com, then re-run." }
if (-not (Have node)) { Write-Host "   Installing Node.js LTS..."; winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null; Refresh-Path }
if (-not (Have git)) { Write-Host "   Installing Git..."; winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements | Out-Null; Refresh-Path }
if (-not (Have node)) { throw "Node.js is still not on PATH. Close and reopen PowerShell, then re-run setup.ps1." }
$nodeVer = (node --version)
if ([int]($nodeVer.TrimStart("v").Split(".")[0]) -lt 20) { throw "Node $nodeVer is too old; Foreman needs Node 20 or newer." }
Ok "Node $nodeVer, git $((git --version) -replace 'git version ','')"

Step "2/7 Code"
if (Test-Path (Join-Path $InstallDir ".git")) {
  Push-Location $InstallDir
  git fetch origin $Branch --quiet
  git checkout $Branch --quiet 2>$null
  git pull origin $Branch --quiet
  Pop-Location
  Ok "Updated $InstallDir ($Branch)"
} else {
  git clone --quiet --branch $Branch https://github.com/elchoerob-stack/charne.git $InstallDir
  Ok "Cloned to $InstallDir"
}
$serverDir = Join-Path $InstallDir "cms-agent\server"

Step "3/7 Dependencies and build"
Push-Location $serverDir
npm install --no-audit --no-fund --loglevel=error
npm run build --silent
Pop-Location
Ok "Built $serverDir\dist"

Step "4/7 Configuration"
$envPath = Join-Path $serverDir ".env"
if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $serverDir ".env.example") $envPath }
$envText = Get-Content $envPath -Raw
function Set-EnvValue([string]$key, [string]$value) {
  $script:envText = if ($script:envText -match "(?m)^$key=") { $script:envText -replace "(?m)^$key=.*$", "$key=$value" } else { $script:envText.TrimEnd() + "`n$key=$value`n" }
}
$existingKey = if ($envText -match "(?m)^ANTHROPIC_API_KEY=(.+)$") { $Matches[1].Trim() } else { "" }
if (-not $ApiKey -and -not $existingKey) {
  $secure = Read-Host "   Paste your Anthropic API key (from console.anthropic.com; leave blank to add later)" -AsSecureString
  $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($ApiKey) { Set-EnvValue "ANTHROPIC_API_KEY" $ApiKey; Ok "API key saved" } elseif ($existingKey) { Ok "API key already set" } else { Warn "No API key: reports and recordings work, chat will not until you add ANTHROPIC_API_KEY to $envPath" }
if (-not ($envText -match "(?m)^CMS_AGENT_TOKEN=.+$")) {
  $token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  Set-EnvValue "CMS_AGENT_TOKEN" $token
  Ok "Generated access token (needed on the phone): $token"
} else { $token = ($envText | Select-String "(?m)^CMS_AGENT_TOKEN=(.+)$").Matches[0].Groups[1].Value.Trim(); Ok "Access token already set: $token" }
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
if (-not $lanIp) { $lanIp = "localhost" }
Set-EnvValue "PORT" $Port
Set-EnvValue "PUBLIC_URL" "http://$lanIp`:$Port"
Set-Content $envPath $envText -NoNewline
Ok "PUBLIC_URL=http://$lanIp`:$Port"

Step "5/7 Firewall (so the phone can connect)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  if (-not (Get-NetFirewallRule -DisplayName "Foreman $Port" -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName "Foreman $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null }
  Ok "Inbound rule for TCP $Port on private networks"
} else {
  Warn "Not running as admin. To let the phone connect, run once in an admin PowerShell:"
  Warn "  New-NetFirewallRule -DisplayName 'Foreman $Port' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private"
}

Step "6/7 Start at logon"
$cmdPath = Join-Path $serverDir "start-foreman.cmd"
@"
@echo off
title Foreman (CMS Agent)
cd /d "%~dp0"
node dist\index.js
pause
"@ | Set-Content $cmdPath -Encoding ASCII
if ($NoAutostart) { Warn "Skipped Task Scheduler (-NoAutostart)" }
else {
  schtasks /Create /TN "Foreman CMS Agent" /TR "`"$cmdPath`"" /SC ONLOGON /RL LIMITED /F | Out-Null
  Ok "Task 'Foreman CMS Agent' runs $cmdPath at logon"
}

Step "7/7 Start now"
$running = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($running) { Ok "Something is already listening on $Port; leaving it" }
else { Start-Process -FilePath $cmdPath -WorkingDirectory $serverDir; Start-Sleep -Seconds 3; Ok "Started in its own window" }
Start-Process "http://localhost:$Port"

Write-Host ""
Write-Host "Done." -ForegroundColor White
Write-Host "  Computer app : open http://localhost:$Port in Chrome/Edge and click 'Install app'"
Write-Host "  Phone        : same Wi-Fi, open http://$lanIp`:$Port in Chrome, Add to Home screen"
Write-Host "                 token when asked: $token"
Write-Host "  Recorder     : chrome://extensions -> Developer mode -> Load unpacked -> $InstallDir\cms-agent\recorder-extension"
Write-Host "  Settings     : $envPath"
Write-Host "  Guide        : $InstallDir\cms-agent\docs\USER_GUIDE.md"
