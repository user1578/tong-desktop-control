$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a';$ops=Join-Path $root 'offline-9850e1a'
$env:TONG_024_MONITOR_ROOT=$root;$env:TONG_024_MONITOR_CANDIDATE='37dc649c46ad0e267c3471f750b97227cf106310'
$worker=Join-Path $PSScriptRoot 'Test-Tong024MonitorRuntime.mjs'
$hostPath=Join-Path $root 'login-management\TongLoginHost.exe';$runnerPath=Join-Path $root 'login-management\TongLoginRuntime.ps1'
if((Get-FileHash -LiteralPath $hostPath).Hash.ToLowerInvariant() -cne '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718'){throw 'OFFLINE_HOST_BINDING_DENIED'}
if(Test-Path -LiteralPath (Join-Path $root 'run\backup.freeze')){throw 'OFFLINE_GATE_NOT_ARCHIVED'}
$service=New-Object -ComObject Schedule.Service;$service.Connect();$folder=$service.GetFolder('\');$definition=$service.NewTask(0)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT5M';$definition.RegistrationInfo.Description='One fixed stable-1 post-install cold start; no production target.'
$action=$definition.Actions.Create(0);$action.Path=$hostPath;$action.WorkingDirectory=$root;$task=$null;$began=[DateTime]::UtcNow
try{
 $task=$folder.RegisterTaskDefinition(('TongStable1Offline-'+[guid]::NewGuid()),$definition,2,$sid,$null,3);$null=$task.Run($null)
 $deadline=[DateTime]::UtcNow.AddSeconds(180);$healthy=$null;$hostProcess=$null;$runner=$null
 while([DateTime]::UtcNow -lt $deadline){
  $instances=@($task.GetInstances(0));if($instances.Count -gt 1){throw 'OFFLINE_DOUBLE_TASK'}
  if($instances.Count -eq 1){$hostProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$instances[0].EnginePID);if($hostProcess -and $hostProcess.ExecutablePath -ieq $hostPath){$runners=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$hostProcess.ProcessId)|Where-Object {$_.ExecutablePath -ieq 'C:\Program Files\PowerShell\7\pwsh.exe' -and $_.CommandLine.Contains($runnerPath)});if($runners.Count -eq 1){$runner=$runners[0]}}}
  if($runner){$events=@([IO.File]::ReadAllLines((Join-Path $root 'logs\login-management.jsonl'))|ForEach-Object {$_|ConvertFrom-Json}|Where-Object {$_.runnerPid -eq $runner.ProcessId -and $_.event -ceq 'runtime_healthy' -and ([DateTime]$_.at).ToUniversalTime() -ge $began});if($events.Count){$healthy=$events[-1];break}}
  if(-not $instances.Count -and $task.LastTaskResult -ne 267009){throw 'OFFLINE_TASK_EARLY_EXIT'};Start-Sleep -Milliseconds 300
 }
 if(-not $healthy -or -not $runner){throw 'OFFLINE_INSTALLED_START_NOT_HEALTHY'}
 $state=& D:\node\node.exe $worker status;if($LASTEXITCODE -ne 0){throw 'OFFLINE_INSTALLED_DOCTOR_FAILED'};$state=$state|ConvertFrom-Json
 if(-not $state.healthy -or $state.phase -cne 'ready' -or $state.runId -cne $healthy.runId){throw 'OFFLINE_INSTALLED_RUN_MISMATCH'}
 $null=& D:\node\node.exe $worker stop;if($LASTEXITCODE -ne 0){throw 'OFFLINE_INSTALLED_STOP_FAILED'}
 $deadline=[DateTime]::UtcNow.AddSeconds(35);while(@($task.GetInstances(0)).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
 if(@($task.GetInstances(0)).Count -or $task.LastTaskResult -ne 0){throw 'OFFLINE_TASK_EXIT_UNPROVEN'}
 $outcome=@{passed=$true;runId=$state.runId;healthy=$true;installedCommit=$env:TONG_024_MONITOR_CANDIDATE;task=$task.Name;hostPid=$hostProcess.ProcessId;runnerPid=$runner.ProcessId;hostSha256=(Get-FileHash -LiteralPath $hostPath).Hash.ToLowerInvariant();runnerSha256=(Get-FileHash -LiteralPath $runnerPath).Hash.ToLowerInvariant();taskExit=0;productionMutation=$false;windowsRebootTested=$false;priorAcceptanceRepeated=$false}
 [IO.File]::WriteAllText((Join-Path $ops 'boot-result.json'),($outcome|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false));$outcome|ConvertTo-Json -Depth 5 -Compress
}finally{
 if($task){$task.Enabled=$false}
 $null=& D:\node\node.exe $worker stop
 $null=& D:\node\node.exe $worker revoke
 if($task -and @($task.GetInstances(0)).Count){throw 'OFFLINE_TASK_CLEANUP_UNPROVEN'}
}
