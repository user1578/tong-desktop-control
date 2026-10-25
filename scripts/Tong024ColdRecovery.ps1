$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class Tong024ColdNative {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint a,bool i,int p);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long a,out long b,out long c,out long d);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint f,StringBuilder n,ref uint s);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint a,bool i,string n);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr h,int k,IntPtr p,uint n,IntPtr r);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr h,out Info f);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder p,uint n,uint f);
 [StructLayout(LayoutKind.Sequential)] struct Info {public uint attrs,c1,c2,a1,a2,w1,w2,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 public static string[] Identity(int pid){var h=OpenProcess(0x101000,false,pid);if(h==IntPtr.Zero)throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");try{if(WaitForSingleObject(h,0)!=258)throw new Exception("HANDOFF_OWNER_GONE");long a,b,c,d;var name=new StringBuilder(32768);uint n=32768;if(!GetProcessTimes(h,out a,out b,out c,out d)||!QueryFullProcessImageName(h,0,name,ref n))throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");return new[]{pid.ToString(),name.ToString(),(DateTime.FromFileTimeUtc(a).Ticks/10*10).ToString()};}finally{CloseHandle(h);}}
 public static bool Gone(int pid){var h=OpenProcess(0x101000,false,pid);if(h==IntPtr.Zero){if(Marshal.GetLastWin32Error()==87)return true;throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");}try{uint result=WaitForSingleObject(h,0);if(result==0)return true;if(result==258)return false;throw new Exception("HANDOFF_IDENTITY_UNAVAILABLE");}finally{CloseHandle(h);}}
 public static int Active(string name){var j=OpenJobObject(4,false,name);if(j==IntPtr.Zero){if(Marshal.GetLastWin32Error()==2)return 0;throw new Exception("HANDOFF_JOB_UNAVAILABLE");}var p=Marshal.AllocHGlobal(48);try{if(!QueryInformationJobObject(j,1,p,48,IntPtr.Zero))throw new Exception("HANDOFF_JOB_UNAVAILABLE");return Marshal.ReadInt32(p,40);}finally{Marshal.FreeHGlobal(p);CloseHandle(j);}}
 public static string FileKey(IntPtr h){Info f;if(!GetFileInformationByHandle(h,out f)||f.links!=1)throw new Exception("HANDOFF_FILE_IDENTITY");return f.volume+":"+f.indexHigh+":"+f.indexLow;}
 public static string FinalPath(IntPtr h){var p=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,p,32768,0);if(n==0||n>=32768)throw new Exception("HANDOFF_PATH_DENIED");return p.ToString().Substring(4);}
}
'@
function Identity([int]$ProcessId){$v=[Tong024ColdNative]::Identity($ProcessId);return @{pid=[int]$v[0];exe=$v[1];startTicks=$v[2]}}
function Same($a,$b){return $a.pid -eq $b.pid -and $a.exe -ieq $b.exe -and $a.startTicks -ceq $b.startTicks}
function Sha([byte[]]$Bytes){return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()}
function Ordinary([string]$Path){$p=[IO.Path]::GetFullPath($Path);while($p){if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'HANDOFF_PATH_DENIED'};$p=[IO.Path]::GetDirectoryName($p)}}
function Check-File($File,[string]$Path){Ordinary $Path;if([Tong024ColdNative]::FinalPath($File.SafeFileHandle.DangerousGetHandle()) -ine [IO.Path]::GetFullPath($Path)){throw 'HANDOFF_PATH_DENIED'};$null=[Tong024ColdNative]::FileKey($File.SafeFileHandle.DangerousGetHandle())}
function Bytes($File){$File.Position=0;$m=[IO.MemoryStream]::new();try{$File.CopyTo($m);return ,$m.ToArray()}finally{$m.Dispose()}}
function Pin([string]$Path){Ordinary $Path;$f=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$pins.Add(@{path=$Path;file=$f});Check-File $f $Path;return $f}
function Seal([string]$Path,[byte[]]$Data){$f=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);$pins.Add(@{path=$Path;file=$f});$f.Write($Data,0,$Data.Length);$f.Flush($true);Check-File $f $Path;return $f}
function Assert-Dead($Expected){if($null -eq $Expected){return};if(-not $Expected.pid -or -not $Expected.exe -or -not $Expected.startTicks){throw 'HANDOFF_IDENTITY_UNAVAILABLE'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$Expected.pid);if($null -ne $p -and (Same (Identity $Expected.pid) $Expected)){throw 'HANDOFF_PROCESS_PRESENT'}}
function Assert-Quiescent {
 foreach($expected in @($state.owner,$state.controller,$state.client)){Assert-Dead $expected}
 if($null -ne $currentState){foreach($key in @('owner','controller','client')){if($currentState.PSObject.Properties[$key]){Assert-Dead $currentState.$key}}}
 $identities=@();$runs=@()
 foreach($name in @('runtime.json','guardian.json','request.json')){
  $path=Join-Path $root ('run\'+$name)
  if([IO.File]::Exists($path)){Ordinary $path;$record=[IO.File]::ReadAllText($path)|ConvertFrom-Json;if($record.PSObject.Properties['runId']){$runs+=@($record.runId)};if($name -ceq 'guardian.json'){$identities+=@($record)};foreach($key in @('supervisor','children','descendants')){if($record.PSObject.Properties[$key]){$identities+=@($record.$key)}}}
 }
 foreach($expected in $identities){Assert-Dead $expected}
 if([Tong024ColdNative]::Active($state.jobName) -ne 0){throw 'HANDOFF_JOB_BUSY'}
 foreach($run in $runs|Select-Object -Unique){if($run -cnotmatch '^[a-f0-9-]{36}$'){throw 'HANDOFF_RUN_DENIED'};foreach($prefix in @('TongRuntime-','TongGuardian-','TongPreflight-launcher-','TongPreflight-guardian-')){if([Tong024ColdNative]::Active('Local\'+$prefix+$run) -ne 0){throw 'HANDOFF_JOB_BUSY'}}}
 $self=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
 # Same explicit simulation boundary as RuntimeSecurity inventory. Production
 # includes ngrok and is NOT supported by this entry, even with a valid grant.
 foreach($p in @(Get-CimInstance Win32_Process)){
  if($p.Name -in @('node.exe','agentdock.exe','TongLoginHost.exe','powershell.exe','pwsh.exe') -and (-not $p.CommandLine -or -not $p.ExecutablePath -or -not $p.CreationDate)){
   # CIM can capture a process while it exits. Only a signaled native process
   # handle or ERROR_INVALID_PARAMETER proves it gone; ACCESS_DENIED is unknown.
   if([Tong024ColdNative]::Gone([int]$p.ProcessId)){continue}
   $script:foreign=@{pid=$p.ProcessId;name=$p.Name;exeReadable=[bool]$p.ExecutablePath;commandLineReadable=[bool]$p.CommandLine};throw 'HANDOFF_INVENTORY_UNKNOWN'
  }
  $belongs=($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -or ($p.CommandLine -and $p.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0)
  if($belongs -and [int]$p.ProcessId -notin @($PID,[int]$self.ParentProcessId)){$script:foreign=Identity $p.ProcessId;throw 'HANDOFF_FOREIGN_PROCESS_PRESENT'}
 }
 # Read the native Windows listener table, including wildcard/IPv6 listeners.
 # A timed-out connect is not proof of absence and is not retried as success.
 try{$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop)}catch{throw 'HANDOFF_PORT_UNKNOWN'}
 foreach($port in @($inputData.profile.gatewayPort,$inputData.profile.upstreamPort,$inputData.profile.agentdockPort)){if(@($listeners|Where-Object LocalPort -eq ([int]$port)).Count -ne 0){throw 'HANDOFF_PORT_BUSY'}}
}
function Checkpoint([string]$Name){@{checkpoint=$Name;sessionId=$state.sessionId;worker=(Identity $PID)}|ConvertTo-Json -Compress;if([Console]::ReadLine() -cne 'continue'){throw 'HANDOFF_RECOVERY_INTERRUPTED'}}
$pins=[Collections.Generic.List[object]]::new();$held=$null;$foreign=$null
try{
 $inputData=[Console]::ReadLine()|ConvertFrom-Json
 $root=[IO.Path]::GetFullPath([string]$inputData.root)
 if($inputData.mode -cne 'production-simulation' -or $root -cnotmatch '^D:\\Tong\\state\\b23-[a-zA-Z0-9_-]+$'){throw 'MAINTENANCE_NOT_READY'}
 if($inputData.profile.root -cne $root -or $inputData.profile.mode -cne $inputData.mode){throw 'HANDOFF_BINDING_DENIED'}
 if($inputData.sessionId -cnotmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' -or $inputData.snapshotSha256 -cnotmatch '^[a-f0-9]{64}$' -or $inputData.gateSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'HANDOFF_BINDING_DENIED'}
 $folder=Join-Path $root ('024-handoff\'+$inputData.sessionId);$gate=Join-Path $root 'run\backup.freeze'
 $manifestFile=Pin (Join-Path $folder 'snapshot.json');$manifest=Bytes $manifestFile
 if((Sha $manifest) -cne $inputData.snapshotSha256){throw 'HANDOFF_SNAPSHOT_CHANGED'}
 $snapshot=[Text.Encoding]::UTF8.GetString($manifest)|ConvertFrom-Json;$state=$snapshot.state
 $originalFile=Pin (Join-Path $folder 'original.freeze');$original=Bytes $originalFile
 if($state.kind -cne 'tong-024-handoff-v1' -or $state.root -cne $root -or $state.sessionId -cne $inputData.sessionId -or $state.profileDigest -cne $inputData.profileDigest -or $state.releaseDigest -cne $inputData.profile.releaseDigest -or $state.jobName -cne ('Local\Tong024Handoff-'+$state.sessionId) -or (Sha $original) -cne $snapshot.originalSha256){throw 'HANDOFF_BINDING_DENIED'}
 if([IO.File]::Exists((Join-Path $folder 'completed.freeze')) -or [IO.File]::Exists((Join-Path $folder 'completed.json'))){throw 'HANDOFF_ALREADY_COMMITTED'}
 Ordinary $gate;$held=[IO.File]::Open($gate,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);Check-File $held $gate
 if([Tong024ColdNative]::FileKey($held.SafeFileHandle.DangerousGetHandle()) -cne $state.fileKey){throw 'HANDOFF_FILE_IDENTITY'}
 $current=Bytes $held;if((Sha $current) -cne $inputData.gateSha256){throw 'HANDOFF_FREEZE_CHANGED'}
 $currentState=$null;try{$currentState=[Text.Encoding]::UTF8.GetString($current)|ConvertFrom-Json}catch{}
 if($null -ne $currentState){
  if(-not $currentState.PSObject.Properties['sessionId'] -or $currentState.sessionId -cne $state.sessionId){throw 'HANDOFF_SESSION_REPLAY'}
  if($currentState.kind -cne $state.kind -or $currentState.fileKey -cne $state.fileKey -or $currentState.root -cne $root -or $currentState.profileDigest -cne $state.profileDigest -or $currentState.releaseDigest -cne $state.releaseDigest){throw 'HANDOFF_BINDING_DENIED'}
  if($currentState.phase -ceq 'completed'){throw 'HANDOFF_ALREADY_COMMITTED'}
 }
 function Authorize {
  $approvalRaw=($inputData.profile|ConvertTo-Json -Depth 10 -Compress)|& 'D:\node\node.exe' (Join-Path $PSScriptRoot 'Tong024ColdRecovery.mjs') --authorize 2>$null
  if($LASTEXITCODE -ne 0){throw 'HANDOFF_AUTH_OR_HEALTH_UNPROVEN'};$approval=$approvalRaw|ConvertFrom-Json
  if($approval.verified -cne $true -or $approval.action -cne 'restore' -or $approval.root -cne $root -or $approval.profileDigest -cne $state.profileDigest){throw 'HANDOFF_BINDING_DENIED'}
 }
 Authorize
 $restoredPath=Join-Path $folder 'restored.json'
 if([IO.File]::Exists($restoredPath)){
  $receiptFile=Pin $restoredPath;$receipt=[Text.Encoding]::UTF8.GetString((Bytes $receiptFile))|ConvertFrom-Json
  if($receipt.sessionId -cne $state.sessionId -or $receipt.fileKey -cne $state.fileKey -or $receipt.originalSha256 -cne (Sha $original)){throw 'HANDOFF_RECEIPT_UNPROVEN'}
  if((Sha $current) -cne (Sha $original)){throw 'HANDOFF_SESSION_REPLAY'}
  Assert-Quiescent;@{phase='already-restored';sessionId=$state.sessionId;fileKey=$state.fileKey}|ConvertTo-Json -Compress;exit 0
 }
 Assert-Quiescent
 $evidence=Join-Path $folder ('cold-'+[guid]::NewGuid().ToString());$null=[IO.Directory]::CreateDirectory($evidence);Ordinary $evidence
 $rawFile=Seal (Join-Path $evidence 'gate.original.bytes') $current
 $intentBytes=[Text.Encoding]::UTF8.GetBytes((@{worker=(Identity $PID);action='restore';root=$root;profileDigest=$state.profileDigest;snapshotSha256=(Sha $manifest);gateSha256=(Sha $current);fileKey=$state.fileKey;originalSha256=(Sha $original)}|ConvertTo-Json -Depth 5 -Compress))
 $intentFile=Seal (Join-Path $evidence 'approval.json') $intentBytes
 Checkpoint 'cold-sealed'
 Assert-Quiescent
 Authorize
 foreach($pin in $pins){Check-File $pin.file $pin.path};Check-File $held $gate
 if((Sha (Bytes $manifestFile)) -cne (Sha $manifest) -or (Sha (Bytes $originalFile)) -cne (Sha $original) -or (Sha (Bytes $rawFile)) -cne (Sha $current) -or (Sha (Bytes $intentFile)) -cne (Sha $intentBytes)){throw 'HANDOFF_SNAPSHOT_CHANGED'}
 $held.Position=0;$held.Write($original,0,$original.Length);$held.SetLength($original.Length);$held.Flush($true)
 Checkpoint 'cold-written'
 $null=Seal $restoredPath ([Text.Encoding]::UTF8.GetBytes((@{sessionId=$state.sessionId;fileKey=$state.fileKey;originalSha256=(Sha $original);coldEvidence=$evidence}|ConvertTo-Json -Compress)))
 @{sessionId=$state.sessionId;phase='cold-restored';fileKey=$state.fileKey;evidence=$evidence;originalSha256=(Sha $original)}|ConvertTo-Json -Compress
}catch{$failure=$_.Exception;while($failure.InnerException){$failure=$failure.InnerException};$code=if($failure.Message -cmatch '^[A-Z][A-Z0-9_]{1,63}$'){$failure.Message}else{'HANDOFF_NATIVE_REFUSED'};[Console]::Error.WriteLine((@{error=$code;foreign=$foreign}|ConvertTo-Json -Compress));exit 2}
finally{if($null -ne $held){$held.Dispose()};foreach($pin in $pins){$pin.file.Dispose()}}
