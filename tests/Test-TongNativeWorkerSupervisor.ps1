$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Native Supervisor canaries require Windows.' }

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$build = & (Join-Path $repository 'scripts\Build-TongWorkerSupervisor.ps1') | ConvertFrom-Json
$root = Join-Path ([IO.Path]::GetTempPath()) ('TongNativeWorker-' + [guid]::NewGuid().ToString('N'))
$root = [IO.Path]::GetFullPath($root)
$temporaryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $root.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic root escaped the temporary directory.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$server = $null
try {
    foreach ($directory in @($root, (Join-Path $root 'bin'), (Join-Path $root 'project'),
            (Join-Path $root 'other'), (Join-Path $root 'private'), (Join-Path $root 'auth'),
            (Join-Path $root 'profile'), (Join-Path $root 'temp'), (Join-Path $root 'state'))) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    $bin = Join-Path $root 'bin'
    $project = Join-Path $root 'project'
    $exe = Join-Path $bin 'TongWorkerSupervisor.exe'
    $node = Join-Path $bin 'node.exe'
    $mock = Join-Path $bin 'TongNativeMockWorker.mjs'
    $codex = Join-Path $bin 'synthetic-codex.exe'
    $policyPath = Join-Path $bin 'policy.json'
    Copy-Item -LiteralPath $build.executable -Destination $exe
    $nodeSource = (Get-Command node.exe -CommandType Application | Select-Object -First 1 -ExpandProperty Source)
    Copy-Item -LiteralPath $nodeSource -Destination $node
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures\TongNativeMockWorker.mjs') -Destination $mock
    [IO.File]::WriteAllText($codex, 'synthetic marker: never execute Codex')
    foreach ($name in @('project', 'other', 'private', 'auth')) {
        [IO.File]::WriteAllText((Join-Path $root "$name\canary.txt"), "synthetic $name")
    }
    [IO.File]::WriteAllText((Join-Path $project 'delete.canary'), 'synthetic delete')
    [void](New-Item -ItemType Junction -Path (Join-Path $project 'outside-link') -Target (Join-Path $root 'other'))
    $sha = { param($Path) (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
    $policy = [ordered]@{
        pipeName = 'TongNativeTest-' + [guid]::NewGuid().ToString('N')
        gatewaySid = $sid; gatewayAccountSid = $sid; workerSid = $sid
        supervisorImagePath = $exe; supervisorImageSha256 = (& $sha $exe)
        bridgeImagePath = $exe; bridgeImageSha256 = (& $sha $exe)
        workerExecutablePath = $node; workerExecutableSha256 = (& $sha $node)
        workerScriptPath = $mock; workerScriptSha256 = (& $sha $mock)
        codexExecutablePath = $codex; codexExecutableSha256 = (& $sha $codex)
        profileRoot = (Join-Path $root 'profile')
        tempRoot = (Join-Path $root 'temp')
        stateRoot = (Join-Path $root 'state')
        projectRoots = @{ synthetic = $project }
        workerModuleSha256 = @{}
        toolDirectories = @()
        syntheticOnly = $true; syntheticRoot = $root
    }
    [IO.File]::WriteAllText($policyPath, ($policy | ConvertTo-Json -Depth 6 -Compress), [Text.UTF8Encoding]::new($false))

    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $rootAcl = Get-Acl -LiteralPath $root
    $rootAcl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(@($sid, 'FullControl'), @('S-1-5-18', 'FullControl'),
            @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($entry[0]),
            [Security.AccessControl.FileSystemRights]::$($entry[1]), $inheritance,
            [Security.AccessControl.PropagationFlags]::None, $allow)
        [void]$rootAcl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $root -AclObject $rootAcl
    foreach ($name in @('other', 'private', 'auth', 'state')) {
        $directory = Join-Path $root $name
        $acl = Get-Acl -LiteralPath $directory
        $acl.SetAccessRuleProtection($true, $false)
        $allowed = if ($name -eq 'other') { @('S-1-5-11') }
            elseif ($name -eq 'state') { @($sid, 'S-1-5-18', 'S-1-5-32-544') }
            else { @('S-1-5-18', 'S-1-5-32-544') }
        foreach ($allowedSid in $allowed) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($allowedSid),
                [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
                [Security.AccessControl.PropagationFlags]::None, $allow)
            [void]$acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $directory -AclObject $acl
        if ($name -eq 'other') {
            $canary = Join-Path $directory 'canary.txt'
            $fileAcl = Get-Acl -LiteralPath $canary
            $fileAcl.SetAccessRuleProtection($true, $false)
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new('S-1-5-11'),
                [Security.AccessControl.FileSystemRights]::FullControl, $allow)
            [void]$fileAcl.AddAccessRule($rule)
            Set-Acl -LiteralPath $canary -AclObject $fileAcl
        }
    }
    $before = (Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    [IO.File]::WriteAllText((Join-Path $root 'original-acl.txt'), $before)
    $arguments = '--serve-synthetic "' + $policyPath + '"'
    $server = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $root 'server.out') -RedirectStandardError (Join-Path $root 'server.err')
    Start-Sleep -Milliseconds 300
    if ($server.HasExited) { throw ('Native Supervisor exited early: ' + (Get-Content -LiteralPath (Join-Path $root 'server.err') -Raw)) }
    & $nodeSource (Join-Path $PSScriptRoot 'Run-TongNativeWorkerSupervisor.mjs') $exe $policyPath $project $root
    if ($LASTEXITCODE -ne 0) { throw "Native Supervisor Node integration failed ($LASTEXITCODE)." }
    $after = (Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    if ($after -ne $before) { throw 'Native Supervisor did not restore the exact synthetic project DACL.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $root 'state') -Filter '*.acl.json').Count -ne 0) {
        throw 'ACL journal was not cleared after normal task completion.'
    }
    Stop-Process -Id $server.Id -Force
    Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
    $server = $null

    $recoveryId = [guid]::NewGuid().ToString('D')
    & $exe '--acl-grant-synthetic' $policyPath $recoveryId 'synthetic'
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic ACL grant failed.' }
    if ((Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -eq $before) {
        throw 'Synthetic ACL grant did not change the DACL.'
    }
    & $exe '--acl-recover-synthetic' $policyPath
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic ACL crash recovery failed.' }
    if ((Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ne $before) {
        throw 'Synthetic ACL crash recovery did not restore the exact DACL.'
    }

    $conflictId = [guid]::NewGuid().ToString('D')
    & $exe '--acl-grant-synthetic' $policyPath $conflictId 'synthetic'
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic ACL conflict grant failed.' }
    $journalPath = Join-Path $root "state\$conflictId.acl.json"
    $record = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    $conflicted = Get-Acl -LiteralPath $project
    $conflicted.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),
        [Security.AccessControl.FileSystemRights]::WriteData, $inheritance,
        [Security.AccessControl.PropagationFlags]::None, $allow)) | Out-Null
    Set-Acl -LiteralPath $project -AclObject $conflicted
    $conflictSddl = (Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    & $exe '--acl-recover-synthetic' $policyPath 2>$null
    if ($LASTEXITCODE -eq 0) { throw 'ACL conflict was silently overwritten.' }
    if ((Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ne $conflictSddl) {
        throw 'ACL conflict recovery overwrote an unrelated change.'
    }
    $repair = Get-Acl -LiteralPath $project
    $repair.SetSecurityDescriptorSddlForm($record.applied, [Security.AccessControl.AccessControlSections]::Access)
    Set-Acl -LiteralPath $project -AclObject $repair
    & $exe '--acl-recover-synthetic' $policyPath
    if ($LASTEXITCODE -ne 0) { throw 'Conflict reconciliation recovery failed.' }
    if ((Get-Acl -LiteralPath $project).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ne $before) {
        throw 'Conflict reconciliation did not restore the original DACL.'
    }
    @{ NativeBuild = 'passed'; SyntheticCanary = 'passed'; ExactAclRestore = 'passed';
        CrashRecovery = 'passed'; ConflictDetection = 'passed'; RealAccountsOrServiceChanged = $false } | ConvertTo-Json
} catch {
    $errorFile = Join-Path $root 'server.err'
    if (Test-Path -LiteralPath $errorFile) { Write-Host ('Native Supervisor stderr: ' + (Get-Content -LiteralPath $errorFile -Raw)) }
    throw
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $root) {
        foreach ($name in @('other', 'private', 'auth', 'state')) {
            $directory = Join-Path $root $name
            if (Test-Path -LiteralPath $directory) {
                & (Join-Path $env:WINDIR 'System32\icacls.exe') $directory '/grant' "*${sid}:F" '/T' '/C' | Out-Null
            }
        }
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
