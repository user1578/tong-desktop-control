$ErrorActionPreference='Stop'
$testRoot=Join-Path 'D:\agentdock-poc-20261010\isolated\state' ('b22-acl-'+[guid]::NewGuid().ToString('N').Substring(0,12))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'temp') -Force | Out-Null
$previousTemp=$env:TEMP; $previousTmp=$env:TMP
try {
    $env:TEMP=Join-Path $testRoot 'temp';$env:TMP=$env:TEMP
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class TongAclProbe {
 [StructLayout(LayoutKind.Sequential)] struct Luid {public uint a;public int b;}
 [StructLayout(LayoutKind.Sequential)] struct Sid {public IntPtr value;public uint attributes;}
 [StructLayout(LayoutKind.Sequential)] struct Request {public uint desired;public IntPtr self,list;public uint length;public IntPtr args;}
 [StructLayout(LayoutKind.Sequential)] struct Reply {public uint length;public IntPtr granted,sacl,error;}
 [DllImport("authz.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool AuthzInitializeResourceManager(uint flags,IntPtr access,IntPtr groups,IntPtr free,string name,out IntPtr manager);
 [DllImport("authz.dll",SetLastError=true)] static extern bool AuthzInitializeContextFromSid(uint flags,IntPtr sid,IntPtr manager,IntPtr expiration,Luid id,IntPtr args,out IntPtr context);
 [DllImport("authz.dll",SetLastError=true)] static extern bool AuthzAddSidsToContext(IntPtr context,[In]Sid[] sids,uint count,IntPtr restricted,uint restrictedCount,out IntPtr added);
 [DllImport("authz.dll",SetLastError=true)] static extern bool AuthzAccessCheck(uint flags,IntPtr context,ref Request request,IntPtr audit,[In]byte[] sd,IntPtr optional,uint count,ref Reply reply,IntPtr cached);
 [DllImport("authz.dll")] static extern bool AuthzFreeContext(IntPtr context);
 [DllImport("authz.dll")] static extern bool AuthzFreeResourceManager(IntPtr manager);
 static IntPtr SidPtr(string value) {var sid=new SecurityIdentifier(value);var bytes=new byte[sid.BinaryLength];sid.GetBinaryForm(bytes,0);var ptr=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,ptr,bytes.Length);return ptr;}
 public static bool OrdinaryAllowed(byte[] descriptor,uint access) {
   IntPtr manager=IntPtr.Zero,context=IntPtr.Zero,added=IntPtr.Zero;
   var ids=new[]{SidPtr("S-1-5-21-123456789-123456789-123456789-987654"),SidPtr("S-1-5-11"),SidPtr("S-1-5-32-545"),SidPtr("S-1-1-0")};
   var granted=Marshal.AllocHGlobal(4);var sacl=Marshal.AllocHGlobal(4);var error=Marshal.AllocHGlobal(4);
   try {
     // NO_AUDIT and SKIP_TOKEN_GROUPS: no logon, account changes or AD lookup.
     if(!AuthzInitializeResourceManager(1,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,"Tong synthetic ACL",out manager))throw new Exception("AUTHZ_MANAGER_FAILED");
     if(!AuthzInitializeContextFromSid(2,ids[0],manager,IntPtr.Zero,new Luid(),IntPtr.Zero,out context))throw new Exception("AUTHZ_CONTEXT_FAILED");
     var groups=new[]{new Sid{value=ids[1],attributes=4},new Sid{value=ids[2],attributes=4},new Sid{value=ids[3],attributes=4}};
     if(!AuthzAddSidsToContext(context,groups,3,IntPtr.Zero,0,out added))throw new Exception("AUTHZ_GROUP_FAILED");
     var request=new Request{desired=access};var reply=new Reply{length=1,granted=granted,sacl=sacl,error=error};
     if(!AuthzAccessCheck(0,added,ref request,IntPtr.Zero,descriptor,IntPtr.Zero,0,ref reply,IntPtr.Zero))throw new Exception("AUTHZ_CHECK_FAILED");
     return Marshal.ReadInt32(error)==0 && ((uint)Marshal.ReadInt32(granted)&access)==access;
   } finally {if(added!=IntPtr.Zero)AuthzFreeContext(added);if(context!=IntPtr.Zero)AuthzFreeContext(context);if(manager!=IntPtr.Zero)AuthzFreeResourceManager(manager);foreach(var id in ids)Marshal.FreeHGlobal(id);Marshal.FreeHGlobal(granted);Marshal.FreeHGlobal(sacl);Marshal.FreeHGlobal(error);}
 }
}
'@
    $results=@()
    foreach($name in @('policy.json','operation.json','audit.jsonl')) {
        $pathItem=Join-Path $testRoot $name
        [IO.File]::WriteAllText($pathItem,'synthetic ACL canary')
        $acl=Get-Acl -LiteralPath $pathItem
        $descriptor=$acl.GetSecurityDescriptorBinaryForm()
        $write=[TongAclProbe]::OrdinaryAllowed($descriptor,2)
        $delete=[TongAclProbe]::OrdinaryAllowed($descriptor,0x10000)
        $changeAcl=[TongAclProbe]::OrdinaryAllowed($descriptor,0x40000)
        if($write -or $delete -or $changeAcl){throw 'Ordinary identity gained protected state modification rights'}
        $results+=[pscustomobject]@{name=$name;writeDenied=-not $write;deleteDenied=-not $delete;changeAclDenied=-not $changeAcl;inheritedDacl=$true}
    }
    $control=[TongAclProbe]::OrdinaryAllowed((Get-Acl -LiteralPath 'D:\agentdock-poc-20261010\isolated').GetSecurityDescriptorBinaryForm(),2)
    if(-not $control){throw 'ACL probe failed to detect the known broad inherited write permission'}
    $evidence=[pscustomobject]@{passed=$true;root=$testRoot;method='Windows AuthzAccessCheck with synthetic ordinary SID + Authenticated Users/Users/Everyone';realUserLogon=$false;broadParentWriteDetected=$control;results=$results}
    $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $testRoot 'evidence.json') -Encoding utf8
    $evidence | ConvertTo-Json -Depth 5 -Compress
} finally {$env:TEMP=$previousTemp;$env:TMP=$previousTmp}
