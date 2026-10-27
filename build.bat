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
rem Logic chon trang thai cua man hinh (web\schedule.js); can Node.js, khong co thi bo qua.
where node >nul 2>&1 && (
  node tests\schedule.test.js
  if errorlevel 1 (
    echo schedule.test.js THAT BAI - khong dong goi.
    exit /b 1
  )
)

echo.
echo == Dong goi LedConference.exe
rem Publish also emits IIS-only files (web.config, aspnetcorev2_inprocess.dll); the exe runs on Kestrel, so only it is kept.
rem dist\data\ is the live data of a service installed from dist\ (meetings, settings, logs): never delete it.
if exist dist for %%f in (dist\*) do del /q "%%f"
if exist obj\publish rmdir /s /q obj\publish
dotnet publish src\LedConference -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o obj\publish
if errorlevel 1 exit /b 1

if not exist dist mkdir dist
copy /y obj\publish\LedConference.exe dist\ >nul
if errorlevel 1 (
  echo Khong ghi duoc dist\LedConference.exe: dung dich vu LedConference truoc ^(sc stop LedConference^).
  exit /b 1
)
copy /y deploy\install.bat dist\ >nul
copy /y deploy\install.ps1 dist\ >nul
copy /y deploy\uninstall.bat dist\ >nul
copy /y deploy\kiem-tra-mang.bat dist\ >nul
copy /y deploy\kiem-tra-mang.ps1 dist\ >nul
if not exist dist\macos mkdir dist\macos
copy /y deploy\macos\* dist\macos\ >nul
copy /y docs\huong-dan-mang.md dist\ >nul
copy /y README.md dist\ >nul
copy /y docs\screen-api.md dist\ >nul
rem APK man hinh: build truoc bang android\gradlew.bat assembleDebug (can Android Studio).
if exist android\app\build\outputs\apk\debug\app-debug.apk copy /y android\app\build\outputs\apk\debug\app-debug.apk dist\LichHop.apk >nul
rmdir /s /q obj\publish
rmdir obj 2>nul

echo.
echo Xong. Thu muc dist\:
dir /b dist
