<#
.SYNOPSIS
  Registers CTraderAgent to start automatically in your interactive Windows
  session whenever you log in, so it's watching the jobs/pending folder
  without you having to remember to start it.

.NOTES
  This MUST run in your interactive session (not as a SYSTEM/service task)
  because it drives a visible GUI application (cTrader Automate) via UI
  Automation. A "run whether user is logged on or not" task cannot see or
  click a desktop UI. If you lock your screen, Windows UI Automation
  generally still works; if you fully log off, it will not.

.EXAMPLE
  # Run from an elevated PowerShell prompt in this scheduler/ folder:
  .\Install-ScheduledTask.ps1
#>

param(
    [string]$TaskName = "CTraderAutonomousAgent",
    [string]$AgentExe = "$PSScriptRoot\..\agent\bin\Release\net8.0-windows\CTraderAgent.exe",
    [string]$Arguments = "--watch"
)

if (-not (Test-Path $AgentExe)) {
    Write-Warning "Agent executable not found at '$AgentExe'. Build it first: cd ..\agent && dotnet build -c Release"
}

# Working directory is deliberately the agent/ source folder (not the exe's own
# bin/Release/... output folder) because appsettings.json's "../jobs", "../reports",
# and "../logs" paths are resolved relative to the current working directory, and
# are meant to land in ctrader-agent/jobs, ctrader-agent/reports, ctrader-agent/logs
# — the same place they land when you run `dotnet run` from agent/ by hand.
$action = New-ScheduledTaskAction -Execute $AgentExe -Argument $Arguments -WorkingDirectory "$PSScriptRoot\..\agent"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

Write-Host "Registered scheduled task '$TaskName'. It will start '$AgentExe $Arguments' the next time you log on."
Write-Host "To start it immediately without logging off: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "To remove it later: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
