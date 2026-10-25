param([string]$ScriptsRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$scripts=if($ScriptsRoot){[IO.Path]::GetFullPath($ScriptsRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts'))}
$testRoot=Join-Path 'D:\Tong\state' ('atomic-job-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $testRoot
$protocol=Get-Content (Join-Path $scripts 'TongStartupProtocol.ps1') -Raw
$guardianSource=Get-Content (Join-Path $scripts 'TongRuntimeGuardian.ps1') -Raw
$jobCode=[regex]::Match($guardianSource,"Add-Type -TypeDefinition @'([\s\S]*?)'@").Groups[1].Value
foreach($mode in @('preflight','supervisor','guardian')){
    $root=Join-Path $testRoot $mode;$runId=[guid]::NewGuid().ToString()
    $null=New-Item -ItemType Directory -Path (Join-Path $root 'run'),(Join-Path $root 'logs')
    $marker=Join-Path $root 'created.txt'
    # Pause immediately AFTER kernel creation and BEFORE the caller can assign,
    # resume, persist a PID, or return. No production test hook is introduced.
    $private=$protocol.Replace('   return info;',('   System.IO.File.WriteAllText(@"'+$marker+'",info.pid.ToString()); System.Threading.Thread.Sleep(30000); return info;'))
    if($private -ceq $protocol){throw 'Atomic creation test hook missed'}
    [IO.File]::WriteAllText((Join-Path $root 'helper.ps1'),$private)
    [IO.File]::WriteAllText((Join-Path $root 'run\request.json'),(@{runId=$runId;startupDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000}|ConvertTo-Json -Compress))
    $supervisor=Join-Path $root 'supervisor.mjs';[IO.File]::WriteAllText($supervisor,'setInterval(()=>{},1000);')
    $body="param(`$Root,`$RunId)`n. (Join-Path `$Root 'helper.ps1')`n"
    if($mode -eq 'preflight'){$body+="`$probe=[TongStartupPreflight]::new(('Local\TongPreflight-launcher-'+`$RunId),'D:\node\node.exe','-e '+[char]34+'setInterval(()=>{},1000)'+[char]34,`$Root)"}
    elseif($mode -eq 'supervisor'){
        $body+="Add-Type -TypeDefinition @'`n"+$jobCode+"`n'@`n`$job=[TongRuntimeJob]::Create(('Local\TongRuntime-'+`$RunId))`n`$child=[TongStartupPreflight]::StartNode(`$job,'D:\node\node.exe','-e '+[char]34+'setInterval(()=>{},1000)'+[char]34,`$Root,[string]([char]0+[string][char]0))"
    }else{
        $arguments='-NoProfile -NonInteractive -File "'+(Join-Path $scripts 'TongRuntimeGuardian.ps1')+'" -Root "'+$root+'" -RunId '+$runId+' -NodeExe D:\node\node.exe -Supervisor "'+$supervisor+'" -OwnerJobName "Local\TongGuardian-'+$runId+'"'
        $body+="`$child=[TongStartupPreflight]::StartGuardian(('Local\TongGuardian-'+`$RunId),'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe','"+$arguments.Replace("'","''")+"',`$Root,30000)"
    }
    $worker=Join-Path $root 'worker.ps1';[IO.File]::WriteAllText($worker,$body)
    $info=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" -Root "'+$root+'" -RunId '+$runId))
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $owner=[Diagnostics.Process]::Start($info);$childId=0
    try{
        $until=[DateTime]::UtcNow.AddSeconds(15)
        while(-not (Test-Path $marker) -and [DateTime]::UtcNow -lt $until -and -not $owner.HasExited){Start-Sleep -Milliseconds 50}
        if(-not (Test-Path $marker)){throw ('Creation boundary not reached: '+$mode)}
        $childId=[int](Get-Content $marker -Raw)
        $identity=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$childId)
        if(-not $identity){throw 'Child not observed at creation boundary'}
        $owner.Kill();$owner.WaitForExit()
        if($mode -eq 'guardian'){
            # The independent Guardian owns its inherited lifetime Job and must
            # still honor cancellation even if the Launcher cannot publish PID.
            [IO.File]::WriteAllText((Join-Path $root 'run\abort.json'),(@{runId=$runId}|ConvertTo-Json -Compress))
        }
        $until=[DateTime]::UtcNow.AddSeconds(20)
        do{$actual=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$childId);if(-not $actual -or $actual.CreationDate -ne $identity.CreationDate){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $until)
        if($actual -and $actual.CreationDate -eq $identity.CreationDate){throw ('Child survived owner loss and cleanup: '+$mode)}
        Write-Output ('PASS: atomic '+$mode+'; owner killed inside CreateProcess return boundary; child gone')
    }finally{if(-not $owner.HasExited){$owner.Kill();$owner.WaitForExit()};$owner.Dispose()}
}
Write-Output ('Evidence: '+$testRoot)
