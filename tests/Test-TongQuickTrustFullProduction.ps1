$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$wrapper=Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($wrapper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
function Load-Function([string]$Name){
  $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name},$true))
  if($found.Count -ne 1){throw ('Missing function '+$Name)}
  $text=$found[0].Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:fakeScheduler')
  $text=$text.Replace('Get-CimInstance Win32_Process','Mock-Cim').Replace('Get-ScheduledTask -TaskName $taskName','Mock-Task')
  $text=$text.Replace('Disable-ScheduledTask -TaskName $taskName','Mock-Disable')
  $text=$text.Replace('Stop-Process -Id $runner.ProcessId -Force -ErrorAction Stop','throw "Unexpected termination"')
  $text=$text.Replace("& (Join-Path `$root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery",'Mock-Sign')
  return $text
}
Invoke-Expression (Load-Function 'Stop-Login')
$script:root='D:\Tong\runtime';$script:taskName='SyntheticTongMonitor'
$script:ExpectedOldCommit=''
$script:fakeDefinition=[pscustomobject]@{}
$script:fakeDefinition|Add-Member ScriptMethod GetInstances {param($n) return $script:instances}
$script:fakeFolder=[pscustomobject]@{}
$script:fakeFolder|Add-Member ScriptMethod GetTask {param($name) return $script:fakeDefinition}
$script:fakeScheduler=[pscustomobject]@{}
$script:fakeScheduler|Add-Member ScriptMethod Connect {}
$script:fakeScheduler|Add-Member ScriptMethod GetFolder {param($name) return $script:fakeFolder}
function Mock-Cim {param($class,$Filter) return $script:processes}
function Mock-Task {return [pscustomobject]@{State=$script:taskState}}
function Mock-Disable {
  $script:disabledCalls++
  if($script:appearDuringDisable){$script:processes=@([pscustomobject]@{Name='TongLoginHost.exe';ExecutablePath='D:\Tong\runtime\login-management\TongLoginHost.exe';CommandLine='host'})}
  if($script:instanceDuringDisable){$script:instances=@([pscustomobject]@{EnginePID=1})}
}
function Reset-Case {
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
$text=[IO.File]::ReadAllText($wrapper)
if(-not $text.Contains('if(-not $taskDisabled){Stop-Login $true $recoverySigned}')){throw 'Rollback must select the verified recovery mechanism and allow an exited monitor'}
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
Write-Output 'PASS: absent monitor rollback including abnormal_exit, orphan/race refusals, and current-window startup failure diagnostics.'
