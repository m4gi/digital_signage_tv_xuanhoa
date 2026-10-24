@echo off
rem Installs LedConference as a Windows Service. Right-click > Run as administrator.
rem The steps (port scan, settings, service, firewall, check) live in install.ps1 next to this file.
rem Safe to run again: it reinstalls the service, lets you change the ports and keeps data\.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Can chay bang quyen Administrator: chuot phai install.bat, chon "Run as administrator".
  pause
  exit /b 1
)
if not exist "%~dp0install.ps1" (
  echo Thieu file install.ps1 canh install.bat. Hay chep lai day du bo cai.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
