# Read-only SCM/process identity probe. No service controls, token adjustment,
# privilege escalation, command-line output, configuration reads or writes.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class Tong024ServiceProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Status {public uint type,state,controls,win32,service,checkpoint,wait,pid,flags;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManager(string machine,string db,uint access);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenService(IntPtr scm,string name,uint access);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool QueryServiceStatusEx(IntPtr svc,int level,out Status status,int size,out int needed);
 [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder path,ref uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static Status Service(){var scm=OpenSCManager(null,null,1);if(scm==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());IntPtr svc=IntPtr.Zero;try{svc=OpenService(scm,"ngrok",4);if(svc==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());Status s;int needed;if(!QueryServiceStatusEx(svc,0,out s,Marshal.SizeOf(typeof(Status)),out needed))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return s;}finally{if(svc!=IntPtr.Zero)CloseServiceHandle(svc);CloseServiceHandle(scm);}}
 public static object[] Process(int pid){var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)return new object[]{Marshal.GetLastWin32Error(),null,null};try{var path=new StringBuilder(32768);uint n=32768;if(!QueryFullProcessImageName(h,0,path,ref n))return new object[]{Marshal.GetLastWin32Error(),null,null};long a,b,c,d;if(!GetProcessTimes(h,out a,out b,out c,out d))return new object[]{Marshal.GetLastWin32Error(),null,null};return new object[]{0,path.ToString(),DateTime.FromFileTimeUtc(a).Ticks.ToString()};}finally{CloseHandle(h);}}
}
'@
$before=[Tong024ServiceProbe]::Service()
$native=if($before.state -eq 4 -and $before.pid -gt 0){[Tong024ServiceProbe]::Process([int]$before.pid)}else{@(-1,$null,$null)}
$after=[Tong024ServiceProbe]::Service()
$cim=Get-CimInstance Win32_Process -Filter ('ProcessId='+$before.pid)
$service=Get-CimInstance Win32_Service -Filter "Name='ngrok'"
$stable=$before.pid -eq $after.pid -and $before.state -eq $after.state -and $service.ProcessId -eq $before.pid
[ordered]@{at=[DateTime]::UtcNow.ToString('o');service='ngrok';serviceState=$before.state;pid=$before.pid;scmStable=$stable;startMode=$service.StartMode;account=$service.StartName;requestedProcessAccess='PROCESS_QUERY_LIMITED_INFORMATION';nativeError=$native[0];nativeExe=$native[1];nativeStartTicks=$native[2];cimParentPid=$cim.ParentProcessId;cimCreationUtc=$cim.CreationDate.ToUniversalTime().ToString('o');cimExeReadable=(-not [string]::IsNullOrEmpty($cim.ExecutablePath));cimCommandLineReadable=(-not [string]::IsNullOrEmpty($cim.CommandLine));processIdentityProven=($stable -and $native[0] -eq 0);inventoryStatus=$(if($native[0] -eq 0 -and $stable -and $cim.CommandLine){'AVAILABLE'}else{'SECURITY_UNAVAILABLE'});productionMutation=$false}|ConvertTo-Json -Compress
