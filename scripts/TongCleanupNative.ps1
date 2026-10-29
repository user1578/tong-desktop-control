#Requires -Version 7
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'TongStartupProtocol.ps1')
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class TongCleanupMutex {
 static readonly Dictionary<string,System.Threading.Mutex> held=new Dictionary<string,System.Threading.Mutex>();
 public static void Acquire(string key){
  if(held.ContainsKey(key))throw new Exception("CLEANUP_JOB_BUSY");
  var mutex=new System.Threading.Mutex(false,"Local\\TongCleanup-"+key);bool acquired=false;
  try{try{acquired=mutex.WaitOne(0);}catch(System.Threading.AbandonedMutexException){acquired=true;}
   if(!acquired)throw new Exception("CLEANUP_JOB_BUSY");held.Add(key,mutex);
  }catch{mutex.Dispose();throw;}
 }
 public static void Release(string key){if(!held.ContainsKey(key))throw new Exception("CLEANUP_JOB_LOCK_NOT_HELD");var mutex=held[key];held.Remove(key);try{mutex.ReleaseMutex();}finally{mutex.Dispose();}}
}
public static class TongCleanupHandleDelete {
 [StructLayout(LayoutKind.Sequential)] struct Time { public uint low,high; public long Ticks {get{return (long)(((ulong)high<<32)|low);}} }
 [StructLayout(LayoutKind.Sequential)] struct Info {public uint attrs;public Time created,accessed,written;public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [StructLayout(LayoutKind.Sequential)] struct Basic {public long created,accessed,written,changed;public uint attrs;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out Basic i,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int kind,ref byte info,uint size);
 static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
 static SafeFileHandle Open(string path,bool directory,bool deleting,bool reading=false){
  var h=CreateFileW("\\\\?\\"+path,0x80u|(deleting?0x10000u:0u)|(reading?0x80000000u:0u),1,IntPtr.Zero,3,0x00200000u|(directory?0x02000000u:0u),IntPtr.Zero);
  if(h.IsInvalid){h.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error());}
  try{Info i;Check(GetFileInformationByHandle(h,out i));if((i.attrs&0x400)!=0||((i.attrs&0x10)!=0)!=directory||(!directory&&i.links!=1))throw new Exception("CLEANUP_UNSAFE_ITEM");return h;}catch{h.Dispose();throw;}
 }
 static void Match(SafeFileHandle h,double inode,double size,double modified,double changed){
  Info i;Basic b;Check(GetFileInformationByHandle(h,out i));Check(GetFileInformationByHandleEx(h,0,out b,(uint)Marshal.SizeOf(typeof(Basic))));
  double id=(double)(((ulong)i.indexHigh<<32)|i.indexLow),length=(double)(((ulong)i.sizeHigh<<32)|i.sizeLow);
  double m=(i.written.Ticks-116444736000000000L)/10000.0,c=(b.changed-116444736000000000L)/10000.0;
  if(id!=inode||length!=size||Math.Abs(m-modified)>0.001||Math.Abs(c-changed)>0.001)throw new Exception("CLEANUP_TARGET_CHANGED");
 }
 static List<SafeFileHandle> Parents(string path){
  path=Path.GetFullPath(path);if(path.Length<4||path[1]!=':'||path[2]!='\\'||path.StartsWith("\\\\"))throw new Exception("CLEANUP_INVALID_PATH");
  var parents=new List<SafeFileHandle>();try{
   var root=Path.GetPathRoot(path);parents.Add(Open(root,true,false));var current=root;var parent=Path.GetDirectoryName(path);
   foreach(var part in parent.Substring(root.Length).Split(new[]{'\\'},StringSplitOptions.RemoveEmptyEntries)){current=Path.Combine(current,part);parents.Add(Open(current,true,false));}return parents;
  }catch{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();throw;}
 }
 public sealed class Digest {public string digest;public string body;}
 public static string[] List(string path){
  var parents=Parents(path);try{using(var h=Open(Path.GetFullPath(path),true,false)){
   var names=new List<string>();foreach(var entry in Directory.EnumerateFileSystemEntries(path)){if(names.Count>=120000)throw new Exception("CLEANUP_TOO_MANY_FILES");names.Add(Path.GetFileName(entry));}return names.ToArray();
  }}finally{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();}
 }
 public static Digest Read(string path,bool body,double inode,double size,double modified,double changed){
  var parents=Parents(path);try{using(var h=Open(Path.GetFullPath(path),false,false,true)){
   Match(h,inode,size,modified,changed);
   using(var stream=new FileStream(h,FileAccess.Read))using(var sha=SHA256.Create()){
    if(body){if(size>8*1024*1024)throw new Exception("CLEANUP_CONTROL_FILE_TOO_LARGE");using(var memory=new MemoryStream()){stream.CopyTo(memory);var bytes=memory.ToArray();return new Digest{digest=Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant(),body=Convert.ToBase64String(bytes)};}}
    return new Digest{digest=Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant()};
   }
  }}finally{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();}
 }
 public static void Delete(string path,bool directory,double inode,double size,double modified,double changed){
  path=Path.GetFullPath(path);var parents=Parents(path);
  try{
   // No write/delete sharing: ancestors cannot be renamed or converted into
   // reparse points while the final object is checked and deleted by HANDLE.
   using(var h=Open(path,directory,true)){
    if(!directory)Match(h,inode,size,modified,changed);
    byte remove=1;Check(SetFileInformationByHandle(h,4,ref remove,1));
   }
  }finally{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();}
 }
}
'@
while($null -ne ($line=[Console]::ReadLine())){
 try{
  $request=$line|ConvertFrom-Json
  $response=@{ok=$true}
  switch($request.action){
   'replace' {[TongStartupPreflight]::AtomicReplace([string]$request.from,[string]$request.to)}
   'delete' {[TongCleanupHandleDelete]::Delete([string]$request.path,[bool]$request.directory,[double]$request.inode,[double]$request.bytes,[double]$request.modified,[double]$request.changed)}
   'acquire' {[TongCleanupMutex]::Acquire([string]$request.key)}
   'release' {[TongCleanupMutex]::Release([string]$request.key)}
   'read' {$read=[TongCleanupHandleDelete]::Read([string]$request.path,[bool]$request.body,[double]$request.inode,[double]$request.bytes,[double]$request.modified,[double]$request.changed);$response.digest=$read.digest;if($request.body){$response.body=$read.body}}
   'list' {$response.entries=@([TongCleanupHandleDelete]::List([string]$request.path))}
   default {throw 'CLEANUP_NATIVE_REQUEST_INVALID'}
  }
  [Console]::WriteLine(($response|ConvertTo-Json -Compress))
 }catch{
  $e=$_.Exception;while($e.InnerException){$e=$e.InnerException}
  $code=if($e.Message -cmatch '^CLEANUP_[A-Z_]+$'){$e.Message}elseif($e -is [ComponentModel.Win32Exception]){'CLEANUP_WIN32_'+$e.NativeErrorCode}else{'CLEANUP_NATIVE_FAILED'}
  [Console]::WriteLine((@{ok=$false;code=$code}|ConvertTo-Json -Compress))
 }
}
