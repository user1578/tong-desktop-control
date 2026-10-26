# Read-only diagnostic: one process token/identity and effective directory
# access. No target process control, chmod, ACL/attribute setter or DB open.
param([int]$TargetPid=$PID,[Parameter(Mandatory)][string]$StateDirectory)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Security.Principal;using Microsoft.Win32.SafeHandles;
public static class TongAccessSnapshot {
 [DllImport("kernel32.dll",SetLastError=true)]static extern SafeFileHandle OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(SafeFileHandle h,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(SafeFileHandle h,uint flags,StringBuilder name,ref uint size);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(SafeFileHandle h,uint access,out SafeFileHandle token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(SafeFileHandle token,int kind,IntPtr value,uint size,out uint required);
 [DllImport("advapi32.dll")]static extern bool IsTokenRestricted(SafeFileHandle token);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern uint GetFileAttributesW(string path);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)]static extern uint GetNamedSecurityInfo(string path,int kind,uint info,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr sd);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd,uint revision,uint info,out IntPtr text,out uint length);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr p);
 static void Check(bool ok){if(!ok)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
 static string TokenValue(SafeFileHandle token,int kind,bool sid){uint size;GetTokenInformation(token,kind,IntPtr.Zero,0,out size);if(size==0||size>1048576)throw new Exception("TOKEN_SIZE_INVALID");var p=Marshal.AllocHGlobal((int)size);try{Check(GetTokenInformation(token,kind,p,size,out size));return sid?new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value:Marshal.ReadInt32(p).ToString();}finally{Marshal.FreeHGlobal(p);}}
 public static object Process(int pid){using(var p=OpenProcess(0x1000,false,pid)){Check(!p.IsInvalid);long a,b,c,d;Check(GetProcessTimes(p,out a,out b,out c,out d));var name=new StringBuilder(32768);uint size=32768;Check(QueryFullProcessImageName(p,0,name,ref size));SafeFileHandle token;Check(OpenProcessToken(p,8,out token));using(token){return new {pid=pid,exe=name.ToString(),startTicks=DateTime.FromFileTimeUtc(a).Ticks.ToString(),userSid=TokenValue(token,1,true),integritySid=TokenValue(token,25,true),mandatoryPolicy=TokenValue(token,27,false),elevationType=TokenValue(token,18,false),appContainer=TokenValue(token,29,false),restricted=IsTokenRestricted(token)};}}}
 public static string Label(string path){IntPtr o,g,d,s,sd;uint e=GetNamedSecurityInfo(path,1,16,out o,out g,out d,out s,out sd);if(e!=0)throw new System.ComponentModel.Win32Exception((int)e);try{IntPtr text;uint length;Check(ConvertSecurityDescriptorToStringSecurityDescriptor(sd,1,16,out text,out length));try{return Marshal.PtrToStringUni(text);}finally{LocalFree(text);}}finally{LocalFree(sd);}}
 public static int Access(string path,uint access){using(var h=CreateFileW(path,access,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){return h.IsInvalid?Marshal.GetLastWin32Error():0;}}
}
'@
$directory=[IO.Path]::GetFullPath($StateDirectory)
$acl=Get-Acl -LiteralPath $directory
$observer=[TongAccessSnapshot]::Process($PID)
$target=[TongAccessSnapshot]::Process($TargetPid)
@{at=[DateTime]::UtcNow.ToString('o');target=$target;observer=$observer;path=$directory;attributes=[TongAccessSnapshot]::GetFileAttributesW($directory);sddl=$acl.Sddl;integrityLabel=[TongAccessSnapshot]::Label($directory);targetExecutableLabel=[TongAccessSnapshot]::Label($target.exe);observerReadAttributesWin32=[TongAccessSnapshot]::Access($directory,128);observerWriteAttributesWin32=[TongAccessSnapshot]::Access($directory,256);observerAddFileWin32=[TongAccessSnapshot]::Access($directory,2);targetTokenUsedForAccessCheck=$false}|ConvertTo-Json -Depth 5 -Compress
