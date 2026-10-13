# Tong cleanup candidate dependency review. Compatible with Windows PowerShell 5.1.
# NO file deletion/moves, permissions changes, service restarts, environment modifications.
# Writes only redacted review output to the authorized demo workspace.
param([string]$ReportDirectory = 'D:\Tong\app\demo-workspace')
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ReportDirectory -PathType Container)) {
    throw "Report directory not found: $ReportDirectory"
}
$root = 'D:\Tong'
$targets = @(
    [pscustomobject]@{Key='old-poc'; Path='D:\agentdock-poc-20261010'; SizeGiB=5.338; Action='CHECK_ONLY'},
    [pscustomobject]@{Key='old-poc-b23-switch'; Path='D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9'; SizeGiB=3.542; Action='CHECK_ONLY'},
    [pscustomobject]@{Key='tong-state-b23-switch'; Path='D:\Tong\state\b23-switch-c104fcca2aa9'; SizeGiB=3.542; Action='CHECK_ONLY'},
    [pscustomobject]@{Key='old-tong-local'; Path='D:\tong-agentdock-local'; SizeGiB=2.502; Action='CHECK_ONLY'},
    [pscustomobject]@{Key='old-tong-checkout'; Path='D:\tong-desktop-control'; SizeGiB=0.568; Action='CHECK_ONLY'},
    [pscustomobject]@{Key='user-npm-cache'; Path=(Join-Path $env:LOCALAPPDATA 'npm-cache'); SizeGiB=4.506; Action='CACHE_REVIEW'},
    [pscustomobject]@{Key='user-codex-runtimes'; Path=(Join-Path $env:USERPROFILE '.cache\codex-runtimes'); SizeGiB=1.709; Action='KEEP_UNTIL_CHECKED'},
    [pscustomobject]@{Key='codex-worktrees'; Path=(Join-Path $env:USERPROFILE '.codex\worktrees'); SizeGiB=1.684; Action='GIT_REVIEW'}
)

$evidence = New-Object System.Collections.ArrayList
$notes = New-Object System.Collections.ArrayList

function Contains-Path([string] $Text, [string] $Fragment) {
    if ([string]::IsNullOrEmpty($Text) -or [string]::IsNullOrEmpty($Fragment)) { return $false }
    return $Text.IndexOf($Fragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}
function Add-Evidence([string]$Key, [string]$Category, [string]$Status, [string]$Detail) {
    [void]$evidence.Add([pscustomobject]@{
        Candidate=$Key; Category=$Category; Status=$Status; Detail=$Detail
    })
}
function Add-Note([string] $Line) { [void]$notes.Add($Line) }

Write-Host 'Checking running processes and services (no command lines printed)...'
$processes = @()
$services = @()
try { $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop) }
catch { Add-Note ("PROCESS_QUERY_UNAVAILABLE: " + $_.Exception.GetType().Name) }
try { $services = @(Get-CimInstance Win32_Service -ErrorAction Stop) }
catch { Add-Note ("SERVICE_QUERY_UNAVAILABLE: " + $_.Exception.GetType().Name) }
foreach ($t in $targets) {
    $key=[string]$t.Key
    $p=[string]$t.Path
    if (-not (Test-Path -LiteralPath $p)) {
        Add-Evidence $key 'exists' 'NOT_FOUND' 'Path does not exist'
        continue
    }
    Add-Evidence $key 'exists' 'PRESENT' 'Candidate exists; NOT cleared for deletion'
    foreach ($proc in $processes) {
        # Read the command line only in memory for a boolean path match; never print it.
        $mExe = Contains-Path ([string]$proc.ExecutablePath) $p
        $mArg = Contains-Path ([string]$proc.CommandLine) $p
        if ($mExe -or $mArg) {
            Add-Evidence $key 'running_process' 'REFERENCED' (
                'PID={0}; Name={1}; ExeMatch={2}; ArgumentPathMatch={3}' -f $proc.ProcessId, $proc.Name, $mExe, $mArg
            )
        }
    }
    foreach ($svc in $services) {
        if (Contains-Path ([string]$svc.PathName) $p) {
            Add-Evidence $key 'service_config' 'REFERENCED' (
                'Service={0}; State={1}; StartMode={2}' -f $svc.Name, $svc.State, $svc.StartMode
            )
        }
    }
}

