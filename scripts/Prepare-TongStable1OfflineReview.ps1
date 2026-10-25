param([switch]$EmitPrivatePacket)
# Read-only production inspection and ONE fixed private metadata packet.
# This is not an installer: no production file/task/service write is offered.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($PSVersionTable.PSVersion.Major -lt 7){throw 'REQUIRES_PS7'}
$ops='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a'
$snapshot=Join-Path $ops 'production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956'
$shadow=Join-Path $ops 'production-shadow';$packet=Join-Path $ops 'offline-last-3f6dabd'
$release='D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-37dc649'
$patchRoot='D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-37dc649'
$hostSource='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
$seal='db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f'
$one='37dc649c46ad0e267c3471f750b97227cf106310';$two='024d5b0920d9ad8f1a2baf2e55640a5666ad4739'
$oneDigest='164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0'
$user=[Security.Principal.WindowsIdentity]::GetCurrent();$sid=$user.User.Value
function Hash([byte[]]$Bytes){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()}
function FileHash([string]$Path){$f=[IO.File]::OpenRead($Path);try{[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($f)).ToLowerInvariant()}finally{$f.Dispose()}}
function NoLink([string]$Path){$p=[IO.Path]::GetFullPath($Path);while($p){if([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint){throw 'LINK_REFUSED'};$p=[IO.Path]::GetDirectoryName($p)}}
function Private([string]$Path){NoLink $Path;$a=Get-Acl -LiteralPath $Path;$allowed=@($sid,'S-1-5-18','S-1-5-32-544');if(-not $a.AreAccessRulesCanonical -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'PRIVATE_ACL_REQUIRED'};foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin $allowed){throw 'PRIVATE_ACL_REQUIRED'}}}
function Put([string]$Name,[byte[]]$Bytes){$p=Join-Path $packet $Name;$f=[IO.File]::Open($p,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$f.Write($Bytes);$f.Flush($true)}finally{$f.Dispose()}}
function JsonBytes($Value){[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 16 -Compress))}
function PlanPath([string]$Root,[string]$Name){if(-not $Name -or $Name.Contains('\') -or $Name.Contains(':') -or $Name.StartsWith('/') -or @($Name.Split('/')|Where-Object {$_ -in @('','..','.')} ).Count){throw 'PLAN_PATH_REFUSED'};return Join-Path $Root $Name.Replace('/','\')}
Private $ops;Private $snapshot;Private $shadow
if((FileHash (Join-Path $snapshot 'seal.json')) -cne $seal){throw 'SEAL_CHANGED'}
$header=Get-Content -LiteralPath (Join-Path $snapshot 'seal.json') -Raw|ConvertFrom-Json -AsHashtable
if($header.scope -cne 'production' -or $header.baseline -cne $two -or $header.target -cne $one -or $header.fileCount -ne 77485){throw 'WRONG_CASE'}
$protected=[IO.File]::ReadAllBytes((Join-Path $snapshot 'manifest.dpapi'))
if((Hash $protected) -cne $header.manifestSha256){throw 'MANIFEST_CHANGED'}
$plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,[Text.Encoding]::UTF8.GetBytes('tong-024-to-37dc649-once-20261025'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{$manifest=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json -AsHashtable}finally{[Array]::Clear($plain)}
# Never export the encryption key/IV or credential plaintext.
if($manifest.records.Count -ne 77485 -or $manifest.archiveSha256 -cne $header.archiveSha256){throw 'MANIFEST_BINDING_CHANGED'}
$manifest.Remove('key');$manifest.Remove('iv')
$shadowProof=Get-Content -LiteralPath (Join-Path $ops 'shadow-result.json') -Raw|ConvertFrom-Json
if(-not $shadowProof.passed -or $shadowProof.seal -cne $seal){throw 'SHADOW_PROOF_REQUIRED'}
$roots=[ordered]@{app='D:\Tong\app';manager='D:\Tong\runtime\releases\manager';control='D:\Tong\runtime\run';secrets='D:\Tong\runtime\secrets';policy='D:\Tong\runtime\tong-policy';backend='D:\Tong\runtime\backend-state';monitor='D:\Tong\runtime\login-management';logs='D:\Tong\runtime\logs';config='C:\Users\Rune\.devspace';oauth='C:\Users\Rune\.local\share\devspace';node='D:\node';ngrok='D:\Tong\state';agentdock='D:\Tong\runtime\agentdock';binding='D:\Tong\runtime'}
foreach($record in $manifest.records){if(-not $roots.Contains($record.group)){throw 'UNKNOWN_GROUP'};$null=PlanPath $roots[$record.group] $record.name}
$releasePath=Join-Path $release 'release-manifest.json';if((FileHash $releasePath) -cne $oneDigest){throw 'VERSION1_RELEASE_CHANGED'}
$pin1=Get-Content -LiteralPath $releasePath -Raw|ConvertFrom-Json -AsHashtable
$pin2Path=Join-Path $shadow 'control\release-pin.json';if((FileHash $pin2Path) -cne '482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd'){throw 'VERSION2_SHADOW_PIN_CHANGED'}
$pin2=Get-Content -LiteralPath $pin2Path -Raw|ConvertFrom-Json -AsHashtable
$profile1=Get-Content -LiteralPath (Join-Path $shadow 'binding\profile.json') -Raw|ConvertFrom-Json -AsHashtable
$profile1.sourceDigest=($pin1.files|Where-Object path -eq 'code/source.tar').sha256;$profile1.releaseDigest=$oneDigest
$profileBytes=JsonBytes $profile1
$encoded=[Convert]::ToBase64String($profileBytes)
$descriptorRaw=& D:\node\node.exe (Join-Path $release 'code\source\scripts\TongProductionProfile.mjs') --approval-descriptor $encoded start
if($LASTEXITCODE -ne 0){throw 'ORIGINAL_VERSION1_DESCRIPTOR_REFUSED'};$descriptor=$descriptorRaw|ConvertFrom-Json
$rows=[Collections.Generic.List[object]]::new()
foreach($group in @('app','manager')){
 $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($kind in @('sourceFiles','native')){foreach($f in $pin1[$kind]){$null=$names.Add($f.path);$base=if($kind -eq 'sourceFiles'){Join-Path $release 'code\source'}else{Join-Path $release 'native'};$source=PlanPath $base $f.path;if((FileHash $source) -cne $f.sha256){throw 'VERSION1_FILE_CHANGED'};$rows.Add(@{operation='write-reviewed-file';group=$group;name=$f.path;source=$source;sha256=$f.sha256})}}
 foreach($name in $pin1.expectedDevspaceHashes.Keys){$rel='node_modules/@waishnav/devspace/dist/'+$name;$source=PlanPath $patchRoot $rel;if((FileHash $source) -cne $pin1.expectedDevspaceHashes[$name]){throw 'VERSION1_PATCH_CHANGED'};$rows.Add(@{operation='write-reviewed-file';group=$group;name=$rel;source=$source;sha256=$pin1.expectedDevspaceHashes[$name]})}
 foreach($f in $pin2.sourceFiles){if(-not $names.Contains($f.path)){$rows.Add(@{operation='retain-outside-active-tree';group=$group;name=$f.path;expectedOldSha256=$f.sha256})}}
}
foreach($name in @('release-pin.json','manager-pin.json')){$rows.Add(@{operation='write-reviewed-file';group='control';name=$name;source=$releasePath;sha256=$oneDigest})}
$rows.Add(@{operation='write-reviewed-file';group='binding';name='profile.json';source=(Join-Path $packet 'profile1.json');sha256=(Hash $profileBytes)})
$hostHash=FileHash $hostSource;if($hostHash -cne '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718'){throw 'EXTERNAL_HOST_CHANGED'}
$runnerSource=Join-Path $release 'code\source\scripts\TongLoginRuntime.ps1';$runnerHash=FileHash $runnerSource
if($runnerHash -cne '2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b'){throw 'FORMAL_RUNNER_CHANGED'}
$rows.Add(@{operation='write-external-operations-component';group='monitor';name='TongLoginHost.exe';source=$hostSource;sha256=$hostHash})
$rows.Add(@{operation='write-external-operations-component';group='monitor';name='TongLoginRuntime.ps1';source=$runnerSource;sha256=$runnerHash})
$approval=[ordered]@{envelopes=0;typedPermissionDecrypted=0;typedPermissionFailed=0;otherPurposeSkipped=0;version1PermissionCount=0;version1UnexpiredCount=0;version1StartUnexpiredCount=0;version1LatestExpiry=$null;loginRecoveryDecrypted=0;loginRecoveryMatchesVersion1=$false;loginRecoveryEnabled=$false;loginRecoveryRevoked=$false}
foreach($file in Get-ChildItem -LiteralPath 'D:\Tong\runtime\secrets\runtime-permissions' -Filter '*.dpapi.json' -File){
 $approval.envelopes++;$envelope=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json -AsHashtable
 if($envelope.purpose -notin @('tong-runtime-permission','tong-login-recovery')){$approval.otherPurposeSkipped++;continue}
 if($envelope.scope -cne 'CurrentUser' -or $envelope.userSid -cne $sid){$approval.typedPermissionFailed++;continue}
 $entropy=if($envelope.purpose -eq 'tong-login-recovery'){'Tong:fixed-login-recovery:v1'}else{'Tong-B2.3:noncredential-runtime-permission:v1'}
 try{$receiptPlain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($envelope.ciphertext),[Text.Encoding]::UTF8.GetBytes($entropy),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{$receipt=[Text.Encoding]::UTF8.GetString($receiptPlain)|ConvertFrom-Json -AsHashtable}finally{[Array]::Clear($receiptPlain)}}catch{$approval.typedPermissionFailed++;continue}
 if($envelope.purpose -eq 'tong-login-recovery'){
  $approval.loginRecoveryDecrypted++;$approval.loginRecoveryEnabled=$receipt.enabled
  $approval.loginRecoveryMatchesVersion1=($receipt.descriptor.runtimeProfile.releaseDigest -ceq $oneDigest -and $receipt.descriptor.managerProfile.releaseDigest -ceq $oneDigest -and $receipt.descriptor.runnerSha256 -ceq $runnerHash)
  $audit=@(Get-Content -LiteralPath 'D:\Tong\runtime\logs\production.login-recovery.audit.jsonl'|ForEach-Object {$_|ConvertFrom-Json}|Where-Object grantId -eq $receipt.grantId)
  $approval.loginRecoveryRevoked=@($audit|Where-Object event -eq 'revoked').Count -gt 0
 }else{
  $approval.typedPermissionDecrypted++
  if($receipt.releaseDigest -ceq $oneDigest -and $receipt.sourceDigest -ceq $profile1.sourceDigest){$approval.version1PermissionCount++;$expires=[DateTimeOffset]::Parse($receipt.expiresAt);if(-not $approval.version1LatestExpiry -or $expires -gt [DateTimeOffset]::Parse($approval.version1LatestExpiry)){$approval.version1LatestExpiry=$receipt.expiresAt};if($expires -gt [DateTimeOffset]::UtcNow){$approval.version1UnexpiredCount++;if($receipt.action -eq 'start'){$approval.version1StartUnexpiredCount++}}}
 }
}
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\');$task=$folder.GetTask('TongLoginRuntime');$taskXml=$task.Xml;$taskHash=Hash ([Text.Encoding]::UTF8.GetBytes($taskXml));$sddl=$task.GetSecurityDescriptor(7)
if($taskXml -cne $manifest.external.taskXml -or $taskHash -cne '925671f84b50311377cdb2585eeadf3f87548e7de0124d786729321a0694a4f3'){throw 'FORMAL_TASK_CHANGED'}
if($task.Definition.Principal.LogonType -ne 3){throw 'TASK_REQUIRES_DIFFERENT_CREDENTIAL_PLAN'}
$validationName='TongStable1ValidateOnly-20261025';if(@($folder.GetTasks(1)|Where-Object Name -eq $validationName).Count){throw 'VALIDATION_NAME_EXISTS'}
$definition=$scheduler.NewTask(0);$definition.XmlText=$taskXml
# TASK_VALIDATE_ONLY = 1: documented native XML validation, NO registration.
$null=$folder.RegisterTaskDefinition($validationName,$definition,1,$sid,$null,3)
$definition.Settings.Enabled=$false;for($i=1;$i -le $definition.Triggers.Count;$i++){$definition.Triggers.Item($i).Enabled=$false}
$null=$folder.RegisterTaskDefinition($validationName,$definition,1,$sid,$null,3)
if(@($folder.GetTasks(1)|Where-Object Name -eq $validationName).Count -or $folder.GetTask('TongLoginRuntime').Xml -cne $taskXml -or $folder.GetTask('TongLoginRuntime').GetSecurityDescriptor(7) -cne $sddl){throw 'TASK_UNCHANGED_CHECK_FAILED'}
$partitions=@(Get-Partition -DriveLetter C,D|Select-Object DiskNumber,PartitionNumber,DriveLetter,Guid,Offset,Size)
$summary=[ordered]@{at=[DateTime]::UtcNow.ToString('o');status='NOT_READY';productionWrite=$false;offlineBootTested=$false;sourceSeal=$seal;sourceManifestCurrentUserDpapiDecrypted=$true;payloadOrShadowFullPassRepeated=$false;records=$manifest.records.Count;partitions=$partitions;adminToken=([Security.Principal.WindowsPrincipal]::new($user)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);bitlockerStatus='UNKNOWN_REQUIRES_ADMIN_STATUS';winreStatus='UNVERIFIED_REQUIRES_ADMIN_INFO_AND_REAL_BOOT';profile1Sha256=(Hash $profileBytes);profile1Digest=$descriptor.profileDigest;installWriteOperations=@($rows|Where-Object {$_.operation -like 'write-*'}).Count;retireOperations=@($rows|Where-Object operation -eq 'retain-outside-active-tree').Count;hostSha256=$hostHash;formalOriginalRunnerSha256=$runnerHash;approvals=$approval;task=@{xmlSha256=$taskHash;sddlSha256=(Hash ([Text.Encoding]::UTF8.GetBytes($sddl)));logonType=3;passwordRequired=$false;originalXmlValidateOnly=$true;disabledXmlValidateOnly=$true;registered=$false;unchanged=$true;actualRegisterRestoreTested=$false};privatePacket=$null;offlineWriteCommandAvailable=$false}
if($EmitPrivatePacket){
 if([IO.Directory]::Exists($packet)){throw 'PACKET_ALREADY_EXISTS_NO_OVERWRITE'};$null=[IO.Directory]::CreateDirectory($packet);Private $packet
 $baseline=@{case='tong-024-to-37dc649-offline-once';sourceSeal=$seal;sourceCommit=$two;targetCommit=$one;originalRoots=$roots;shadowRoot=$shadow;originalGateFileKey=$manifest.gateFileKey;partitions=$partitions;records=$manifest.records;fileDataNotIncluded=$true;credentialPlaintextOrEncryptionKeysIncluded=$false;notAnOfflineWriter=$true}
 Put 'baseline-files.json' (JsonBytes $baseline);Put 'profile1.json' $profileBytes
 Put 'install1-order.json' (JsonBytes @{target=$one;releaseDigest=$oneDigest;roots=$roots;operations=$rows.ToArray();actualOfflineDriveMapping=$null;productionWriteAuthorized=$false;executable=$false;originalFreezeMustRemainUntilOfflineVerifiedCommit=$true})
 Put 'TongLoginRuntime.original.xml' ([Text.Encoding]::UTF8.GetBytes($taskXml));Put 'TongLoginRuntime.disabled.xml' ([Text.Encoding]::UTF8.GetBytes($definition.XmlText));Put 'TongLoginRuntime.original.sddl' ([Text.Encoding]::UTF8.GetBytes($sddl))
 $summary.privatePacket=@{path=$packet;baselineSha256=(FileHash (Join-Path $packet 'baseline-files.json'));installOrderSha256=(FileHash (Join-Path $packet 'install1-order.json'));actualTaskAndServiceObjectsIncluded=$false;onlyMetadataAndProfile=$true}
 Put 'summary.json' (JsonBytes $summary)
}
$summary|ConvertTo-Json -Depth 9 -Compress
