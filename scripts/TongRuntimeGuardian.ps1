param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$NodeExe,[Parameter(Mandatory)][string]$Supervisor)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$job=[IntPtr]::Zero
$stage='compile'
$approvedRoot=$false
try {
    if ($Root -match '["\r\n]' -or $RunId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid guardian settings' }
    $boundary='D:\agentdock-poc-20261010\isolated\state\'
    $Root=[IO.Path]::GetFullPath($Root)
    if(-not $Root.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved PoC'}
    $approvedRoot=$true
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TongRuntimeJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr c,d; public uint e; public UIntPtr f; public uint g,h; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,IntPtr info,uint size,IntPtr returned);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Create() { var job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero)throw new Exception("JOB_CREATE_FAILED"); var data=new Extended(); data.basic.flags=0x2000; int size=Marshal.SizeOf(data); var ptr=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(data,ptr,false);if(!SetInformationJobObject(job,9,ptr,(uint)size)){CloseHandle(job);throw new Exception("JOB_CONFIG_FAILED");}}finally{Marshal.FreeHGlobal(ptr);}return job; }
  public static int Active(IntPtr job) { var ptr=Marshal.AllocHGlobal(48);try{if(!QueryInformationJobObject(job,1,ptr,48,IntPtr.Zero))throw new Exception("JOB_QUERY_FAILED");return Marshal.ReadInt32(ptr,40);}finally{Marshal.FreeHGlobal(ptr);} }
}
'@
    function Save-Json([string]$Path,$Value) { $tempPath=$Path+'.'+[guid]::NewGuid().ToString()+'.tmp'; [IO.File]::WriteAllText($tempPath,($Value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $tempPath -Destination $Path -Force }
    $stage='read-request'
    $request=Get-Content -LiteralPath (Join-Path $Root 'run\request.json') -Raw | ConvertFrom-Json
    if ($request.runId -ne $RunId) { throw 'Run identity mismatch' }
    $stage='create-job'
    $job=[TongRuntimeJob]::Create()
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$NodeExe
    $info.Arguments='--trace-uncaught --trace-warnings "'+$Supervisor+'" supervise --root "'+$Root+'" --run-id "'+$RunId+'"'
    $info.WorkingDirectory=$Root; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.EnvironmentVariables.Clear()
    foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) { if($entry.Key -match '^(SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|PROGRAMDATA|PATH|PATHEXT|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS)$') { $info.EnvironmentVariables[[string]$entry.Key]=[string]$entry.Value } }
    $stage='spawn-node'
    $node=[Diagnostics.Process]::new(); $node.StartInfo=$info; $null=$node.Start()
    $stage='assign-job'
    if (-not [TongRuntimeJob]::AssignProcessToJobObject($job,$node.Handle)) { $node.Kill(); throw 'Job assignment failed' }
    $selfInfo=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$PID)
    $guardian=[ordered]@{schemaVersion=1;runId=$RunId;pid=$PID;exe=$selfInfo.ExecutablePath;startTicks=$selfInfo.CreationDate.ToUniversalTime().Ticks.ToString();nodePid=$node.Id;jobAssigned=$true;startedAt=[datetime]::UtcNow.ToString('o')}
    $stage='record-start'
    Save-Json (Join-Path $Root 'run\guardian.json') $guardian
    $stage='wait-node'
    while(-not $node.WaitForExit(100)) {
        $abortPath=Join-Path $Root 'run\abort.json'
        if(Test-Path -LiteralPath $abortPath) {
            $abort=Get-Content -LiteralPath $abortPath -Raw | ConvertFrom-Json
            if($abort.runId -eq $RunId) { if(-not [TongRuntimeJob]::TerminateJobObject($job,1)){throw 'Job abort failed'}; $node.WaitForExit(); break }
        }
    }
    $code=$node.ExitCode
    $before=[TongRuntimeJob]::Active($job)
    if ($before -gt 0) { if(-not [TongRuntimeJob]::TerminateJobObject($job,1)){throw 'Job termination failed'} }
    $active=$before
    for($i=0;$i -lt 100;$i++){ $active=[TongRuntimeJob]::Active($job);if($active -eq 0){break};Start-Sleep -Milliseconds 100 }
    $guardian['finishedAt']=[datetime]::UtcNow.ToString('o');$guardian['nodeExitCode']=$code;$guardian['nodeExitHex']=('0x{0:X8}' -f ([long]$code -band 0xffffffffL));$guardian['jobActiveBeforeCleanup']=$before;$guardian['jobActiveAfterCleanup']=$active
    Save-Json (Join-Path $Root 'run\guardian.json') $guardian
    $exitEvent=[ordered]@{at=$guardian.finishedAt;runId=$RunId;event='node_supervisor_exit';pid=$node.Id;exitCode=$code;hex=$guardian.nodeExitHex;classification=$(if($guardian.nodeExitHex -eq '0xC0000409'){'native_fast_fail'}elseif($code -eq 0){'normal_exit'}else{'abnormal_exit'});jobActiveAfterCleanup=$active}
    [IO.File]::AppendAllText((Join-Path $Root 'logs\guardian.jsonl'),(($exitEvent | ConvertTo-Json -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
    $runtimePath=Join-Path $Root 'run\runtime.json'
    if(Test-Path -LiteralPath $runtimePath){$runtime=Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json;if($runtime.runId -eq $RunId -and $runtime.supervisor.pid -eq $node.Id -and ($active -gt 0 -or $runtime.phase -in @('starting','ready','stopping'))){$runtime.phase=if($active -gt 0){'cleanup_required'}else{'abnormal_exit'};$runtime | Add-Member -NotePropertyName finishedAt -NotePropertyValue $guardian.finishedAt -Force;Save-Json $runtimePath $runtime}}
} catch { if($approvedRoot){try { $failure=[ordered]@{runId=$RunId;stage=$stage;at=[datetime]::UtcNow.ToString('o');exceptionType=$_.Exception.GetType().FullName;errorId=$_.FullyQualifiedErrorId;win32Error=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}; [IO.File]::WriteAllText((Join-Path $Root 'run\guardian-failure.json'),($failure | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false)) } catch { }}; [Console]::Error.WriteLine('Tong runtime guardian failed; inspect protected lifecycle records'); exit 2 }
finally { if($job -ne [IntPtr]::Zero){$null=[TongRuntimeJob]::CloseHandle($job)} }
