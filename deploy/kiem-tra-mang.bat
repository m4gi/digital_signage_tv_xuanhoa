@echo off
rem Network test for one floor: plug a laptop into that floor's switch and double-click this file.
rem No admin rights needed. Results go to ket-qua\ next to this file (one report per run + tong-hop.csv).
rem Saved as UTF-8 without BOM; chcp 65001 makes cmd read the Vietnamese lines below correctly.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "%~dp0kiem-tra-mang.ps1" (
  echo Thiếu file kiem-tra-mang.ps1 cạnh kiem-tra-mang.bat.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiem-tra-mang.ps1" %*
echo.
pause
