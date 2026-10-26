# Exercise the real waiter's stage cap/exit/cancel with actual IPC and an
# atomically contained native parent Job; no runtime roots or Tasks are used.
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $project 'scripts\TongStartupProtocol.ps1')
$runId=[guid]::NewGuid().ToString()
$job='Local\TongPreflight-launcher-'+$runId
$output=Join-Path $project ('artifacts\024-recovery\readiness-native-'+$runId+'.local.json')
$arguments='"'+(Join-Path $PSScriptRoot 'fixtures\TongReadinessNative.mjs')+'" parent "'+$output+'"'
$probe=[TongStartupPreflight]::new($job,'D:\node\node.exe',$arguments,$project)
$parent=@{pid=$probe.Pid;exe='D:\node\node.exe';startTicks=$probe.StartTicks}
try{
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 while(-not $probe.Exited -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
 if(-not $probe.Exited){throw 'READINESS_TEST_PARENT_TIMEOUT'}
 if($probe.ExitCode -ne 0){throw 'READINESS_TEST_PARENT_FAILED'}
 if($probe.Active -ne 0){throw 'READINESS_TEST_JOB_NOT_EMPTY'}
 $result=[IO.File]::ReadAllText($output)|ConvertFrom-Json
 if(-not $result.passed){throw 'READINESS_TEST_FAILED'}
 @{passed=$true;runId=$runId;job=$job;parent=$parent;parentExit=0;jobActiveAfterCleanup=$probe.Active;result=$result;output=$output}|ConvertTo-Json -Depth 7 -Compress
}finally{if($probe.Active -gt 0){$probe.Cancel()};$probe.Dispose()}
