param([string]$ScriptsRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$scripts=if($ScriptsRoot){[IO.Path]::GetFullPath($ScriptsRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts'))}
. (Join-Path $scripts 'TongStartupProtocol.ps1')
$NodeExe='D:\node\node.exe'
$testRoot=Join-Path 'D:\Tong\state' ('startup-protocol-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $testRoot
foreach($scenario in @('slow','timeout','cancel')){
    $Root=Join-Path $testRoot $scenario;$RunId=[guid]::NewGuid().ToString()
    $null=New-Item -ItemType Directory -Path (Join-Path $Root 'run')
    $scriptPath=Join-Path $Root 'preflight.mjs'
    $delay=if($scenario -eq 'slow'){16000}else{60000}
    $scriptText=@'
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [root,runId,mode,delay]=process.argv.slice(2);
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
writeFileSync(join(root,'child.json'),JSON.stringify({pid:child.pid}));
if(mode==='cancel')setTimeout(()=>writeFileSync(join(root,'run','abort.json'),JSON.stringify({runId})),300);
setTimeout(()=>process.exit(0),Number(delay));
'@
    [IO.File]::WriteAllText($scriptPath,$scriptText)
    $budget=if($scenario -eq 'slow'){30000}else{1500}
    [IO.File]::WriteAllText((Join-Path $Root 'run\request.json'),(@{runId=$RunId;startupDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$budget}|ConvertTo-Json -Compress))
    Initialize-TongStartup 'launcher'
    $watch=[Diagnostics.Stopwatch]::StartNew();$failure=$null
    try{Invoke-TongStartupPreflight ('"'+$scriptPath+'" "'+$Root+'" '+$RunId+' '+$scenario+' '+$delay)}catch{$failure=$_.Exception.Message}
    if($scenario -eq 'slow'){
        if($failure -or $watch.ElapsedMilliseconds -lt 15000){throw ('Slow preflight failed: '+$failure)}
    }elseif($failure -cne $(if($scenario -eq 'timeout'){'START_TIMEOUT'}else{'START_ABORT'})){throw ('Wrong cancellation reason: '+$failure)}
    if(-not $script:tongStartup.preflightClean){throw 'Preflight cleanup not proven'}
    $child=Get-Content -LiteralPath (Join-Path $Root 'child.json') -Raw|ConvertFrom-Json
    $until=[DateTime]::UtcNow.AddSeconds(5)
    do{$remaining=Get-Process -Id $child.pid -ErrorAction SilentlyContinue;if(-not $remaining -or $remaining.HasExited){break};Start-Sleep -Milliseconds 50}while([DateTime]::UtcNow -lt $until)
    if($remaining -and -not $remaining.HasExited){throw 'Preflight descendant survived'}
    Write-Output ('PASS: '+$scenario+'; descendant gone; cleanup proven')
}
# Killing the owner must close the kernel Job even when PowerShell cannot run a
# finally block. This worker and all its data are newly created test resources.
$Root=Join-Path $testRoot 'owner-exit';$RunId=[guid]::NewGuid().ToString()
$null=New-Item -ItemType Directory -Path (Join-Path $Root 'run')
[IO.File]::WriteAllText((Join-Path $Root 'run\request.json'),(@{runId=$RunId;startupDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000}|ConvertTo-Json -Compress))
$worker=Join-Path $Root 'worker.ps1'
$workerText="param(`$Root,`$RunId,`$NodeExe)`n. '"+(Join-Path $scripts 'TongStartupProtocol.ps1')+"'`nInitialize-TongStartup 'launcher'`nInvoke-TongStartupPreflight ('-e '+[char]34+'setInterval(()=>{},1000)'+[char]34)`n"
[IO.File]::WriteAllText($worker,$workerText)
$info=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" -Root "'+$Root+'" -RunId '+$RunId+' -NodeExe "'+$NodeExe+'"'))
$info.UseShellExecute=$false;$info.CreateNoWindow=$true
$owner=[Diagnostics.Process]::Start($info)
$observed=@();$until=[DateTime]::UtcNow.AddSeconds(10)
try{
    while([DateTime]::UtcNow -lt $until){
        $observed=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$owner.Id)|Where-Object {$_.Name -eq 'node.exe'})
        if($observed.Count){break};Start-Sleep -Milliseconds 100
    }
    if(-not $observed.Count){throw 'Worker never started its owned preflight'}
    $owner.Kill();$owner.WaitForExit()
    foreach($p in $observed){
        $until=[DateTime]::UtcNow.AddSeconds(5)
        do{$actual=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ProcessId);if(-not $actual -or $actual.CreationDate -ne $p.CreationDate){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
        if($actual -and $actual.CreationDate -eq $p.CreationDate){throw 'Owner exit leaked preflight'}
    }
}finally{if(-not $owner.HasExited){$owner.Kill();$owner.WaitForExit()};$owner.Dispose()}
Write-Output ('PASS: owner exit closes private preflight Job; evidence '+$testRoot)
# Deterministic failure of the kernel observation: execute the real function
# body with an unavoidable Job API double. Unproven cleanup must never advance
# to Guardian creation, even when the preflight's own exit code was zero.
$Root=Join-Path $testRoot 'unproven';$RunId=[guid]::NewGuid().ToString()
$null=New-Item -ItemType Directory -Path (Join-Path $Root 'run')
[IO.File]::WriteAllText((Join-Path $Root 'run\request.json'),(@{runId=$RunId;startupDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000}|ConvertTo-Json -Compress))
Initialize-TongStartup 'launcher'
$script:uncleanProbe=[pscustomobject]@{Exited=$true;ExitCode=0;Active=1;Pid=1;StartTicks='1'}
$script:uncleanProbe|Add-Member ScriptMethod Cancel {}
$script:uncleanProbe|Add-Member ScriptMethod Dispose {}
$body=${function:Invoke-TongStartupPreflight}.ToString() -replace '(?m)^\s*\$probe=\[TongStartupPreflight\]::new.*$','$probe=$script:uncleanProbe'
$body=$body.Replace('.AddSeconds(10)','.AddSeconds(0)')
Invoke-Expression ('function Invoke-UncleanPreflight {'+$body+'}')
$failure=$null;try{Invoke-UncleanPreflight 'unused'}catch{$failure=$_.Exception.Message}
if($failure -cne 'PREFLIGHT_CLEANUP_REQUIRED'){throw 'Unproven cleanup advanced beyond preflight'}
Write-Output 'PASS: unproven preflight cleanup refuses Guardian creation'
