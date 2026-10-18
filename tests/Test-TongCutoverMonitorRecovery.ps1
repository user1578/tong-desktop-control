# Regression tests extract exactly the functions in the reviewed cutover wrapper.
# All Windows/scheduler commands are replaced with synthetic stubs. No production writes.
param(
  [string]$Wrapper = 'D:\Tong\state\native-codex-acceptance-20261018\project-affinity-candidate\Invoke-TongCutover-cc9c04d-to-a1b56b3-v2.ps1'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$code=Get-Content -LiteralPath $Wrapper -Raw -Encoding UTF8
function Extract([string]$from,[string]$to) {
  $start=$code.IndexOf($from,[StringComparison]::Ordinal)
  if($start -lt 0){throw "Missing function: $from"}
  $end=$code.IndexOf($to,$start+$from.Length,[StringComparison]::Ordinal)
  if($end -le $start){throw "Missing boundary: $to"}
  return $code.Substring($start,$end-$start)
}
$stop=Extract 'function Stop-Login(' 'function Stop-ExactRun('
$stop=$stop.Replace('New-Object -ComObject Schedule.Service','$script:fakeScheduler')
$stop=$stop.Replace('Get-CimInstance Win32_Process','Mock-Cim')
$stop=$stop.Replace('Get-ScheduledTask -TaskName $taskName','Mock-Task')
$stop=$stop.Replace('Disable-ScheduledTask -TaskName $taskName','Mock-Disable')
$stop=$stop.Replace('Stop-Process -Id $runner.ProcessId -Force -ErrorAction Stop','throw "Unexpected process termination"')
$stop=$stop.Replace('Get-Process -Id $runner.ProcessId -ErrorAction SilentlyContinue','throw "Unexpected Get-Process"')
Invoke-Expression $stop

$script:root='D:\synthetic'
$script:taskName='SyntheticTongMonitor'
$script:mockInstances=@()
$script:mockTaskState='Ready'
$script:mockProcesses=@()
$script:taskDisabled=$false
$script:disabledCalls=0
$script:fakeDefinition=[pscustomobject]@{}
$script:fakeDefinition|Add-Member -MemberType ScriptMethod -Name GetInstances -Value {param($n) return $script:mockInstances}
$script:fakeFolder=[pscustomobject]@{}
$script:fakeFolder|Add-Member -MemberType ScriptMethod -Name GetTask -Value {param($name) return $script:fakeDefinition}
$script:fakeScheduler=[pscustomobject]@{}
$script:fakeScheduler|Add-Member -MemberType ScriptMethod -Name Connect -Value {}
$script:fakeScheduler|Add-Member -MemberType ScriptMethod -Name GetFolder -Value {param($folder) return $script:fakeFolder}
function Mock-Cim {param($class,[string]$Filter) return $script:mockProcesses}
function Mock-Task {return [pscustomobject]@{State=$script:mockTaskState}}
function Mock-Disable {$script:disabledCalls++}
function Reset-Case {
  $script:mockInstances=@()
  $script:mockTaskState='Ready'
  $script:mockProcesses=@()
  $script:taskDisabled=$false
  $script:disabledCalls=0
}
function Assert-Fails([scriptblock]$action,[string]$message){
  $caught=''
  try { & $action } catch {$caught=$_.Exception.Message}
  if(-not $caught.Contains($message)){throw "Expected [$message], got [$caught]"}
}
Reset-Case
Stop-Login $true
if(-not $script:taskDisabled -or $script:disabledCalls -ne 1){throw 'Absent monitor must disable once and never kill'}
Reset-Case
Assert-Fails { Stop-Login } 'Expected exactly one live'
if($script:disabledCalls -ne 0){throw 'Initial stop must not accept missing monitor'}
Reset-Case
$script:mockTaskState='Running'
Assert-Fails { Stop-Login $true } 'Scheduler still reports'
if($script:disabledCalls -ne 0){throw 'Running scheduler cannot be disabled'}
Reset-Case
$script:mockProcesses=@([pscustomobject]@{Name='powershell.exe';CommandLine='"C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "D:\Tong\runtime\login-management\TongLoginRuntime.ps1" -Mode run';ExecutablePath='C:\Windows\powershell.exe'})
Assert-Fails { Stop-Login $true } 'unclaimed live process'
if($script:disabledCalls -ne 0){throw 'Live runner cannot be bypassed'}
Reset-Case
$script:mockInstances=@([pscustomobject]@{EnginePID=1},[pscustomobject]@{EnginePID=2})
Assert-Fails { Stop-Login $true } 'Expected exactly one live'
if($script:disabledCalls -ne 0){throw 'Multiple instances must be rejected'}

$healthy=Extract 'function Await-Healthy(){' 'function Enable-Login(){'
$healthy=$healthy.Replace('CurrentStatus','Mock-Current')
$healthy=$healthy.Replace('Get-ScheduledTask -TaskName $taskName','Mock-Task')
$healthy=$healthy.Replace("Native 'production doctor'","Mock-Doctor")
$healthy=$healthy.Replace('Test-Path -LiteralPath $log','Mock-Exists')
$healthy=$healthy.Replace('Get-Content -LiteralPath $log -Tail 50','Mock-Log')
$healthy=$healthy.Replace('Start-Sleep -Seconds 3','Mock-Sleep')
Invoke-Expression $healthy
$script:monitorWindowStart=[DateTime]::UtcNow.AddSeconds(-30)
function Mock-Current {return [pscustomobject]@{phase='stopped';supervisorAlive=$false;guardianAlive=$false}}
function Mock-Exists {return $true}
function Mock-Log {return ('{"event":"manager_command_failed","managerAction":"start","reason":"CLEANUP_REQUIRED","at":"'+[DateTime]::UtcNow.ToString('o')+'"}')}
function Mock-Doctor {return [pscustomobject]@{healthy=$false}}
function Mock-Sleep {throw 'Unexpected wait instead of fast failure'}
Reset-Case
Assert-Fails { Await-Healthy } 'CLEANUP_REQUIRED'
$probeFunction=Extract 'function Verify-StoppedPreviousRuntime(){' 'function Stop-ExactRun('
$probeFunction=$probeFunction.Replace('$raw=& $node $cleanupProbe $originalRun','$raw=$script:mockProbeJson; $global:LASTEXITCODE=$script:mockProbeExit')
Invoke-Expression $probeFunction
$script:originalRun='01234567-89ab-4cde-9012-0123456789ab'
$script:cleanupProbe='D:\Tong\state\native-codex-acceptance-20261018\project-affinity-candidate\TongCutoverStoppedRunProbe.mjs'
$script:cleanupProbeSha256='8ee6bccd0e38d0a7ee331072b23fd694418536c4b3326534e293d1c0145f6c5e'
$script:mockProbeExit=2
$script:mockProbeJson='{"ok":false,"failures":["JOB_STILL_ACTIVE"],"readOnly":true}'
Assert-Fails { Verify-StoppedPreviousRuntime } 'JOB_STILL_ACTIVE'
$script:mockProbeExit=0
$script:mockProbeJson='{"ok":true,"expectedRunId":"01234567-89ab-4cde-9012-0123456789ab","readOnly":true,"liveRecordedPids":0,"jobActive":0,"blockedPortCount":0}'
Verify-StoppedPreviousRuntime

$stopIdx=$code.IndexOf('$null=Stop-ExactRun $true',[StringComparison]::Ordinal)
$probeIdx=$code.IndexOf('  Verify-StoppedPreviousRuntime',[StringComparison]::Ordinal)
$installIdx=$code.IndexOf("Native 'copy reviewed candidate sources'",[StringComparison]::Ordinal)
if($stopIdx -lt 0 -or $probeIdx -le $stopIdx -or $installIdx -le $probeIdx){
  throw 'Cleanup proof must guard the install transition'
}
Write-Output 'PASS: absent/active monitor handling, real startup code, and strict pre-install cleanup guard.'
