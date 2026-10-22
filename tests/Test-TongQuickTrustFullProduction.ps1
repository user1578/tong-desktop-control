$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$wrapper=Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($wrapper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
# Refuse any accidentally unmocked production boundary if the source changes.
function Get-CimInstance {throw 'Real CIM access forbidden in this synthetic test'}
function Get-ScheduledTask {throw 'Real task access forbidden in this synthetic test'}
function Disable-ScheduledTask {throw 'Real task mutation forbidden in this synthetic test'}
function Stop-Process {throw 'Real process termination forbidden in this synthetic test'}
function Load-Function([string]$Name){
  $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name},$true))
  if($found.Count -ne 1){throw ('Missing function '+$Name)}
  $text=$found[0].Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:fakeScheduler')
  $text=$text.Replace('Get-CimInstance Win32_Process','Mock-Cim').Replace('Get-ScheduledTask -TaskName $taskName','Mock-Task')
  $text=$text.Replace('Disable-ScheduledTask -TaskName $taskName','Mock-Disable')
  $text=$text.Replace('Stop-Process -Id $runner.ProcessId -Force -ErrorAction Stop','Mock-StopRunner')
  $text=$text.Replace('Stop-ExactLoginRunner $runner','Mock-StopRunner')
  $text=$text.Replace("& (Join-Path `$root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery",'Mock-Sign')
  return $text
}
Invoke-Expression (Load-Function 'Stop-Login')
$script:root='D:\Tong\runtime';$script:taskName='SyntheticTongMonitor'
$script:node='D:\node\node.exe';$script:manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$script:fakeDefinition=[pscustomobject]@{}
$script:fakeDefinition|Add-Member ScriptMethod GetInstances {param($n) return $script:instances}
$script:fakeFolder=[pscustomobject]@{}
$script:fakeFolder|Add-Member ScriptMethod GetTask {param($name) return $script:fakeDefinition}
$script:fakeScheduler=[pscustomobject]@{}
$script:fakeScheduler|Add-Member ScriptMethod Connect {}
$script:fakeScheduler|Add-Member ScriptMethod GetFolder {param($name) return $script:fakeFolder}
function Mock-Cim {
  param($class,$Filter)
  if($script:activeCase){
    Update-MonitorWorld
    if($Filter -match '^ProcessId=(\d+)$'){return $script:processes|Where-Object ProcessId -eq ([int]$Matches[1])}
    if($Filter -match '^ParentProcessId=(\d+)$'){return $script:processes|Where-Object ParentProcessId -eq ([int]$Matches[1])}
    if($Filter){throw ('Unexpected process filter: '+$Filter)}
  }
  return $script:processes
}
function Mock-Task {return [pscustomobject]@{State=$script:taskState}}
function Mock-Disable {
  $script:disabledCalls++
  if($script:appearDuringDisable){$script:processes=@([pscustomobject]@{Name='TongLoginHost.exe';ExecutablePath='D:\Tong\runtime\login-management\TongLoginHost.exe';CommandLine='host'})}
  if($script:instanceDuringDisable){$script:instances=@([pscustomobject]@{EnginePID=1})}
}
function Reset-Case {
  $script:activeCase=$false
  $script:instances=@();$script:processes=@();$script:taskState='Ready'
  $script:disabledCalls=0;$script:taskDisabled=$false
  $script:appearDuringDisable=$false;$script:instanceDuringDisable=$false
}
function Assert-Fails([scriptblock]$Action,[string]$Message){
  $caught='';try{& $Action}catch{$caught=$_.Exception.Message}
  if(-not $caught.Contains($Message)){throw ('Expected ['+$Message+'], got ['+$caught+']')}
}
Reset-Case
Stop-Login $true
if(-not $script:taskDisabled -or $script:disabledCalls -ne 1){throw 'Rollback must safely disable an absent monitor'}
Reset-Case
Assert-Fails {Stop-Login} 'Expected exactly one live'
if($script:disabledCalls){throw 'Initial stop must reject absence before mutation'}
Reset-Case;$script:taskState='Running'
Assert-Fails {Stop-Login $true} 'Scheduler still reports'
Reset-Case;$script:processes=@([pscustomobject]@{Name='TongLoginHost.exe';ExecutablePath='D:\Tong\runtime\login-management\TongLoginHost.exe';CommandLine='host'})
Assert-Fails {Stop-Login $true} 'unclaimed live process'
Reset-Case;$script:processes=@([pscustomobject]@{Name='powershell.exe';ExecutablePath='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';CommandLine='"C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "D:\Tong\runtime\login-management\TongLoginRuntime.ps1" -Mode run'})
Assert-Fails {Stop-Login $true} 'unclaimed live process'
Reset-Case;$script:appearDuringDisable=$true
Assert-Fails {Stop-Login $true} 'unclaimed live process'
Reset-Case;$script:instanceDuringDisable=$true
Assert-Fails {Stop-Login $true} 'Monitor appeared'
Reset-Case;$script:instances=@([pscustomobject]@{EnginePID=1},[pscustomobject]@{EnginePID=2})
Assert-Fails {Stop-Login $true} 'Expected exactly one live'
Reset-Case;$script:processes=@([pscustomobject]@{Name='unrelated.exe';ExecutablePath='D:\unrelated.exe';CommandLine='unrelated'})
Stop-Login $true
if($script:disabledCalls -ne 1){throw 'Unrelated processes must be preserved'}
Reset-Case;$script:processes=@([pscustomobject]@{Name='node.exe';ExecutablePath=$node;CommandLine=('"'+$node+'" "'+$manager+'" start --root "'+$root+'" --login-recovery --error-json')})
Assert-Fails {Stop-Login $true} 'unclaimed live process'
if($script:disabledCalls){throw 'An orphaned Manager must block rollback before mutation'}
Reset-Case;$script:processes=@([pscustomobject]@{Name='node.exe';ExecutablePath=$node;CommandLine=('"'+$node+'" "'+$manager+'" "doctor" "--root" "'+$root+'" "--login-recovery" "--error-json"')})
Assert-Fails {Stop-Login $true} 'unclaimed live process'
if($script:disabledCalls){throw 'Quoted Manager argv must not bypass orphan detection'}
Reset-Case;$script:processes=@([pscustomobject]@{Name='node.exe';ExecutablePath=$node;CommandLine=('"'+$node+'" "'+$manager+'" supervise --root "'+$root+'" --run-id synthetic-run')})
Stop-Login $true
if($script:processes.Count -ne 1){throw 'The independent Supervisor must remain untouched'}

