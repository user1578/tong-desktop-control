# One narrow version-2 state repair rehearsal. No production target or service control.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a'
$ops=Join-Path $root 'offline-9850e1a';$case=Join-Path $ops ('state-only-024-'+[guid]::NewGuid())
$snapshot=Join-Path $ops 'isolation-52b84969-c847-4f78-9699-d57c5d46842a'
$seal='b1d1921e283fb6d261718fe5c474ef0c41c0f0b19ba756fc52ec6571117e16da'
$controller=Join-Path $PSScriptRoot '..\scripts\TongStable1Offline.ps1'
$worker=Join-Path $PSScriptRoot 'Test-Tong024StateRepairWorker.mjs'
$run=Join-Path $root 'run';$monitor=Join-Path $root 'login-management';$gatePath=Join-Path $run 'backup.freeze'
$null=[IO.Directory]::CreateDirectory((Join-Path $case 'temp'));$null=[IO.Directory]::CreateDirectory((Join-Path $case 'original'))
$env:TEMP=Join-Path $case 'temp';$env:TMP=$env:TEMP
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Runtime.InteropServices;
public static class StateRepairFile {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint a,c1,c2,t1,t2,w1,w2,v,s1,s2,links,i1,i2;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(IntPtr h,out Info f);
 public static string Key(string p){using(var s=File.Open(p,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){Info f;if(!GetFileInformationByHandle(s.SafeFileHandle.DangerousGetHandle(),out f)||f.links!=1)throw new Exception("FILE_ID_UNAVAILABLE");return f.v+":"+f.i1+":"+f.i2;}}
}
'@
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Check([bool]$Condition,[string]$ErrorCode){if(-not $Condition){throw $ErrorCode}}
function Worker([string]$Action){$text=& D:\node\node.exe $worker $Action;if($LASTEXITCODE -ne 0){throw ('WORKER_FAILED_'+$Action)};return ($text|ConvertFrom-Json)}
function Inspect { $text=& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File $controller -Mode InspectIsolation -Snapshot $snapshot;if($LASTEXITCODE -ne 0 -or -not ($text|ConvertFrom-Json).quiescent){throw 'NATIVE_INSPECTION_REFUSED'} }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex=[Threading.Mutex]::new($false,('Local\Tong024StateRepair-'+$sid));$held=$false;$task=$null;$gate=$null;$started=$false;$grant=$false;$result=$null
try{
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true};Check $held 'LIFECYCLE_MUTEX_BUSY'
 Inspect
 $gateKey=[StateRepairFile]::Key($gatePath);Check ($gateKey -ceq '3025126315:65536:3281504') 'ORIGINAL_FIXTURE_GATE_REQUIRED'
 $pinHash=Hash (Join-Path $run 'release-pin.json');Check ($pinHash -ceq '482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd') 'VERSION2_REQUIRED'
 $profileHash=Hash (Join-Path $root 'profile.json')
 $before=@{};foreach($f in Get-ChildItem -LiteralPath $run -File){$before[$f.Name]=Hash $f.FullName}
 $null=Worker 'grant';$grant=$true
 $blocked=Worker 'blocked-start';Check ($blocked.error -ceq 'RUNTIME_BUSY') 'EXPECTED_EXISTING_GATE_BUSY'
 foreach($name in $before.Keys){Check ((Hash (Join-Path $run $name)) -ceq $before[$name]) 'ORIGINAL_CONTROL_CHANGED_BEFORE_ARCHIVE'}
 $gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 # Kernel identities/Jobs/ports and all fixture tasks were checked immediately above.
 # Keep the original gate present and held until every old control is retained.
 $index=@{baseline='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';gateFileKey=$gateKey;hashes=$before;productionWrite=$false}
 [IO.File]::WriteAllText((Join-Path $case 'archive-index.json'),($index|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 foreach($name in $before.Keys){if($name -notin @('release-pin.json','manager-pin.json','backup.freeze')){$original=Join-Path $case ('original\'+$name);[IO.File]::Move((Join-Path $run $name),$original);[IO.File]::Copy($original,(Join-Path $run $name),$false)}}
 # Working copies are byte-identical. The ORIGINAL version-2 Manager must
 # accept its own cleanup checks; no receipts or status fields are fabricated.
 foreach($name in $before.Keys){Check ((Hash (Join-Path $run $name)) -ceq $before[$name]) 'WORKING_CONTROL_COPY_CHANGED'}
 $gate.Dispose();$gate=$null;[IO.File]::Move($gatePath,(Join-Path $case 'original\backup.freeze'))
 Check (([StateRepairFile]::Key((Join-Path $case 'original\backup.freeze'))) -ceq $gateKey) 'ARCHIVE_FILE_ID_CHANGED'
 # The formal Task starts its own runtime, rather than adopting a runtime
 # started from a different Windows caller. No App/Manager code is patched.
 $hostSource=Join-Path $root 'monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
 Check ((Hash $hostSource) -ceq '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718') 'HOST_CHANGED'
 [IO.File]::Copy($hostSource,(Join-Path $monitor 'TongLoginHost.exe'),$false)
 $runner=[IO.File]::ReadAllText((Join-Path $root 'releases\manager\scripts\TongLoginRuntime.ps1')).Replace("`$runtime='D:\Tong\runtime'","`$runtime='$root'").Replace('Local\TongLoginRuntime-','Local\Tong024StateRepair-')
 [IO.File]::WriteAllText((Join-Path $monitor 'TongLoginRuntime.ps1'),$runner,[Text.UTF8Encoding]::new($false))
 $service=New-Object -ComObject Schedule.Service;$service.Connect();$folder=$service.GetFolder('\');$definition=$service.NewTask(0)
 $definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0;$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT5M'
 $action=$definition.Actions.Create(0);$action.Path=Join-Path $monitor 'TongLoginHost.exe';$action.WorkingDirectory=$root
 $mutex.ReleaseMutex();$held=$false
 $task=$folder.RegisterTaskDefinition(('Tong024StateRepair-'+[guid]::NewGuid()),$definition,2,$sid,$null,3);$began=[DateTime]::UtcNow;$started=$true;$null=$task.Run($null)
 $deadline=[DateTime]::UtcNow.AddSeconds(180);$observed=$null;$hostIdentity=$null;$runnerIdentity=$null
 while([DateTime]::UtcNow -lt $deadline){
  $instances=@($task.GetInstances(0));Check ($instances.Count -le 1) 'DUPLICATE_TASK_INSTANCE'
  if($instances.Count -eq 1){$hostIdentity=Get-CimInstance Win32_Process -Filter ('ProcessId='+$instances[0].EnginePID);if($hostIdentity -and $hostIdentity.ExecutablePath -ieq $action.Path){$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$hostIdentity.ProcessId)|Where-Object {$_.ExecutablePath -ieq 'C:\Program Files\PowerShell\7\pwsh.exe' -and $_.CommandLine.Contains((Join-Path $monitor 'TongLoginRuntime.ps1'))});if($children.Count -eq 1){$runnerIdentity=$children[0]}}}
  if($runnerIdentity){$events=@(Get-Content -LiteralPath (Join-Path $root 'logs\login-management.jsonl')|ForEach-Object {$_|ConvertFrom-Json}|Where-Object {$_.runnerPid -eq $runnerIdentity.ProcessId -and $_.event -ceq 'runtime_healthy' -and ([DateTime]$_.at).ToUniversalTime() -ge $began});if($events.Count){$observed=$events[-1];break}}
  if(-not $instances.Count -and $task.LastTaskResult -ne 267009 -and ([DateTime]::UtcNow-$began).TotalSeconds -gt 3){throw 'FORMAL_TASK_EARLY_EXIT'};Start-Sleep -Milliseconds 300
 }
 Check ($null -ne $observed) 'FORMAL_TASK_DID_NOT_START_HEALTHY_VERSION2'
 $ready=Worker 'status';Check ($ready.healthy -and $ready.phase -ceq 'ready' -and $ready.runId -ceq $observed.runId) 'FORMAL_TASK_DOCTOR_FAILED'
 Check ((Hash (Join-Path $root 'profile.json')) -ceq $profileHash) 'PROFILE_CHANGED'
 foreach($pin in @('release-pin.json','manager-pin.json')){Check ((Hash (Join-Path $run $pin)) -ceq $pinHash) 'PIN_CHANGED'}
 $stopped=Worker 'stop';$started=$false
 $deadline=[DateTime]::UtcNow.AddSeconds(35);while(@($task.GetInstances(0)).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
 Check (@($task.GetInstances(0)).Count -eq 0 -and $task.LastTaskResult -eq 0) 'TASK_DID_NOT_STOP_CLEANLY';$task.Enabled=$false
 $null=Worker 'revoke';$grant=$false
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true};Check $held 'POST_STOP_MUTEX_BUSY'
 Inspect
 Check (-not [IO.File]::Exists($gatePath)) 'UNEXPECTED_POST_STOP_GATE'
 [IO.File]::Move((Join-Path $case 'original\backup.freeze'),$gatePath)
 $restored=& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File $controller -Mode RestoreIsolation -Snapshot $snapshot -ExpectedSeal $seal
 Check ($LASTEXITCODE -eq 0 -and ($restored|ConvertFrom-Json).allOriginalBytesVerified) 'FIXTURE_RESTORE_NOT_PROVEN'
 $result=@{at=[DateTime]::UtcNow.ToString('o');passed=$true;case=$case;version='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';existingFreezeError=$blocked.error;stateOnlyStartHealthy=$true;originalControlsRetained=$true;workingControlCopiesUnchangedBeforeStart=$true;managerAndAppSourceUnchanged=$true;profileAndPinsUnchanged=$true;controllerMutexThroughArchive=$true;nativeControllerMutexThroughReady=$false;formalTaskStartedOwnRuntime=$true;independentManagerFileGateUsed=$true;formalTask=$task.Name;runId=$ready.runId;hostPid=$hostIdentity.ProcessId;runnerPid=$runnerIdentity.ProcessId;ps7Host=$true;taskExit=0;stopped=$true;originalGateFileKey=$gateKey;originalGateRestored=(([StateRepairFile]::Key($gatePath)) -ceq $gateKey);fullFixtureRestored=$true;productionWrite=$false;historicalMonitorFailedCause='UNKNOWN';productionEntrypointsClosed=$false;ngrokServiceControlTested=$false;largeBackupOrTreeCopy=$false}
 [IO.File]::WriteAllText((Join-Path $case 'result.json'),($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false));$result|ConvertTo-Json -Depth 6 -Compress
}finally{
 if($gate){$gate.Dispose()}
 if($task){$task.Enabled=$false}
 if($started){try{$null=Worker 'stop'}catch{Write-Warning 'Fixture stop requires investigation; no automatic file restore attempted'}}
 if($grant){try{$null=Worker 'revoke'}catch{Write-Warning 'Fixture grant revocation not proven'}}
 if($held){$mutex.ReleaseMutex()};$mutex.Dispose()
}
