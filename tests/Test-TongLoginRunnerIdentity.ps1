$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$wrapper=Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($wrapper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and ($n.Name -match '^(Get|Assert|Test)-Login' -or $n.Name -in @('Stop-Login','Restore-LoginAfterRejectedStop'))},$true)){
  . ([scriptblock]::Create($fn.Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:scheduler')))
}
$script:root='D:\synthetic-tong-runner';$script:taskName='SyntheticTongMonitor';$script:manager='synthetic-manager'
$script:definition=[pscustomobject]@{}
$script:definition|Add-Member ScriptMethod GetInstances {param($flags) return $script:instances}
$script:folder=[pscustomobject]@{}
$script:folder|Add-Member ScriptMethod GetTask {param($name) if($name -cne $script:taskName){throw 'Wrong task'};return $script:definition}
$script:scheduler=[pscustomobject]@{}
$script:scheduler|Add-Member ScriptMethod Connect {}
$script:scheduler|Add-Member ScriptMethod GetFolder {param($name) return $script:folder}
function Get-CimInstance {param($ClassName,$Filter)
  if($ClassName -cne 'Win32_Process'){throw 'Wrong CIM class'}
  if(-not $Filter){return $script:processes}
  if($Filter -match '^ProcessId=(\d+)$'){return @($script:processes|Where-Object ProcessId -eq ([int]$Matches[1]))}
  if($Filter -match '^ParentProcessId=(\d+)$'){return @($script:processes|Where-Object ParentProcessId -eq ([int]$Matches[1]))}
  throw ('Unexpected filter '+$Filter)
}
function Get-ScheduledTask {param($TaskName) return $script:task}
function Disable-ScheduledTask {param($TaskName) $script:disabled++; & $script:change}
function Enable-ScheduledTask {param($TaskName) $script:enables++}
function Start-ScheduledTask {param($TaskName) $script:starts++}
function Get-Process {param($Id,$ErrorAction) return @($script:processes|Where-Object ProcessId -eq $Id)}
function CurrentStatus {return [pscustomobject]@{runId='synthetic-run';supervisorAlive=$true;guardianAlive=$true;phase='ready'}}
function Native {param($Name,$Arguments)
  if($Name -cne 'graceful exact-run stop' -or ($Arguments -join '|') -cne 'synthetic-manager|stop-run|--root|D:\synthetic-tong-runner|--run-id|synthetic-run|--error-json|--login-recovery'){throw 'Wrong stop target'}
  $script:stops++;$script:instances=@();$script:processes=@()
}
function Start-Sleep {throw 'Unexpected wait'}
function Stop-Process {throw 'No force termination allowed'}
function Reset-Case {
  $script:disabled=0;$script:stops=0;$script:enables=0;$script:starts=0;$script:taskDisabled=$false;$script:change={}
  $script:originalRun='synthetic-run'
  $script:instances=@([pscustomobject]@{EnginePID=100;InstanceGuid='{11111111-1111-4111-8111-111111111111}';State=4})
  $script:task=[pscustomobject]@{State='Running';Actions=@([pscustomobject]@{Execute='D:\synthetic-tong-runner\login-management\TongLoginHost.exe';Arguments='';WorkingDirectory='D:\synthetic-tong-runner'});Principal=[pscustomobject]@{UserId='Rune'}}
  $script:hostRecord=[pscustomobject]@{Name='TongLoginHost.exe';ProcessId=100;ParentProcessId=99;ExecutablePath='D:\synthetic-tong-runner\login-management\TongLoginHost.exe';CommandLine='"D:\synthetic-tong-runner\login-management\TongLoginHost.exe"';CreationDate=[datetime]'2026-10-28T00:00:00Z'}
  $script:runnerRecord=[pscustomobject]@{Name='pwsh.exe';ProcessId=101;ParentProcessId=100;ExecutablePath='C:\Program Files\PowerShell\7\pwsh.exe';CommandLine='"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -NonInteractive -File "D:\synthetic-tong-runner\login-management\TongLoginRuntime.ps1" -Mode run';CreationDate=[datetime]'2026-10-28T00:00:01Z'}
  $script:processes=@($script:hostRecord,$script:runnerRecord)
}
Reset-Case
Stop-Login
if($script:disabled -ne 1 -or $script:stops -ne 1){throw 'PS7 must reach one graceful exact-run stop'}
Reset-Case;$script:hostRecord.CommandLine+=' '
Stop-Login
if($script:stops -ne 1){throw 'Native launch trailing whitespace is not an argument'}
$cases=@{
  'fake executable'={ $script:runnerRecord.ExecutablePath='D:\fake\pwsh.exe' }
  'changed arguments'={ $script:runnerRecord.CommandLine+=' -Command evil' }
  'missing creation time'={ $script:runnerRecord.CreationDate=$null }
  'runner predates host'={ $script:runnerRecord.CreationDate=$script:hostRecord.CreationDate.AddSeconds(-1) }
  'multiple runners'={ $script:processes+=($script:runnerRecord.PSObject.Copy()) }
  'wrong parent'={ $script:runnerRecord.ParentProcessId=999 }
  'wrong host path'={ $script:hostRecord.ExecutablePath='D:\fake\TongLoginHost.exe' }
  'host extra arguments'={ $script:hostRecord.CommandLine+=' unexpected' }
  'wrong task action'={ $script:task.Actions[0].Arguments='evil' }
  'multiple instances'={ $script:instances+=($script:instances[0].PSObject.Copy()) }
  'runner PID reused'={ $script:change={ $script:runnerRecord.CreationDate=$script:runnerRecord.CreationDate.AddSeconds(5) } }
  'host PID reused'={ $script:change={ $script:hostRecord.CreationDate=$script:hostRecord.CreationDate.AddTicks(1) } }
  'runner disappears'={ $script:change={ $script:processes=@($script:hostRecord) } }
  'host disappears'={ $script:change={ $script:processes=@($script:runnerRecord) } }
  'instance replaced'={ $script:change={ $script:instances[0].InstanceGuid='{22222222-2222-4222-8222-222222222222}' } }
  'path changes before stop'={ $script:change={ $script:runnerRecord.ExecutablePath='D:\fake\pwsh.exe' } }
  'arguments change before stop'={ $script:change={ $script:runnerRecord.CommandLine+=' -Command evil' } }
  'second runner before stop'={ $script:change={ $script:processes+=($script:runnerRecord.PSObject.Copy()) } }
}
foreach($name in $cases.Keys){
  Reset-Case; & $cases[$name]
  $rejected=$false
  try{Stop-Login}catch{$rejected=$true}
  if(-not $rejected -or $script:stops){throw ('Unsafe stop accepted: '+$name)}
}
# Execute the real outer catch statement, not just Stop-Login, so identity
# refusal cannot be undone by a catch path starting a replacement task.
$enableFn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Enable-Login'},$true)
. ([scriptblock]::Create($enableFn.Extent.Text))
$catchClause=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})[-1]
function Await-Healthy {return (CurrentStatus)}
Reset-Case
$script:wasStopped=$false;$script:didInstall=$false;$script:snapshot=$null
$script:change={ $script:task.Actions[0].Arguments='replaced-task' }
$caught=$false
try{Stop-Login}catch{
  $caught=$true
  try{. ([scriptblock]::Create($catchClause.CatchClauses[0].Body.Extent.Text.TrimStart('{').TrimEnd('}')))}catch{}
}
if(-not $caught -or $script:stops -or $script:enables -or $script:starts){throw 'Outer catch must not restart a task after identity refusal'}
Reset-Case
$script:stoppingLoginIdentity=Get-LoginMonitorIdentity $definition
Restore-LoginAfterRejectedStop
if($script:enables -ne 1 -or $script:starts){throw 'Original healthy monitor may only be re-enabled without spawning'}
Write-Output ('PASS: PS7 graceful stop and '+$cases.Count+' identity/race refusals; no process termination.')