# Active production config reference check; record paths and match flag only,
# NEVER export raw file content, command line, tokens, or credential data.
Write-Host 'Checking active Tong config references (match flags only)...'
$configFiles = @()
$knownConfigs = @(
    'D:\Tong\runtime\production-root.json',
    'D:\Tong\runtime\profile.json',
    'D:\Tong\app\config\tong.config.json'
)
foreach ($p in $knownConfigs) {
    if (Test-Path -LiteralPath $p -PathType Leaf) {
        $configFiles += @(Get-Item -LiteralPath $p)
    }
}
foreach ($folder in @('D:\Tong\runtime\run', 'D:\Tong\app\config')) {
    if (Test-Path -LiteralPath $folder -PathType Container) {
        $configFiles += @(Get-ChildItem -LiteralPath $folder -Force -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in @('.json','.ps1','.yml','.yaml','.toml') })
    }
}
$configFiles = @($configFiles | Sort-Object FullName -Unique)
foreach ($f in $configFiles) {
    if ($f.Length -gt 2097152) { Add-Note ('CONFIG_SKIPPED_LARGE: ' + $f.Name); continue }
    if (($f.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Add-Note ('CONFIG_SKIPPED_LINK: ' + $f.Name); continue
    }
    $content = $null
    try { $content = [System.IO.File]::ReadAllText($f.FullName) }
    catch { Add-Note ('CONFIG_READ_FAILED: ' + $f.Name); continue }
    foreach ($t in $targets) {
        $rawPath = [string]$t.Path
        $jsonEscapedPath = $rawPath.Replace('\', '\\')
        if ((Contains-Path $content $rawPath) -or (Contains-Path $content $jsonEscapedPath)) {
            $short=$f.FullName.Replace('D:\Tong\', '')
            Add-Evidence ([string]$t.Key) 'active_config' 'REFERENCED' $short
        }
    }
}

# Compare a small set of selected, existing, same-relative-path test artifacts.
# File size and content hashes are sample evidence, not proof of full directory identity.
Write-Host 'Comparing representative old PoC and Tong-state files...'
$left = 'D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9'
$right = 'D:\Tong\state\b23-switch-c104fcca2aa9'
$samples = @('profile.json','production-root.json','run\runtime.json','run\release-pin.json',
 'run\switch-result.json','tong\package-lock.json','tong\README.md','tong\package.json','tong\oauth\README.md')
$sha = [System.Security.Cryptography.SHA256]::Create()
foreach ($rel in $samples) {
    $f1=Join-Path $left $rel; $f2=Join-Path $right $rel
    if (-not ((Test-Path -LiteralPath $f1 -PathType Leaf) -and (Test-Path -LiteralPath $f2 -PathType Leaf))) {
        Add-Evidence 'duplicate-b23-comparison' 'sample' 'SAMPLE_MISSING' $rel; continue
    }
    try {
        $i1=Get-Item -LiteralPath $f1; $i2=Get-Item -LiteralPath $f2
        $equalSize=($i1.Length -eq $i2.Length)
        $sameHash=$false
        if ($equalSize -and $i1.Length -le 2097152) {
            $s1=[System.IO.File]::OpenRead($f1)
            try { $h1=[Convert]::ToBase64String($sha.ComputeHash($s1)) } finally { $s1.Dispose() }
            $s2=[System.IO.File]::OpenRead($f2)
            try { $h2=[Convert]::ToBase64String($sha.ComputeHash($s2)) } finally { $s2.Dispose() }
            $sameHash=($h1 -eq $h2)
        }
        $status=if (-not $equalSize) {'DIFFERENT_SIZE'} elseif ($sameHash) {'SAME_CONTENT_SAMPLE'} else {'UNCONFIRMED'}
        Add-Evidence 'duplicate-b23-comparison' 'sample' $status ("{0}; Bytes={1}" -f $rel,$i1.Length)
    } catch { Add-Evidence 'duplicate-b23-comparison' 'sample' 'READ_FAILED' $rel }
}
$sha.Dispose()

Write-Host 'Checking Git status and worktrees (GIT_OPTIONAL_LOCKS=0)...'
$repos = @(
 'D:\tong-desktop-control',
 'D:\Tong\development\tong-desktop-control'
)
$worktreesRoot = Join-Path $env:USERPROFILE '.codex\worktrees'
if (Test-Path -LiteralPath $worktreesRoot -PathType Container) {
    foreach ($folder in @(Get-ChildItem -LiteralPath $worktreesRoot -Directory -ErrorAction SilentlyContinue)) {
        $nested = Join-Path $folder.FullName 'tong-desktop-control'
        if (Test-Path -LiteralPath $nested) { $repos += $nested }
    }
}
$git=Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) {
    Add-Note 'GIT_UNAVAILABLE: could not inspect worktrees'
} else {
    $prev = $env:GIT_OPTIONAL_LOCKS
    try {
        $env:GIT_OPTIONAL_LOCKS='0'
        foreach ($repo in $repos) {
            if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
                Add-Evidence 'git-repos' 'git_status' 'NOT_A_REPO' $repo; continue
            }
            try {
                $lines=@(& git -C $repo -c core.fsmonitor=false status --porcelain=v1 --untracked-files=normal 2>$null)
                $exit=$LASTEXITCODE
                if ($exit -eq 0) {
                    Add-Evidence 'git-repos' 'git_status' 'CHECKED' (
                        '{0}; ChangedOrUntrackedEntries={1}' -f $repo, $lines.Count
                    )
                } else { Add-Evidence 'git-repos' 'git_status' 'GIT_ERROR' $repo }
            } catch { Add-Evidence 'git-repos' 'git_status' 'GIT_ERROR' $repo }
        }
        $main='D:\Tong\development\tong-desktop-control'
        if (Test-Path -LiteralPath (Join-Path $main '.git')) {
            try {
                $wt=@(& git -C $main worktree list --porcelain 2>$null)
                $wtPaths=@($wt | Where-Object { $_ -like 'worktree *' })
                foreach ($w in $wtPaths) { Add-Evidence 'git-repos' 'registered_worktree' 'PRESENT' $w }
            } catch { Add-Note 'GIT_WORKTREE_LIST_UNAVAILABLE' }
        }
    } finally {
        $env:GIT_OPTIONAL_LOCKS=$prev
    }
}

$report = Join-Path $ReportDirectory 'Tong-cleanup-dependency-review.csv'
$readme = Join-Path $ReportDirectory 'Tong-cleanup-dependency-review.txt'
$evidence.ToArray() | Export-Csv -LiteralPath $report -NoTypeInformation -Encoding UTF8
$lines = @(
 'Tong cleanup dependency review (READ ONLY); local time: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),
 'This is NOT deletion approval. Absence of references does not guarantee a path is unused.',
 'Scanned process executable/command line references, services and selected active configs without exporting command lines or credentials.',
 'Selected samples are NOT an exhaustive checksum comparison; estimated sizes are logical and cannot predict physical reclaimed bytes.',
 'No delete, move, ACL, service, environment or Git content changes were requested.',
 '',
 'CANDIDATE INVENTORY (GiB figures from previous inventory; NOT newly rescanned):'
)
foreach ($t in $targets) {
    $hits=@($evidence.ToArray() | Where-Object { $_.Candidate -eq $t.Key -and $_.Status -eq 'REFERENCED' })
    $lines += ('{0} | {1} GiB | {2} | references found: {3} | {4}' -f $t.Key,$t.SizeGiB,$t.Action,$hits.Count,$t.Path)
}
$lines += ''
$lines += 'REVIEW FLAGS:'
foreach ($r in $evidence.ToArray()) {
    if ($r.Status -eq 'REFERENCED' -or $r.Category -eq 'git_status' -or $r.Category -eq 'registered_worktree' -or $r.Category -eq 'sample') {
        $lines += ('{0} | {1} | {2} | {3}' -f $r.Candidate,$r.Category,$r.Status,$r.Detail)
    }
}
$lines += ''
$lines += 'INSPECTION LIMITS / NOTES:'
if ($notes.Count -eq 0) { $lines += 'No additional warnings.' }
else { $lines += @($notes.ToArray()) }
$lines | Set-Content -LiteralPath $readme -Encoding UTF8
Write-Host 'Done:'
Write-Host $report
Write-Host $readme
