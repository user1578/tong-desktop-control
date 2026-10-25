param([ValidateRange(1,2)][int]$Cycles=2)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=$env:TONG_024_MONITOR_ROOT
if($root -cnotmatch '^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$'){throw 'ISOLATION_ROOT_DENIED'}
$existingScheduler=New-Object -ComObject Schedule.Service;$existingScheduler.Connect()
foreach($previousTask in $existingScheduler.GetFolder('\').GetTasks(1)){foreach($action in $previousTask.Definition.Actions){if($action.Path -and $action.Path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -and @($previousTask.GetInstances(0)).Count -ne 0){throw 'PREVIOUS_TASK_STILL_RUNNING'}}}
$worker=Join-Path $PSScriptRoot 'Test-Tong024MonitorRuntime.mjs'
$prepared=& D:\node\node.exe $worker prepare;if($LASTEXITCODE -ne 0){throw 'FIXTURE_PREPARE_FAILED'};$prepared=$prepared|ConvertFrom-Json
$id=[guid]::NewGuid().ToString();$deployment=Join-Path $root ('monitor-'+$id);$null=[IO.Directory]::CreateDirectory($deployment)
$runnerPath=Join-Path $deployment 'TongLoginRuntime.ps1';$exe=Join-Path $deployment 'TongLoginHost.exe'
$source=[IO.File]::ReadAllText($prepared.runnerSource)
if($source.Split("`$runtime='D:\Tong\runtime'").Count -ne 2){throw 'RUNNER_SOURCE_CHANGED'}
$source=$source.Replace("`$runtime='D:\Tong\runtime'","`$runtime='$root'").Replace('Local\TongLoginRuntime-','Local\Tong024FormalMonitor-'+$id+'-')
[IO.File]::WriteAllText($runnerPath,$source,[Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
$shell=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'PowerShell\7\pwsh.exe'
if((Get-AuthenticodeSignature -LiteralPath $shell).Status -ne 'Valid'){throw 'INSTALLED_PWSH_SIGNATURE_UNPROVEN'}
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class Tong024DoctorObserver {
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint a,bool i,int p);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint WaitForSingleObject(IntPtr h,uint t);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr h,out uint c);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(IntPtr h,out long a,out long b,out long c,out long d);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref uint length);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 public static int Exit(int pid,string exe,long ticks){var h=OpenProcess(0x101000,false,pid);if(h==IntPtr.Zero)throw new Exception("DOCTOR_HANDLE_UNAVAILABLE");try{long a,b,c,d;var name=new StringBuilder(32768);uint length=32768;if(!GetProcessTimes(h,out a,out b,out c,out d)||!QueryFullProcessImageName(h,0,name,ref length)||DateTime.FromFileTimeUtc(a).Ticks/10*10!=ticks||!String.Equals(name.ToString(),exe,StringComparison.OrdinalIgnoreCase))throw new Exception("DOCTOR_IDENTITY_CHANGED");if(WaitForSingleObject(h,30000)!=0)throw new Exception("DOCTOR_EXIT_UNKNOWN");uint code;if(!GetExitCodeProcess(h,out code))throw new Exception("DOCTOR_EXIT_UNKNOWN");return (int)code;}finally{CloseHandle(h);}}
}
'@
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\');$definition=$scheduler.NewTask(0)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT10M';$definition.RegistrationInfo.Description='Tong 024 isolated exact-runner behavior rehearsal; no production targets.'
$a=$definition.Actions.Create(0);$a.Path=$exe;$a.WorkingDirectory=$root;$task=$null;$runs=@()
function Wait-TaskStopped {
 $until=[DateTime]::UtcNow.AddSeconds(35);while(@($task.GetInstances(0)).Count -gt 0 -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 200}
 if(@($task.GetInstances(0)).Count -ne 0 -or $task.LastTaskResult -ne 0){throw 'TASK_NORMAL_EXIT_UNPROVEN'}
}
try{
 $task=$folder.RegisterTaskDefinition(('Tong024Acceptance-'+$id),$definition,2,$sid,$null,3)
 foreach($cycle in 1..$Cycles){
  $began=[DateTime]::UtcNow;$instance=$task.Run($null);$until=$began.AddSeconds(180);$healthy=$null;$runner=$null;$hostProcess=$null
  while([DateTime]::UtcNow -lt $until){
   $instances=@($task.GetInstances(0));if($instances.Count -gt 1){throw 'DOUBLE_TASK_INSTANCE'}
   if($instances.Count -eq 1){$hostProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$instances[0].EnginePID);if($hostProcess -and $hostProcess.ExecutablePath -ieq $exe){$runners=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$hostProcess.ProcessId)|Where-Object {$_.ExecutablePath -ieq $shell -and $_.CommandLine -and $_.CommandLine.Contains($runnerPath)});if($runners.Count -gt 1){throw 'DOUBLE_RUNNER'};if($runners.Count -eq 1){$runner=$runners[0]}}}
   $log=Join-Path $root 'logs\login-management.jsonl';if($runner -and [IO.File]::Exists($log)){$healthy=@([IO.File]::ReadAllLines($log)|ForEach-Object{$_|ConvertFrom-Json}|Where-Object {$_.runnerPid -eq $runner.ProcessId -and $_.event -ceq 'runtime_healthy' -and ([DateTime]$_.at).ToUniversalTime() -ge $began});if($healthy.Count -gt 0){$healthy=$healthy[-1];break}}
   if(@($task.GetInstances(0)).Count -eq 0 -and $task.LastTaskResult -ne 267009){throw 'FORMAL_RUNNER_EARLY_EXIT'}
   Start-Sleep -Milliseconds 300
  }
  if(-not $healthy -or -not $runner -or -not $hostProcess){throw 'FORMAL_INITIAL_HEALTH_UNPROVEN'}
  $null=$task.Run($null);Start-Sleep -Milliseconds 300
  if(@($task.GetInstances(0)).Count -ne 1 -or @($task.GetInstances(0))[0].EnginePID -ne $hostProcess.ProcessId){throw 'TASK_IGNORE_NEW_UNPROVEN'}
  $until=[DateTime]::UtcNow.AddSeconds(30);$doctor=$null
  while([DateTime]::UtcNow -lt $until){$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$runner.ProcessId));$doctor=@($children|Where-Object {$_.ExecutablePath -ieq 'D:\node\node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($prepared.root+'\releases\manager\scripts\TongAgentDockRuntime.mjs') -and $_.CommandLine.Contains(' doctor ') -and $_.CreationDate.ToUniversalTime() -gt ([DateTime]$healthy.at).ToUniversalTime()});if($doctor.Count -eq 1){$doctor=$doctor[0];break};Start-Sleep -Milliseconds 150}
  if(-not $doctor -or $doctor -is [Array]){throw 'PERIODIC_DOCTOR_PROCESS_UNPROVEN'}
  if([Tong024DoctorObserver]::Exit([int]$doctor.ProcessId,$doctor.ExecutablePath,$doctor.CreationDate.ToUniversalTime().Ticks) -ne 0){throw 'PERIODIC_DOCTOR_FAILED'}
  $state=& D:\node\node.exe $worker status;if($LASTEXITCODE -ne 0){throw 'HEALTH_STATUS_UNPROVEN'};$state=$state|ConvertFrom-Json
  if($state.phase -cne 'ready' -or $state.runId -cne $healthy.runId -or -not $state.guardianAlive -or -not $state.healthy){throw 'HEALTHY_RUN_UNPROVEN'}
  if($cycle -eq 1){
   $gatewayTest=if($prepared.commit -ceq '37dc649c46ad0e267c3471f750b97227cf106310'){'Test-TongStable1Gateway.mjs'}else{'Test-Tong024HandoffGateway.mjs'}
   & D:\node\node.exe (Join-Path $PSScriptRoot $gatewayTest) $root $prepared.commit
   if($LASTEXITCODE -ne 0){throw 'GATEWAY_MCP_FAILED'}
  }
  $stopped=& D:\node\node.exe $worker stop;if($LASTEXITCODE -ne 0){throw 'CONTROLLED_STOP_FAILED'};Wait-TaskStopped
  $runs+=@{cycle=$cycle;runId=$state.runId;hostPid=$hostProcess.ProcessId;runnerPid=$runner.ProcessId;runnerExe=$runner.ExecutablePath;periodicDoctorPid=$doctor.ProcessId;periodicDoctorExit=0;concurrentDoctorHealthy=$state.healthy;taskExit=$task.LastTaskResult;initialHealthy=$true;ignoreNew=$true}
 }
 if($runs[0].runId -ceq $prepared.priorStoppedRunId -or ($Cycles -eq 2 -and $runs[0].runId -ceq $runs[1].runId)){throw 'RESTART_NOT_NEW_RUN'}
 $outcome=@{passed=$true;root=$root;deployment=$deployment;task=$task.Name;hostSha256=(Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant();runnerSha256=(Get-FileHash -LiteralPath $runnerPath).Hash.ToLowerInvariant();pinnedRunnerSha256=(Get-FileHash -LiteralPath $prepared.runnerSource).Hash.ToLowerInvariant();runnerAdjustments=@('isolated root','isolated SID mutex name');candidate=$prepared.commit;priorStoppedRunId=$prepared.priorStoppedRunId;runs=$runs;productionMutation=$false}
 [IO.File]::WriteAllText((Join-Path $deployment 'outcome.json'),($outcome|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false));$outcome|ConvertTo-Json -Depth 8 -Compress
}finally{
 if($null -ne $task){$task.Enabled=$false}
 $null=& D:\node\node.exe $worker stop
 if($null -ne $task -and @($task.GetInstances(0)).Count -gt 0){Wait-TaskStopped}
 $null=& D:\node\node.exe $worker revoke
}
