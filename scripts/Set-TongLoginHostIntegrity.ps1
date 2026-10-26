# Explicit installation step: bind one regular Host by bytes and native file
# identity, then set only its mandatory label. Never relabel a directory/tree.
param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,[switch]$VerifyOnly)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(-not [IO.Path]::IsPathRooted($Path) -or [IO.Path]::GetFileName($Path) -cne 'TongLoginHost.exe'){throw 'EXACT_HOST_PATH_REQUIRED'}
$target=[IO.Path]::GetFullPath($Path)
$ancestor=$target
while($ancestor){$item=Get-Item -LiteralPath $ancestor -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_DENIED'};$parent=[IO.Directory]::GetParent($ancestor);$ancestor=if($null -ne $parent){$parent.FullName}else{$null}}
if(-not ('TongHostIntegrity' -as [type])){Add-Type -TypeDefinition @'
using System;using System.IO;using System.Text;using System.Security.Cryptography;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class TongHostIntegrity {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint attrs,c1,c2,a1,a2,w1,w2,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder path,uint length,uint flags);
 [DllImport("advapi32.dll")]static extern uint GetSecurityInfo(SafeFileHandle h,int type,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr sd);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd,uint revision,uint flags,out IntPtr text,out uint length);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr sd,out uint length);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetSecurityDescriptorSacl(IntPtr sd,out bool present,out IntPtr sacl,out bool defaulted);
 [DllImport("advapi32.dll")]static extern uint SetSecurityInfo(SafeFileHandle h,int type,uint flags,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr p);
 static void Check(bool ok){if(!ok)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
 static void Error(uint error){if(error!=0)throw new System.ComponentModel.Win32Exception((int)error);}
 static string Descriptor(SafeFileHandle h,uint flags){IntPtr o,g,d,s,sd;Error(GetSecurityInfo(h,1,flags,out o,out g,out d,out s,out sd));try{IntPtr text;uint length;Check(ConvertSecurityDescriptorToStringSecurityDescriptor(sd,1,flags,out text,out length));try{return Marshal.PtrToStringUni(text);}finally{LocalFree(text);}}finally{LocalFree(sd);}}
 public static string[] Apply(string path,string expected,bool verify){
  // Share-read prevents replacement or content writes until all checks finish.
  using(var h=CreateFileW(path,0x80020000u|(verify?0u:0x80000u),1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){
   Check(!h.IsInvalid);Info before;Check(GetFileInformationByHandle(h,out before));if(before.links!=1||(before.attrs&0x410)!=0)throw new Exception("REGULAR_SINGLE_LINK_HOST_REQUIRED");
   var final=new StringBuilder(32768);uint count=GetFinalPathNameByHandle(h,final,32768,0);Check(count>0&&count<32768);if(!String.Equals(final.ToString(),"\\\\?\\"+Path.GetFullPath(path),StringComparison.OrdinalIgnoreCase))throw new Exception("HOST_PATH_CHANGED");
   string digest;using(var stream=new FileStream(h,FileAccess.Read,4096,false)){
    using(var hash=SHA256.Create()){digest=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    if(!String.Equals(digest,expected,StringComparison.OrdinalIgnoreCase))throw new Exception("HOST_HASH_MISMATCH");
    string daclBefore=Descriptor(h,7),labelBefore=Descriptor(h,16);
    if(!verify){IntPtr sd;uint length;Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;;NW;;;ME)",1,out sd,out length));try{bool present,def;IntPtr sacl;Check(GetSecurityDescriptorSacl(sd,out present,out sacl,out def));if(!present||sacl==IntPtr.Zero)throw new Exception("LABEL_DESCRIPTOR_INVALID");Error(SetSecurityInfo(h,1,16,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,sacl));}finally{LocalFree(sd);}}
    string labelAfter=Descriptor(h,16);if(!System.Text.RegularExpressions.Regex.IsMatch(labelAfter,@"\(ML;[^;]*;NW;;;ME\)"))throw new Exception("HOST_MEDIUM_INTEGRITY_REQUIRED");
    Info after;Check(GetFileInformationByHandle(h,out after));if(before.volume!=after.volume||before.indexHigh!=after.indexHigh||before.indexLow!=after.indexLow||Descriptor(h,7)!=daclBefore)throw new Exception("HOST_IDENTITY_OR_DACL_CHANGED");
    return new[]{digest,before.volume+":"+before.indexHigh+":"+before.indexLow,labelBefore,labelAfter};
   }
  }
 }
}
'@}
$result=[TongHostIntegrity]::Apply($target,$ExpectedSha256,[bool]$VerifyOnly)
@{path=$target;sha256=$result[0];fileKey=$result[1];beforeLabel=$result[2];afterLabel=$result[3];mediumIntegrity=$true;daclUnchanged=$true;verifyOnly=[bool]$VerifyOnly}|ConvertTo-Json -Compress
