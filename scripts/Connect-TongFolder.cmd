@echo off
setlocal
set "PS7=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%PS7%" (
  echo 需要安装或修复 PowerShell 7。
  pause
  exit /b 1
)
"%PS7%" -STA -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Connect-TongFolder.ps1" -ChooseFolder
if errorlevel 1 (
  echo 未建立授权。没有自动放宽原有权限。
)
pause
