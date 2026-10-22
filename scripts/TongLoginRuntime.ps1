param([ValidateSet('status','start','stop','run')][string]$Mode='status')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$runtime='D:\Tong\runtime'
$node='D:\node\node.exe'
$manager=Join-Path $runtime 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$recoveryLimit=3;$recoveryWindowSeconds=1800;$recoveryIntervalSeconds=60
function Write-RuntimeEvent([string]$Event,$Status,[string]$Reason,$Details) {
    $entry=[ordered]@{at=[DateTime]::UtcNow.ToString('o');event=$Event;mode=$Mode;runnerPid=$PID;reason=$Reason}
    if($Status){foreach($key in @('runId','phase','supervisorAlive','guardianAlive')){if($Status.PSObject.Properties[$key]){$entry[$key]=$Status.$key}}}
    if($Details){foreach($key in $Details.Keys){$entry[$key]=$Details[$key]}}
    [IO.File]::AppendAllText((Join-Path $runtime 'logs\login-management.jsonl'),(($entry|ConvertTo-Json -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
}
function New-LoginManagerProcess([string[]]$Arguments) {
    # PS5.1 has no ArgumentList. These fixed paths/arguments cannot contain a
    # quote, newline or trailing backslash that would escape a closing quote.
    foreach($argument in $Arguments){if($argument -match '["\r\n]' -or $argument.EndsWith('\')){throw 'Invalid Manager argument'}}
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=[Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName=$node
    $process.StartInfo.Arguments=($Arguments|ForEach-Object {'"'+$_+'"'}) -join ' '
    $process.StartInfo.WorkingDirectory=$runtime
    $process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
    $process.StartInfo.RedirectStandardInput=$true
    $process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
    $process.StartInfo.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $process.StartInfo.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    return $process
}
function Runtime([string]$Action,[string]$ExpectedRunId) {
    # Standalone status uses the manager's existing ACL-checked readonly path.
    # Lifecycle queries still require the recovery grant before any side effect.
    $arguments=@($manager,$Action,'--root',$runtime)
    if($Action -ceq 'stop-run'){$arguments+=@('--run-id',$ExpectedRunId)}
    if(-not ($Action -ceq 'status' -and $Mode -eq 'status')){$arguments+='--login-recovery'}
    $arguments+='--error-json'
    $process=$null;$reason='MANAGER_START_FAILED'
    $details=@{managerAction=$Action;managerPid=$null;managerStartTicks=$null;exitObserved=$false;nativeExitCode=$null;exitHex=$null;outputKind='unread'}
    $clock=[Diagnostics.Stopwatch]::StartNew()
    try {
        $process=New-LoginManagerProcess $arguments
        if(-not $process.Start()){throw 'Manager did not start'}
        # Retain the actual process handle: pipe EOF and PID-only observations
        # cannot prove that this particular native process has exited.
        $null=$process.Handle
        $details.managerPid=$process.Id;$details.managerStartTicks=$process.StartTime.ToUniversalTime().Ticks.ToString()
        $process.StandardInput.Close()
        $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
        if($Mode -ne 'status'){Write-RuntimeEvent 'manager_command_started' $null '' $details}
        $reason='MANAGER_EXIT_TIMEOUT'
        # Existing maximum startup (120s) plus abort cleanup (30s), within the
        # maintenance mutex's unchanged 180s limit. Never kill an unresolved CLI.
        if(-not $process.WaitForExit(150000)){throw 'Manager exit unproven'}
        $details.exitObserved=$true;$details.nativeExitCode=$process.ExitCode
        $global:LASTEXITCODE=$details.nativeExitCode
        $details.exitHex=('0x{0:X8}' -f ([long]$details.nativeExitCode -band 0xffffffffL))
        $details.durationMs=$clock.ElapsedMilliseconds
        if($Mode -ne 'status'){Write-RuntimeEvent 'manager_command_exited' $null '' $details}
        $reason='MANAGER_OUTPUT_INCOMPLETE'
        # Read both streams concurrently. A descendant can retain a pipe after
        # Manager exit; distinguish that failure from an actual process timeout.
        if(-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout,$stderr),2000)){throw 'Manager output incomplete'}
        $raw=$stdout.GetAwaiter().GetResult()
        $details.outputKind=if([string]::IsNullOrWhiteSpace($raw)){'empty'}else{'unstructured'}
        if($details.nativeExitCode -ne 0){
            $reason='REFUSED'
            try{$failure=$raw|ConvertFrom-Json;if($failure.error -cmatch '^[A-Z_]{1,64}$'){$reason=$failure.error;$details.outputKind='error_json'}}catch{}
            throw 'Manager refused command'
        }
        $reason='MANAGER_OUTPUT_INVALID'
        $result=$raw|ConvertFrom-Json -ErrorAction Stop
        if($null -eq $result){throw 'Manager output missing'}
        return $result
    }catch{
        # Bounded metadata only, never arbitrary stdout/stderr or exception text.
        # Do not add Manager log events to standalone status.
        if($Mode -ne 'status'){Write-RuntimeEvent 'manager_command_failed' $null $reason $details}
        $failureException=[InvalidOperationException]::new(('Tong manager refused '+$Action+': '+$reason))
        $failureException.Data['managerAction']=$Action;$failureException.Data['managerCode']=$reason
        throw $failureException
    }finally{
        if($process){$process.Dispose()}
    }
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
function Start-ManagedRuntimeOnce($Status) {
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
function Start-ManagedRuntime($Status) {
    for($attempt=0;$attempt -lt $recoveryLimit;$attempt++){
        try{return (Start-ManagedRuntimeOnce $Status)}catch{
            # A failed manager start has already waited for its exact Guardian
            # cleanup. Recheck state; the manager still enforces Job/identity,
            # ports, pins and authorization on every bounded retry.
            if($Mode -cne 'run' -or $attempt -ge ($recoveryLimit-1) -or $_.Exception.Data['managerAction'] -cne 'start' -or $_.Exception.Data['managerCode'] -notin @('START_FAILED','START_TIMEOUT')){throw}
            $Status=Runtime 'status'
            if($Status.PSObject.Properties['stopRequested'] -and $Status.stopRequested){throw 'Startup retry refused: stop requested; evidence retained'}
            if($Status.supervisorAlive -or $Status.phase -notin @('not_started','stopped','abnormal_exit')){throw 'Startup retry refused: cleanup or identity unresolved; evidence retained'}
            Reserve-Recovery $Status 'startup_retry'
        }
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
