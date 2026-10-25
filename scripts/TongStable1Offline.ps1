param(
 [Parameter(Mandatory)][ValidateSet('InspectIsolation','CaptureProduction','CaptureIsolation','Verify','RestoreIsolation','RestoreShadow','InstallIsolation','ArchiveIsolation')][string]$Mode,
 [string]$Snapshot,[string]$ExpectedSeal,
 [ValidateSet('none','app-half','manager-files','bindings')][string]$InterruptAt='none',
 [ValidateRange(0,2500000000)][long]$ResourceBudgetBytes=0
)
# Fixed 024 -> 37dc649 offline file operation. No service/task controls, no
# Manager imports, no production write mode, no automatic freeze retirement.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$case='tong-024-to-37dc649-once-20261025'
$fixture='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a'
$ops=Join-Path $fixture 'offline-9850e1a'
$oldCommit='024d5b0920d9ad8f1a2baf2e55640a5666ad4739'
$newCommit='37dc649c46ad0e267c3471f750b97227cf106310'
$release='D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-37dc649'
$entropy=[Text.Encoding]::UTF8.GetBytes($case)
function Sha([byte[]]$Bytes){return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()}
function File-Sha([string]$Path){$s=[IO.File]::OpenRead($Path);try{return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant()}finally{$s.Dispose()}}
function Ordinary([string]$Path){$p=[IO.Path]::GetFullPath($Path);while($p){if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'OFFLINE_LINK_DENIED'};$p=[IO.Path]::GetDirectoryName($p)}}
function Private([string]$Path){Ordinary $Path;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allow=@($sid,'S-1-5-18','S-1-5-32-544');$acl=Get-Acl -LiteralPath $Path;if(-not $acl.AreAccessRulesCanonical -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allow){throw 'OFFLINE_ACL_DENIED'};foreach($a in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($a.AccessControlType -eq 'Allow' -and $a.IdentityReference.Value -notin $allow){throw 'OFFLINE_ACL_DENIED'}}}
function Member([string]$Base,[string]$Name){if(-not $Name -or $Name.Contains('\') -or $Name.Contains(':') -or $Name.StartsWith('/') -or @($Name.Split('/')|Where-Object {$_ -in @('','..','.') -or $_ -match '[<>"|?*\x00-\x1f]' -or $_ -match '[. ]$' -or $_ -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)'}).Count){throw 'OFFLINE_PATH_DENIED'};$p=[IO.Path]::GetFullPath((Join-Path $Base $Name.Replace('/','\')));if(-not $p.StartsWith($Base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'OFFLINE_PATH_DENIED'};return $p}
function Durable([string]$Path,[byte[]]$Bytes){$f=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$f.Write($Bytes);$f.Flush($true)}finally{$f.Dispose()}}
function Reply($Value){$Value|ConvertTo-Json -Depth 10 -Compress}
function Assert-IsolationQuiescent {
 $proof=& D:\node\node.exe (Join-Path $PSScriptRoot 'TongStable1OfflineProbe.mjs')
 if($LASTEXITCODE -ne 0 -or -not ($proof|ConvertFrom-Json).quiescent){throw 'OFFLINE_NATIVE_QUIESCENCE_DENIED'}
 $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folders=[Collections.Generic.Stack[object]]::new();$folders.Push($scheduler.GetFolder('\'))
 while($folders.Count){$f=$folders.Pop();foreach($task in $f.GetTasks(1)){if($task.Xml.IndexOf($fixture,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and ($task.Enabled -or @($task.GetInstances(0)).Count)){throw 'OFFLINE_TASK_STILL_ARMED'}};foreach($child in $f.GetFolders(0)){$folders.Push($child)}}
}
Private $fixture
if(-not [IO.Directory]::Exists($ops)){$null=[IO.Directory]::CreateDirectory($ops)};Private $ops
if(-not $Snapshot -or [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Snapshot)) -ine $ops -or [IO.Path]::GetFileName($Snapshot) -notmatch '^(production|isolation)-[a-f0-9-]{36}$'){throw 'OFFLINE_SNAPSHOT_SCOPE_DENIED'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class TongStable1File {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint a,c1,c2,t1,t2,w1,w2,v,s1,s2,links,i1,i2;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(IntPtr h,out Info f);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder b,uint n,uint flags);
 public static string Key(IntPtr h){Info f;if(!GetFileInformationByHandle(h,out f)||f.links!=1)throw new Exception("OFFLINE_FILE_ID_DENIED");return f.v+":"+f.i1+":"+f.i2;}
 public static string Path(IntPtr h){var b=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,b,32768,0);if(n==0||n>=32768)throw new Exception("OFFLINE_FINAL_PATH_DENIED");return b.ToString().Substring(4);}
}
'@
function Check-Handle($File,[string]$Path){if([TongStable1File]::Path($File.SafeFileHandle.DangerousGetHandle()) -ine $Path){throw 'OFFLINE_FINAL_PATH_DENIED'};return [TongStable1File]::Key($File.SafeFileHandle.DangerousGetHandle())}
function Groups([string]$Scope){
 if($Scope -eq 'production'){$r='D:\Tong\runtime';$app='D:\Tong\app';$config='C:\Users\Rune\.devspace';$oauth='C:\Users\Rune\.local\share\devspace'}
 elseif($Scope -eq 'isolation'){$r=$fixture;$app=Join-Path $r 'tong';$config=Join-Path $app 'home\.devspace';$oauth=Join-Path $app 'oauth'}else{throw 'OFFLINE_SCOPE_DENIED'}
 $g=[ordered]@{app=$app;manager=(Join-Path $r 'releases\manager');control=(Join-Path $r 'run');secrets=(Join-Path $r 'secrets');policy=(Join-Path $r 'tong-policy');backend=(Join-Path $r 'backend-state');monitor=(Join-Path $r 'login-management');logs=(Join-Path $r 'logs');config=$config;oauth=$oauth}
 # config/oauth are already included in the simulated app, but are distinct
 # external production locations. Never snapshot the same path twice.
 if($Scope -eq 'isolation'){$g.Remove('config');$g.Remove('oauth')}
 return $g
}
function Inventory($Groups,[switch]$AllBinding){
 $result=[Collections.Generic.List[object]]::new()
 foreach($group in $Groups.Keys){$base=$Groups[$group];if(-not [IO.Directory]::Exists($base)){continue};Ordinary $base
  if($group -eq 'binding' -and -not $AllBinding){foreach($name in @('profile.json','production-root.json')){$p=Join-Path $base $name;if([IO.File]::Exists($p)){$result.Add(@{group=$group;name=$name;path=$p;size=([IO.FileInfo]::new($p)).Length})}};continue}
  $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($base)
  while($pending.Count){$dir=$pending.Pop();foreach($item in [IO.DirectoryInfo]::new($dir).EnumerateFileSystemInfos()){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OFFLINE_LINK_DENIED'};if($item -is [IO.DirectoryInfo]){$pending.Push($item.FullName)}else{$rel=[IO.Path]::GetRelativePath($base,$item.FullName).Replace('\','/');$null=Member $base $rel;$result.Add(@{group=$group;name=$rel;path=$item.FullName;size=$item.Length})}}}
 }
 return @($result.ToArray()|Sort-Object group,name)
}
$handles=[Collections.Generic.List[IDisposable]]::new();$gate=$null;$zip=$null;$memory=$null;$aes=$null;$raw=$null;$crypto=$null
try{
 if($Mode -eq 'InspectIsolation'){Assert-IsolationQuiescent;Reply @{operation='inspected';quiescent=$true;productionWrite=$false};exit 0}
 if($Mode -in @('CaptureProduction','CaptureIsolation')){
  $scope=if($Mode -eq 'CaptureProduction'){'production'}else{'isolation'};$r=if($scope -eq 'production'){'D:\Tong\runtime'}else{$fixture};$groups=Groups $scope
  if($scope -eq 'isolation'){Assert-IsolationQuiescent}
  $profile=[IO.File]::ReadAllBytes((Join-Path $r 'profile.json'));$pin=[IO.File]::ReadAllBytes((Join-Path $r 'run\release-pin.json'));$managerPin=[IO.File]::ReadAllBytes((Join-Path $r 'run\manager-pin.json'))
  if(([Text.Encoding]::UTF8.GetString($pin)|ConvertFrom-Json -AsHashtable).commit -cne $oldCommit -or (Sha $pin) -cne (Sha $managerPin)){throw 'OFFLINE_BASELINE_DENIED'}
  $gatePath=Join-Path $r 'run\backup.freeze';Ordinary $gatePath;$gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$gateKey=Check-Handle $gate $gatePath
  $files=[Collections.Generic.List[object]]::new();foreach($f in (Inventory $groups)){$files.Add($f)}
  foreach($extra in @(@{group='binding';name='profile.json';path=(Join-Path $r 'profile.json')},@{group='binding';name='production-root.json';path=(Join-Path $r 'production-root.json')})){$files.Add($extra)}
  if($scope -eq 'production'){
   $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$initialTaskXml=$scheduler.GetFolder('\').GetTask('TongLoginRuntime').Xml
   foreach($item in @(@{group='node';name='node.exe';path='D:\node\node.exe'},@{group='ngrok';name='ngrok-service.yml';path='D:\Tong\state\ngrok-service.yml'})){$files.Add($item)}
   $nativeGroups=[ordered]@{agentdock='D:\Tong\runtime\agentdock'};foreach($item in (Inventory $nativeGroups)){$files.Add($item)}
  }
  # Open every source before reading any payload. All are read/share-read only;
  # no source, credential, task, policy or service is modified by capture.
  foreach($f in $files){Ordinary $f.path;$h=[IO.File]::Open($f.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$handles.Add($h);$f.handle=$h;$f.fileKey=Check-Handle $h $f.path}
  if([IO.Directory]::Exists($Snapshot)){throw 'OFFLINE_DESTINATION_EXISTS'};$null=[IO.Directory]::CreateDirectory($Snapshot);Private $Snapshot
  $key=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$iv=[Security.Cryptography.RandomNumberGenerator]::GetBytes(16);$aes=[Security.Cryptography.Aes]::Create();$aes.Key=$key;$aes.IV=$iv
  $raw=[IO.File]::Open((Join-Path $Snapshot 'payload.aes'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $crypto=[Security.Cryptography.CryptoStream]::new($raw,$aes.CreateEncryptor(),[Security.Cryptography.CryptoStreamMode]::Write,$true)
  $zip=[IO.Compression.ZipArchive]::new($crypto,[IO.Compression.ZipArchiveMode]::Create,$true)
  $seen=[Collections.Generic.HashSet[string]]::new();$records=[Collections.Generic.List[object]]::new();[long]$logicalBytes=0
  foreach($f in $files){$h=$f.handle;$h.Position=0;$digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($h)).ToLowerInvariant();$h.Position=0;$logicalBytes+=$h.Length
   if($seen.Add($digest)){$entry=$zip.CreateEntry('blobs/'+$digest,[IO.Compression.CompressionLevel]::Optimal);$s=$entry.Open();try{$h.CopyTo($s)}finally{$s.Dispose()}}
   $records.Add(@{group=$f.group;name=$f.name;sha256=$digest;size=$h.Length;fileKey=$f.fileKey})
   if($raw.Position -gt 536870912){throw 'OFFLINE_RESOURCE_LIMIT'}
  }
  # Export external monitor/service configuration into the encrypted payload.
  $external=@{}
  if($scope -eq 'production'){$external.taskXml=$scheduler.GetFolder('\').GetTask('TongLoginRuntime').Xml;if($external.taskXml -cne $initialTaskXml){throw 'OFFLINE_TASK_CHANGED'};$external.ngrokService=(Get-CimInstance Win32_Service -Filter "Name='ngrok'"|Select-Object Name,StartMode,StartName,PathName,State,ProcessId)}
  $zip.Dispose();$zip=$null;$crypto.FlushFinalBlock();$crypto.Dispose();$crypto=$null;$raw.Flush($true);$raw.Dispose();$raw=$null
  $again=Inventory $groups;if((($again|ForEach-Object {$_.group+'/'+$_.name}) -join "`n") -cne (($files|Where-Object {$groups.Contains($_.group)}|Sort-Object group,name|ForEach-Object {$_.group+'/'+$_.name}) -join "`n")){throw 'OFFLINE_SOURCE_SET_CHANGED'}
  foreach($f in $files){if((Check-Handle $f.handle $f.path) -cne $f.fileKey){throw 'OFFLINE_SOURCE_ID_CHANGED'}}
  $metadata=@{case=$case;scope=$scope;root=$r;baseline=$oldCommit;target=$newCommit;records=$records.ToArray();key=[Convert]::ToBase64String($key);iv=[Convert]::ToBase64String($iv);gateFileKey=$gateKey;profileSha256=(Sha $profile);external=$external;archiveSha256=(File-Sha (Join-Path $Snapshot 'payload.aes'))}
  $plain=[Text.Encoding]::UTF8.GetBytes(($metadata|ConvertTo-Json -Depth 9 -Compress));$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Array]::Clear($plain)
  Durable (Join-Path $Snapshot 'manifest.dpapi') $protected
  $header=[ordered]@{case=$case;scope=$scope;baseline=$oldCommit;target=$newCommit;createdAt=[DateTime]::UtcNow.ToString('o');fileCount=$records.Count;uniqueBlobs=$seen.Count;logicalBytes=$logicalBytes;archiveBytes=([IO.FileInfo]::new((Join-Path $Snapshot 'payload.aes'))).Length;archiveSha256=$metadata.archiveSha256;manifestSha256=(Sha $protected);productionWriteAllowed=$false;startupInventoryProven=$false}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($header|ConvertTo-Json -Compress));Durable (Join-Path $Snapshot 'seal.json') $bytes
  Reply @{operation='captured';snapshot=$Snapshot;seal=(Sha $bytes);scope=$scope;files=$records.Count;uniqueBlobs=$seen.Count;logicalBytes=$logicalBytes;archiveBytes=$header.archiveBytes;gateFileKey=$gateKey;sourceWrite=$false;offlineEntryClosureProven=$false};exit 0
 }
 if($ExpectedSeal -cnotmatch '^[a-f0-9]{64}$'){throw 'OFFLINE_EXPECTED_SEAL_REQUIRED'};Private $Snapshot
 $headerBytes=[IO.File]::ReadAllBytes((Join-Path $Snapshot 'seal.json'));if((Sha $headerBytes) -cne $ExpectedSeal){throw 'OFFLINE_SEAL_CHANGED'};$header=[Text.Encoding]::UTF8.GetString($headerBytes)|ConvertFrom-Json -AsHashtable
 if($header.case -cne $case -or $header.baseline -cne $oldCommit -or $header.target -cne $newCommit){throw 'OFFLINE_CASE_DENIED'}
 if($Mode -in @('RestoreIsolation','InstallIsolation','ArchiveIsolation') -and ($header.scope -cne 'isolation')){throw 'OFFLINE_PRODUCTION_WRITE_DENIED'}
 if((File-Sha (Join-Path $Snapshot 'manifest.dpapi')) -cne $header.manifestSha256 -or (File-Sha (Join-Path $Snapshot 'payload.aes')) -cne $header.archiveSha256){throw 'OFFLINE_BACKUP_CHANGED'}
 $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $Snapshot 'manifest.dpapi')),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $m=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json -AsHashtable;[Array]::Clear($plain)
 if($m.case -cne $case -or $m.scope -cne $header.scope -or $m.archiveSha256 -cne $header.archiveSha256 -or $m.baseline -cne $oldCommit -or $m.target -cne $newCommit){throw 'OFFLINE_MANIFEST_DENIED'}
 $aes=[Security.Cryptography.Aes]::Create();$aes.Key=[Convert]::FromBase64String($m.key);$aes.IV=[Convert]::FromBase64String($m.iv);$raw=[IO.File]::OpenRead((Join-Path $Snapshot 'payload.aes'));$crypto=[Security.Cryptography.CryptoStream]::new($raw,$aes.CreateDecryptor(),[Security.Cryptography.CryptoStreamMode]::Read)
 $memory=[IO.MemoryStream]::new();$crypto.CopyTo($memory);$memory.Position=0;$zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
 $expected=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($rec in $m.records){if($rec.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $rec.size -lt 0 -or $rec.size -gt 536870912){throw 'OFFLINE_RECORD_DENIED'};$id=$rec.group+'/'+$rec.name;if($expected.ContainsKey($id)){throw 'OFFLINE_DUPLICATE'};$expected.Add($id,$rec)}
 $verified=[Collections.Generic.HashSet[string]]::new();foreach($rec in $m.records){if($verified.Add($rec.sha256)){$entry=$zip.GetEntry('blobs/'+$rec.sha256);if(-not $entry -or $entry.Length -ne $rec.size){throw 'OFFLINE_BLOB_DENIED'};$s=$entry.Open();try{if([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant() -cne $rec.sha256){throw 'OFFLINE_BLOB_CHANGED'}}finally{$s.Dispose()}}}
 if($zip.Entries.Count -ne $verified.Count){throw 'OFFLINE_EXTRA_BLOB'}
 if($Mode -eq 'Verify'){
  $counts=@{};foreach($rec in $m.records){if(-not $counts.ContainsKey($rec.group)){$counts[$rec.group]=0};$counts[$rec.group]++}
  Reply @{operation='verified';scope=$header.scope;files=$expected.Count;uniqueBlobs=$verified.Count;seal=$ExpectedSeal;currentUserDpapi=$true;fullPayloadAuthenticated=$true;gateFileKey=$m.gateFileKey;groups=$counts;externalMonitorConfigIncluded=($m.external.Count -gt 0)};exit 0
 }
 if($Mode -eq 'RestoreShadow'){
  # A full, NO-ACTIVATION materialization of the actual production snapshot.
  # Every destination is a literal child of this private shadow directory;
  # original absolute paths and task/service definitions are never applied.
  if($m.scope -cne 'production' -or $m.root -cne 'D:\Tong\runtime'){throw 'OFFLINE_SHADOW_SOURCE_DENIED'}
  if($ResourceBudgetBytes -ne 2500000000){throw 'OFFLINE_RESOURCE_APPROVAL_REQUIRED'}
  $shadow=Join-Path $ops 'production-shadow';$leasePath=Join-Path $ops 'production-shadow-lease.json'
  $dest=[ordered]@{};foreach($group in @('app','manager','control','secrets','policy','backend','monitor','logs','config','oauth','node','ngrok','agentdock','binding')){$dest[$group]=Join-Path $shadow $group}
  foreach($rec in $m.records){if(-not $dest.Contains($rec.group)){throw 'OFFLINE_SHADOW_GROUP_DENIED'};$null=Member $dest[$rec.group] $rec.name}
  [long]$allocated=0;foreach($file in [IO.Directory]::EnumerateFiles($ops,'*',[IO.SearchOption]::AllDirectories)){$allocated+=([IO.FileInfo]::new($file)).Length};[long]$written=0
  if(-not [IO.Directory]::Exists($shadow)){
   if([IO.File]::Exists($leasePath)){throw 'OFFLINE_SHADOW_LEASE_CONFLICT'};$null=[IO.Directory]::CreateDirectory((Join-Path $shadow 'control'));Private $shadow
   $gatePath=Join-Path $shadow 'control\backup.freeze';Durable $gatePath ([byte[]]@());$gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);$gateKey=Check-Handle $gate $gatePath
   Durable $leasePath ([Text.Encoding]::UTF8.GetBytes((@{case=$case;seal=$ExpectedSeal;gateFileKey=$gateKey;noActivation=$true;resourceBudgetBytes=$ResourceBudgetBytes}|ConvertTo-Json -Compress)))
  }else{
   Private $shadow;$lease=Get-Content -LiteralPath $leasePath -Raw|ConvertFrom-Json;if($lease.case -cne $case -or $lease.seal -cne $ExpectedSeal -or -not $lease.noActivation){throw 'OFFLINE_SHADOW_LEASE_DENIED'}
   $gatePath=Join-Path $shadow 'control\backup.freeze';$gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);$gateKey=Check-Handle $gate $gatePath;if($gateKey -cne $lease.gateFileKey){throw 'OFFLINE_SHADOW_GATE_CHANGED'}
  }
  $retired=Join-Path $ops ('shadow-retired-'+[guid]::NewGuid());$null=[IO.Directory]::CreateDirectory($retired)
  function Shadow-Retire([string]$Path,[string]$Group,[string]$Name){$to=Member (Join-Path $retired $Group) $Name;$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to));Ordinary $Path;[IO.File]::Move($Path,$to)}
  foreach($f in (Inventory $dest -AllBinding)){if(-not $expected.ContainsKey($f.group+'/'+$f.name)){Shadow-Retire $f.path $f.group $f.name}}
  $parents=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$count=0
  foreach($rec in $m.records){$path=Member $dest[$rec.group] $rec.name
   if($rec.group -eq 'control' -and $rec.name -eq 'backup.freeze'){if($rec.size -ne 0 -or $gate.Length -ne 0){throw 'OFFLINE_SHADOW_GATE_BYTES_DENIED'}}
   elseif(-not [IO.File]::Exists($path) -or (File-Sha $path) -cne $rec.sha256){
    if($allocated+$written+$rec.size+$header.fileCount*4096+67108864 -gt $ResourceBudgetBytes){throw 'OFFLINE_RESOURCE_LIMIT'}
    $parent=[IO.Path]::GetDirectoryName($path);if($parents.Add($parent)){$null=[IO.Directory]::CreateDirectory($parent);Ordinary $parent}
    if([IO.File]::Exists($path)){Shadow-Retire $path $rec.group $rec.name}
    $input=$zip.GetEntry('blobs/'+$rec.sha256).Open();$output=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$input.CopyTo($output);$output.Flush($true)}finally{$input.Dispose();$output.Dispose()};$written+=$rec.size
    if((File-Sha $path) -cne $rec.sha256){throw 'OFFLINE_SHADOW_WRITE_CHANGED'}
   }
   $count++;if($count%10000 -eq 0){Reply @{operation='shadow-progress';verifiedFiles=$count;total=$expected.Count}}
  }
  $actual=Inventory $dest -AllBinding;if($actual.Count -ne $expected.Count){throw 'OFFLINE_SHADOW_SET_CHANGED'}
  foreach($f in $actual){if(-not $expected.ContainsKey($f.group+'/'+$f.name)){throw 'OFFLINE_SHADOW_SET_CHANGED'}}
  if((Check-Handle $gate $gatePath) -cne $gateKey){throw 'OFFLINE_SHADOW_GATE_CHANGED'}
  if(-not $m.external.taskXml -or $m.external.ngrokService.Name -cne 'ngrok'){throw 'OFFLINE_EXTERNAL_CONFIG_MISSING'}
  Reply @{operation='shadow-restored';workerPid=$PID;files=$count;seal=$ExpectedSeal;shadow=$shadow;gateFileKey=$gateKey;allCapturedBytesVerified=$true;managerImported=$false;productionWrite=$false;taskServiceDefinitionsApplied=$false;externalConfigRecovered=$true;taskXmlSha256=(Sha ([Text.Encoding]::UTF8.GetBytes($m.external.taskXml)));noActivation=$true;newBytesWritten=$written;retired=$retired;resourceBudgetBytes=$ResourceBudgetBytes};exit 0
 }
 if($m.root -cne $fixture){throw 'OFFLINE_ROOT_DENIED'};$groups=Groups 'isolation';$groups['binding']=$fixture
 foreach($rec in $m.records){if(-not $groups.Contains($rec.group) -or $rec.group -eq 'binding' -and $rec.name -notin @('profile.json','production-root.json')){throw 'OFFLINE_GROUP_DENIED'};$null=Member $groups[$rec.group] $rec.name}
 Assert-IsolationQuiescent
 $gatePath=Join-Path $fixture 'run\backup.freeze'
 if($Mode -eq 'RestoreIsolation' -and -not [IO.File]::Exists($gatePath)){
  # Only a previously sealed isolation archive may return its ORIGINAL file.
  # Do not create a replacement freeze or accept an unrelated file identity.
  $candidates=@([IO.Directory]::EnumerateDirectories($ops,'start-*')|Where-Object {[IO.File]::Exists((Join-Path $_ 'backup.freeze'))})
  if($candidates.Count -ne 1){throw 'OFFLINE_ARCHIVED_GATE_REQUIRED'};$archive=$candidates[0]
  $index=Get-Content -LiteralPath (Join-Path $archive 'index.json') -Raw|ConvertFrom-Json
  if($index.seal -cne $ExpectedSeal -or $index.gateFileKey -cne $m.gateFileKey){throw 'OFFLINE_ARCHIVE_BINDING_DENIED'}
  $original=Join-Path $archive 'backup.freeze';Ordinary $original;$h=[IO.File]::OpenRead($original)
  try{if((Check-Handle $h $original) -cne $m.gateFileKey -or $h.Length -ne 0){throw 'OFFLINE_ARCHIVED_GATE_CHANGED'}}finally{$h.Dispose()}
  [IO.File]::Move($original,$gatePath)
 }
 $gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);$gateKey=Check-Handle $gate $gatePath;if($gateKey -cne $m.gateFileKey){throw 'OFFLINE_GATE_ID_CHANGED'}
 # The stopped fixture is independently checked by the driver before invoking
 # this operation. A persistent old gate blocks all ordinary Manager starts.
 $retired=Join-Path $ops ('retired-'+[guid]::NewGuid());$null=[IO.Directory]::CreateDirectory($retired)
 function Retire([string]$Path,[string]$Group,[string]$Name){$to=Member (Join-Path $retired $Group) $Name;$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to));Ordinary $Path;[IO.File]::Move($Path,$to)}
 function Put([string]$Path,[byte[]]$Bytes,[string]$Group,[string]$Name){$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path));Ordinary ([IO.Path]::GetDirectoryName($Path));if([IO.File]::Exists($Path)){if((File-Sha $Path) -ceq (Sha $Bytes)){return};Retire $Path $Group $Name};Durable $Path $Bytes}
 if($Mode -eq 'ArchiveIsolation'){
  $currentPin=Get-Content -LiteralPath (Join-Path $fixture 'run\release-pin.json') -Raw|ConvertFrom-Json
  if($currentPin.commit -cne $newCommit -or $gate.Length -ne 0 -or (File-Sha (Join-Path $fixture 'run\release-pin.json')) -cne '164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0'){throw 'OFFLINE_START_BINDING_DENIED'}
  foreach($group in @('app','manager')){foreach($f in @($currentPin.sourceFiles)+@($currentPin.native)){if((File-Sha (Member $groups[$group] $f.path)) -cne $f.sha256){throw 'OFFLINE_INSTALLED_SOURCE_CHANGED'}};foreach($name in $currentPin.expectedDevspaceHashes.PSObject.Properties.Name){if((File-Sha (Member $groups[$group] ('node_modules/@waishnav/devspace/dist/'+$name))) -cne $currentPin.expectedDevspaceHashes.$name){throw 'OFFLINE_INSTALLED_PATCH_CHANGED'}}}
  $archive=Join-Path $ops ('start-'+[guid]::NewGuid());$null=[IO.Directory]::CreateDirectory($archive);$recordList=[Collections.Generic.List[object]]::new()
  foreach($f in (Inventory ([ordered]@{control=(Join-Path $fixture 'run')}))){if($f.name -in @('backup.freeze','release-pin.json','manager-pin.json','login-recovery-budget.json')){continue};$original=$expected['control/'+$f.name];if(-not $original -or (File-Sha $f.path) -cne $original.sha256){throw 'OFFLINE_CONTROL_CHANGED'};$recordList.Add(@{name=$f.name;sha256=$original.sha256})}
  Durable (Join-Path $archive 'index.json') ([Text.Encoding]::UTF8.GetBytes((@{case=$case;seal=$ExpectedSeal;gateFileKey=$gateKey;source=$newCommit;scope='isolation';records=$recordList.ToArray();productionReady=$false}|ConvertTo-Json -Depth 5 -Compress)))
  foreach($f in $recordList){[IO.File]::Move((Join-Path $fixture ('run\'+$f.name)),(Member $archive $f.name))}
  # This close/move boundary is intentionally NOT offered for production.
  # The fixed isolated test has no armed task and has native quiescence proof;
  # it does not establish a race-free production handoff for unmodified v1.
  $gate.Dispose();$gate=$null;[IO.File]::Move($gatePath,(Join-Path $archive 'backup.freeze'))
  $h=[IO.File]::OpenRead((Join-Path $archive 'backup.freeze'));try{if((Check-Handle $h (Join-Path $archive 'backup.freeze')) -cne $gateKey){throw 'OFFLINE_GATE_ID_CHANGED'}}finally{$h.Dispose()}
  Reply @{operation='archived-isolation-controls';archive=$archive;seal=$ExpectedSeal;gateFileKey=$gateKey;originalFilePreserved=$true;productionHandoffProven=$false};exit 0
 }
 if($Mode -eq 'RestoreIsolation'){
  foreach($f in (Inventory $groups)){if($f.group -eq 'binding' -and $f.name -notin @('profile.json','production-root.json')){continue};if(-not $expected.ContainsKey($f.group+'/'+$f.name)){Retire $f.path $f.group $f.name}}
  foreach($rec in $m.records){if(-not $groups.Contains($rec.group)){throw 'OFFLINE_GROUP_DENIED'};$path=Member $groups[$rec.group] $rec.name
   if($rec.group -eq 'control' -and $rec.name -eq 'backup.freeze'){continue};if([IO.File]::Exists($path) -and (File-Sha $path) -ceq $rec.sha256){continue}
   $s=$zip.GetEntry('blobs/'+$rec.sha256).Open();$buffer=[IO.MemoryStream]::new();try{$s.CopyTo($buffer);Put $path $buffer.ToArray() $rec.group $rec.name}finally{$s.Dispose();[Array]::Clear($buffer.GetBuffer());$buffer.Dispose()}
  }
  $freeze=$expected['control/backup.freeze'];if(-not $freeze -or $freeze.size -ne 0){throw 'OFFLINE_GATE_PREIMAGE_DENIED'};$gate.SetLength(0);$gate.Flush($true)
  foreach($rec in $m.records){if($rec.group -eq 'control' -and $rec.name -eq 'backup.freeze'){continue};if((File-Sha (Member $groups[$rec.group] $rec.name)) -cne $rec.sha256){throw 'OFFLINE_RESTORE_VERIFY_FAILED'}}
  if((Check-Handle $gate $gatePath) -cne $gateKey){throw 'OFFLINE_GATE_ID_CHANGED'}
  Reply @{operation='restored';scope='isolation';workerPid=$PID;files=$expected.Count;gateFileKey=$gateKey;gatePreserved=$true;allOriginalBytesVerified=$true;retired=$retired;managerImported=$false;productionWrite=$false};exit 0
 }
 # Install only original version-1 files; no startup or online handoff occurs.
 $pinBytes=[IO.File]::ReadAllBytes((Join-Path $release 'release-manifest.json'));if((Sha $pinBytes) -cne '164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0'){throw 'OFFLINE_RELEASE_DENIED'};$pin=[Text.Encoding]::UTF8.GetString($pinBytes)|ConvertFrom-Json -AsHashtable
 $n=0;foreach($group in @('app','manager')){
  $paths=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($f in $pin.sourceFiles){$paths.Add($f.path)|Out-Null;$bytes=[IO.File]::ReadAllBytes((Member (Join-Path $release 'code\source') $f.path));if((Sha $bytes) -cne $f.sha256){throw 'OFFLINE_RELEASE_CHANGED'};Put (Member $groups[$group] $f.path) $bytes $group $f.path;$n++;if($group -eq 'app' -and $n -eq 135 -and $InterruptAt -eq 'app-half'){exit 71}}
  foreach($f in $pin.native){$bytes=[IO.File]::ReadAllBytes((Member (Join-Path $release 'native') $f.path));if((Sha $bytes) -cne $f.sha256){throw 'OFFLINE_NATIVE_CHANGED'};Put (Member $groups[$group] $f.path) $bytes $group $f.path}
  # Remove only old release source names absent from the exact new manifest.
  $baselineEntry=$expected['control/release-pin.json'];$s=$zip.GetEntry('blobs/'+$baselineEntry.sha256).Open();$reader=[IO.StreamReader]::new($s);try{$oldPin=$reader.ReadToEnd()|ConvertFrom-Json -AsHashtable}finally{$reader.Dispose()}
  foreach($f in $oldPin.sourceFiles){if(-not $paths.Contains($f.path) -and [IO.File]::Exists((Member $groups[$group] $f.path))){Retire (Member $groups[$group] $f.path) $group $f.path}}
  foreach($name in $pin.expectedDevspaceHashes.Keys){$rel='node_modules/@waishnav/devspace/dist/'+$name;$bytes=[IO.File]::ReadAllBytes((Member 'D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-37dc649' $rel));if((Sha $bytes) -cne $pin.expectedDevspaceHashes[$name]){throw 'OFFLINE_PATCH_CHANGED'};Put (Member $groups[$group] $rel) $bytes $group $rel}
 }
 if($InterruptAt -eq 'manager-files'){exit 71}
 foreach($name in @('release-pin.json','manager-pin.json')){Put (Join-Path $fixture ('run\'+$name)) $pinBytes 'control' $name}
 $profile=Get-Content -LiteralPath (Join-Path $fixture 'profile.json') -Raw|ConvertFrom-Json -AsHashtable;$profile.sourceDigest=($pin.files|Where-Object path -eq 'code/source.tar').sha256;$profile.releaseDigest=Sha $pinBytes
 Put (Join-Path $fixture 'profile.json') ([Text.Encoding]::UTF8.GetBytes(($profile|ConvertTo-Json -Compress))) 'binding' 'profile.json'
 if($InterruptAt -eq 'bindings'){exit 71}
 $monitorSource=Join-Path $fixture 'monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
 if((File-Sha $monitorSource) -cne '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718'){throw 'OFFLINE_EXTERNAL_HOST_CHANGED'}
 Put (Join-Path $groups.monitor 'TongLoginHost.exe') ([IO.File]::ReadAllBytes($monitorSource)) 'monitor' 'TongLoginHost.exe'
 $runner=[IO.File]::ReadAllText((Join-Path $release 'code\source\scripts\TongLoginRuntime.ps1'))
 $runner=$runner.Replace("`$runtime='D:\Tong\runtime'","`$runtime='$fixture'").Replace('Local\TongLoginRuntime-','Local\TongStable1Offline-')
 Put (Join-Path $groups.monitor 'TongLoginRuntime.ps1') ([Text.Encoding]::UTF8.GetBytes($runner)) 'monitor' 'TongLoginRuntime.ps1'
 Reply @{operation='installed';scope='isolation';target=$newCommit;gatePreserved=$true;gateFileKey=$gateKey;retired=$retired;managerImported=$false;productionWrite=$false}
}finally{
 if($zip){$zip.Dispose()};if($crypto){$crypto.Dispose()};if($raw){$raw.Dispose()};if($aes){$aes.Dispose()};if($memory){[Array]::Clear($memory.GetBuffer());$memory.Dispose()};foreach($h in $handles){$h.Dispose()};if($gate){$gate.Dispose()}
}
