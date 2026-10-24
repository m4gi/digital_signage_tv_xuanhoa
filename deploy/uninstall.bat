@echo off
rem Removes the LedConference service and its firewall rules after a Y/N confirmation.
rem Keeps data\ (meetings, rooms, settings, backups), so install.bat can bring everything back.
setlocal
cd /d "%~dp0"
set SVC=LedConference

net session >nul 2>&1
if errorlevel 1 (
  echo Can chay bang quyen Administrator: chuot phai uninstall.bat, chon "Run as administrator".
  pause
  exit /b 1
)

sc query %SVC% >nul 2>&1
if errorlevel 1 (
  echo Dich vu %SVC% chua duoc cai tren may nay. Khong co gi de go.
  pause
  exit /b 0
)

set PORTS=
if exist data\settings.json (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Get-Content data\settings.json -Raw | ConvertFrom-Json; '' + $s.screenPort + ' va ' + $s.adminPort"`) do set PORTS=%%p
)

echo Se go dich vu %SVC% va luat tuong lua cua no.
if defined PORTS echo Cong duoc giai phong: %PORTS%
echo Du lieu trong thu muc data\ duoc GIU LAI.
choice /c YN /m "Tiep tuc go"
if errorlevel 2 (
  echo Da huy, khong thay doi gi.
  pause
  exit /b 0
)

sc stop %SVC% >nul 2>&1
timeout /t 3 /nobreak >nul
sc delete %SVC% >nul
if errorlevel 1 (
  echo Khong go duoc dich vu. Dong cua so Services neu dang mo roi chay lai.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="LedConference - man hinh" >nul 2>&1
netsh advfirewall firewall delete rule name="LedConference - quan tri" >nul 2>&1

echo.
echo Da go dich vu va luat tuong lua.
echo Du lieu van con trong data\ ^(chay install.bat de cai lai, hoac xoa tay neu khong can nua^).
pause
