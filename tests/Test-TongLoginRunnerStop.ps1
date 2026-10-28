$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Join-Path 'D:\Tong\development\test-temp' ('runner-stop-'+[guid]::NewGuid().ToString('N'))
$login=Join-Path $root 'login-management'
$null=New-Item -ItemType Directory -Path $login
$exe=Join-Path $login 'TongLoginHost.exe'
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
$runner=Join-Path $login 'TongLoginRuntime.ps1'
$releaseSignal=Join-Path $login 'release'
# Real native Host and PS7 child; only scheduler and manager request delivery are
# isolated adapters. No real task, production run, recovery receipt or pin used.
$body=@'
param([string]$Mode)
if($Mode -cne 'run'){exit 94}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'started'),[string]$PID)
while(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release'))){Start-Sleep -Milliseconds 100}
exit 0
'@
[IO.File]::WriteAllText($runner,$body,[Text.UTF8Encoding]::new($false))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and ($n.Name -match '^(Get|Assert|Test)-Login' -or $n.Name -eq 'Stop-Login')},$true)){
  . ([scriptblock]::Create($fn.Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:scheduler')))
}
$taskName='SyntheticRunnerStop';$manager='synthetic-manager';$script:disabled=$false;$script:stops=0
$script:instanceId=[guid]::NewGuid().ToString()
$script:definition=[pscustomobject]@{}
$script:definition|Add-Member ScriptMethod GetInstances {param($flags)
  if(-not $script:hostProcess.HasExited){[pscustomobject]@{InstanceGuid=$script:instanceId;EnginePID=$script:hostProcess.Id;State=4}}
}
$script:folder=[pscustomobject]@{}
$script:folder|Add-Member ScriptMethod GetTask {param($name) return $script:definition}
$script:scheduler=[pscustomobject]@{}
$script:scheduler|Add-Member ScriptMethod Connect {}
$script:scheduler|Add-Member ScriptMethod GetFolder {param($name) return $script:folder}
function Get-ScheduledTask {param($TaskName)
  [pscustomobject]@{State='Running';Actions=@([pscustomobject]@{Execute=$exe;Arguments='';WorkingDirectory=$root});Principal=[pscustomobject]@{UserId=[Environment]::UserName}}
}
function Disable-ScheduledTask {param($TaskName) $script:disabled=$true}
function CurrentStatus {[pscustomobject]@{runId='isolated-run';supervisorAlive=$true}}
function Native {param($Name,$Arguments)
  if(-not $script:disabled -or $Name -cne 'graceful exact-run stop' -or
      ($Arguments -join '|') -cne ('synthetic-manager|stop-run|--root|'+$root+'|--run-id|isolated-run|--error-json|--login-recovery')){throw 'Wrong isolated stop request'}
  $script:stops++
  [IO.File]::WriteAllText($releaseSignal,'graceful stop')
}
function Stop-Process {throw 'Forced termination forbidden'}
$script:hostProcess=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
try{
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
  @{passed=$true;root=$root;realHost=$true;realPs7=$true;normalExit=$true;productionModified=$false}|ConvertTo-Json -Compress
}finally{
  # Release only this newly created fixture's wait condition; no PID termination.
  if(-not $hostProcess.HasExited){[IO.File]::WriteAllText($releaseSignal,'fixture teardown');$null=$hostProcess.WaitForExit(15000)}
}
