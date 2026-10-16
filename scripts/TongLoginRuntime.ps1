param([ValidateSet('status','start','stop','run')][string]$Mode='status')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$runtime='D:\Tong\runtime'
$node='D:\node\node.exe'
$manager=Join-Path $runtime 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$recoveryLimit=3;$recoveryWindowSeconds=1800;$recoveryIntervalSeconds=60
function Write-RuntimeEvent([string]$Event,$Status,[string]$Reason) {
    $entry=[ordered]@{at=[DateTime]::UtcNow.ToString('o');event=$Event;mode=$Mode;runnerPid=$PID;reason=$Reason}
    if($Status){foreach($key in @('runId','phase','supervisorAlive','guardianAlive')){if($Status.PSObject.Properties[$key]){$entry[$key]=$Status.$key}}}
    [IO.File]::AppendAllText((Join-Path $runtime 'logs\login-management.jsonl'),(($entry|ConvertTo-Json -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
}
function Runtime([string]$Action,[string]$ExpectedRunId) {
    # Standalone status uses the manager's existing ACL-checked readonly path.
    # Lifecycle queries still require the recovery grant before any side effect.
    if($Action -ceq 'status' -and $Mode -eq 'status'){$raw=& $node $manager $Action --root $runtime --error-json}
    elseif($Action -ceq 'stop-run'){$raw=& $node $manager $Action --root $runtime --run-id $ExpectedRunId --login-recovery --error-json}else{$raw=& $node $manager $Action --root $runtime --login-recovery --error-json}
    if($LASTEXITCODE -ne 0){$reason='REFUSED';try{$failure=$raw|ConvertFrom-Json;if($failure.error -cmatch '^[A-Z_]{1,64}$'){$reason=$failure.error}}catch{};throw ('Tong manager refused '+$Action+': '+$reason)}
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
    if(-not $current.supervisorAlive -or $current.phase -cne 'ready' -or $current.runId -cne $RunId){throw 'Tong changed during health checks; recovery refused'}
    $null=Runtime 'stop-run' $RunId
}
function Read-RecoveryTime($Value) {
    # PS7 converts JSON ISO timestamps to DateTime; PS5.1 returns strings.
    # Avoid a culture/local-time round trip that silently expires the budget.
    if($Value -is [DateTime]){return $Value.ToUniversalTime()}
    return [DateTime]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}
function Reserve-Recovery($Status,[string]$Reason) {
    # The budget survives wrapper exits and all three Task Scheduler retries.
    # Never reset it merely because a replacement Supervisor became ready.
    $path=Join-Path $runtime 'run\login-recovery-budget.json'
    $now=[DateTime]::UtcNow;$attempts=@()
    if(Test-Path -LiteralPath $path){
        $budget=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
        if($budget.schemaVersion -ne 1 -or -not $budget.PSObject.Properties['attempts']){throw 'Invalid login recovery budget; evidence retained'}
        foreach($item in $budget.attempts){
            $at=Read-RecoveryTime $item.at
            if($at -gt $now.AddSeconds(5)){throw 'Invalid login recovery clock; evidence retained'}
            if($at -gt $now.AddSeconds(-$recoveryWindowSeconds)){$attempts+=,$item}
        }
    }
    if($attempts.Count -ge $recoveryLimit){throw 'Login recovery budget exhausted; evidence retained'}
    if($attempts.Count -gt 0){
        $last=Read-RecoveryTime $attempts[-1].at
        $wait=[Math]::Ceiling(($last.AddSeconds($recoveryIntervalSeconds)-$now).TotalSeconds)
        if($wait -gt 0){Write-RuntimeEvent 'recovery_backoff' $Status ([string]$wait);Start-Sleep -Seconds $wait}
    }
    $runId=if($Status.PSObject.Properties['runId']){$Status.runId}else{$null}
    $attempts+=,[ordered]@{at=[DateTime]::UtcNow.ToString('o');runId=$runId;reason=$Reason}
    $temporary=$path+'.'+[guid]::NewGuid().ToString()+'.tmp'
    [IO.File]::WriteAllText($temporary,([ordered]@{schemaVersion=1;attempts=@($attempts)}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temporary,$path,[NullString]::Value)}else{[IO.File]::Move($temporary,$path)}
    Write-RuntimeEvent 'recovery_attempt' $Status $Reason
}
function Start-ManagedRuntime($Status) {
    # Give the existing Guardian a bounded opportunity to finish its private Job.
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    while(-not $Status.supervisorAlive -and $Status.PSObject.Properties['guardianAlive'] -and $Status.guardianAlive -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Seconds 1;$Status=Runtime 'status'}
    if(-not $Status.supervisorAlive){
        if($Status.phase -eq 'stale_record'){$null=Runtime 'reconcile-stale'}
        $null=Runtime 'start';$Status=Runtime 'status'
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(120)
    while($Status.supervisorAlive -and $Status.phase -ceq 'starting' -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Seconds 2;$Status=Runtime 'status'}
    if(-not $Status.supervisorAlive -or $Status.phase -cne 'ready'){throw 'Tong is not ready; evidence retained'}
    for($attempt=0;$attempt -lt 3;$attempt++) {
        $doctor=Runtime 'doctor'
        if($doctor.healthy){return $Status}
        if($attempt -eq 2){Stop-UnhealthyRuntime $Status.runId;throw 'Tong failed consecutive health checks; evidence retained'}
        Start-Sleep -Seconds 2
    }
}
try {
    if($Mode -eq 'status') {
        $status=Runtime 'status'
        [ordered]@{tongPhase=$status.phase;tongSupervisorAlive=$status.supervisorAlive;runId=$(if($status.PSObject.Properties['runId']){$status.runId}else{$null})}|ConvertTo-Json
        exit 0
    }
    Write-RuntimeEvent 'runner_started' $null ''
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
                if($Mode -eq 'run' -and -not $status.supervisorAlive){Reserve-Recovery $status 'login_start'}
                $status=Start-ManagedRuntime $status
                Write-RuntimeEvent 'runtime_healthy' $status ''
                Write-Output 'Tong healthy; Gateway, DevSpace and approved AgentDock managed by the pinned runtime.'
            }
        }finally{if($locked){$mutex.ReleaseMutex()}}
        if($Mode -eq 'run') {
            # Task Scheduler owns this wrapper; it survives terminal closure.
            # Three consecutive failures avoid restarting for a transient probe.
            # Local recovery is bounded across scheduler restarts by the budget.
            $failures=0;$observedRunId=$status.runId
            while($true) {
                Start-Sleep -Seconds 10
                $locked=$false
                try {
                    Enter-RuntimeLock $mutex;$locked=$true
                    $status=Runtime 'status'
                    if(($status.PSObject.Properties['stopRequested'] -and $status.stopRequested) -or (-not $status.supervisorAlive -and $status.phase -ceq 'stopped')){Write-RuntimeEvent 'requested_stop_observed' $status '';exit 0}
                    if(-not $status.supervisorAlive -or $status.phase -cne 'ready'){
                        Write-RuntimeEvent 'runtime_lost' $status 'process_or_readiness_lost'
                        Reserve-Recovery $status 'process_or_readiness_lost'
                        $status=Start-ManagedRuntime $status
                        Write-RuntimeEvent 'recovery_succeeded' $status ''
                        $failures=0;$observedRunId=$status.runId;continue
                    }
                    if($status.runId -cne $observedRunId){$failures=0;$observedRunId=$status.runId}
                    $doctor=Runtime 'doctor'
                    if($doctor.healthy){$failures=0}else{$failures++;if($failures -ge 3){
                        Reserve-Recovery $status 'consecutive_health_failures'
                        Stop-UnhealthyRuntime $observedRunId
                        $status=Start-ManagedRuntime (Runtime 'status')
                        Write-RuntimeEvent 'recovery_succeeded' $status ''
                        $failures=0;$observedRunId=$status.runId
                    }}
                }finally{if($locked){$mutex.ReleaseMutex()}}
            }
        }
    }finally{$mutex.Dispose()}
}catch {
    $message=$_.Exception.Message
    try{Write-RuntimeEvent 'runner_failed' $null $message}catch{}
    [Console]::Error.WriteLine($message)
    if(Test-Path -LiteralPath (Join-Path $runtime 'logs')){[IO.File]::AppendAllText((Join-Path $runtime 'logs\login-management.log'),([DateTime]::UtcNow.ToString('o')+' '+$message+"`n"),[Text.UTF8Encoding]::new($false))}
    exit 1
}
