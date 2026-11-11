<#
.SYNOPSIS
  Launches the Trader Agent in its OWN window in --watch mode, so it runs
  continuously alongside your other work: it watches jobs\pending\ and
  processes whatever you (or Claude) drop in, while you keep working/training.

.DESCRIPTION
  Opens a separate PowerShell window running `dotnet run -- --watch` from the
  agent\ folder. Leave that window open (minimised is fine) and the agent keeps
  running. Close it to stop the agent. cTrader must be open and logged in,
  since the agent drives its UI.

  This runs in your interactive session (it drives a visible GUI), so keep
  yourself logged in — locking the screen is generally fine, fully logging off
  is not. For auto-start at logon, use Install-ScheduledTask.ps1 instead.

.EXAMPLE
  .\Start-Agent.ps1
#>

param(
    [string]$AgentDir = "$PSScriptRoot\..\agent",
    [switch]$Build
)

$AgentDir = (Resolve-Path $AgentDir).Path

if ($Build) {
    Write-Host "Building agent..."
    dotnet build "$AgentDir\CTraderAgent.csproj" -c Debug | Out-Host
}

Write-Host "Starting Trader Agent in a new window (watching for jobs)..."
Write-Host "  Jobs folder : $AgentDir\..\jobs\pending"
Write-Host "  Reports     : $AgentDir\..\reports"
Write-Host "Close the new window to stop the agent."

# -NoExit keeps the window (and the agent) alive; the title makes it easy to spot.
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$host.UI.RawUI.WindowTitle = 'cTrader Trader Agent (watching)'; Set-Location '$AgentDir'; dotnet run -- --watch"
)
