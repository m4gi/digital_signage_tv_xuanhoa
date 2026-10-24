@echo off
rem Builds dist\: one self-contained LedConference.exe (no .NET needed on the server) plus install scripts and docs.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo == Kiem tra logic (SelfCheck)
dotnet run --project tests\SelfCheck -c Release
if errorlevel 1 (
  echo.
  echo SelfCheck THAT BAI - khong dong goi.
  exit /b 1
)

echo.
echo == Dong goi LedConference.exe
rem Publish also emits IIS-only files (web.config, aspnetcorev2_inprocess.dll); the exe runs on Kestrel, so only it is kept.
if exist dist rmdir /s /q dist
if exist obj\publish rmdir /s /q obj\publish
dotnet publish src\LedConference -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o obj\publish
if errorlevel 1 exit /b 1

mkdir dist
copy /y obj\publish\LedConference.exe dist\ >nul
copy /y deploy\install.bat dist\ >nul
copy /y deploy\install.ps1 dist\ >nul
copy /y deploy\uninstall.bat dist\ >nul
copy /y README.md dist\ >nul
copy /y docs\screen-api.md dist\ >nul
rmdir /s /q obj\publish
rmdir obj 2>nul

echo.
echo Xong. Thu muc dist\:
dir /b dist
