$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$id=[guid]::NewGuid().ToString();$root=Join-Path 'D:\Tong\state' ('b23-task-host-'+$id)
$null=[IO.Directory]::CreateDirectory($root)
$exe=Join-Path $root 'TongLoginHost.exe'
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
@'
param([string]$Mode)
if($Mode -cne 'run'){exit 94}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'runner.json'),(@{pid=$PID;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress))
while(-not [IO.File]::Exists((Join-Path $PSScriptRoot 'release'))){Start-Sleep -Milliseconds 100}
exit 37
'@|Set-Content -LiteralPath (Join-Path $root 'TongLoginRuntime.ps1') -Encoding utf8
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
$definition=$scheduler.NewTask(0);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT5M'
$definition.RegistrationInfo.Description='Tong 024 isolated native Task/Host probe; manual-only; no production paths.'
$action=$definition.Actions.Create(0);$action.Path=$exe;$action.WorkingDirectory=$root
$name='Tong024Acceptance-'+$id;$task=$null
try{
 $task=$folder.RegisterTaskDefinition($name,$definition,2,$sid,$null,3)
 $instance=$task.Run($null);$until=[DateTime]::UtcNow.AddSeconds(20)
 while(-not [IO.File]::Exists((Join-Path $root 'runner.json')) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
 if(-not [IO.File]::Exists((Join-Path $root 'runner.json'))){throw 'TASK_RUNNER_NOT_STARTED'}
 $runner=Get-Content -LiteralPath (Join-Path $root 'runner.json') -Raw|ConvertFrom-Json
 $runnerProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$runner.pid)
 $hostProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$runnerProcess.ParentProcessId)
 $second=$task.Run($null);$instances=@($task.GetInstances(0))
 if($instances.Count -ne 1 -or $instances[0].InstanceGuid -ine $instance.InstanceGuid -or $hostProcess.ExecutablePath -ine $exe){throw 'TASK_HOST_IDENTITY_UNPROVEN'}
 $observed=@{platformOnly=$true;taskName=$name;root=$root;instanceGuid=$instance.InstanceGuid;enginePid=$instance.EnginePID;hostPid=$hostProcess.ProcessId;hostExe=$hostProcess.ExecutablePath;runnerPid=$runner.pid;instances=$instances.Count;secondInstanceGuid=$second.InstanceGuid}
 [IO.File]::WriteAllText((Join-Path $root 'release'),'stop')
 $until=[DateTime]::UtcNow.AddSeconds(20);while(@($task.GetInstances(0)).Count -gt 0 -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
 if(@($task.GetInstances(0)).Count -ne 0 -or $task.LastTaskResult -ne 37){throw 'TASK_HOST_EXIT_UNPROVEN'}
 $observed.passed=$true;$observed.lastTaskResult=$task.LastTaskResult;$observed|ConvertTo-Json -Compress
}finally{[IO.File]::WriteAllText((Join-Path $root 'release'),'stop');if($null -ne $task){$task.Enabled=$false}}
