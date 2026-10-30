$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Join-Path 'D:\Tong\development\test-temp' ('runner-stop-'+[guid]::NewGuid().ToString('N'))
$login=Join-Path $root 'login-management'
$null=New-Item -ItemType Directory -Path $login
$null=New-Item -ItemType Directory -Path (Join-Path $root 'logs')
$exe=Join-Path $login 'TongLoginHost.exe'
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
$runner=Join-Path $login 'TongLoginRuntime.ps1'
$releaseSignal=Join-Path $login 'release'
# Real native Host and PS7 child; only scheduler and manager request delivery are
# isolated adapters. No real task, production run, recovery receipt or pin used.
$body=@'
param([string]$Mode)
if($Mode -cne 'run'){exit 94}
$fixtureName=[IO.Path]::GetFileName((Split-Path -Parent $PSScriptRoot))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex=[Threading.Mutex]::new($false,('Local\TongRecoveryHostTest-'+$fixtureName+'-'+$sid))
try{if(-not $mutex.WaitOne(0)){exit 95};$mutex.ReleaseMutex()}finally{$mutex.Dispose()}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'started'),[string]$PID)
$event=@{at=[DateTime]::UtcNow.ToString('o');event='runtime_healthy';runId='11111111-1111-4111-8111-111111111111';runnerPid=$PID;phase='ready'}|ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'logs\login-management.jsonl'),$event+"`n")
while(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release'))){Start-Sleep -Milliseconds 100}
exit 0
'@
[IO.File]::WriteAllText($runner,$body,[Text.UTF8Encoding]::new($false))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and ($n.Name -match '^(Get|Assert|Test)-Login' -or $n.Name -in @('Stop-Login','Recover-LoginMonitor'))},$true)){
  . ([scriptblock]::Create($fn.Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:scheduler').Replace('Local\TongLoginRuntime-',('Local\TongRecoveryHostTest-'+[IO.Path]::GetFileName($root)+'-')).Replace('Local\TongLoginMonitorRecovery-',('Local\TongRecoveryControllerTest-'+[IO.Path]::GetFileName($root)+'-'))))
}
$taskName='SyntheticRunnerStop';$manager='synthetic-manager';$script:disabled=$false;$script:stops=0
$script:hostProcess=$null;$script:starts=0
$script:ExpectedRunId='11111111-1111-4111-8111-111111111111'
$script:expectedOldApp='f81d1d0ddcc6da354cb475be628e6b79ca822516'
$script:instanceId=[guid]::NewGuid().ToString()
$script:definition=[pscustomobject]@{}
$script:definition|Add-Member ScriptMethod GetInstances {param($flags)
  if($null -ne $script:hostProcess -and -not $script:hostProcess.HasExited){[pscustomobject]@{InstanceGuid=$script:instanceId;EnginePID=$script:hostProcess.Id;State=4}}
}
$script:folder=[pscustomobject]@{}
$script:folder|Add-Member ScriptMethod GetTask {param($name) return $script:definition}
$script:scheduler=[pscustomobject]@{}
$script:scheduler|Add-Member ScriptMethod Connect {}
$script:scheduler|Add-Member ScriptMethod GetFolder {param($name) return $script:folder}
function Get-ScheduledTask {param($TaskName)
  $state=if($null -ne $script:hostProcess -and -not $script:hostProcess.HasExited){'Running'}else{'Ready'}
  [pscustomobject]@{State=$state;Actions=@([pscustomobject]@{Execute=$exe;Arguments='';WorkingDirectory=$root});Principal=[pscustomobject]@{UserId=[Environment]::UserName}}
}
function Get-LoginRecoveryState {return [pscustomobject]@{runId=$ExpectedRunId;phase='ready';supervisorAlive=$true;guardianAlive=$true;stopRequested=$false;commit=$expectedOldApp;taskState=[string](Get-ScheduledTask).State;runnerSha256=('b'*64);fingerprint='isolated-original'}}
function Start-ScheduledTask {param($TaskName) $script:starts++;$script:hostProcess=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru}
function Disable-ScheduledTask {param($TaskName) $script:disabled=$true}
function CurrentStatus {[pscustomobject]@{runId='isolated-run';supervisorAlive=$true}}
function Native {param($Name,$Arguments)
  if($Name -ceq 'verify monitor recovery grant'){return [pscustomobject]@{approved=$true;loginRecoverySupported=$true;runnerSha256=('b'*64)}}
  if(-not $script:disabled -or $Name -cne 'graceful exact-run stop' -or
      ($Arguments -join '|') -cne ('synthetic-manager|stop-run|--root|'+$root+'|--run-id|isolated-run|--error-json|--login-recovery')){throw 'Wrong isolated stop request'}
  $script:stops++
  [IO.File]::WriteAllText($releaseSignal,'graceful stop')
}
function Stop-Process {throw 'Forced termination forbidden'}
try{
  $recovered=Recover-LoginMonitor
  if($script:starts -ne 1 -or -not $recovered.monitorRecovered -or $recovered.runId -cne $ExpectedRunId){throw 'Real Host recovery must dispatch once and reattach the same run'}
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while(-not (Test-Path -LiteralPath (Join-Path $login 'started')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
  if(-not (Test-Path -LiteralPath (Join-Path $login 'started'))){throw 'Isolated runner startup failed'}
  try{$observed=Get-LoginMonitorIdentity $definition}catch{
    Get-CimInstance Win32_Process -Filter ('ProcessId='+$hostProcess.Id) | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress | Write-Output
    throw
  }
  if($observed.runner.name -cne 'pwsh.exe' -or $observed.runner.parent -ne $hostProcess.Id){throw 'Expected real PS7 child'}
  Stop-Login
  if($script:stops -ne 1 -or -not $hostProcess.WaitForExit(1000) -or $hostProcess.ExitCode -ne 0){throw 'Graceful Host/Runner exit failed'}
  if(Get-CimInstance Win32_Process -Filter ('ProcessId='+$observed.runner.pid)){throw 'Isolated runner remains'}
  @{passed=$true;root=$root;realHost=$true;realPs7=$true;monitorRecovery=$true;normalExit=$true;productionModified=$false}|ConvertTo-Json -Compress
}finally{
  # Release only this newly created fixture's wait condition; no PID termination.
  if($null -ne $hostProcess -and -not $hostProcess.HasExited){[IO.File]::WriteAllText($releaseSignal,'fixture teardown');$null=$hostProcess.WaitForExit(15000)}
}
