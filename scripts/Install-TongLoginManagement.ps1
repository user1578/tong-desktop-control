param([ValidateSet('prepare','install','rollback','status','start','stop','recover')][string]$Mode='prepare')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Keep the old preparation (including its tunnel artifacts) for diagnosis only.
$preparation='D:\Tong\state\p26-login-preparation-v2'
$deployment='D:\Tong\runtime\login-management'
$taskName='TongLoginRuntime'
$taskShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
function Assert-SafeDirectory([string]$Path) {
    $item=Get-Item -LiteralPath $Path -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked directory refused'}
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed=@($sid,'S-1-5-18','S-1-5-32-544')
    $acl=Get-Acl -LiteralPath $Path
    if(-not $acl.AreAccessRulesCanonical -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'Invalid protected directory'}
    foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notin $allowed){throw 'Foreign directory access refused'}}
}
function ManagerPreflight {
    $raw=& 'D:\node\node.exe' 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs' preflight-production --login-recovery
    if($LASTEXITCODE -ne 0){throw 'Current formal runtime permission/pin refused; no task installed'}
    $checked=$raw|ConvertFrom-Json
    if(-not $checked.approved -or -not $checked.PSObject.Properties['stopRunSupported'] -or -not $checked.stopRunSupported){throw 'Pinned manager update required for guarded login recovery'}
}
function Invoke-Runner([string]$Action) {
    & $taskShell -NoLogo -NoProfile -NonInteractive -File (Join-Path $deployment 'TongLoginRuntime.ps1') -Mode $Action
    if($LASTEXITCODE -ne 0){throw ('Runtime '+$Action+' failed')}
}
if($Mode -eq 'prepare') {
    if(Test-Path -LiteralPath $preparation){throw 'Preparation already exists'}
    Assert-SafeDirectory 'D:\Tong\state'
    New-Item -ItemType Directory -Path $preparation|Out-Null
    Assert-SafeDirectory $preparation
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TongLoginRuntime.ps1') -Destination (Join-Path $preparation 'TongLoginRuntime.ps1')
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $action=New-ScheduledTaskAction -Execute $taskShell -Argument ('-NoLogo -NoProfile -NonInteractive -File "'+$deployment+'\TongLoginRuntime.ps1" -Mode run') -WorkingDirectory 'D:\Tong\runtime'
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $sid
    $trigger.Delay='PT20S'
    $principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
    $settingsTask=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $task=New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settingsTask -Description 'Restore the pinned local Tong runtime at Rune login; external tunnel managed separately; no credentials in task arguments.'
    $task|Export-ScheduledTask|Set-Content -LiteralPath (Join-Path $preparation 'TongLoginRuntime.review.xml') -Encoding Unicode
    $manifest=[ordered]@{schemaVersion=2;runnerHash=(Get-FileHash -LiteralPath (Join-Path $preparation 'TongLoginRuntime.ps1')).Hash;taskHash=(Get-FileHash -LiteralPath (Join-Path $preparation 'TongLoginRuntime.review.xml')).Hash;productionSwitched=$false;preparedAt=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText((Join-Path $preparation 'preparation.json'),($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Output ('Prepared only: '+$preparation)
}elseif($Mode -eq 'install') {
    # Run only after the user has approved installing the login task.
    Assert-SafeDirectory $preparation
    ManagerPreflight
    if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'New task already exists'}
    $manifest=Get-Content -LiteralPath (Join-Path $preparation 'preparation.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($manifest.schemaVersion -ne 2){throw 'Legacy preparation refused'}
    foreach($pair in @(@('TongLoginRuntime.ps1',$manifest.runnerHash),@('TongLoginRuntime.review.xml',$manifest.taskHash))){if((Get-FileHash -LiteralPath (Join-Path $preparation $pair[0])).Hash -ine $pair[1]){throw 'Reviewed preparation changed'}}
    Assert-SafeDirectory 'D:\Tong\runtime'
    if(Test-Path -LiteralPath $deployment) {
        # Resume a failed registration only when the retained reviewed payload
        # is exact. Never overwrite an unknown or changed deployment.
        Assert-SafeDirectory $deployment
        $entries=@(Get-ChildItem -LiteralPath $deployment -Force)
        if($entries.Count -ne 1 -or $entries[0].Name -cne 'TongLoginRuntime.ps1' -or ($entries[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $entries[0].FullName).Hash -ine $manifest.runnerHash){throw 'Existing deployment differs from reviewed preparation'}
    }else {
        New-Item -ItemType Directory -Path $deployment|Out-Null
        Assert-SafeDirectory $deployment
        Copy-Item -LiteralPath (Join-Path $preparation 'TongLoginRuntime.ps1') -Destination (Join-Path $deployment 'TongLoginRuntime.ps1')
    }
    Register-ScheduledTask -TaskName $taskName -Xml (Get-Content -LiteralPath (Join-Path $preparation 'TongLoginRuntime.review.xml') -Raw -Encoding Unicode)|Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output 'Login task installed and started. Verify local runtime status and login-management.log.'
}elseif($Mode -eq 'rollback') {
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if($task){Disable-ScheduledTask -TaskName $taskName|Out-Null;Stop-ScheduledTask -TaskName $taskName}
    # Disabling the wrapper does not terminate the independent runtime guardian.
    Write-Output 'Login task disabled and stopped; healthy Tong and external tunnel left running. Artifacts retained.'
}elseif($Mode -eq 'status') {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue|Select-Object TaskName,State
    Invoke-Runner 'status'
}elseif($Mode -eq 'stop') {
    Disable-ScheduledTask -TaskName $taskName|Out-Null
    Stop-ScheduledTask -TaskName $taskName
    Invoke-Runner 'stop'
}else {
    Enable-ScheduledTask -TaskName $taskName|Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output 'Recovery dispatched; inspect status and login-management.log.'
}
