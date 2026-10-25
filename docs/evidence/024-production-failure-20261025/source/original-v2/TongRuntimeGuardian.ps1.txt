param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$NodeExe,[Parameter(Mandatory)][string]$Supervisor,[string]$RecoveryGrantId)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$job=[IntPtr]::Zero
$stage='compile'
$approvedRoot=$false
function Write-GuardianEvent([string]$Event,$Details) {
    $entry=[ordered]@{at=[datetime]::UtcNow.ToString('o');runId=$RunId;event=$Event;guardianPid=$PID;stage=$stage}
    if($Details){foreach($key in $Details.Keys){$entry[$key]=$Details[$key]}}
    [IO.File]::AppendAllText((Join-Path $Root 'logs\guardian.jsonl'),(($entry|ConvertTo-Json -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
}
try {
    if ($Root -match '["\r\n]' -or $RunId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid guardian settings' }
    $boundary='D:\Tong\state\'
    $Root=[IO.Path]::GetFullPath($Root)
    if($Root -ceq 'D:\Tong\runtime') {
        if($NodeExe -cne 'D:\node\node.exe' -or $Supervisor -cne 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs'){throw 'Fixed production entry required'}
        if($RecoveryGrantId){& $NodeExe $Supervisor preflight-login --root $Root --grant-id $RecoveryGrantId | Out-Null}else{& $NodeExe $Supervisor preflight-production | Out-Null}
        if($LASTEXITCODE -ne 0){throw 'Production approval refused'}
    }elseif(-not $Root.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'Root outside approved scope'}
    $approvedRoot=$true
    Write-GuardianEvent 'guardian_started' $null
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
  public static IntPtr Create(string name) { var job=CreateJobObject(IntPtr.Zero,name); int error=Marshal.GetLastWin32Error(); if(job==IntPtr.Zero)throw new Exception("JOB_CREATE_FAILED"); if(error==183){CloseHandle(job);throw new Exception("JOB_ALREADY_EXISTS");} var data=new Extended(); data.basic.flags=0x2000; int size=Marshal.SizeOf(data); var ptr=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(data,ptr,false);if(!SetInformationJobObject(job,9,ptr,(uint)size)){CloseHandle(job);throw new Exception("JOB_CONFIG_FAILED");}}finally{Marshal.FreeHGlobal(ptr);}return job; }
  public static int Active(IntPtr job) { var ptr=Marshal.AllocHGlobal(48);try{if(!QueryInformationJobObject(job,1,ptr,48,IntPtr.Zero))throw new Exception("JOB_QUERY_FAILED");return Marshal.ReadInt32(ptr,40);}finally{Marshal.FreeHGlobal(ptr);} }
}
'@
    function Save-Json([string]$Path,$Value) { $tempPath=$Path+'.'+[guid]::NewGuid().ToString()+'.tmp'; [IO.File]::WriteAllText($tempPath,($Value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $tempPath -Destination $Path -Force }
    $stage='read-request'
    $request=Get-Content -LiteralPath (Join-Path $Root 'run\request.json') -Raw | ConvertFrom-Json
    if ($request.runId -ne $RunId) { throw 'Run identity mismatch' }
    if($RecoveryGrantId){
        if($RecoveryGrantId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' -or $request.recoveryGrantId -cne $RecoveryGrantId){throw 'Recovery grant identity mismatch'}
        & $NodeExe $Supervisor preflight-login --root $Root --grant-id $RecoveryGrantId | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Recovery authorization refused'}
    }elseif($request.PSObject.Properties['recoveryGrantId']){throw 'Recovery request requires explicit guardian authorization'}
    $stage='create-job'
    $jobName='Local\TongRuntime-'+$RunId
    $job=[TongRuntimeJob]::Create($jobName)
    Write-GuardianEvent 'job_created' @{jobName=$jobName;killOnJobClose=$true}
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$NodeExe
    $info.Arguments='--trace-uncaught --trace-warnings "'+$Supervisor+'" supervise --root "'+$Root+'" --run-id "'+$RunId+'"'
    $info.WorkingDirectory=$Root; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.EnvironmentVariables.Clear()
    foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) { if($entry.Key -match '^(SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|PROGRAMDATA|PATH|PATHEXT|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS)$') { $info.EnvironmentVariables[[string]$entry.Key]=[string]$entry.Value } }
    $stage='spawn-node'
    $node=[Diagnostics.Process]::new(); $node.StartInfo=$info; $null=$node.Start()
    $nodeTicks=$node.StartTime.ToUniversalTime().Ticks
    $nodeIdentity=[ordered]@{pid=$node.Id;parentPid=$PID;exe=$NodeExe;startTicks=($nodeTicks-($nodeTicks%10)).ToString();markerMatches=$true}
    Write-GuardianEvent 'node_spawned' @{nodePid=$node.Id}
    $stage='assign-job'
    if (-not [TongRuntimeJob]::AssignProcessToJobObject($job,$node.Handle)) { $node.Kill(); throw 'Job assignment failed' }
    $selfInfo=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$PID)
    $guardian=[ordered]@{schemaVersion=1;runId=$RunId;pid=$PID;exe=$selfInfo.ExecutablePath;startTicks=$selfInfo.CreationDate.ToUniversalTime().Ticks.ToString();nodePid=$node.Id;jobAssigned=$true;jobName=$jobName;killOnJobClose=$true;startedAt=[datetime]::UtcNow.ToString('o')}
    $stage='record-start'
    Save-Json (Join-Path $Root 'run\guardian.json') $guardian
    Write-GuardianEvent 'job_assigned' @{nodePid=$node.Id}
    $stage='wait-node'
    $heartbeat=[datetime]::UtcNow.AddSeconds(60)
    while(-not $node.WaitForExit(100)) {
        if([datetime]::UtcNow -ge $heartbeat){Write-GuardianEvent 'guardian_heartbeat' @{nodePid=$node.Id;jobActive=[TongRuntimeJob]::Active($job)};$heartbeat=[datetime]::UtcNow.AddSeconds(60)}
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
    $runtime=$null
    if(Test-Path -LiteralPath $runtimePath){$runtime=Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json}
    if($null -eq $runtime -or $runtime.runId -cne $RunId){
        # Even a Supervisor that exits before its first persist needs a terminal
        # record for subsequent starts. Never publish over a replacement request.
        $currentRequest=Get-Content -LiteralPath (Join-Path $Root 'run\request.json') -Raw | ConvertFrom-Json
        if($currentRequest.runId -cne $RunId){throw 'Run replaced during Guardian cleanup'}
        $runtime=[ordered]@{schemaVersion=1;runId=$RunId;phase=$(if($active -gt 0){'cleanup_required'}else{'abnormal_exit'});supervisor=$nodeIdentity;children=@();descendants=@();startedAt=$guardian.startedAt;finishedAt=$guardian.finishedAt;exits=@($exitEvent)}
        Save-Json $runtimePath $runtime
        Write-GuardianEvent 'supervisor_exit_before_record' @{nodePid=$node.Id;jobActiveAfterCleanup=$active}
    }elseif($runtime.supervisor.pid -eq $node.Id -and ($active -gt 0 -or $runtime.phase -in @('starting','ready','stopping'))){$runtime.phase=if($active -gt 0){'cleanup_required'}else{'abnormal_exit'};$runtime | Add-Member -NotePropertyName finishedAt -NotePropertyValue $guardian.finishedAt -Force;Save-Json $runtimePath $runtime}
} catch { if($approvedRoot){try { $failure=[ordered]@{runId=$RunId;stage=$stage;at=[datetime]::UtcNow.ToString('o');exceptionType=$_.Exception.GetType().FullName;errorId=$_.FullyQualifiedErrorId;win32Error=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}; [IO.File]::WriteAllText((Join-Path $Root 'run\guardian-failure.json'),($failure | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));Write-GuardianEvent 'guardian_failure' $failure } catch { }}; [Console]::Error.WriteLine('Tong runtime guardian failed; inspect protected lifecycle records'); exit 2 }
finally { if($job -ne [IntPtr]::Zero){$null=[TongRuntimeJob]::CloseHandle($job);if($approvedRoot){try{Write-GuardianEvent 'job_handle_closed' $null}catch{}}} }
