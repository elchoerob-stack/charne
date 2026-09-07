@echo off
title Foreman installer
echo Installing Foreman (CMS Agent). A PowerShell window will do the work.
echo If Windows asks for permission, click Yes so the firewall rule for the phone can be added.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-Command','irm https://raw.githubusercontent.com/elchoerob-stack/charne/claude/grokbot-cms-agent-5vkq13/cms-agent/setup.ps1 | iex'"
