param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$NodeExe,[Parameter(Mandatory)][string]$Supervisor,[string]$RecoveryGrantId)
$ErrorActionPreference='Stop'
$childId=0
try {
    $guardian=Join-Path $PSScriptRoot 'TongRuntimeGuardian.ps1'
    if(@($Root,$NodeExe,$Supervisor,$guardian) | Where-Object {$_ -match '["\r\n]'}){throw 'Invalid launch path'}
    if($RunId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid run identity'}
    $Root=[IO.Path]::GetFullPath($Root)
    if($Root -ceq 'D:\Tong\runtime') {
        if($NodeExe -cne 'D:\node\node.exe' -or $Supervisor -cne 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs'){throw 'Fixed production entry required'}
        if($RecoveryGrantId){& $NodeExe $Supervisor preflight-login --root $Root --grant-id $RecoveryGrantId | Out-Null}else{& $NodeExe $Supervisor preflight-production | Out-Null}
        if($LASTEXITCODE -ne 0){throw 'Production approval refused'}
    }elseif(-not $Root.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved scope'}
    if($RecoveryGrantId -and $RecoveryGrantId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'Invalid recovery grant identity'}
    $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$guardian+'" -Root "'+$Root+'" -RunId "'+$RunId+'" -NodeExe "'+$NodeExe+'" -Supervisor "'+$Supervisor+'"'
    if($RecoveryGrantId){$arguments+=' -RecoveryGrantId "'+$RecoveryGrantId+'"'}
    # A new console alone still inherits the initiating application's Job.
    # Break away explicitly; refuse launch if that Job forbids breakaway.
    # Keep PS5.1 as the pinned production host; its .NET Framework security
    # helpers and the existing Task Scheduler action are validated together.
    $guardianShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TongIndependentGuardian {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public int size;public string reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public short show,reservedSize;public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread;public uint pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string exe,StringBuilder args,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static uint Start(string exe,string args,string cwd) {
  var startup=new Startup();startup.size=Marshal.SizeOf(startup);startup.flags=1;startup.show=0;
  ProcessInfo info;
  if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" "+args),IntPtr.Zero,IntPtr.Zero,false,0x01000010,IntPtr.Zero,cwd,ref startup,out info))throw new Exception("GUARDIAN_BREAKAWAY_FAILED:"+Marshal.GetLastWin32Error());
  try{return info.pid;}finally{CloseHandle(info.thread);CloseHandle(info.process);}
 }
}
'@
    $childId=[TongIndependentGuardian]::Start($guardianShell,$arguments,$Root)
    [pscustomobject]@{pid=$childId} | ConvertTo-Json -Compress
} catch {
    # This explicit negative acknowledgement is emitted only before CreateProcess
    # returned a child. The manager can release its lock without guessing about
    # an unobserved Guardian after a breakaway/validation failure.
    if($childId -eq 0){[pscustomobject]@{runId=$RunId;guardianCreated=$false}|ConvertTo-Json -Compress}
    [Console]::Error.WriteLine('Runtime launch refused');exit 2
}
