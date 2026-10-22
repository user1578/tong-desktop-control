$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Load only these definitions. The production runner, recovery loop, credentials
# and logs are never invoked; all fixtures are inline, self-exiting Node code.
$source=Join-Path $PSScriptRoot '..\scripts\TongLoginRuntime.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($name in @('New-LoginManagerProcess','Runtime')){
    $definition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
    if($definition.Count -ne 1){throw ('Missing function '+$name)}
    Invoke-Expression $definition[0].Extent.Text
}
$script:realFactory=${function:New-LoginManagerProcess}
$script:node=(Get-Command node.exe -CommandType Application).Source
$script:runtime=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:manager=Join-Path $runtime 'scripts\TongAgentDockRuntime.mjs'
$script:Mode='run'
$script:events=[Collections.Generic.List[object]]::new()
# Verify the real PS5.1-compatible Windows argument quoting and UTF-8 decoding,
# without replacing the factory's Arguments as the Manager fixtures below do.
$unicodeArgument=([string][char]0x4e2d)+[char]0x6587
$argumentProbe=& $script:realFactory @('--eval','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--','with spaces',$unicodeArgument,"apostrophe's",'')
try{
    $null=$argumentProbe.Start();$argumentProbe.StandardInput.Close()
    $output=$argumentProbe.StandardOutput.ReadToEndAsync();$errorOutput=$argumentProbe.StandardError.ReadToEndAsync()
    if(-not $argumentProbe.WaitForExit(5000) -or -not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($output,$errorOutput),2000) -or $argumentProbe.ExitCode -ne 0){throw 'Argument probe did not finish'}
    $received=$output.GetAwaiter().GetResult()|ConvertFrom-Json
    if($received.Count -ne 4 -or $received[0] -cne 'with spaces' -or $received[1] -cne $unicodeArgument -or $received[2] -cne "apostrophe's" -or $received[3] -cne ''){throw ('Windows quoting/UTF-8 argument round trip failed: '+($received|ConvertTo-Json -Compress))}
}finally{$argumentProbe.Dispose()}
function Write-RuntimeEvent($Event,$Status,$Reason,$Details){
    $script:events.Add([pscustomobject]@{event=$Event;reason=$Reason;details=$Details.Clone()})
}
function New-LoginManagerProcess([string[]]$Arguments){
    $script:argumentsSeen=$Arguments
    $process=& $script:realFactory $Arguments
    if($process.StartInfo.UseShellExecute -or -not $process.StartInfo.CreateNoWindow -or -not $process.StartInfo.RedirectStandardOutput -or -not $process.StartInfo.RedirectStandardError){throw 'Manager must use isolated output pipes without a console window'}
    # Exercise the real Process/pipe configuration, replacing only the pinned
    # Manager program with harmless inline code. Nothing is written to disk.
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script:fixture))
    $process.StartInfo.Arguments='-e "eval(Buffer.from('''+$encoded+''',''base64'').toString(''utf8''))"'
    if($script:failStart){$process.StartInfo.FileName=Join-Path $script:runtime 'nonexistent-synthetic-node.exe'}
    return $process
}
function Reset-Probe([string]$Code){$script:events.Clear();$script:fixture=$Code;$script:failStart=$false;$script:Mode='run'}
function Assert-Fails([scriptblock]$Action,[string]$Code){
    $caught=$null;try{& $Action}catch{$caught=$_}
    if($null -eq $caught -or $caught.Exception.Data['managerCode'] -cne $Code){throw ('Expected bounded Manager failure '+$Code+', got '+$caught)}
    return $caught
}
function Assert-ExitEvidence([int]$Code){
    $started=@($script:events|Where-Object event -eq 'manager_command_started')
    $exited=@($script:events|Where-Object event -eq 'manager_command_exited')
    if($started.Count -ne 1 -or $exited.Count -ne 1){throw 'Missing actual Manager start/exit evidence'}
    $proof=$exited[0].details
    if(-not $proof.exitObserved -or $proof.nativeExitCode -ne $Code -or $proof.managerPid -le 0 -or [long]$proof.managerStartTicks -le 0 -or $proof.managerPid -ne $started[0].details.managerPid -or $proof.managerStartTicks -cne $started[0].details.managerStartTicks){throw 'Exit evidence must identify the same native process'}
    $process=$null
    try{$process=[Diagnostics.Process]::GetProcessById($proof.managerPid);if(-not $process.HasExited){throw 'Reported Manager process is still alive'}}catch [ArgumentException]{}finally{if($process){$process.Dispose()}}
}
Reset-Probe 'setTimeout(()=>console.log(JSON.stringify({healthy:true})),250)'
$result=Runtime 'doctor'
if(-not $result.healthy){throw 'Successful Manager output lost'}
Assert-ExitEvidence 0
if($global:LASTEXITCODE -ne 0){throw 'Successful native exit code compatibility lost'}
if($script:argumentsSeen -notcontains '--login-recovery' -or $script:argumentsSeen -notcontains '--error-json'){throw 'Recovery/error protocol changed'}
Reset-Probe 'console.log(JSON.stringify({phase:"stopped"}))'
$null=Runtime 'stop-run' 'synthetic-run'
if($script:argumentsSeen -notcontains '--run-id' -or $script:argumentsSeen -notcontains 'synthetic-run'){throw 'Exact-run identity lost'}
Reset-Probe 'process.stderr.write("x".repeat(524288));console.log(JSON.stringify({healthy:true}))'
if(-not (Runtime 'doctor').healthy){throw 'Concurrent stdout/stderr draining failed'}
Assert-ExitEvidence 0
Reset-Probe 'console.log(JSON.stringify({error:"APPROVAL_DENIED"}));process.exitCode=1'
$null=Assert-Fails {Runtime 'start'} 'APPROVAL_DENIED'
Assert-ExitEvidence 1
if(($script:events|Where-Object event -eq 'manager_command_failed').details.outputKind -cne 'error_json'){throw 'Structured refusal classification lost'}
Reset-Probe 'process.exitCode=37'
$null=Assert-Fails {Runtime 'doctor'} 'REFUSED'
Assert-ExitEvidence 37
if($global:LASTEXITCODE -ne 37){throw 'Failed native exit code compatibility lost'}
$failure=($script:events|Where-Object event -eq 'manager_command_failed').details
if($failure.outputKind -cne 'empty' -or $failure.exitHex -cne '0x00000025'){throw 'Native failure evidence lost'}
Reset-Probe 'console.log("unstructured output")'
$null=Assert-Fails {Runtime 'doctor'} 'MANAGER_OUTPUT_INVALID'
Assert-ExitEvidence 0
Reset-Probe 'console.log(JSON.stringify({phase:"ready"}))'
$script:Mode='status'
if((Runtime 'status').phase -cne 'ready' -or $script:events.Count -or $script:argumentsSeen -contains '--login-recovery'){throw 'Standalone status must remain readonly without a recovery grant'}
Reset-Probe 'process.exitCode=37'
$script:Mode='status'
$null=Assert-Fails {Runtime 'status'} 'REFUSED'
if($script:events.Count){throw 'Readonly status failure must not write logs'}
Reset-Probe ''
$script:failStart=$true
$null=Assert-Fails {Runtime 'doctor'} 'MANAGER_START_FAILED'
if(@($script:events|Where-Object event -eq 'manager_command_exited').Count){throw 'A spawn failure must not claim process exit'}
# Model a retained pipe deterministically: this Windows Node build does not
# reliably pass .NET redirected stdout to spawn(...,{stdio:'inherit'}).
# Real process/pipe behavior above remains tested with concurrent large stderr.
$script:pendingOutput=[Threading.Tasks.TaskCompletionSource[string]]::new()
$script:exitCompletes=$true
function New-LoginManagerProcess([string[]]$Arguments){
    $output=[pscustomobject]@{}
    $output|Add-Member ScriptMethod ReadToEndAsync {return $script:pendingOutput.Task}
    $fake=[pscustomobject]@{Id=123;StartTime=[datetime]'2026-10-23T00:00:00Z';Handle=[intptr]1;ExitCode=0;StandardInput=[IO.StringWriter]::new();StandardOutput=$output;StandardError=[IO.StringReader]::new('')}
    $fake|Add-Member ScriptMethod Start {return $true}
    $fake|Add-Member ScriptMethod WaitForExit {param($ms) if($ms -ne 150000){throw 'Manager startup/cleanup budget changed'};return $script:exitCompletes}
    $fake|Add-Member ScriptMethod Dispose {}
    return $fake
}
Reset-Probe ''
$clock=[Diagnostics.Stopwatch]::StartNew()
$null=Assert-Fails {Runtime 'doctor'} 'MANAGER_OUTPUT_INCOMPLETE'
if($clock.Elapsed.TotalSeconds -gt 6 -or -not ($script:events|Where-Object event -eq 'manager_command_exited').details.exitObserved){throw 'Pipe retention must be bounded and distinct from actual process exit'}
$script:pendingOutput.SetResult('{"healthy":true}')
# A timeout must leave an unresolved process alone and preserve its identity,
# not kill it or manufacture an exit code. No real long-running process needed.
$script:exitCompletes=$false
Reset-Probe ''
$null=Assert-Fails {Runtime 'start'} 'MANAGER_EXIT_TIMEOUT'
$failure=($script:events|Where-Object event -eq 'manager_command_failed').details
if($failure.exitObserved -or $failure.managerPid -ne 123 -or $failure.nativeExitCode -ne $null -or @($script:events|Where-Object event -eq 'manager_command_exited').Count){throw 'An unresolved process must not have successful exit evidence'}
Write-Output 'PASS: real Manager exit identity/status, native/refusal/start failures, concurrent pipes, bounded inherited-output/exit waits and readonly status.'
