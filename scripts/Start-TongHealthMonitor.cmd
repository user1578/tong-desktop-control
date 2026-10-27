@echo off
setlocal
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell 7 pwsh.exe was not found.
  echo Install PowerShell 7 or run the .ps1 script with an installed pwsh.exe.
  pause
  exit /b 1
)
echo Starting independent read-only Tong health monitor...
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Watch-TongHealth.ps1" -Mode Start -IntervalSeconds 10
if errorlevel 1 (
  echo Monitor failed to start. No Tong production configuration was changed.
  pause
  exit /b 1
)
echo.
echo Close this window if desired. The health monitor runs separately.
pause
