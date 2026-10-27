$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$held=$null
$mutex=$null;$mutexHeld=$false
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class TongFreezeIdentity {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint a,c1,c2,t1,t2,w1,w2,v,s1,s2,links,i1,i2;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info f);
 public static string Key(FileStream h){Info f;if(!GetFileInformationByHandle(h.SafeFileHandle,out f)||f.links!=1)throw new Exception("FILE_ID_UNAVAILABLE");return f.v+":"+f.i1+":"+f.i2;}
}
'@
try {
    $request=[Console]::ReadLine()|ConvertFrom-Json
    if($request.expectedSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'binding'}
    $path=Join-Path ([IO.Path]::GetFullPath([string]$request.root)) 'run\backup.freeze'
    $hashName=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($path.ToLowerInvariant())))
    $mutex=[Threading.Mutex]::new($false,('Local\TongFreeze-'+$hashName))
    try{$mutexHeld=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$mutexHeld=$true}
    if(-not $mutexHeld){throw 'busy'}
    $upgrade=$request.PSObject.Properties['upgradeReceipt']
    if($upgrade){
        if($request.profile.root -cne $request.root){throw 'binding'}
        if($request.profile.mode -ceq 'production'){
            if($request.root -cne 'D:\Tong\runtime' -or $request.testCrashAfterReceipt){throw 'production binding'}
            $approval=($request|ConvertTo-Json -Depth 12 -Compress)|& 'D:\node\node.exe' (Join-Path $PSScriptRoot 'TongLifecycleFreeze.mjs') --authorize-upgrade
            if($LASTEXITCODE -ne 0 -or ($approval|ConvertFrom-Json).verified -cne $true){throw 'approval'}
            if(-not ([IO.Path]::GetFullPath([string]$request.upgradeReceipt)).StartsWith('D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-',[StringComparison]::Ordinal)){throw 'receipt scope'}
        }elseif($request.profile.mode -cne 'production-simulation' -or $request.root -cnotmatch '^D:\\Tong\\state\\b23-[a-zA-Z0-9_-]+$' -or -not ([string]$request.upgradeReceipt).StartsWith($request.root+'\',[StringComparison]::Ordinal)){throw 'simulation scope'}
        foreach($target in @($request.root,(Split-Path ([string]$request.upgradeReceipt)))){
            $current=[IO.Path]::GetFullPath([string]$target)
            while($current){if(([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'};$parent=[IO.Directory]::GetParent($current);if($null -eq $parent){break};$current=$parent.FullName}
        }
        $receipt=[string]$request.upgradeReceipt;$binding=$null
        if([IO.File]::Exists($receipt)){$binding=[IO.File]::ReadAllText($receipt)|ConvertFrom-Json}
        if(-not [IO.File]::Exists($path)){
            if($null -eq $binding -or -not [IO.File]::Exists([string]$binding.pendingPath)){
                $pending=$receipt+'.pending-'+[guid]::NewGuid().ToString('N')
                $prepared=[IO.File]::Open($pending,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
                try{$prepared.Flush($true);$binding=@{path=$path;pendingPath=$pending;key=[TongFreezeIdentity]::Key($prepared)}}finally{$prepared.Dispose()}
                $temp=$receipt+'.tmp-'+[guid]::NewGuid().ToString('N')
                $stream=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
                try{$bytes=[Text.Encoding]::UTF8.GetBytes(($binding|ConvertTo-Json -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
                [IO.File]::Move($temp,$receipt,$true)
            }
            if($request.testCrashAfterReceipt){throw 'injected interruption'}
            if($binding.path -cne $path -or -not ([string]$binding.pendingPath).StartsWith($receipt+'.pending-',[StringComparison]::Ordinal)){throw 'receipt changed'}
            $prepared=[IO.File]::Open([string]$binding.pendingPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
            try{if([TongFreezeIdentity]::Key($prepared) -cne $binding.key -or $prepared.Length -ne 0){throw 'pending changed'}}finally{$prepared.Dispose()}
            # No-overwrite atomic move: receipt is durable before the lifecycle
            # gate becomes visible. An interrupted preparation can be resumed.
            [IO.File]::Move([string]$binding.pendingPath,$path)
        }
        if($null -eq $binding -or $binding.path -cne $path){throw 'unowned gate'}
    }
    # RW + Share.Read admits snapshot readers but denies every other writer,
    # delete and rename. This is the original gate, never a replacement lock.
    $held=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    if($upgrade -and [TongFreezeIdentity]::Key($held) -cne $binding.key){throw 'gate identity'}
    function Proof {
        $held.Position=0;$algorithm=[Security.Cryptography.SHA256]::Create()
        try{$hash=([BitConverter]::ToString($algorithm.ComputeHash($held))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
        if($hash -cne $request.expectedSha256){throw 'changed'}
        [ordered]@{root=[string]$request.root;sha256=$hash;holderPid=$PID;exclusiveWriter=$true}|ConvertTo-Json -Compress
    }
    Proof
    while($null -ne ($line=[Console]::ReadLine())) {
        if($line -ceq 'close'){break}
        if($line -ceq 'release' -and $upgrade){
            $null=Proof
            $held.Dispose();$held=$null
            [IO.File]::Delete($path)
            @{released=$true}|ConvertTo-Json -Compress
            break
        }
        if($line -cne 'proof'){throw 'command'}
        Proof
    }
} catch {
    [Console]::Error.WriteLine('LIFECYCLE_FREEZE_UNAVAILABLE')
    exit 2
} finally {if($null -ne $held){$held.Dispose()};if($mutexHeld){$mutex.ReleaseMutex()};if($null -ne $mutex){$mutex.Dispose()}}
