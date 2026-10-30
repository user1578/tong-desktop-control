$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\scripts\TongCleanupReferences.ps1'))
. (Join-Path $PSScriptRoot '..\scripts\TongCleanupComReferences.ps1')
. (Join-Path $PSScriptRoot '..\scripts\TongCleanupTaskTrust.ps1')
# Real checker, isolated metadata providers; never inspect or modify real tasks.
$text=$text.Replace('[Console]::In.ReadToEnd().Trim()','$script:target').Replace('exit 2','throw')
$text=$text.Replace(". (Join-Path `$PSScriptRoot 'TongCleanupComReferences.ps1')",'')
$text=$text.Replace(". (Join-Path `$PSScriptRoot 'TongCleanupTaskTrust.ps1')",'')
$probe=[scriptblock]::Create($text)
$script:target='D:\Tong\state\synthetic-reference-test\npm-cache'
$script:actions=@();$script:processes=@();$script:taskFailure=$false
$script:registry=@{};$script:registryFailure=$false
$script:taskPath='\Synthetic\';$script:taskName='SyntheticTask';$script:user='Rune'
$script:taskOwner='S-1-5-32-544';$script:taskWriters=@('S-1-5-18','S-1-5-32-544');$script:taskOrdinary=$true
$script:parentMutators=@('S-1-5-18','S-1-5-32-544')
function Get-CleanupRegistryRecord {param($Hive,$View,$Key) if($script:registryFailure){throw 'INJECTED_REGISTRY_FAILURE'};return $script:registry[([string]$Hive+'|'+[string]$View+'|'+$Key)]}
function Get-CleanupPackageRoot {param($Package) if($script:packageMissing -or $Package -eq 'unstaged-package'){return $null};return 'D:\safe-package'}
$script:packageMissing=$false
function Get-CleanupTaskPathSecurity {param($Path)
  $source=Join-Path (Join-Path ([Environment]::GetFolderPath('System')) 'Tasks') ($script:taskPath.TrimStart('\')+$script:taskName)
  return [pscustomobject]@{ordinary=$script:taskOrdinary;directory=($Path -ine $source);owner=$script:taskOwner;writers=$script:taskWriters;mutators=$script:parentMutators}
}
function Reg([string]$Key,[hashtable]$Values,[string[]]$Keys=@()) {$script:registry['LocalMachine|Registry64|'+$Key]=[pscustomobject]@{values=$Values;keys=$Keys}}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}' @{} @('InprocServer32')
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''='D:\safe\handler.dll'}
function Get-ScheduledTask {param($ErrorAction) if($script:taskFailure){throw 'INJECTED_TASK_QUERY_FAILURE'};[pscustomobject]@{Actions=$script:actions;TaskPath=$script:taskPath;TaskName=$script:taskName;Principal=[pscustomobject]@{UserId=$script:user}}}
function Get-CimInstance {param($ClassName,$ErrorAction) if($ClassName -eq 'Win32_Process'){return $script:processes};if($ClassName -eq 'Win32_Service'){return};throw 'Unexpected class'}
function Check {(& $probe)|ConvertFrom-Json}
$script:actions=@([pscustomobject]@{CimClass=[pscustomobject]@{CimClassName='MSFT_TaskComHandlerAction'};ClassId='{11111111-1111-4111-8111-111111111111}';Data=''})
$result=Check
if(-not $result.readOnly -or $result.references -ne 0 -or $result.unknown -ne 0){throw 'COM handler must be inspected without reading nonexistent Exec fields'}
$script:actions[0].Data=$script:target
if((Check).references -ne 1){throw 'COM handler Data reference must be retained'}
$script:actions[0].Data=''
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''=($script:target+'\handler.dll')}
if((Check).references -ne 1){throw 'COM DLL registration reference lost when Data is empty'}
$script:registryFailure=$true
if((Check).unknown -ne 1){throw 'COM registry failure must fail closed'}
$script:registryFailure=$false;$script:registry=@{}
if((Check).unknown -ne 1){throw 'Absent COM registration must remain unknown'}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}' @{AppID='{22222222-2222-4222-8222-222222222222}'}
Reg 'Software\Classes\AppID\{22222222-2222-4222-8222-222222222222}' @{LocalService='SyntheticService'}
Reg 'SYSTEM\CurrentControlSet\Services\SyntheticService' @{ImagePath='C:\Windows\System32\svchost.exe'}
Reg 'SYSTEM\CurrentControlSet\Services\SyntheticService\Parameters' @{ServiceDll=($script:target+'\service.dll')}
if((Check).references -ne 1){throw 'COM service DLL reference lost'}
$script:registry=@{}
Reg 'Software\Classes\PackagedCom\ClassIndex\{11111111-1111-4111-8111-111111111111}' @{} @('synthetic-package')
Reg 'Software\Classes\PackagedCom\Package\synthetic-package\Class\{11111111-1111-4111-8111-111111111111}' @{ServerId='one';DllPath=($script:target+'\package.dll')}
Reg 'Software\Classes\PackagedCom\Package\synthetic-package\Server\one' @{Executable='server.exe'}
if((Check).references -ne 1){throw 'Packaged COM DLL reference lost'}
$script:packageMissing=$true
if((Check).unknown -ne 1){throw 'Empty packaged COM resolution must remain unknown'}
$script:packageMissing=$false
Reg 'Software\Classes\PackagedCom\ClassIndex\{11111111-1111-4111-8111-111111111111}' @{} @('synthetic-package','unstaged-package')
Reg 'Software\Classes\PackagedCom\Package\synthetic-package\Class\{11111111-1111-4111-8111-111111111111}' @{ServerId='one';DllPath='safe.dll'}
Reg 'Software\Classes\PackagedCom\Package\unstaged-package\Class\{11111111-1111-4111-8111-111111111111}' @{ServerId='old';DllPath='old.dll'}
Reg 'Software\Classes\PackagedCom\Package\unstaged-package\Server\old' @{Executable='old.exe'}
if((Check).unknown -ne 0){throw 'Authoritatively unstaged package residue must not invalidate a resolved active package'}
Reg 'Software\Classes\PackagedCom\Package\unstaged-package\Class\{11111111-1111-4111-8111-111111111111}' @{DllPath=($script:target+'\known.dll')}
if((Check).references -lt 1){throw 'Unstaged package residue must still preserve known absolute references'}
$script:registry=@{}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}' @{} @('InprocServer32')
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''='C:\Windows\System32\mscoree.dll';CodeBase='file:///D:/Tong/state/COM%20Test/npm-cache/handler.dll'}
$savedTarget=$script:target;$script:target='D:\Tong\state\COM Test\npm-cache'
if((Check).references -ne 1){throw 'Encoded CodeBase URI reference lost'}
$script:target=$savedTarget;$script:registry=@{}
$script:taskPath='\Microsoft\Windows\Synthetic\';$script:user='SYSTEM'
$result=Check
if($result.unknown -ne 0 -or $result.warnings.Count -ne 1){throw 'Approved protected SYSTEM task must produce an auditable warning'}
$script:taskWriters+= 'S-1-5-32-545'
if((Check).unknown -ne 1){throw 'Ordinary task writers must prevent the exception'}
$script:taskWriters=@('S-1-5-18','S-1-5-32-544');$script:taskOrdinary=$false
if((Check).unknown -ne 1){throw 'Reparse task source must prevent the exception'}
$script:taskOrdinary=$true;$script:taskOwner='S-1-5-32-545'
if((Check).unknown -ne 1){throw 'Untrusted task owner must prevent the exception'}
$script:taskOwner='S-1-5-32-544';$script:user='Rune'
if((Check).unknown -ne 1){throw 'Non-SYSTEM task must prevent the exception'}
$script:user='SYSTEM';$script:taskPath='\Microsoft\Windows\..\Synthetic\'
if((Check).unknown -ne 1){throw 'Task traversal must prevent the exception'}
$script:taskPath='\Microsoft\Windows\Synthetic\'
$script:parentMutators+='S-1-5-32-545'
if((Check).unknown -ne 1){throw 'Ordinary ancestor replacement rights must prevent the exception'}
$script:parentMutators=@('S-1-5-18','S-1-5-32-544')
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}' @{} @('InprocServer32')
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''=($script:target+'\active.dll')}
if((Check).references -ne 1){throw 'Trusted SYSTEM task must still protect a known DLL reference'}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''='mscoree.dll';CodeBase='file:///D:/Tong/state/synthetic-reference-test/npm-cache/handler.dll'}
if((Check).references -lt 1){throw 'Relative default server must not hide a known CodeBase from the SYSTEM exception'}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\InprocServer32' @{''='relative.dll'}
Reg 'Software\Classes\CLSID\{11111111-1111-4111-8111-111111111111}\LocalServer32' @{''=('"'+$script:target+'\server.exe"')}
if((Check).references -lt 1){throw 'Early server failure must not hide a later known server reference'}
$script:taskPath='\Synthetic\';$script:user='Rune'
$script:actions=@([pscustomobject]@{CimClass=[pscustomobject]@{CimClassName='MSFT_TaskExecAction'};Execute='D:\safe\node.exe';Arguments=$script:target;WorkingDirectory='D:\safe'})
if((Check).references -ne 1){throw 'Exec argument reference lost'}
$script:actions=@([pscustomobject]@{CimClass=[pscustomobject]@{CimClassName='MSFT_TaskExecAction'};Execute='D:\safe\node.exe';Arguments=''})
if((Check).unknown -ne 1){throw 'Incomplete Exec metadata must fail closed'}
$script:actions=@([pscustomobject]@{CimClass=[pscustomobject]@{CimClassName='MSFT_TaskUnknownAction'}})
if((Check).unknown -ne 1){throw 'Unknown action type must fail closed'}
$script:actions=@();$script:processes=@([pscustomobject]@{ProcessId=1;Name='node.exe';CommandLine=$null;ExecutablePath=$null})
$result=Check
if($result.unknown -ne 1 -or $result.unknownKinds.process_command_line -ne 1 -or $result.unknownProcesses[0].pid -ne 1){throw 'Unknown relevant process metadata must fail closed with bounded evidence'}
$script:taskFailure=$true;$rejected=$false
try{$null=Check}catch{$rejected=$true}
if(-not $rejected){throw 'Task enumeration failure must not produce an accepted proof'}
Write-Output 'PASS: Exec and COM handler references, missing/unknown metadata and enumeration failure refusals.'