Invoke-Expression (Load-Function 'Get-LoginFailure')
$script:monitorWindowStart=[DateTime]::UtcNow.AddSeconds(-10)
$script:logLines=@()
function Test-Path {param($LiteralPath) return $true}
function Get-Content {param($LiteralPath,$Tail) return $script:logLines}
$at=[DateTime]::UtcNow.ToString('o')
$old=[DateTime]::UtcNow.AddHours(-1).ToString('o')
$script:logLines=@('{"event":"runner_failed","at":"'+$old+'","runnerPid":1,"reason":"old failure"}')
if(Get-LoginFailure){throw 'Historical failure must not poison a new monitor'}
$script:logLines=@(
  ('{"event":"manager_command_failed","at":"'+$at+'","runnerPid":2,"managerAction":"start","reason":"CLEANUP_REQUIRED"}'),
  ('{"event":"runner_failed","at":"'+$at+'","runnerPid":2,"reason":"failure"}')
)
if((Get-LoginFailure) -cne 'start: CLEANUP_REQUIRED'){throw 'Acceptance must retain the actual manager failure'}
Invoke-Expression (Load-Function 'Verify-StoppedPreviousRuntime')
Invoke-Expression (Load-Function 'Await-Stopped')
$script:mockStatus=[pscustomobject]@{phase='abnormal_exit';runId='01234567-89ab-4cde-9012-0123456789abc';supervisorAlive=$false;guardianAlive=$false}
$script:mockProof=[pscustomobject]@{ok=$true;readOnly=$true;expectedRunId=$script:mockStatus.runId;matchingOwnedPids=0;jobActive=0;blockedPortCount=0}
$script:restored=$false
$script:cleanupProbe='synthetic-probe'
function CurrentStatus {return $script:mockStatus}
function Native {param($Name,$Arguments) if($Name -eq 'verify stopped runtime'){return $script:mockProof}; if($Name -eq 'restore exact old sources'){$script:restored=$true;return [pscustomobject]@{ok=$true}};throw ('Unexpected native call: '+$Name)}
function Start-Sleep {throw 'Unexpected wait for a completed failed startup'}
$null=Await-Stopped
$script:mockProof.jobActive=1
Assert-Fails {Await-Stopped} 'cleanup proof'
$script:mockProof.jobActive=0
Invoke-Expression (Load-Function 'Restore-Old')
function Mock-Sign {$global:LASTEXITCODE=0}
function Enable-Login {}
function Await-Healthy {return [pscustomobject]@{runId='synthetic-recovered'}}
Reset-Case
$script:snapshot='D:\synthetic-snapshot';$script:node='synthetic-node';$script:helper='synthetic-helper';$script:cleanupProbe='synthetic-probe';$script:recoverySigned=$true
Restore-Old
if(-not $script:restored){throw 'A completed abnormal_exit with absent monitor must reach source rollback'}

