param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$NodeExe,[Parameter(Mandatory)][string]$Supervisor,[string]$RecoveryGrantId)
$ErrorActionPreference='Stop'
try {
    $guardian=Join-Path $PSScriptRoot 'TongRuntimeGuardian.ps1'
    if(@($Root,$NodeExe,$Supervisor,$guardian) | Where-Object {$_ -match '["\r\n]'}){throw 'Invalid launch path'}
    if($RunId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid run identity'}
    $Root=[IO.Path]::GetFullPath($Root)
    if($Root -ceq 'D:\Tong\runtime') {
        if($NodeExe -cne 'D:\node\node.exe' -or $Supervisor -cne 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs'){throw 'Fixed production entry required'}
        if($RecoveryGrantId){& $NodeExe $Supervisor preflight-login --root $Root --grant-id $RecoveryGrantId | Out-Null}else{& $NodeExe $Supervisor preflight-production | Out-Null}
        if($LASTEXITCODE -ne 0){throw 'Production approval refused'}
    }elseif(-not $Root.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved scope'}
    if($RecoveryGrantId -and $RecoveryGrantId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'Invalid recovery grant identity'}
    $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$guardian+'" -Root "'+$Root+'" -RunId "'+$RunId+'" -NodeExe "'+$NodeExe+'" -Supervisor "'+$Supervisor+'"'
    if($RecoveryGrantId){$arguments+=' -RecoveryGrantId "'+$RecoveryGrantId+'"'}
    # A separate hidden Windows console survives the initiating CLI's console exit.
    # No service, scheduled task, startup item, or credential argument is created.
    $guardianShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $child=Start-Process -FilePath $guardianShell -ArgumentList $arguments -WindowStyle Hidden -PassThru
    [pscustomobject]@{pid=$child.Id} | ConvertTo-Json -Compress
} catch {[Console]::Error.WriteLine('Runtime launch refused');exit 2}
