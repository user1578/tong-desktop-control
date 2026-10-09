$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TongControl.psm1') -Force
Stop-TongDesktopControl
Start-TongDesktopControl