# Active monitor cases also use fake time, CIM, scheduler, mutex and termination.
# Neither the real mutex factory nor any Windows process/task API is executed.
function Update-MonitorWorld {
  if($script:killed -and -not $script:consoleStuck -and $script:nowMs -ge $script:consoleExitAt){
    $script:processes=@($script:processes|Where-Object ProcessId -ne 404)
  }
  if($script:killed -and -not $script:hostStuck -and $script:nowMs -ge $script:hostExitAt){
    $script:processes=@($script:processes|Where-Object ProcessId -ne 101)
    if(-not $script:schedulerStuck){$script:instances=@();if(-not $script:taskStateStuck){$script:taskState='Ready'}}
  }
}
function New-LoginLifecycleMutex {return $script:fakeMutex}
function Mock-StopRunner {
  if(-not $script:activeCase -or -not $script:mutexHeld){throw 'Termination without lifecycle ownership'}
  $script:operations+= 'kill-runner'
  if($script:terminationRefused){throw 'Synthetic termination refused'}
  if(-not $script:runnerStuck){$script:processes=@($script:processes|Where-Object ProcessId -ne 202)}
  $script:killed=$true;$script:hostExitAt=$script:nowMs+$script:hostDrainMs
  $script:consoleExitAt=$script:nowMs+$script:consoleDrainMs
  if($script:childAfterKill){$script:processes+= [pscustomobject]@{ProcessId=505;ParentProcessId=404;SessionId=7;Name='worker.exe';ExecutablePath='D:\synthetic\worker.exe';CreationDate=[datetime]'2026-10-22T00:00:05Z';CommandLine='synthetic'}}
}
function Get-Date {return ([datetime]'2026-10-22T00:00:00Z').AddMilliseconds($script:nowMs)}
function Start-Sleep {param($Seconds) $script:nowMs+=1000*$Seconds}
function Reset-Active {
  Reset-Case
  $script:activeCase=$true;$script:node='D:\node\node.exe'
  $script:manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
  $script:nowMs=0;$script:operations=@();$script:mutexHeld=$false
  $script:lockAvailable=$true;$script:pendingMs=0;$script:leaveChild=$false
  $script:hostStuck=$false;$script:runnerStuck=$false;$script:schedulerStuck=$false
  $script:hostDrainMs=0;$script:hostExitAt=0;$script:killed=$false
  $script:consoleDrainMs=0;$script:consoleExitAt=0;$script:consoleStuck=$false
  $script:reuseConsole=$false;$script:reuseChild=$false;$script:changeTask=$false
  $script:taskStateStuck=$false;$script:childAfterKill=$false
  $script:reuseHost=$false;$script:reuseRunner=$false;$script:exitDuringWait=$false
  $script:terminationRefused=$false;$script:released=0;$script:disposed=0
  $script:taskState='Running'
  $script:processes=@(
    [pscustomobject]@{ProcessId=101;ParentProcessId=1;Name='TongLoginHost.exe';ExecutablePath=Join-Path $root 'login-management\TongLoginHost.exe';CreationDate=[datetime]'2026-10-22T00:00:00Z';CommandLine='host'},
    [pscustomobject]@{ProcessId=202;ParentProcessId=101;Name='powershell.exe';ExecutablePath='C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe';CreationDate=[datetime]'2026-10-22T00:00:01Z';CommandLine='"C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "D:\Tong\runtime\login-management\TongLoginRuntime.ps1" -Mode run'},
    [pscustomobject]@{ProcessId=303;ParentProcessId=202;Name='node.exe';ExecutablePath=$node;CreationDate=[datetime]'2026-10-22T00:00:02Z';CommandLine=('"'+$node+'" "'+$manager+'" start --root "'+$root+'" --login-recovery')},
    [pscustomobject]@{ProcessId=404;ParentProcessId=202;Name='conhost.exe';ExecutablePath=Join-Path ([Environment]::SystemDirectory) 'conhost.exe';CreationDate=[datetime]'2026-10-22T00:00:01.010Z';CommandLine=('\??\'+(Join-Path ([Environment]::SystemDirectory) 'conhost.exe')+' 0x4')}
  )
  foreach($process in $script:processes){$process|Add-Member NoteProperty SessionId 7}
  $script:instances=@([pscustomobject]@{EnginePID=101})
  $script:fakeMutex=[pscustomobject]@{}
  $script:fakeMutex|Add-Member ScriptMethod WaitOne {
    param($milliseconds)
    if($milliseconds -lt 150000 -or $milliseconds -gt 180000){throw 'Lifecycle wait must be bounded and cover Manager startup/abort cleanup'}
    if(-not $script:taskDisabled){throw 'Future task triggers must be disabled before waiting'}
    $script:operations+= 'wait-command'
    $script:nowMs+=$script:pendingMs
    if(-not $script:lockAvailable){return $false}
    if(-not $script:leaveChild){$script:processes=@($script:processes|Where-Object ProcessId -ne 303)}
    if($script:reuseHost){$script:processes=@($script:processes|ForEach-Object {if($_.ProcessId -eq 101){$copy=$_.PSObject.Copy();$copy.CreationDate=$copy.CreationDate.AddMinutes(1);$copy}else{$_}})}
    if($script:reuseRunner){$script:processes=@($script:processes|ForEach-Object {if($_.ProcessId -eq 202){$copy=$_.PSObject.Copy();$copy.CreationDate=$copy.CreationDate.AddMinutes(1);$copy}else{$_}})}
    if($script:reuseConsole){($script:processes|Where-Object ProcessId -eq 404).CreationDate=[datetime]'2026-10-22T00:01:01Z'}
    if($script:reuseChild){$child=[pscustomobject]@{ProcessId=303;ParentProcessId=202;SessionId=7;Name='node.exe';ExecutablePath=$script:node;CreationDate=[datetime]'2026-10-22T00:01:02Z';CommandLine='replacement'};$script:processes=@($script:processes|Where-Object ProcessId -ne 303)+@($child)}
    if($script:changeTask){$script:instances=@([pscustomobject]@{EnginePID=909})}
    if($script:exitDuringWait){$script:processes=@();$script:instances=@();$script:taskState='Ready'}
    $script:mutexHeld=$true
    return $true
  }
  $script:fakeMutex|Add-Member ScriptMethod ReleaseMutex {$script:mutexHeld=$false;$script:released++}
  $script:fakeMutex|Add-Member ScriptMethod Dispose {$script:disposed++}
}
Reset-Active;$script:pendingMs=51000;$script:hostDrainMs=2000
Stop-Login
if(($script:operations -join ',') -cne 'wait-command,kill-runner' -or $script:nowMs -ne 53000 -or $script:processes.Count -or $script:released -ne 1 -or $script:disposed -ne 1){throw 'Wait for a slow in-flight start before stopping the runner and draining its Host'}
Reset-Active;$script:consoleDrainMs=3000
Stop-Login
if($script:nowMs -ne 3000 -or $script:processes.Count){throw 'A valid persistent conhost must be allowed before runner stop, then proven gone'}
Reset-Active;$script:consoleStuck=$true
Assert-Fails {Stop-Login} 'Login monitor did not fully exit'
if($script:nowMs -ne 30000){throw 'A lingering conhost must block at the existing exit deadline'}
foreach($fault in @('ExecutablePath','SessionId','CommandLine','CreationDate')){
  Reset-Active
  $console=$script:processes|Where-Object ProcessId -eq 404
  switch($fault){
    'ExecutablePath' {$console.ExecutablePath='D:\synthetic\conhost.exe'}
    'SessionId' {$console.SessionId=8}
    'CommandLine' {$console.CommandLine='conhost.exe unexpected'}
    'CreationDate' {$console.CreationDate=[datetime]'2026-10-21T00:00:00Z'}
  }
  Assert-Fails {Stop-Login} 'live child processes'
  if($script:operations -contains 'kill-runner'){throw ('Unverified console must block termination: '+$fault)}
}
Reset-Active;$script:reuseConsole=$true
Assert-Fails {Stop-Login} 'descendant identity changed'
Reset-Active;$script:reuseChild=$true
Assert-Fails {Stop-Login} 'descendant identity changed'
Reset-Active;$script:changeTask=$true
Assert-Fails {Stop-Login} 'Login task instance changed'
if($script:operations -contains 'kill-runner'){throw 'A replacement task must not be stopped'}
Reset-Active;$script:taskState='Ready'
Assert-Fails {Stop-Login} 'Login task state mismatch'
if($script:disabledCalls){throw 'An inconsistent task must be rejected before mutation'}
Reset-Active
($script:processes|Where-Object ProcessId -eq 101).ExecutablePath='D:\synthetic\TongLoginHost.exe'
Assert-Fails {Stop-Login} 'Login host identity mismatch'
Reset-Active
($script:processes|Where-Object ProcessId -eq 202).ExecutablePath='D:\synthetic\powershell.exe'
Assert-Fails {Stop-Login} 'Unable to identify'
Reset-Active
($script:processes|Where-Object ProcessId -eq 202).SessionId=8
Assert-Fails {Stop-Login} 'Monitor runner identity mismatch'
Reset-Active
$script:processes+= [pscustomobject]@{ProcessId=505;ParentProcessId=303;SessionId=7;Name='worker.exe';ExecutablePath='D:\synthetic\worker.exe';CreationDate=[datetime]'2026-10-22T00:00:03Z';CommandLine='synthetic'}
Assert-Fails {Stop-Login} 'live child processes'
if($script:operations -contains 'kill-runner'){throw 'An observed orphaned descendant must block termination even when its parent exited'}
Reset-Active
$script:processes+= [pscustomobject]@{ProcessId=505;ParentProcessId=404;SessionId=7;Name='worker.exe';ExecutablePath='D:\synthetic\worker.exe';CreationDate=[datetime]'2026-10-22T00:00:03Z';CommandLine='synthetic'}
Assert-Fails {Stop-Login} 'live child processes'
Reset-Active;$script:childAfterKill=$true;$script:consoleStuck=$true
Assert-Fails {Stop-Login} 'live child processes'
Reset-Active;$script:taskStateStuck=$true
Assert-Fails {Stop-Login} 'Login monitor did not fully exit'
Reset-Active
$script:processes+= [pscustomobject]@{ProcessId=606;ParentProcessId=999;SessionId=7;Name='node.exe';ExecutablePath=$script:node;CreationDate=[datetime]'2026-10-22T00:00:03Z';CommandLine=('"'+$script:node+'" "'+$script:manager+'" "doctor" "--root" "'+$root+'" "--login-recovery"')}
Assert-Fails {Stop-Login} 'live Manager client'
if($script:operations -contains 'kill-runner'){throw 'An unclaimed Manager must block before runner termination'}
Reset-Active;$script:lockAvailable=$false
Assert-Fails {Stop-Login} 'Login lifecycle command did not finish'
if($script:operations -contains 'kill-runner' -or $script:released -or $script:disposed -ne 1){throw 'A busy lifecycle must remain untouched and the mutex handle must be disposed'}
Reset-Active;$script:leaveChild=$true
Assert-Fails {Stop-Login} 'still has live child processes'
if($script:operations -contains 'kill-runner' -or $script:released -ne 1){throw 'An abandoned/unresolved command must not be orphaned'}
Reset-Active;$script:leaveChild=$true
# ScriptMethod exceptions have different wrapping from .NET WaitOne. Exercise
# abandonment with a real, unique test mutex; no production mutex is opened.
$mutexName='Local\TongCutoverSynthetic-'+[guid]::NewGuid().ToString('N')
$abandonedMutex=[Threading.Mutex]::new($false,$mutexName)
$holder=[PowerShell]::Create();$probe=[PowerShell]::Create()
try{
  $null=$holder.AddScript('param($name) $m=[Threading.Mutex]::new($false,$name);$null=$m.WaitOne()').AddArgument($mutexName)
  $null=$holder.Invoke()
  if($holder.HadErrors){throw $holder.Streams.Error[0]}
  $holder.Dispose() # The owning synthetic thread exits without releasing.
  $script:fakeMutex=$abandonedMutex
  Assert-Fails {Stop-Login} 'still has live child processes'
  if($script:operations -contains 'kill-runner'){throw 'Abandonment must not bypass child identity checks'}
  $null=$probe.AddScript('param($name) $m=[Threading.Mutex]::new($false,$name);try{$owned=$m.WaitOne(0);if($owned){$m.ReleaseMutex()};return $owned}finally{$m.Dispose()}').AddArgument($mutexName)
  $released=$probe.Invoke()
  if($probe.HadErrors -or $released.Count -ne 1 -or -not $released[0]){throw 'Maintenance must release ownership even after an abandoned-mutex refusal'}
}finally{$holder.Dispose();$probe.Dispose();$abandonedMutex.Dispose()}
Reset-Active;$script:reuseHost=$true
Assert-Fails {Stop-Login} 'Login host identity changed'
if($script:operations -contains 'kill-runner'){throw 'Host PID reuse must refuse termination'}
Reset-Active;$script:reuseRunner=$true
Assert-Fails {Stop-Login} 'Monitor runner identity changed'
if($script:operations -contains 'kill-runner'){throw 'Runner PID reuse must refuse termination'}
Reset-Active;$script:exitDuringWait=$true
Stop-Login
if($script:operations -contains 'kill-runner' -or $script:released -ne 1){throw 'A monitor exiting naturally while waiting must be accepted without termination'}
Reset-Active;$script:hostStuck=$true
Assert-Fails {Stop-Login} 'Login monitor did not fully exit'
if($script:nowMs -ne 30000 -or -not $script:taskDisabled -or $script:released -ne 1){throw 'A live Host must retain the disabled task and block at the exit deadline'}
Reset-Active;$script:runnerStuck=$true
Assert-Fails {Stop-Login} 'Login monitor did not fully exit'
Reset-Active;$script:schedulerStuck=$true
Assert-Fails {Stop-Login} 'Login monitor did not fully exit'
Reset-Active;$script:terminationRefused=$true
Assert-Fails {Stop-Login} 'Synthetic termination refused'
if($script:released -ne 1 -or $script:disposed -ne 1){throw 'Termination failure must release the maintenance mutex'}

# Restore must always prove monitor exit, including after a previous failed stop
# has already set taskDisabled. No runtime stop or source restoration may precede it.
function CurrentStatus {$script:statusCalls++;return $script:mockStatus}
function Stop-ExactRun {
  param($TryRecovery)
  $script:stopRunCalls++
  $script:mockStatus=[pscustomobject]@{phase='stopped';runId=$script:mockProof.expectedRunId;supervisorAlive=$false;guardianAlive=$false}
  return $script:mockStatus
}
Reset-Active;$script:hostStuck=$true;$script:taskDisabled=$true
$script:statusCalls=0;$script:stopRunCalls=0;$script:restored=$false
Assert-Fails {Restore-Old} 'Login monitor did not fully exit'
if($script:statusCalls -or $script:stopRunCalls -or $script:restored){throw 'A disabled but live monitor must block all runtime stop and restore operations'}
Reset-Active;$script:lockAvailable=$false;$script:taskDisabled=$true
Assert-Fails {Restore-Old} 'Login lifecycle command did not finish'
if($script:statusCalls -or $script:stopRunCalls -or $script:restored){throw 'An in-flight Manager must block rollback'}
Reset-Active;$script:leaveChild=$true;$script:taskDisabled=$true
Assert-Fails {Restore-Old} 'live child processes'
if($script:statusCalls -or $script:stopRunCalls -or $script:restored){throw 'A live Manager despite lifecycle ownership must block rollback'}
Reset-Active;$script:exitDuringWait=$true;$script:taskDisabled=$true
$script:mockProof.jobActive=1
Assert-Fails {Restore-Old} 'cleanup proof'
if($script:stopRunCalls -or $script:restored){throw 'Monitor exit must not bypass the Guardian cleanup proof'}
$script:mockProof.jobActive=0
Reset-Active;$script:taskDisabled=$true;$script:pendingMs=51000
$script:mockStatus=[pscustomobject]@{phase='ready';runId=$script:mockProof.expectedRunId;supervisorAlive=$true;guardianAlive=$true}
Restore-Old
if($script:stopRunCalls -ne 1 -or -not $script:restored){throw 'Rollback must converge once the command and monitor exit are proven'}
# Exercise the actual termination helper with a fake native handle. No real
# process handle is opened, and PID reuse in the final query-to-kill gap refuses.
Invoke-Expression (Load-Function 'Stop-ExactLoginRunner')
function Open-LoginProcessHandle {param($ProcessId) return $script:processHandle}
$identity=[pscustomobject]@{ProcessId=202;CreationDate=[datetime]'2026-10-22T00:00:01Z';ExecutablePath='C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe'}
$script:handleKills=0;$script:handleDisposals=0
$script:processHandle=[pscustomobject]@{Handle=[intptr]1;StartTime=$identity.CreationDate;MainModule=[pscustomobject]@{FileName=$identity.ExecutablePath}}
$script:processHandle|Add-Member ScriptMethod WaitForExit {param($ms) return $false}
$script:processHandle|Add-Member ScriptMethod Kill {$script:handleKills++}
$script:processHandle|Add-Member ScriptMethod Dispose {$script:handleDisposals++}
Stop-ExactLoginRunner $identity
if($script:handleKills -ne 1 -or $script:handleDisposals -ne 1){throw 'Original native handle must be used and released'}
$script:processHandle.StartTime=$identity.CreationDate.AddMinutes(1)
Assert-Fails {Stop-ExactLoginRunner $identity} 'Monitor runner identity changed'
if($script:handleKills -ne 1 -or $script:handleDisposals -ne 2){throw 'A replacement native handle must never be killed'}
Write-Output 'PASS: exact conhost lifecycle, Manager/descendant exit, task/Host/runner/PID refusals, in-flight/abandoned mutex, bounded cleanup and rollback safety.'
