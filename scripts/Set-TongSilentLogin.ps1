param(
    [ValidateSet('prepare','apply','rollback')][string]$Mode='prepare',
    [Parameter(Mandatory)][string]$EvidenceRoot,
    [string]$VerifiedHost
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$runtime='D:\Tong\runtime'
$deployment=Join-Path $runtime 'login-management'
$runner=Join-Path $deployment 'TongLoginRuntime.ps1'
$hostPath=Join-Path $deployment 'TongLoginHost.exe'
$manager=Join-Path $runtime 'releases\manager\scripts\TongAgentDockRuntime.mjs'
function Runtime([string]$Action){
    $raw=& 'D:\node\node.exe' $manager $Action --root $runtime --error-json
    if($LASTEXITCODE -ne 0){throw ('Runtime '+$Action+' refused')}
    return ($raw|ConvertFrom-Json)
}
function Assert-PrivateDirectory([string]$Path){
    $item=Get-Item -LiteralPath $Path -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked directory refused'}
    $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
    $acl=Get-Acl -LiteralPath $Path
    if(-not $acl.AreAccessRulesCanonical -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'Untrusted directory owner or ACL'}
    foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notin $allowed){throw 'Foreign directory access refused'}}
}
$EvidenceRoot=[IO.Path]::GetFullPath($EvidenceRoot)
if(-not $EvidenceRoot.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase) -and -not $EvidenceRoot.StartsWith(($deployment+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Evidence must be in Tong state or login-management'}
$service=New-Object -ComObject Schedule.Service
$service.Connect()
$folder=$service.GetFolder('\')
$task=$folder.GetTask('TongLoginRuntime')
$manifestPath=Join-Path $EvidenceRoot 'silent-login.json'
if($Mode -eq 'prepare'){
    if(Test-Path -LiteralPath $EvidenceRoot){throw 'Evidence path already exists'}
    Assert-PrivateDirectory (Split-Path -Parent $EvidenceRoot)
    Assert-PrivateDirectory $deployment
    if(-not $VerifiedHost -or -not (Test-Path -LiteralPath $VerifiedHost -PathType Leaf)){throw 'A verified host is required'}
    $state=Runtime 'status'
    if(-not $state.supervisorAlive -or -not $state.guardianAlive -or $state.phase -cne 'ready' -or -not (Runtime 'doctor').healthy){throw 'Healthy independent runtime required'}
    $instances=@($task.GetInstances(0))
    if($instances.Count -ne 1){throw 'Exactly one existing login instance required'}
    $definition=$task.Definition
    if($definition.Actions.Count -ne 1 -or $definition.Actions.Item(1).Path -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or $definition.Actions.Item(1).Arguments -cne ('-NoLogo -NoProfile -NonInteractive -File "'+$runner+'" -Mode run') -or $definition.Principal.LogonType -ne 3 -or $definition.Settings.MultipleInstances -ne 2){throw 'Unexpected login task definition'}
    $null=New-Item -ItemType Directory -Path $EvidenceRoot
    Assert-PrivateDirectory $EvidenceRoot
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'original-task.xml'),$task.Xml,[Text.Encoding]::Unicode)
    Copy-Item -LiteralPath $runner -Destination (Join-Path $EvidenceRoot 'TongLoginRuntime.ps1')
    Copy-Item -LiteralPath $VerifiedHost -Destination (Join-Path $EvidenceRoot 'TongLoginHost.exe')
    $old=Get-Process -Id $instances[0].EnginePID
    $manifest=[ordered]@{schemaVersion=1;preparedAt=[DateTime]::UtcNow.ToString('o');originalTaskHash=(Get-FileHash -LiteralPath (Join-Path $EvidenceRoot 'original-task.xml')).Hash;runnerHash=(Get-FileHash -LiteralPath $runner).Hash;hostHash=(Get-FileHash -LiteralPath $VerifiedHost).Hash;oldInstance=$instances[0].InstanceGuid;oldPid=$old.Id;oldStartTicks=$old.StartTime.ToUniversalTime().Ticks;runId=$state.runId;supervisorPid=$state.supervisor.pid;supervisorTicks=$state.supervisor.startTicks;guardianPid=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$state.supervisor.pid)).ParentProcessId}
    [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Output ('Prepared rollback and reviewed host: '+$EvidenceRoot)
    exit 0
}
Assert-PrivateDirectory $EvidenceRoot
Assert-PrivateDirectory $deployment
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($manifest.schemaVersion -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $EvidenceRoot 'original-task.xml')).Hash -cne $manifest.originalTaskHash -or (Get-FileHash -LiteralPath $runner).Hash -cne $manifest.runnerHash){throw 'Rollback material or pinned runner changed'}
if($Mode -eq 'rollback'){
    # Restore the definition for the next launch, without killing the healthy
    # current monitoring instance or any independently owned runtime component.
    $null=$folder.RegisterTask('TongLoginRuntime',(Get-Content -LiteralPath (Join-Path $EvidenceRoot 'original-task.xml') -Raw),4,$null,$null,3)
    Write-Output 'Original task definition restored; current monitoring and runtime left running. Original entry retained.'
    exit 0
}
if((Get-FileHash -LiteralPath (Join-Path $EvidenceRoot 'TongLoginHost.exe')).Hash -cne $manifest.hostHash -or $task.Xml -cne (Get-Content -LiteralPath (Join-Path $EvidenceRoot 'original-task.xml') -Raw)){throw 'Task or reviewed host changed since preparation'}
if(Test-Path -LiteralPath $hostPath){throw 'Existing host will not be overwritten'}
$oldInstance=@($task.GetInstances(0))|Where-Object InstanceGuid -eq $manifest.oldInstance
if(-not $oldInstance -or (Get-Process -Id $manifest.oldPid).StartTime.ToUniversalTime().Ticks -ne $manifest.oldStartTicks){throw 'Original instance identity changed'}
$state=Runtime 'status'
if($state.runId -cne $manifest.runId -or $state.supervisor.pid -ne $manifest.supervisorPid -or $state.supervisor.startTicks -cne $manifest.supervisorTicks -or -not (Runtime 'doctor').healthy){throw 'Production identity or health changed'}
Copy-Item -LiteralPath (Join-Path $EvidenceRoot 'TongLoginHost.exe') -Destination $hostPath
$newInstance=$null
$handedOver=$false
try{
    $definition=$task.Definition
    $definition.Actions.Item(1).Path=$hostPath
    $definition.Actions.Item(1).Arguments=''
    # Temporarily allow two instances of this SAME task for a verified handover.
    # No additional task/service is registered. Restore IgnoreNew immediately.
    $definition.Settings.MultipleInstances=0
    $updated=$folder.RegisterTaskDefinition('TongLoginRuntime',$definition,4,$null,$null,3)
    try{$newInstance=$updated.Run($null)}finally{
        $definition.Settings.MultipleInstances=2
        $null=$folder.RegisterTaskDefinition('TongLoginRuntime',$definition,4,$null,$null,3)
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    $newRunner=$null;$healthy=$false
    while([DateTime]::UtcNow -lt $deadline){
        $newInstance.Refresh()
        if($newInstance.State -ne 4){throw 'New login instance exited before takeover'}
        $candidates=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$newInstance.EnginePID)|Where-Object { $_.ExecutablePath -ieq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -and $_.CommandLine -like ('*"'+$runner+'" -Mode run') })
        if($candidates.Count -eq 1){
            $newRunner=$candidates[0]
            $events=@(Get-Content -LiteralPath (Join-Path $runtime 'logs\login-management.jsonl') -Tail 30|ForEach-Object {$_|ConvertFrom-Json}|Where-Object runnerPid -eq $newRunner.ProcessId)
            if(@($events|Where-Object event -eq 'runner_failed').Count){throw 'New monitor failed'}
            $healthy=@($events|Where-Object { $_.event -ceq 'runtime_healthy' -and $_.runId -ceq $manifest.runId }).Count -eq 1
            if($healthy){break}
        }
        Start-Sleep -Milliseconds 500
    }
    if(-not $healthy){throw 'New monitor did not confirm takeover'}
    $state=Runtime 'status'
    if($state.runId -cne $manifest.runId -or $state.supervisor.pid -ne $manifest.supervisorPid -or $state.supervisor.startTicks -cne $manifest.supervisorTicks -or -not $state.guardianAlive -or -not (Runtime 'doctor').healthy){throw 'Runtime changed during takeover'}
    # Only the old task instance is stopped, after new monitoring is healthy.
    # Guardian was verified independent of this task's process tree above.
    $old=Get-Process -Id $manifest.oldPid -ErrorAction SilentlyContinue
    if($old -and $old.StartTime.ToUniversalTime().Ticks -eq $manifest.oldStartTicks){$oldInstance.Stop()}
    $handedOver=$true
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'takeover.json'),(@{at=[DateTime]::UtcNow.ToString('o');oldPid=$manifest.oldPid;hostPid=$newInstance.EnginePID;runnerPid=$newRunner.ProcessId;runId=$state.runId;supervisorPid=$state.supervisor.pid;guardianPid=$manifest.guardianPid}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Output 'Silent task monitor took over; production run identity unchanged. Original definition and entry retained.'
}catch{
    if(-not $handedOver){
        if($newInstance){$newInstance.Stop()}
        $null=$folder.RegisterTask('TongLoginRuntime',(Get-Content -LiteralPath (Join-Path $EvidenceRoot 'original-task.xml') -Raw),4,$null,$null,3)
    }
    throw
}
