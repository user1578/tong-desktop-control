# Small self-contained test. Only touches this run's own disposable workspace fixture.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $root 'scripts\Watch-TongHealth.ps1'
$fixture=Join-Path (Join-Path $root 'artifacts') ('watcher-fixture-'+[guid]::NewGuid().ToString('N'))
$runtime=Join-Path $fixture 'runtime'
$out=Join-Path $fixture 'out'
$job=$null
try{
    foreach($p in @($runtime,(Join-Path $runtime 'run'),(Join-Path $runtime 'logs'),$out)){
        [void][IO.Directory]::CreateDirectory($p)
    }
    # An independently running production watcher owns the real mutex. Exercise
    # the same source with a fixture-only name instead of competing with it.
    $testScript=Join-Path $fixture 'Watch-TongHealth.ps1'
    [IO.File]::WriteAllText($testScript,([IO.File]::ReadAllText($script).Replace('Local\TongHealthMonitor_',('Local\TongHealthWatcherTest_'+[guid]::NewGuid().ToString('N')+'_'))))
    $script=$testScript
    $id=[guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $runtime 'run\runtime.json'),(@{phase='abnormal_exit';runId=$id;supervisor=@{pid=0}}|ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $runtime 'run\guardian.json'),(@{runId=$id;pid=0}|ConvertTo-Json))
    $inputLog=Join-Path $runtime 'logs\login-management.jsonl'
    [IO.File]::WriteAllText($inputLog,'')
    $job=Start-Job -ScriptBlock {
        param($script,$runtime,$out)
        & (Get-Command pwsh).Source -NoProfile -NonInteractive -File $script -Mode Run -IntervalSeconds 2 -MaxSamples 4 -RuntimeRoot $runtime -LogRoot $out
        if($LASTEXITCODE -ne 0){throw "watcher exit: $LASTEXITCODE"}
    } -ArgumentList $script,$runtime,$out
    $log=Join-Path $out 'health.jsonl'
    $ready=$false
    for($i=0;$i -lt 40;$i++){
        if((Test-Path $log) -and (Get-Content $log -ErrorAction SilentlyContinue|Where-Object {$_ -match '"type":"sample"'}|Select-Object -First 1)){$ready=$true;break}
        Start-Sleep -Milliseconds 500
    }
    if(-not $ready){$details=($job|Receive-Job -Keep 2>&1|Out-String);throw ('Watcher did not write first sample; job='+$job.State+'; '+$details)}
    $secret='DO_NOT_RECORD_FAKE_SECRET_943b'
    $eventAt=[datetime]::UtcNow.ToString('o')
    $callId=[guid]::NewGuid().ToString()
    $event=@{at=$eventAt;event='manager_command_failed';runId=$id;reason='APPROVAL_DENIED';managerAction='stop-run';diagnosticStage='envelope_unseal';diagnosticKind='AUTH_REJECTED';managerStage='envelope_unseal';managerPid=123;runnerPid=456;invocationId=$callId;nativeExitCode=-1073740791;exitHex='0xC0000409';secret=$secret}
    [IO.File]::AppendAllText($inputLog,(ConvertTo-Json -InputObject $event -Compress)+[char]10)
    # Runner exit can lack runId. Its event must still be recorded safely.
    $withoutRun=@{at=[datetime]::UtcNow.ToString('o');event='runner_failed';reason='APPROVAL_DENIED';privateMessage=$secret}
    [IO.File]::AppendAllText($inputLog,(ConvertTo-Json -InputObject $withoutRun -Compress)+[char]10)
    $job|Wait-Job -Timeout 70|Out-Null
    if($job.State -ne 'Completed'){throw "Watcher job state: $($job.State)"}
    $records=@(Get-Content $log|ForEach-Object {$_|ConvertFrom-Json})
    $samples=@($records|Where-Object {$_.type -eq 'sample'})
    $events=@($records|Where-Object {$_.type -eq 'source_event' -and $_.event -eq 'manager_command_failed'})
    $trans=@($records|Where-Object {$_.type -eq 'health_transition' -and $_.to -eq 'TONG_UNHEALTHY'})
    if($samples.Count -ne 4){throw "Expected 4 samples, got $($samples.Count)"}
    if(@($samples|Where-Object {$_.healthy}).Count -ne 0){throw 'Mock offline runtime unexpectedly healthy'}
    if($events.Count -lt 1){throw 'Missing appended authorization error event'}
    if($events[0].diagnosticKind -ne 'AUTH_REJECTED' -or $events[0].diagnosticStage -ne 'envelope_unseal'){throw 'Diagnostic stage/kind dropped'}
    if($events[0].managerAction -cne 'stop-run' -or $events[0].exitHex -cne '0xC0000409' -or $events[0].managerPid -ne 123 -or $events[0].runnerPid -ne 456 -or $events[0].invocationId -cne $callId){throw 'Native correlation metadata dropped'}
    if(([datetimeoffset]$events[0].sourceUtc).UtcDateTime -ne ([datetimeoffset]$eventAt).UtcDateTime){throw 'UTC source timestamp shifted'}
    if(@($records|Where-Object {$_.type -eq 'source_event' -and $_.event -eq 'runner_failed'}).Count -ne 1){throw 'RunId-less event was dropped'}
    if($trans.Count -ne 1){throw 'Missing offline transition'}
    $body=[IO.File]::ReadAllText($log)
    if($body.Contains($secret)){throw 'Untrusted source field leaked into output'}
    if(Test-Path (Join-Path $out 'owner.json')){throw 'Watcher failed to release its owner record'}
    [pscustomobject]@{passed=$true;samples=$samples.Count;sourceEvents=$events.Count;offlineTransitions=$trans.Count;leak=$false}|ConvertTo-Json -Compress
}finally{
    if($null -ne $job){
        if($job.State -eq 'Running'){Stop-Job $job -ErrorAction SilentlyContinue}
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    }
    if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Stop}
}
