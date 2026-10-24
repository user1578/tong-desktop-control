param([ValidateSet('host','proof','inspect','recover')][string]$Mode)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Security.Principal;
public static class Tong024Native {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long a,out long b,out long c,out long d);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr data,uint size,IntPtr returned);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr h,out FileInfo value);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder path,uint size,uint flags);
 [StructLayout(LayoutKind.Sequential)] struct FileInfo {public uint attrs,c1,c2,a1,a2,w1,w2,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr handle,uint info,IntPtr descriptor);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
 public static string[] Identity(int pid){var h=OpenProcess(0x101000,false,pid);if(h==IntPtr.Zero)throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");try{if(WaitForSingleObject(h,0)!=258)throw new Exception("HANDOFF_OWNER_GONE");long a,b,c,d;var name=new StringBuilder(32768);uint n=32768;if(!GetProcessTimes(h,out a,out b,out c,out d)||!QueryFullProcessImageName(h,0,name,ref n))throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");return new[]{pid.ToString(),name.ToString(),(DateTime.FromFileTimeUtc(a).Ticks/10*10).ToString()};}finally{CloseHandle(h);}}
 public static bool Member(int pid,string name){var p=OpenProcess(0x1000,false,pid);var j=OpenJobObject(4,false,name);try{bool yes;if(p==IntPtr.Zero||j==IntPtr.Zero||!IsProcessInJob(p,j,out yes))throw new Exception("HANDOFF_JOB_UNAVAILABLE");return yes;}finally{if(p!=IntPtr.Zero)CloseHandle(p);if(j!=IntPtr.Zero)CloseHandle(j);}}
 public static int Active(string name){var j=OpenJobObject(4,false,name);if(j==IntPtr.Zero){if(Marshal.GetLastWin32Error()==2)return 0;throw new Exception("HANDOFF_JOB_UNAVAILABLE");}var p=Marshal.AllocHGlobal(48);try{if(!QueryInformationJobObject(j,1,p,48,IntPtr.Zero))throw new Exception("HANDOFF_JOB_UNAVAILABLE");return Marshal.ReadInt32(p,40);}finally{Marshal.FreeHGlobal(p);CloseHandle(j);}}
 public static string FileKey(IntPtr h){FileInfo f;if(!GetFileInformationByHandle(h,out f)||f.links!=1)throw new Exception("HANDOFF_FILE_IDENTITY");return f.volume+":"+f.indexHigh+":"+f.indexLow;}
 public static string FinalPath(IntPtr h){var p=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,p,32768,0);if(n==0||n>=32768)throw new Exception("HANDOFF_PATH_DENIED");return p.ToString().Substring(4);}
 public static void RestrictObservers(string name){var h=OpenJobObject(0x40000,false,name);IntPtr sd=IntPtr.Zero;uint size;try{var sid=WindowsIdentity.GetCurrent().User.Value;if(h==IntPtr.Zero||!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;0x00020004;;;"+sid+")(A;;GA;;;SY)",1,out sd,out size)||!SetKernelObjectSecurity(h,4,sd))throw new Exception("HANDOFF_JOB_DACL");}finally{if(sd!=IntPtr.Zero)LocalFree(sd);if(h!=IntPtr.Zero)CloseHandle(h);}}
}
'@
function Identity([int]$ProcessId){$v=[Tong024Native]::Identity($ProcessId);return [ordered]@{pid=[int]$v[0];exe=$v[1];startTicks=$v[2]}}
function Same($a,$b){return $a.pid -eq $b.pid -and $a.exe -ieq $b.exe -and $a.startTicks -ceq $b.startTicks}
function Sha([byte[]]$Bytes){$s=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($s.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Ordinary([string]$Path){$p=[IO.Path]::GetFullPath($Path);while($p){if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'HANDOFF_PATH_DENIED'};$p=[IO.Path]::GetDirectoryName($p)}}
function Final-Path($File,[string]$Path){if([Tong024Native]::FinalPath($File.SafeFileHandle.DangerousGetHandle()) -ine [IO.Path]::GetFullPath($Path)){throw 'HANDOFF_PATH_DENIED'}}
function Durable([string]$Path,[byte[]]$Bytes){$f=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$f.Write($Bytes,0,$Bytes.Length);$f.Flush($true)}finally{$f.Dispose()}}
function Read-Gate([string]$Path){$f=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete));try{$key=[Tong024Native]::FileKey($f.SafeFileHandle.DangerousGetHandle());$m=[IO.MemoryStream]::new();try{$f.CopyTo($m);return @{key=$key;bytes=$m.ToArray()}}finally{$m.Dispose()}}finally{$f.Dispose()}}
function Reply($Value){$Value|ConvertTo-Json -Depth 15 -Compress}
$held=$null;$job=$null
try {
 $inputData=[Console]::ReadLine()|ConvertFrom-Json
 $root=[IO.Path]::GetFullPath([string]$inputData.root);$gate=Join-Path $root 'run\backup.freeze'
 if($inputData.sessionId -cnotmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'HANDOFF_BINDING_DENIED'}
 if($Mode -eq 'recover'){
  # Isolated, independent recovery only. Never adopt a live or disarmed run.
  if($inputData.mode -cne 'production-simulation' -or $root -cnotmatch '^D:\\Tong\\state\\b23-[a-zA-Z0-9_-]+$'){throw 'MAINTENANCE_NOT_READY'}
  $folder=Join-Path $root ('024-handoff\'+$inputData.sessionId)
  foreach($path in @($gate,(Join-Path $folder 'snapshot.json'),(Join-Path $folder 'original.freeze'))){Ordinary $path}
  $held=[IO.File]::Open($gate,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);Final-Path $held $gate
  $m=[IO.MemoryStream]::new();try{$held.CopyTo($m);$current=$m.ToArray()}finally{$m.Dispose()}
  if((Sha $current) -cne $inputData.gateSha256){throw 'HANDOFF_FREEZE_CHANGED'}
  $manifest=[IO.File]::ReadAllBytes((Join-Path $folder 'snapshot.json'))
  if((Sha $manifest) -cne $inputData.snapshotSha256){throw 'HANDOFF_SNAPSHOT_CHANGED'}
  $snapshot=[Text.Encoding]::UTF8.GetString($manifest)|ConvertFrom-Json
  $original=[IO.File]::ReadAllBytes((Join-Path $folder 'original.freeze'))
  $intentPath=Join-Path $folder 'recovery-intent.json';$intent=$null
  if([IO.File]::Exists($intentPath)){
   Ordinary $intentPath;$intent=[IO.File]::ReadAllText($intentPath)|ConvertFrom-Json
   if($intent.snapshotSha256 -cne (Sha $manifest) -or $intent.fileKey -cne $snapshot.state.fileKey -or $intent.originalSha256 -cne (Sha $original)){throw 'HANDOFF_BINDING_DENIED'}
   $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$intent.worker.pid)
   if($null -ne $p -and (Same (Identity $intent.worker.pid) $intent.worker)){throw 'HANDOFF_RECOVERY_OWNER_PRESENT'}
  }
  # A prior recovery may have flushed the original zero-byte gate before dying.
  # Only its sealed, dead-worker intent permits resuming from those exact bytes.
  if($null -ne $intent -and (Sha $current) -ceq (Sha $original)){$state=$snapshot.state}else{$state=[Text.Encoding]::UTF8.GetString($current)|ConvertFrom-Json}
  if($state.kind -cne 'tong-024-handoff-v1' -or $state.root -cne $root -or $state.sessionId -cne $inputData.sessionId -or $state.fileKey -cne [Tong024Native]::FileKey($held.SafeFileHandle.DangerousGetHandle()) -or $state.profileDigest -cne $inputData.profileDigest -or $state.profileDigest -cne $snapshot.state.profileDigest -or -not (Same $state.owner $snapshot.state.owner) -or -not (Same $state.controller $snapshot.state.controller) -or $state.fileKey -cne $snapshot.state.fileKey -or $snapshot.state.sessionId -cne $state.sessionId -or $snapshot.state.root -cne $root -or (Sha $original) -cne $snapshot.originalSha256){throw 'HANDOFF_BINDING_DENIED'}
  if($state.phase -cnotin @('held','authorized','failed') -or [IO.File]::Exists((Join-Path $folder 'commit-intent.json'))){throw 'HANDOFF_DISARMED_RECOVERY_REQUIRED'}
  foreach($owner in @($state.owner,$state.controller)){
   $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owner.pid)
   if($null -ne $p -and (Same (Identity $owner.pid) $owner)){throw 'HANDOFF_RECOVERY_OWNER_PRESENT'}
  }
  $identities=@($state.client);$runs=@()
  foreach($name in @('runtime.json','guardian.json','request.json')){
   $path=Join-Path $root ('run\'+$name)
   if([IO.File]::Exists($path)){
    $record=[IO.File]::ReadAllText($path)|ConvertFrom-Json
    if($record.PSObject.Properties['runId']){$runs+=@($record.runId)}
    if($name -ceq 'guardian.json'){$identities+=@($record)}
    if($record.PSObject.Properties['supervisor']){$identities+=@($record.supervisor)}
    foreach($key in @('children','descendants')){if($record.PSObject.Properties[$key]){$identities+=@($record.$key)}}
   }
  }
  foreach($expected in $identities){if($null -ne $expected -and $expected.pid){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$expected.pid);if($null -ne $p -and (Same (Identity $expected.pid) $expected)){throw 'HANDOFF_RECOVERY_PROCESS_PRESENT'}}}
  if($state.jobName -cne ('Local\Tong024Handoff-'+$state.sessionId) -or [Tong024Native]::Active($state.jobName) -ne 0){throw 'HANDOFF_JOB_BUSY'}
  foreach($run in $runs|Select-Object -Unique){if($run -cnotmatch '^[a-f0-9-]{36}$'){throw 'HANDOFF_RUN_DENIED'};foreach($prefix in @('TongRuntime-','TongGuardian-','TongPreflight-launcher-','TongPreflight-guardian-')){if([Tong024Native]::Active('Local\'+$prefix+$run) -ne 0){throw 'HANDOFF_JOB_BUSY'}}}
  if($null -eq $intent){Durable $intentPath ([Text.Encoding]::UTF8.GetBytes((@{worker=(Identity $PID);gateSha256=(Sha $current);snapshotSha256=(Sha $manifest);fileKey=$state.fileKey;originalSha256=(Sha $original)}|ConvertTo-Json -Depth 5 -Compress)))}
  Reply @{phase='recovery-prepared'};if([Console]::ReadLine() -cne 'continue'){throw 'HANDOFF_RECOVERY_INTERRUPTED'}
  $held.Position=0;$held.Write($original,0,$original.Length);$held.SetLength($original.Length);$held.Flush($true)
  Reply @{phase='freeze-written'};if([Console]::ReadLine() -cne 'continue'){throw 'HANDOFF_RECOVERY_INTERRUPTED'}
  $restoredPath=Join-Path $folder 'restored.json'
  if([IO.File]::Exists($restoredPath)){Ordinary $restoredPath;$restored=[IO.File]::ReadAllText($restoredPath)|ConvertFrom-Json;if($restored.sessionId -cne $state.sessionId -or $restored.fileKey -cne $state.fileKey -or $restored.originalSha256 -cne (Sha $original)){throw 'HANDOFF_BINDING_DENIED'}}else{Durable $restoredPath ([Text.Encoding]::UTF8.GetBytes((@{sessionId=$state.sessionId;originalSha256=(Sha $original);fileKey=$state.fileKey;independentWorker=(Identity $PID)}|ConvertTo-Json -Depth 5 -Compress)))}
  Reply @{phase='freeze-restored';sessionId=$state.sessionId;fileKey=$state.fileKey;originalSha256=(Sha $original)};exit 0
 }
 if($Mode -in @('proof','inspect')){
  $observed=Read-Gate $gate;$state=[Text.Encoding]::UTF8.GetString($observed.bytes)|ConvertFrom-Json
  if($Mode -eq 'inspect'){
   if($state.kind -cne 'tong-024-handoff-v1' -or $state.root -cne $root -or $state.sessionId -cne $inputData.sessionId -or $state.fileKey -cne $observed.key -or $state.jobName -cne ('Local\Tong024Handoff-'+$state.sessionId)){throw 'HANDOFF_BINDING_DENIED'}
   Reply @{sessionId=$state.sessionId;active=[Tong024Native]::Active($state.jobName);fileKey=$observed.key};exit 0
  }
  if($state.kind -cne 'tong-024-handoff-v1' -or $state.root -cne $root -or $state.sessionId -cne $inputData.sessionId -or $state.fileKey -cne $observed.key -or $state.profileDigest -cne $inputData.profileDigest -or $state.action -cne $inputData.action -or $state.phase -cne 'authorized'){throw 'HANDOFF_BINDING_DENIED'}
  if(-not (Same (Identity $state.owner.pid) $state.owner) -or -not (Same (Identity $state.controller.pid) $state.controller)){throw 'HANDOFF_OWNER_GONE'}
  if($inputData.role -cnotin @('manager','launcher')){throw 'HANDOFF_CALLER_DENIED'}
  # Stdin is not caller identity. Bind the requested PID to this proof
  # helper's actual OS parent before examining the authorized Job member.
  $requester=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
  if($null -eq $requester -or $requester.ParentProcessId -ne $inputData.pid){throw 'HANDOFF_CALLER_DENIED'}
  $caller=Identity $requester.ParentProcessId
  if($inputData.role -ceq 'launcher'){
   $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$inputData.pid)
   if($p.ParentProcessId -ne $state.client.pid -or -not (Same (Identity $state.client.pid) $state.client) -or $caller.exe -ine (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')){throw 'HANDOFF_CALLER_DENIED'}
  }elseif(-not (Same $caller $state.client)){throw 'HANDOFF_CALLER_DENIED'}
  if(-not [Tong024Native]::Member($caller.pid,$state.jobName)){throw 'HANDOFF_CALLER_DENIED'}
  Reply @{verified=$true;sessionId=$state.sessionId;jobName=$state.jobName;caller=$caller;fileKey=$observed.key;role=$inputData.role};exit 0
 }
 # Production mutation remains disabled independently of the JS caller.
 if($inputData.mode -cne 'production-simulation' -or $root -cnotmatch '^D:\\Tong\\state\\b23-[a-zA-Z0-9_-]+$'){throw 'MAINTENANCE_NOT_READY'}
 if($inputData.managerRoot -cne (Join-Path $root 'releases\manager') -or $inputData.nodeExe -ine 'D:\node\node.exe'){throw 'HANDOFF_BINDING_DENIED'}
 Ordinary $gate;Ordinary $inputData.managerRoot
 . (Join-Path $PSScriptRoot 'TongStartupProtocol.ps1')
 $controller=Identity $inputData.controller.pid
 $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
 if($parent.ParentProcessId -ne $controller.pid -or -not (Same $controller $inputData.controller)){throw 'HANDOFF_CONTROLLER_DENIED'}
 $held=[IO.File]::Open($gate,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);Final-Path $held $gate
 $m=[IO.MemoryStream]::new();try{$held.CopyTo($m);$original=$m.ToArray()}finally{$m.Dispose()}
 if((Sha $original) -cne $inputData.expectedSha256){throw 'HANDOFF_FREEZE_CHANGED'}
 if($original.Length -ne 0){throw 'HANDOFF_RECOVERY_REQUIRED'}
 $sessions=Join-Path $root '024-handoff'
 if([IO.Directory]::Exists($sessions)){Ordinary $sessions;foreach($previous in [IO.Directory]::GetDirectories($sessions)){if(-not [IO.File]::Exists((Join-Path $previous 'restored.json')) -and -not [IO.File]::Exists((Join-Path $previous 'completed.freeze'))){throw 'HANDOFF_RECOVERY_REQUIRED'}}}
 $folder=Join-Path $root ('024-handoff\'+$inputData.sessionId)
 if([IO.Directory]::Exists($folder)){throw 'HANDOFF_SESSION_EXISTS'}
 $null=[IO.Directory]::CreateDirectory($folder)
 Ordinary $folder
 Durable (Join-Path $folder 'original.freeze') $original
 $state=[ordered]@{kind='tong-024-handoff-v1';root=$root;sessionId=$inputData.sessionId;openedAt=[DateTime]::UtcNow.ToString('o');profileDigest=$inputData.profileDigest;releaseDigest=$inputData.releaseDigest;fileKey=[Tong024Native]::FileKey($held.SafeFileHandle.DangerousGetHandle());owner=(Identity $PID);controller=$controller;phase='held';client=$null;action=$null;jobName=('Local\Tong024Handoff-'+$inputData.sessionId)}
 $manifest=[Text.Encoding]::UTF8.GetBytes((@{state=$state;originalSha256=(Sha $original)}|ConvertTo-Json -Depth 15 -Compress))
 Durable (Join-Path $folder 'snapshot.json') $manifest
 if((Sha ([IO.File]::ReadAllBytes((Join-Path $folder 'original.freeze')))) -cne (Sha $original)){throw 'HANDOFF_SNAPSHOT_CHANGED'}
 function Persist-Gate {$b=[Text.Encoding]::UTF8.GetBytes(($state|ConvertTo-Json -Depth 15 -Compress));$held.Position=0;$held.Write($b,0,$b.Length);$held.SetLength($b.Length);$held.Flush($true)}
 function Proof {if(-not (Same (Identity $controller.pid) $controller)){throw 'HANDOFF_OWNER_GONE'};if((Sha ([IO.File]::ReadAllBytes((Join-Path $folder 'snapshot.json')))) -cne (Sha $manifest) -or (Sha ([IO.File]::ReadAllBytes((Join-Path $folder 'original.freeze')))) -cne $inputData.expectedSha256){throw 'HANDOFF_SNAPSHOT_CHANGED'};return @{sessionId=$state.sessionId;phase=$state.phase;owner=$state.owner;client=$state.client;jobName=$state.jobName;fileKey=$state.fileKey;folder=$folder;snapshotSha256=(Sha $manifest);active=$(if($null -eq $job){0}else{$job.Active});exited=$(if($null -eq $job){$true}else{$job.Exited});exitCode=$(if($null -eq $job -or -not $job.Exited){$null}else{$job.ExitCode})}}
 Persist-Gate;Reply (Proof)
 while($null -ne ($line=[Console]::ReadLine())){
  $cmd=$line|ConvertFrom-Json;$null=Proof
  switch -CaseSensitive ($cmd.command){
   'proof' {Reply (Proof)}
   'launch' {
    if($cmd.action -cnotin @('start','stop-run','probe')){throw 'HANDOFF_ACTION_DENIED'}
    if($null -ne $job -and -not $job.Exited){throw 'HANDOFF_CLIENT_BUSY'}
    $entry=Join-Path $inputData.managerRoot 'scripts\TongAgentDockRuntime.mjs'
    if((Sha ([IO.File]::ReadAllBytes($entry))) -cne $cmd.scriptSha256){throw 'HANDOFF_CANDIDATE_CHANGED'}
    $arguments='"'+$entry+'" '+$cmd.action+' --root "'+$root+'" --handoff-id '+$state.sessionId+' --error-json'
    if($cmd.loginRecovery){$arguments+=' --login-recovery'}
    if($cmd.PSObject.Properties['runId']){if($cmd.runId -cnotmatch '^[a-f0-9-]{36}$'){throw 'HANDOFF_RUN_DENIED'};$arguments+=' --run-id '+$cmd.runId}
    if($null -eq $job){$job=[TongStartupPreflight]::new($state.jobName,$inputData.nodeExe,$arguments,$root,$true);[Tong024Native]::RestrictObservers($state.jobName)}else{$job.StartNext($inputData.nodeExe,$arguments,$root)}
    $state.client=[ordered]@{pid=$job.Pid;exe=$inputData.nodeExe;startTicks=$job.StartTicks};$state.action=$cmd.action;$state.phase='authorized'
    Persist-Gate;$job.Resume();Reply (Proof)
   }
   'cancel' {if($null -ne $job){$job.Cancel()};$state.phase='failed';Persist-Gate;Reply (Proof)}
   'restore-freeze' {
    if($null -ne $job -and $job.Active -ne 0){throw 'HANDOFF_JOB_BUSY'}
    if((Sha ([IO.File]::ReadAllBytes((Join-Path $folder 'original.freeze')))) -cne $inputData.expectedSha256){throw 'HANDOFF_SNAPSHOT_CHANGED'}
    $held.Position=0;$held.Write($original,0,$original.Length);$held.SetLength($original.Length);$held.Flush($true)
    Durable (Join-Path $folder 'restored.json') ([Text.Encoding]::UTF8.GetBytes((@{sessionId=$state.sessionId;originalSha256=(Sha $original);fileKey=$state.fileKey}|ConvertTo-Json -Compress)))
    $held.Dispose();$held=$null
    Reply @{phase='restored';sessionId=$state.sessionId};exit 0
   }
   'complete' {
    if($null -eq $job -or -not $job.Exited -or $job.ExitCode -ne 0){throw 'HANDOFF_CLIENT_UNPROVEN'}
    $runtime=[IO.File]::ReadAllText((Join-Path $root 'run\runtime.json'))|ConvertFrom-Json
    $guardian=[IO.File]::ReadAllText((Join-Path $root 'run\guardian.json'))|ConvertFrom-Json
    if($runtime.runId -cne $cmd.runId -or $runtime.phase -cne 'ready' -or $runtime.releaseDigest -cne $state.releaseDigest -or $guardian.runId -cne $runtime.runId -or $guardian.containment -cne 'create_process_job_list' -or -not (Same (Identity $guardian.pid) $guardian) -or $guardian.nodePid -ne $runtime.supervisor.pid -or $guardian.jobName -cne ('Local\TongRuntime-'+$runtime.runId) -or -not (Same (Identity $runtime.supervisor.pid) $runtime.supervisor) -or -not [Tong024Native]::Member($runtime.supervisor.pid,$state.jobName) -or -not [Tong024Native]::Member($guardian.pid,$state.jobName)){throw 'HANDOFF_READY_UNPROVEN'}
    if(-not (Same (Identity $cmd.monitor.pid) $cmd.monitor)){throw 'HANDOFF_MONITOR_UNPROVEN'}
    $monitor=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cmd.monitor.pid)
    if($monitor.ParentProcessId -ne $controller.pid -or $monitor.CommandLine.IndexOf((Join-Path $folder 'TongLoginRuntime.ps1'),[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'HANDOFF_MONITOR_UNPROVEN'}
    $events=@([IO.File]::ReadAllLines((Join-Path $root 'logs\login-management.jsonl'))|ForEach-Object{$_|ConvertFrom-Json}|Where-Object{$_.runnerPid -eq $cmd.monitor.pid -and $_.PSObject.Properties['runId'] -and $_.runId -ceq $runtime.runId -and ([DateTime]$_.at).ToUniversalTime().Ticks -ge [long]$cmd.monitor.startTicks})
    if(@($events|Where-Object event -eq 'runtime_healthy').Count -lt 1 -or @($events|Where-Object event -eq 'handoff_periodic_health').Count -lt 1){throw 'HANDOFF_MONITOR_UNPROVEN'}
    $state.phase='commit-intent';Persist-Gate;Durable (Join-Path $folder 'commit-intent.json') ([Text.Encoding]::UTF8.GetBytes(($state|ConvertTo-Json -Depth 15 -Compress)))
    $job.ReleaseSurvivors();$state.phase='disarmed';Persist-Gate
    $held.Dispose();$held=$null;[IO.File]::Move($gate,(Join-Path $folder 'completed.freeze'))
    Reply @{phase='completed';sessionId=$state.sessionId;runId=$runtime.runId};exit 0
   }
   default {throw 'HANDOFF_COMMAND_DENIED'}
  }
 }
}catch{$failure=$_.Exception;while($failure.InnerException){$failure=$failure.InnerException};$code=if($failure.Message -cmatch '^[A-Z][A-Z0-9_]{1,63}$'){$failure.Message}else{'HANDOFF_NATIVE_REFUSED'};[Console]::Error.WriteLine((@{error=$code;mode=$Mode}|ConvertTo-Json -Compress));exit 2}
finally{if($null -ne $job){$job.Dispose()};if($null -ne $held){$held.Dispose()}}
