# Tong B2.4 second-batch: local commit of audit material, then one approved path cleanup.
# Windows PowerShell 5.1 compatible. User explicitly approved ONLY the exact old PoC switch directory.
# No push, no service stop/restart, no production config/ACL changes, no other deletions.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repo = 'D:\Tong\development\tong-desktop-control'
$source = 'D:\Tong\app\demo-workspace'
$relativeDir = 'docs/maintenance/2026-10-13-disk-audit'
$destination = Join-Path $repo 'docs\maintenance\2026-10-13-disk-audit'
$target = 'D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9'
$mirror = 'D:\Tong\state\b23-switch-c104fcca2aa9'
$expectedTarget = 'D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9'
$receiptPath = Join-Path $source 'Tong-second-batch-cleanup-result.txt'
$commitSha = 'NOT_COMMITTED'
$phase = 'PREFLIGHT'
$freeBefore = $null
$freeAfter = $null
$git = $null

$documents = @(
    'Tong-Review-SecondBatch-Switch.ps1',
    'Tong-b23-switch-second-review.csv',
    'Tong-b23-switch-second-review.txt',
    'Tong-second-batch-cleanup-decision-20261013.md',
    'Tong-Commit-And-Delete-OldSwitch.ps1',
    'Tong-Exact-OldSwitch-LongPath.py'
)

function Assert-ExitCode([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}
function Check-TcpPort([int]$port) {
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $socket.BeginConnect('127.0.0.1', $port, $null, $null)
        try {
            if (-not $result.AsyncWaitHandle.WaitOne(1500)) { return $false }
            $socket.EndConnect($result)
            return $true
        } finally {
            $result.AsyncWaitHandle.Close()
        }
    } catch { return $false }
    finally { $socket.Close() }
}
function Read-D-FreeBytes {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'" -ErrorAction Stop
    if ($null -eq $disk) { throw 'D: disk status unavailable' }
    return [long]$disk.FreeSpace
}
function Write-Receipt([string]$status,[string]$details) {
    $values = @(
        "LocalTime: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Target: $target",
        "Status: $status",
        "Phase: $phase",
        "LocalCommit: $commitSha",
        'GitPush: NOT_PERFORMED',
        'ProductionAndMirror: NOT_TARGETED',
        "Details: $details"
    )
    if ($null -ne $freeBefore) { $values += "DFreeBeforeBytes: $freeBefore" }
    if ($null -ne $freeAfter) {
        $values += "DFreeAfterBytes: $freeAfter"
        $values += "FreeChangeBytes: $($freeAfter - $freeBefore)"
    }
    $values | Set-Content -LiteralPath $receiptPath -Encoding UTF8
}

