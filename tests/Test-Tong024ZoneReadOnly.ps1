$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Diagnostic only: no runner execution, policy/zone/ADS/registry writes.
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
[ComImport,Guid("79eac9ee-baf9-11ce-8c82-00aa004ba90b"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IInternetSecurityManager024 {
 [PreserveSig] int SetSecuritySite(IntPtr site);
 [PreserveSig] int GetSecuritySite(out IntPtr site);
 [PreserveSig] int MapUrlToZone([MarshalAs(UnmanagedType.LPWStr)]string url,out uint zone,uint flags);
}
public static class Tong024ZoneProbe {
 [DllImport("urlmon.dll",ExactSpelling=true)] static extern int CoInternetCreateSecurityManager(IntPtr provider,out IInternetSecurityManager024 manager,uint reserved);
 public static long[] Map(string url,uint flags){IInternetSecurityManager024 m;int hr=CoInternetCreateSecurityManager(IntPtr.Zero,out m,0);if(hr<0)Marshal.ThrowExceptionForHR(hr);try{uint zone;hr=m.MapUrlToZone(url,out zone,flags);return new long[]{hr,zone};}finally{Marshal.FinalReleaseComObject(m);}}
}
'@
$targets=@('D:\Tong\runtime\login-management\TongLoginRuntime.ps1','D:\Tong\state\b23-task-host-59cce095-cce9-42fd-9bcc-a182575eca04\TongLoginRuntime.ps1',$PSCommandPath,(Join-Path $PSHOME 'Microsoft.PowerShell_profile.ps1'))
$files=foreach($path in $targets){
 $uri=([Uri]$path).AbsoluteUri;$method=[psobject].Assembly.GetType('System.Management.Automation.ClrFacade').GetMethod('GetFileSecurityZone',[Reflection.BindingFlags]'Static,NonPublic')
 $core=if([IO.File]::Exists($path)){$method.Invoke($null,@($path)).ToString()}else{'not-present'}
 $directZone=try{@([IO.File]::ReadAllLines($path+':Zone.Identifier')|Where-Object{$_ -match '^ZoneId='})}catch{'not-readable-or-absent'}
 @{path=$path;exists=[IO.File]::Exists($path);urlmonPath=@([Tong024ZoneProbe]::Map($path,0));urlmonUri=@([Tong024ZoneProbe]::Map($uri,0));urlmonNoSavedFileDiagnostic=@([Tong024ZoneProbe]::Map($uri,1));directZoneId=$directZone;pwsh7Zone=$core;signature=$(if([IO.File]::Exists($path)){(Get-AuthenticodeSignature -LiteralPath $path).Status.ToString()}else{'not-present'});streams=$(if([IO.File]::Exists($path)){@((Get-Item -LiteralPath $path -Stream *).Stream)}else{@()})}
}
$legacy=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoLogo -NoProfile -NonInteractive -Command '$paths=@("D:\Tong\runtime\login-management\TongLoginRuntime.ps1","D:\Tong\state\b23-task-host-59cce095-cce9-42fd-9bcc-a182575eca04\TongLoginRuntime.ps1","C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");@{version=$PSVersionTable.PSVersion.ToString();policy=(Get-ExecutionPolicy).ToString();files=@($paths|ForEach-Object{@{path=$_;clrPathZone=[Security.Policy.Zone]::CreateFromUrl($_).SecurityZone.ToString();clrUriZone=[Security.Policy.Zone]::CreateFromUrl(([Uri]$_).AbsoluteUri).SecurityZone.ToString()}})}|ConvertTo-Json -Depth 6 -Compress'
if($LASTEXITCODE -ne 0){throw 'READONLY_LEGACY_ZONE_DIAGNOSTIC_FAILED'}
$defaults=foreach($scope in @('HKCU:','HKLM:')){$key=$scope+'\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\ProtocolDefaults';@{scope=$scope;file=(Get-ItemProperty -LiteralPath $key -Name file).file}}
@{pwshVersion=$PSVersionTable.PSVersion.ToString();pwshPolicy=(Get-ExecutionPolicy).ToString();driveType=([IO.DriveInfo]::new('D:\')).DriveType.ToString();legacy=($legacy|ConvertFrom-Json);files=@($files);protocolDefaults=@($defaults);productionMutation=$false}|ConvertTo-Json -Depth 8 -Compress
