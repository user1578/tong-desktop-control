# Control-flow regression. Native ownership/approval is tested separately by
# the full synthetic Task; this fixture stops before any runtime Job creation.
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=Join-Path 'D:\Tong\state' ('b23-guardian-flow-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path (Join-Path $fixture 'run'),(Join-Path $fixture 'logs')
$source=[IO.File]::ReadAllText((Join-Path $project 'scripts\TongRuntimeGuardian.ps1')).Replace('D:\Tong\runtime',$fixture)
[IO.File]::WriteAllText((Join-Path $fixture 'Guardian.ps1'),$source)
[IO.File]::WriteAllText((Join-Path $fixture 'TongStartupProtocol.ps1'),@'
function Initialize-TongStartup { }
function Assert-TongStartupActive { if($script:stage -eq 'create-job'){throw 'TEST_STOP_BEFORE_JOB'} }
function Set-TongStartupStage { }
function Invoke-TongStartupPreflight([string]$Arguments) {
 [IO.File]::AppendAllText((Join-Path $Root 'calls.txt'),($Arguments+"`n"))
 if([IO.File]::ReadAllText((Join-Path $Root 'case.txt')) -eq 'denied'){throw 'APPROVAL_DENIED'}
}
'@)
$runId=[guid]::NewGuid().ToString();$grant=[guid]::NewGuid().ToString()
foreach($case in @('recovery','mismatched-grant','missing-grant','denied','ordinary')){
 [IO.File]::WriteAllText((Join-Path $fixture 'calls.txt'),'')
 $request=@{runId=$runId;startupDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+180000}
 if($case -ne 'ordinary'){$request.recoveryGrantId=$(if($case -eq 'mismatched-grant'){[guid]::NewGuid().ToString()}else{$grant})}
 [IO.File]::WriteAllText((Join-Path $fixture 'run\request.json'),($request|ConvertTo-Json))
 [IO.File]::WriteAllText((Join-Path $fixture 'case.txt'),$case)
 $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $fixture 'Guardian.ps1'),'-Root',$fixture,'-RunId',$runId,'-NodeExe','D:\node\node.exe','-Supervisor',(Join-Path $fixture 'releases\manager\scripts\TongAgentDockRuntime.mjs'))
 if($case -notin @('ordinary','missing-grant')){$arguments+=@('-RecoveryGrantId',$grant)}
 $null=& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' @arguments 2>&1
 if($LASTEXITCODE -ne 2){throw 'FIXTURE_DID_NOT_STOP'}
 $calls=@([IO.File]::ReadAllLines((Join-Path $fixture 'calls.txt')))
 $expected=if($case -in @('mismatched-grant','missing-grant')){0}else{1}
 if($calls.Count -ne $expected){throw ($case+': expected '+$expected+' authorization invocation, got '+$calls.Count)}
}
@{passed=$true;root=$fixture;singleRecoveryPreflight=$true;deniedBeforeJob=$true;mismatchedGrantRejectedBeforePreflight=$true}|ConvertTo-Json -Compress
