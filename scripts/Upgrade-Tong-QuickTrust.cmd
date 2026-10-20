@echo off
setlocal
set "PS7=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%PS7%" (
  echo PowerShell 7 was not found; Tong production was not modified.
  pause
  exit /b 1
)
echo Tong Quick Trust production upgrade - matching APP and Manager releases.
echo Existing project sessions and user data are preserved; local approvals are required.
"%PS7%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-TongQuickTrustFullProduction.ps1" -Mode Deploy
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Upgrade was not confirmed. Check the console result before retrying.
) else (
  echo.
  echo Upgrade completed; check the ChatGPT Tong connection afterwards.
)
pause
exit /b %RC%
