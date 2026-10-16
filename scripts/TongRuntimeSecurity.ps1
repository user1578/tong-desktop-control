param([ValidateSet('acl','protect','unprotect','identity','descendants','terminate','runtime-job')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$pipe = $null
try {
    $inputData = ConvertFrom-Json ([Console]::In.ReadToEnd())
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    if ($Mode -eq 'acl') {
        $items = @()
        foreach ($target in $inputData.paths) {
            $item = Get-Item -LiteralPath $target -Force
            $acl = Get-Acl -LiteralPath $target
            $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
            $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
            $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
            $hasDacl = $null -ne $raw.DiscretionaryAcl
            $foreign = @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowedSids })
            $secure = $hasDacl -and $acl.AreAccessRulesCanonical -and $ownerSid -in $allowedSids -and $foreign.Count -eq 0 -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
            $items += [pscustomobject]@{path=[string]$target;secure=[bool]$secure;ownerSid=$ownerSid;protected=$acl.AreAccessRulesProtected;ordinaryWriteDenied=[bool]$secure;method='allow-SID enumeration with non-null canonical DACL';aces=@($rules | ForEach-Object {[pscustomobject]@{sid=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString();inherited=$_.IsInherited}})}
        }
        [pscustomobject]@{userSid=$currentSid;items=$items} | ConvertTo-Json -Depth 6 -Compress
    } elseif ($Mode -eq 'protect' -or $Mode -eq 'unprotect') {
        Add-Type -AssemblyName System.Security
        $entropy = [Text.Encoding]::UTF8.GetBytes('Tong-B2.2:' + [string]$inputData.purpose)
        if ($Mode -eq 'protect') {
            $plain = [Text.Encoding]::UTF8.GetBytes([string]$inputData.value)
            try { $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
            finally { [Array]::Clear($plain, 0, $plain.Length) }
            [pscustomobject]@{schemaVersion=1;scope='CurrentUser';userSid=$currentSid;purpose=$inputData.purpose;ciphertext=[Convert]::ToBase64String($encrypted)} | ConvertTo-Json -Compress
        } else {
            $envelope = Get-Content -LiteralPath $inputData.path -Raw | ConvertFrom-Json
            if ($envelope.schemaVersion -ne 1 -or $envelope.scope -ne 'CurrentUser' -or $envelope.userSid -ne $currentSid -or $envelope.purpose -ne $inputData.purpose) { throw 'Secret identity mismatch' }
            $decrypted = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($envelope.ciphertext), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            try {
                # Plaintext only crosses an ACL-protected named pipe, never stdout/argv/environment.
                $pipeAcl = [IO.Pipes.PipeSecurity]::new()
                $pipeAcl.SetAccessRuleProtection($true, $false)
                $pipeAcl.SetOwner([Security.Principal.SecurityIdentifier]::new($currentSid))
                foreach ($sid in $allowedSids) { $pipeAcl.AddAccessRule([IO.Pipes.PipeAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)) }
                $pipe = [IO.Pipes.NamedPipeServerStream]::new([string]$inputData.pipeName, [IO.Pipes.PipeDirection]::Out, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous, 4096, 4096, $pipeAcl)
                [Console]::Out.WriteLine('READY')
                $wait = $pipe.BeginWaitForConnection($null, $null)
                if (-not $wait.AsyncWaitHandle.WaitOne(10000)) { throw 'Secret pipe timeout' }
                $pipe.EndWaitForConnection($wait)
                $pipe.Write($decrypted, 0, $decrypted.Length)
                $pipe.Flush()
            } finally { [Array]::Clear($decrypted, 0, $decrypted.Length) }
        }
    } else {
        function Process-Info($p) {
            if ($null -eq $p) { return $null }
            [pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;exe=[string]$p.ExecutablePath;startTicks=$p.CreationDate.ToUniversalTime().Ticks.ToString()}
        }
        if ($Mode -eq 'runtime-job') {
            if([string]$inputData.runId -cnotmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'){throw 'Invalid runtime Job identity'}
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TongRuntimeJobProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,IntPtr info,uint size,IntPtr returned);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static int Active(string name) {
  var job=OpenJobObject(4,false,name);
  if(job==IntPtr.Zero){if(Marshal.GetLastWin32Error()==2)return -1;throw new Exception("JOB_PROBE_FAILED");}
  try{var ptr=Marshal.AllocHGlobal(48);try{if(!QueryInformationJobObject(job,1,ptr,48,IntPtr.Zero))throw new Exception("JOB_QUERY_FAILED");return Marshal.ReadInt32(ptr,40);}finally{Marshal.FreeHGlobal(ptr);}}
  finally{CloseHandle(job);}
 }
}
'@
            $active=[TongRuntimeJobProbe]::Active(('Local\TongRuntime-'+[string]$inputData.runId))
            [pscustomobject]@{exists=($active -ge 0);activeProcesses=[Math]::Max(0,$active)} | ConvertTo-Json -Compress
        } elseif ($Mode -eq 'descendants') {
            $all = @(Get-CimInstance Win32_Process)
            $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId]=$p }
            $ids = [Collections.Generic.HashSet[int]]::new(); $null = $ids.Add([int]$inputData.pid)
            # Historical ParentProcessId alone is not ownership: reject recycled ancestry.
            do { $added = $false; foreach ($p in $all) { $parent=$byId[[int]$p.ParentProcessId]; if ($null -ne $parent -and $p.CreationDate -ge $parent.CreationDate -and $ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true } } } while ($added)
            # Omit our short-lived metadata probes, not backend command processes.
            @($all | Where-Object { $_.ProcessId -ne [int]$inputData.pid -and $ids.Contains([int]$_.ProcessId) -and $_.CommandLine -notlike '*TongRuntimeSecurity.ps1*' } | ForEach-Object { Process-Info $_ }) | ConvertTo-Json -Depth 3 -Compress
        } else {
            $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$inputData.pid)
            if ($Mode -eq 'identity') {
                $result = Process-Info $p
                if ($null -ne $result) { $result | Add-Member -NotePropertyName markerMatches -NotePropertyValue ([string]$p.CommandLine -like ('*' + [string]$inputData.marker + '*')) }
                ConvertTo-Json -InputObject $result -Compress
            } else {
                # Open once, validate and terminate that handle. Never re-address a PID
                # after validation (it may have been recycled in the meantime).
                Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TongOwnedProcess {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static bool Terminate(int pid,string exe,string ticks) {
  var h=OpenProcess(0x1001,false,pid);if(h==IntPtr.Zero)return false;
  try {long a,b,c,d;var name=new StringBuilder(32768);uint length=32768;
   if(!GetProcessTimes(h,out a,out b,out c,out d)||!QueryFullProcessImageName(h,0,name,ref length))return false;
   long actual=DateTime.FromFileTimeUtc(a).Ticks;actual=actual/10*10;
   if(actual.ToString()!=ticks||!String.Equals(name.ToString(),exe,StringComparison.OrdinalIgnoreCase))return false;
   if(!TerminateProcess(h,1))throw new Exception("OWNED_TERMINATION_FAILED");return true;
  }finally{CloseHandle(h);}
 }
}
'@
                $matches = [TongOwnedProcess]::Terminate([int]$inputData.pid,[string]$inputData.exe,[string]$inputData.startTicks)
                [pscustomobject]@{matched=[bool]$matches} | ConvertTo-Json -Compress
            }
        }
    }
} catch { [Console]::Error.WriteLine('Tong runtime security operation refused'); exit 2 }
finally { if ($null -ne $pipe) { $pipe.Dispose() } }