try {
    Write-Host '== Stage 1: exact deletion preflight (no mutations) =='
    $resolved = [System.IO.Path]::GetFullPath($target).TrimEnd('\')
    if ($resolved -ine $expectedTarget) { throw 'Exact candidate path mismatch' }
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
        throw 'Approved candidate directory is absent. No cleanup needed. Stop here.'
    }
    if (-not (Test-Path -LiteralPath $mirror -PathType Container)) {
        throw 'Retained D:\Tong state copy missing; no cleanup allowed.'
    }
    foreach ($p in @(
        'D:\agentdock-poc-20261010',
        'D:\agentdock-poc-20261010\isolated',
        'D:\agentdock-poc-20261010\isolated\state',
        $target
    )) {
        $entry = Get-Item -LiteralPath $p -Force -ErrorAction Stop
        if (-not $entry.PSIsContainer -or
            ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate ancestor is not a plain directory: $p"
        }
    }

    foreach ($port in @(7676,7677,18765)) {
        if (-not (Check-TcpPort $port)) {
            throw "Tong local service on 127.0.0.1:$port not reachable, refusing cleanup"
        }
    }
    Write-Host 'Tong local listeners reachable on 7676, 7677 and 18765.'

    # Confirm that production JSON does not point directly into the directory being deleted.
    $configFiles = @(
        'D:\Tong\runtime\run\release-pin.json',
        'D:\Tong\runtime\run\manager-pin.json',
        'D:\Tong\runtime\run\runtime.json',
        'D:\Tong\runtime\profile.json',
        'D:\Tong\runtime\production-root.json',
        'D:\Tong\app\config\tong.config.json'
    )
    foreach ($file in $configFiles) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Production configuration missing: $file"
        }
        $contents = [System.IO.File]::ReadAllText($file)
        if ($contents.IndexOf($target,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $contents.IndexOf($target.Replace('\','\\'),[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "Production configuration directly references exact candidate; preserve it: $file"
        }
        try { $obj = $contents | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "Cannot parse production configuration: $file" }
        if ($file -like '*\release-pin.json') {
            $releaseRoot = [string]$obj.releaseRoot
            if (-not [string]::IsNullOrWhiteSpace($releaseRoot) -and
                [System.IO.Path]::IsPathRooted($releaseRoot)) {
                $pinPath = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd('\')
                if ($pinPath -ieq $target -or
                    $pinPath.StartsWith($target+'\',[System.StringComparison]::OrdinalIgnoreCase)) {
                    throw 'Pinned release points inside exact deletion candidate.'
                }
            }
        }
    }
    Write-Host 'No inspected production configuration references the exact target.'

    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach ($proc in $processes) {
        $commandLine = [string]$proc.CommandLine
        $executable = [string]$proc.ExecutablePath
        if ($commandLine.IndexOf($target,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $executable.IndexOf($target,[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "PID $($proc.ProcessId) references target; no cleanup."
        }
    }
    Write-Host 'No visible running process references exact target.'

    # PowerShell 5.1 cannot reliably traverse deep node_modules (MAX_PATH).
    # Python 3.11 uses Windows extended-length paths and validates every entry,
    # failing closed on any reparse point or unreadable path.
    $pythonPath = 'C:\Program Files\Python311\python.exe'
    $longPathHelper = Join-Path $source 'Tong-Exact-OldSwitch-LongPath.py'
    if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) { throw 'Expected Python 3.11 executable not found' }
    if (-not (Test-Path -LiteralPath $longPathHelper -PathType Leaf)) { throw 'Long-path helper missing' }
    Write-Host 'Checking nested reparse points with Python 3.11 long-path support...'
    & $pythonPath $longPathHelper verify
    Assert-ExitCode 'Full long-path reparse/access validation'
    foreach ($rel in @('profile.json','production-root.json','run\release-pin.json','tong\package-lock.json')) {
        $a = Join-Path $target $rel
        $b = Join-Path $mirror $rel
        if (-not (Test-Path -LiteralPath $a -PathType Leaf) -or
            -not (Test-Path -LiteralPath $b -PathType Leaf)) {
            throw "Mirror sample file absent: $rel"
        }
        $hasher=[System.Security.Cryptography.SHA256]::Create()
        try {
            $stream=[System.IO.File]::OpenRead($a)
            try { $ha=[Convert]::ToBase64String($hasher.ComputeHash($stream)) } finally { $stream.Dispose() }
            $stream=[System.IO.File]::OpenRead($b)
            try { $hb=[Convert]::ToBase64String($hasher.ComputeHash($stream)) } finally { $stream.Dispose() }
        } finally { $hasher.Dispose() }
        if ($ha -ne $hb) { throw "Mirror sample mismatch: $rel" }
    }
    $freeBefore = Read-D-FreeBytes
    Write-Host 'Target and retained copy checked. No reparse points found.'

    Write-Host '== Stage 2: commit exact new review files (NO PUSH) =='
    $phase = 'LOCAL_GIT_COMMIT'
    $git = Get-Command git.exe -ErrorAction Stop
    $actualRepo = ((& $git.Source -C $repo rev-parse --show-toplevel) | Out-String).Trim()
    Assert-ExitCode 'Determine Git repository'
    if ($actualRepo.Replace('/','\').TrimEnd('\') -ine $repo.TrimEnd('\')) {
        throw 'Unexpected Git repo root'
    }
    $branch = ((& $git.Source -C $repo branch --show-current) | Out-String).Trim()
    Assert-ExitCode 'Read branch'
    if ($branch -notlike 'codex/*') { throw 'Expected existing codex/ branch; do not commit to main.' }
    $oldStaged = @(& $git.Source -C $repo diff --cached --name-only)
    Assert-ExitCode 'Check staged Git changes'
    if ($oldStaged.Count -gt 0) { throw 'Existing staged Git changes found. Refusing to mix commits.' }

    $paths = @()
    foreach ($file in $documents) {
        $inputFile=Join-Path $source $file
        $outputFile=Join-Path $destination $file
        if (-not (Test-Path -LiteralPath $inputFile -PathType Leaf)) { throw "Missing review file: $file" }
        if (Test-Path -LiteralPath $outputFile) { throw "Existing review file, refusing overwrite: $file" }
        $paths += "$relativeDir/$file"
    }
    if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
        throw 'First-batch Git audit destination missing; refuse creating an unexpected directory.'
    }
    foreach ($file in $documents) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $destination $file) -ErrorAction Stop
    }
    & $git.Source -C $repo add -- $paths
    Assert-ExitCode 'Stage review files'
    $staged = @(& $git.Source -C $repo diff --cached --name-only)
    Assert-ExitCode 'Inspect staged files'
    $unexpectedStaged = @($staged | Where-Object { $paths -notcontains $_ })
    if ($staged.Count -ne $paths.Count -or $unexpectedStaged.Count -ne 0) {
        throw 'Unexpected staged Git content: stop before committing or deleting.'
    }
    & $git.Source -C $repo diff --cached --check
    Assert-ExitCode 'Validate staged diff'
    & $git.Source -C $repo commit -m 'docs: record Tong second-batch cleanup review'
    Assert-ExitCode 'Commit review files'
    $commitSha=(( & $git.Source -C $repo rev-parse --short HEAD ) | Out-String).Trim()
    Assert-ExitCode 'Verify local commit'
    Write-Host ("Local review commit: {0} | branch: {1}" -f $commitSha,$branch)

    Write-Host '== Stage 3: remove ONLY the approved old switch snapshot =='
    $phase = 'EXACT_DELETION'
    # Recheck that no new process reference appeared while making the Git commit.
    foreach ($proc in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        $commandLine=[string]$proc.CommandLine
        $executable=[string]$proc.ExecutablePath
        if ($commandLine.IndexOf($target,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $executable.IndexOf($target,[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "PID $($proc.ProcessId) began referencing target, deletion canceled."
        }
    }
    # Validate again immediately before removal; do not fall back to PS5.1 Remove-Item.
    & $pythonPath $longPathHelper delete
    Assert-ExitCode 'Exact approved long-path removal'
    if (Test-Path -LiteralPath $target) {
        throw 'Deletion returned but candidate still exists.'
    }
    $freeAfter = Read-D-FreeBytes
    $phase = 'POST_DELETE_VERIFICATION'
    $unreachablePorts=@()
    foreach ($port in @(7676,7677,18765)) {
        if (-not (Check-TcpPort $port)) { $unreachablePorts += $port }
    }
    if ($unreachablePorts.Count -gt 0) {
        Write-Receipt 'DELETED_WITH_HEALTH_WARNING' ('Local listener(s) not reachable: '+($unreachablePorts -join ','))
        throw 'Exact candidate removed, but local Tong port check failed; investigate before any other cleanup.'
    }
    if (-not (Test-Path -LiteralPath $mirror -PathType Container)) {
        Write-Receipt 'DELETED_WITH_HEALTH_WARNING' 'Retained mirror missing; investigate'
        throw 'Exact candidate removed, but expected retained mirror missing.'
    }
    Write-Receipt 'REMOVED_AND_LOCAL_PORTS_HEALTHY' 'Exact target absent; 3 local service ports reachable; retained mirror exists'
    Write-Host '== SUCCESS =='
    Write-Host ("Removed exact candidate: {0}" -f $target)
    Write-Host ("Space gained on D: {0:N3} GiB" -f (($freeAfter-$freeBefore)/1GB))
    Write-Host ("Local Git commit: {0}; no push" -f $commitSha)
    Write-Host ("Receipt: {0}" -f $receiptPath)
} catch {
    $reason = [string]$_.Exception.Message
    if ($phase -ne 'POST_DELETE_VERIFICATION') {
        Write-Receipt 'ABORTED_OR_INCOMPLETE' $reason
    }
    Write-Host ("Stopped in phase {0}: {1}" -f $phase,$reason)
    Write-Host ("Inspect receipt: {0}; do NOT rerun blindly." -f $receiptPath)
    throw
}
