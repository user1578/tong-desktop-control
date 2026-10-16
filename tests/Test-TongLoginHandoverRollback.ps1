$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Execute the production rollback function with the scheduler as the sole fake.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\Set-TongSilentLogin.ps1'),[ref]$tokens,[ref]$errors)
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Restore-LoginMonitoring'},$true)
if(-not $function){throw 'Rollback implementation missing'}
. ([scriptblock]::Create($function.Extent.Text))
foreach($scenario in @('old-exited','both-exited','new-stop-fails')){
    $script:instances=@();$script:registered=$false;$script:started=$false;$script:stopped=$false
    $old=[pscustomobject]@{InstanceGuid='old'}
    $new=[pscustomobject]@{InstanceGuid='new';State=4}
    $new|Add-Member ScriptMethod Refresh {}
    $new|Add-Member ScriptMethod Stop {if(-not $script:registered){throw 'Rollback must precede cleanup'};$script:stopped=$true;throw 'SCHED_E_TASK_NOT_RUNNING'}
    if($scenario -eq 'old-exited'){$script:instances=@($new)}
    if($scenario -eq 'new-stop-fails'){$script:instances=@($old,$new)}
    $restored=[pscustomobject]@{}
    $restored|Add-Member ScriptMethod GetInstances {param($flags) return $script:instances}
    $restored|Add-Member ScriptMethod Run {param($args) $script:started=$true;return $null}
    $folder=[pscustomobject]@{Restored=$restored}
    $folder|Add-Member ScriptMethod RegisterTask {param($name,$xml,$flags,$user,$password,$logon) if($name -cne 'TongLoginRuntime' -or $xml -cne 'original' -or $flags -ne 4){throw 'Wrong rollback'};$script:registered=$true;return $this.Restored}
    Restore-LoginMonitoring $folder $old $new 'original'
    if(-not $script:registered){throw 'Definition not restored'}
    if($scenario -eq 'old-exited' -and ($script:stopped -or $script:started)){throw 'Only living monitor must be preserved'}
    if($scenario -eq 'both-exited' -and -not $script:started){throw 'Missing monitor not restarted'}
    if($scenario -eq 'new-stop-fails' -and -not $script:stopped){throw 'Cleanup path not exercised'}
}
'PASS: failed handover restores definition, retains sole monitor, tolerates cleanup failure and restarts absent monitoring'
