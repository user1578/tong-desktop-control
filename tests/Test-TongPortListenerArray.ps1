$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\scripts\TongControl.psm1') -Force
$module = Get-Module -Name TongControl
$listeners = & $module { Get-TongPortListeners -Port 65534 }

if ($null -eq $listeners -or $listeners -isnot [array]) {
    throw 'A port query must return an array, including when no listener exists.'
}

try {
    & $module { Wait-TongPort -Port 65534 -ProcessId 2147483647 -Service 'test sentinel' }
    throw 'The sentinel process should not own a listening port.'
}
catch {
    if ($_.Exception.Message -notlike '*exited before its port became ready*') { throw }
}
Write-Output 'PASS: an empty port query remains an array.'
Write-Output 'PASS: waiting on an empty port reports the expected startup state.'
