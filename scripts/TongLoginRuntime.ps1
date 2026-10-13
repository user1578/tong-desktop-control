param([ValidateSet('status','start','stop','run')][string]$Mode='status')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$runtime='D:\Tong\runtime'
$node='D:\node\node.exe'
$manager=Join-Path $runtime 'releases\manager\scripts\TongAgentDockRuntime.mjs'
function Runtime([string]$Action,[string]$ExpectedRunId) {
    # Standalone status uses the manager's existing ACL-checked readonly path.
    # Lifecycle queries still require the recovery grant before any side effect.
    if($Action -ceq 'status' -and $Mode -eq 'status'){$raw=& $node $manager $Action --root $runtime}
    elseif($Action -ceq 'stop-run'){$raw=& $node $manager $Action --root $runtime --run-id $ExpectedRunId --login-recovery}else{$raw=& $node $manager $Action --root $runtime --login-recovery}
    if($LASTEXITCODE -ne 0){throw ('Tong manager refused '+$Action)}
    return ($raw|ConvertFrom-Json)
}
function Enter-RuntimeLock($Mutex) {
    $locked=$false
    try{$locked=$Mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(-not $locked){throw 'Another Tong lifecycle operation is running'}
}
function Stop-UnhealthyRuntime([string]$RunId) {
    # Never stop a replacement run or a startup/shutdown in progress. The
    # manager still verifies approval, exact identity and private Job cleanup.
    $current=Runtime 'status'
    if($current.supervisorAlive -and $current.phase -ceq 'ready' -and $current.runId -ceq $RunId){$null=Runtime 'stop-run' $RunId}
    throw 'Tong failed consecutive health checks; scheduler recovery required'
}
try {
    if($Mode -eq 'status') {
        $status=Runtime 'status'
        [ordered]@{tongPhase=$status.phase;tongSupervisorAlive=$status.supervisorAlive;runId=$(if($status.PSObject.Properties['runId']){$status.runId}else{$null})}|ConvertTo-Json
        exit 0
    }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex=[Threading.Mutex]::new($false,('Local\TongLoginRuntime-'+$sid))
    try {
        $locked=$false
        try {
            Enter-RuntimeLock $mutex;$locked=$true
            $status=Runtime 'status'
            if($Mode -eq 'stop') {
                if($status.supervisorAlive){$null=Runtime 'stop-run' $status.runId}
                Write-Output 'Tong stopped. State and PID evidence retained.'
            }else {
                if(-not $status.supervisorAlive) {
                    if($status.phase -eq 'stale_record'){$null=Runtime 'reconcile-stale'}
                    $null=Runtime 'start'
                    $status=Runtime 'status'
                }
                # A manual manager start can already be in progress at login.
                # Wait for its readiness instead of creating a second instance.
                $deadline=[DateTime]::UtcNow.AddSeconds(120)
                while($status.supervisorAlive -and $status.phase -ceq 'starting' -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Seconds 2;$status=Runtime 'status'}
                if(-not $status.supervisorAlive -or $status.phase -cne 'ready'){throw 'Tong is not ready; scheduler recovery required'}
                for($attempt=0;$attempt -lt 3;$attempt++) {
                    $doctor=Runtime 'doctor'
                    if($doctor.healthy){break}
                    if($attempt -eq 2){Stop-UnhealthyRuntime $status.runId}
                    Start-Sleep -Seconds 2
                }
                Write-Output 'Tong healthy; Gateway, DevSpace and approved AgentDock managed by the pinned runtime.'
            }
        }finally{if($locked){$mutex.ReleaseMutex()}}
        if($Mode -eq 'run') {
            # Task Scheduler owns this wrapper; it survives terminal closure.
            # Three consecutive failures avoid restarting for a transient probe.
            # Restart count and delay remain bounded by the existing task policy.
            $failures=0;$observedRunId=$status.runId
            while($true) {
                Start-Sleep -Seconds 10
                $locked=$false
                try {
                    Enter-RuntimeLock $mutex;$locked=$true
                    $status=Runtime 'status'
                    if(-not $status.supervisorAlive -or $status.phase -cne 'ready'){throw 'Managed Tong exited or lost readiness'}
                    if($status.runId -cne $observedRunId){$failures=0;$observedRunId=$status.runId}
                    $doctor=Runtime 'doctor'
                    if($doctor.healthy){$failures=0}else{$failures++;if($failures -ge 3){Stop-UnhealthyRuntime $observedRunId}}
                }finally{if($locked){$mutex.ReleaseMutex()}}
            }
        }
    }finally{$mutex.Dispose()}
}catch {
    $message=$_.Exception.Message
    [Console]::Error.WriteLine($message)
    if(Test-Path -LiteralPath (Join-Path $runtime 'logs')){[IO.File]::AppendAllText((Join-Path $runtime 'logs\login-management.log'),([DateTime]::UtcNow.ToString('o')+' '+$message+"`n"),[Text.UTF8Encoding]::new($false))}
    exit 1
}
