param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$NodeExe,[Parameter(Mandatory)][string]$Supervisor,[string]$RecoveryGrantId)
$ErrorActionPreference='Stop'
$childId=0
try {
    $guardian=Join-Path $PSScriptRoot 'TongRuntimeGuardian.ps1'
    if(@($Root,$NodeExe,$Supervisor,$guardian) | Where-Object {$_ -match '["\r\n]'}){throw 'Invalid launch path'}
    if($RunId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid run identity'}
    $Root=[IO.Path]::GetFullPath($Root)
    if($Root -cne 'D:\Tong\runtime' -and -not $Root.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved scope'}
    if($Root -ceq 'D:\Tong\runtime' -and ($NodeExe -cne 'D:\node\node.exe' -or $Supervisor -cne 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs')){throw 'Fixed production entry required'}
    if($RecoveryGrantId -and $RecoveryGrantId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'Invalid recovery grant identity'}
    . (Join-Path $PSScriptRoot 'TongStartupProtocol.ps1')
    Initialize-TongStartup 'launcher'
    Assert-TongStartupActive
    if($Root -ceq 'D:\Tong\runtime') {
        if($NodeExe -cne 'D:\node\node.exe' -or $Supervisor -cne 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs'){throw 'Fixed production entry required'}
        if($RecoveryGrantId){Invoke-TongStartupPreflight ('"'+$Supervisor+'" preflight-login --root "'+$Root+'" --grant-id '+$RecoveryGrantId)}else{Invoke-TongStartupPreflight ('"'+$Supervisor+'" preflight-production')}
    }elseif(-not $Root.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved scope'}
    if($RecoveryGrantId -and $RecoveryGrantId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'Invalid recovery grant identity'}
    $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$guardian+'" -Root "'+$Root+'" -RunId "'+$RunId+'" -NodeExe "'+$NodeExe+'" -Supervisor "'+$Supervisor+'"'
    if($RecoveryGrantId){$arguments+=' -RecoveryGrantId "'+$RecoveryGrantId+'"'}
    $arguments+=' -OwnerJobName "Local\TongGuardian-'+$RunId+'"'
    # A new console alone still inherits the initiating application's Job.
    # Break away explicitly; refuse launch if that Job forbids breakaway.
    # Keep PS5.1 as the pinned production host; its .NET Framework security
    # helpers and the existing Task Scheduler action are validated together.
    $guardianShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Assert-TongStartupActive
    Set-TongStartupStage 'create_guardian'
    # From here until the creation result is persisted, absence is unknown.
    $script:tongStartup.guardianCreated=$null
    Set-TongStartupStage 'create_guardian'
    $adoptionBudget=[int][Math]::Max(1,[Math]::Min(30000,($script:tongDeadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())))
    $retainOuterJob=$false
    $request=[IO.File]::ReadAllText((Join-Path $Root 'run\request.json'))|ConvertFrom-Json
    if($request.PSObject.Properties['handoff']){
        if($request.runId -cne $RunId){throw 'Handoff request mismatch'}
        $proofInput=@{root=$Root;sessionId=$request.handoff.sessionId;profileDigest=$request.handoff.profileDigest;pid=$PID;role='launcher';action='start'}|ConvertTo-Json -Compress
        # The pinned runtime environment deliberately omits ProgramFiles.
        $proofHost=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'PowerShell\7\pwsh.exe'
        $proofRaw=$proofInput | & $proofHost -NoLogo -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'Tong024Handoff.ps1') -Mode proof
        if($LASTEXITCODE -ne 0){throw 'Handoff containment unavailable'}
        $proof=$proofRaw|ConvertFrom-Json
        if($proof.verified -cne $true -or $proof.caller.pid -ne $PID){throw 'Handoff containment refused'}
        $retainOuterJob=$true
    }
    $childId=[TongStartupPreflight]::StartGuardian(('Local\TongGuardian-'+$RunId),$guardianShell,$arguments,$Root,$adoptionBudget,$retainOuterJob)
    $script:tongStartup.guardianCreated=$true
    $script:tongStartup['guardian']=[ordered]@{pid=$childId;exe=$guardianShell;startTicks=[TongStartupPreflight]::GuardianStartTicks;markerMatches=$true}
    $script:tongStartup['finishedAt']=[DateTime]::UtcNow.ToString('o')
    Set-TongStartupStage 'guardian_created'
    [pscustomobject]@{pid=$childId} | ConvertTo-Json -Compress
} catch {
    # This explicit negative acknowledgement is emitted only before CreateProcess
    # returned a child. The manager can release its lock without guessing about
    # an unobserved Guardian after a breakaway/validation failure.
    if(Get-Variable tongStartup -Scope Script -ErrorAction SilentlyContinue){
        $nativeFailure=$_.Exception
        while($nativeFailure.InnerException){$nativeFailure=$nativeFailure.InnerException}
        if($nativeFailure.Data.Contains('guardianPid')){
            $childId=[int]$nativeFailure.Data['guardianPid']
            $script:tongStartup['guardian']=[ordered]@{pid=$childId;exe=[string]$nativeFailure.Data['guardianExe'];startTicks=[string]$nativeFailure.Data['guardianStartTicks'];markerMatches=$true}
            $script:tongStartup['guardianTreeCleanup']=[ordered]@{proven=($nativeFailure.Data['guardianTreeClean'] -ceq $true);jobName=('Local\TongGuardian-'+$RunId);stage='guardian_adoption';runId=$RunId}
        }
        # CreateProcess failure returned synchronously; a killed launcher cannot
        # execute this catch and therefore cannot publish negative proof.
        $script:tongStartup.guardianCreated=($childId -ne 0)
        try{Complete-TongStartupFailure $_}catch{}
        if($childId -eq 0 -and $script:tongStartup.preflightClean){[pscustomobject]@{runId=$RunId;guardianCreated=$false}|ConvertTo-Json -Compress}
    }
    [Console]::Error.WriteLine('Runtime launch refused');exit 2
}
