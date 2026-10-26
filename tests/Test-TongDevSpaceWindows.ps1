param([string]$ProbeRoot,[switch]$Worker)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $ProbeRoot){$ProbeRoot='D:\Tong\state\comm-chmod-'+[guid]::NewGuid().ToString('N');$null=[IO.Directory]::CreateDirectory($ProbeRoot)}
if($ProbeRoot -cnotmatch '^D:\\Tong\\state\\comm-chmod-[a-zA-Z0-9]+$'){throw 'ISOLATION_ROOT_REQUIRED'}
function NoReparse([string]$Path){
 $current=[IO.Path]::GetFullPath($Path)
 while($current){
  $item=Get-Item -LiteralPath $current -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE_DENIED'}
  $parent=[IO.Directory]::GetParent($current);$current=if($null -ne $parent){$parent.FullName}else{$null}
 }
}
NoReparse $ProbeRoot
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class TongProbeDacl {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool SetFileSecurity(string path,uint flags,byte[] sd);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern uint GetFileAttributesW(string path);
 public static void Set(string path,byte[] sd){if(!SetFileSecurity(path,4u|0x80000000u,sd))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
 public static int Access(string path,uint access){using(var h=CreateFileW(path,access,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)){return h.IsInvalid?Marshal.GetLastWin32Error():0;}}
}
'@
$case=if($Worker){'task'}else{'interactive'}
$trial=Join-Path $ProbeRoot $case
if(Test-Path -LiteralPath $trial){throw 'FRESH_TRIAL_REQUIRED'}
$null=[IO.Directory]::CreateDirectory($trial)
# Only read the real state directory's security descriptor. All changes below
# address new synthetic children, never the real directory or its database.
$originalAcl=Get-Acl -LiteralPath 'C:\Users\Rune\.local\share\devspace'
foreach($name in @('existing','acl-clone','deny-attributes','deny-data')){
 $path=Join-Path $trial $name;$null=[IO.Directory]::CreateDirectory($path)
 Set-Acl -LiteralPath $path -AclObject $originalAcl
 if($name -in @('deny-attributes','deny-data')){
  $acl=Get-Acl -LiteralPath $path
  $rights=if($name -eq 'deny-attributes'){[Security.AccessControl.FileSystemRights]::WriteAttributes}else{[Security.AccessControl.FileSystemRights]::WriteData}
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,'ContainerInherit,ObjectInherit','None','Deny'))
  # Apply only the changed DACL. Reapplying Get-Acl's complete descriptor can
  # request unrelated owner/audit privileges under a limited Windows token.
  [TongProbeDacl]::Set($path,$acl.GetSecurityDescriptorBinaryForm())
 }
}
$identity=@{sid=$sid.Value;pid=$PID;ps=$PSVersionTable.PSVersion.ToString();taskWorker=[bool]$Worker}
[IO.File]::WriteAllText((Join-Path $trial 'identity.json'),($identity|ConvertTo-Json))
# OPEN_EXISTING only: acquire and close handles to inspect effective access.
# No chmod, attribute/ACL setter, database open or file creation on real state.
$realState='C:\Users\Rune\.local\share\devspace'
$realAccess=@{directoryAttributes=[TongProbeDacl]::GetFileAttributesW($realState);writeAttributesWin32=[TongProbeDacl]::Access($realState,256);addFileWin32=[TongProbeDacl]::Access($realState,2);databaseWriteAttributesWin32=[TongProbeDacl]::Access((Join-Path $realState 'devspace.sqlite'),256);sddl=$originalAcl.Sddl}
[IO.File]::WriteAllText((Join-Path $trial 'real-state-readonly-access.json'),($realAccess|ConvertTo-Json))
$probe=Join-Path $PSScriptRoot 'fixtures\TongDevSpaceWindowsProbe.mjs'
$package=Join-Path $project 'node_modules\@waishnav\devspace'
& D:\node\node.exe $probe $trial $package $case
if($LASTEXITCODE -ne 0){throw ('PROBE_FAILED_'+$case)}
if($Worker){exit 0}
# A dedicated, limited InteractiveToken task with no trigger. The production
# task and all prior test tasks/records are untouched. Retain it disabled.
$taskName='TongCommProbe-'+[guid]::NewGuid().ToString('N')
$action=New-ScheduledTaskAction -Execute 'C:\Program Files\PowerShell\7\pwsh.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -File "'+$PSCommandPath+'" -ProbeRoot "'+$ProbeRoot+'" -Worker') -WorkingDirectory $project
$principal=New-ScheduledTaskPrincipal -UserId $sid.Value -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
$null=Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings
try{
 Start-ScheduledTask -TaskName $taskName
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 do{
  Start-Sleep -Milliseconds 200
  $task=Get-ScheduledTask -TaskName $taskName
  $info=Get-ScheduledTaskInfo -TaskName $taskName
 }while(([string]$task.State -eq 'Running' -or -not (Test-Path -LiteralPath (Join-Path $ProbeRoot 'task\result.json'))) -and [DateTime]::UtcNow -lt $deadline)
 if([string]$task.State -eq 'Running'){throw 'TASK_PROBE_TIMEOUT'}
 if($info.LastTaskResult -ne 0){throw ('TASK_PROBE_EXIT_'+$info.LastTaskResult)}
 $taskResult=Get-Content -LiteralPath (Join-Path $ProbeRoot 'task\result.json') -Raw|ConvertFrom-Json
 $taskIdentity=Get-Content -LiteralPath (Join-Path $ProbeRoot 'task\identity.json') -Raw|ConvertFrom-Json
 if($taskIdentity.sid -cne $sid.Value){throw 'TASK_IDENTITY_MISMATCH'}
 $outcome=@{passed=$true;root=$ProbeRoot;task=$taskName;taskExit=$info.LastTaskResult;identity=$taskIdentity;result=$taskResult;realStateReadonlyAccess=(Get-Content -LiteralPath (Join-Path $ProbeRoot 'task\real-state-readonly-access.json') -Raw|ConvertFrom-Json);productionChanged=$false}
 [IO.File]::WriteAllText((Join-Path $ProbeRoot 'outcome.json'),($outcome|ConvertTo-Json -Depth 8))
 $outcome|ConvertTo-Json -Depth 8 -Compress
}finally{Disable-ScheduledTask -TaskName $taskName|Out-Null}
