# Tong B2.4 disk audit: local Git commit first, then approved npm _cacache cleanup.
# Run manually in Windows PowerShell 5.1. Does NOT push, edit production runtime, or touch _npx.
# Git commit stages ONLY exact audit artifacts; all pre-existing unrelated changes remain untouched.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repo = 'D:\Tong\development\tong-desktop-control'
$src = 'D:\Tong\app\demo-workspace'
$relativeDir = 'docs/maintenance/2026-10-13-disk-audit'
$destDir = Join-Path $repo 'docs\maintenance\2026-10-13-disk-audit'
$approvedCache = 'C:\Users\Rune\AppData\Local\npm-cache\_cacache'
$cacheParent = 'C:\Users\Rune\AppData\Local\npm-cache'
$receipt = Join-Path $src 'Tong-first-batch-cleanup-result.txt'
$files = @(
    'Tong-ReadOnly-Disk-Audit.ps1',
    'Tong-Verify-Cleanup-Candidates.ps1',
    'Tong-cleanup-final-review-20261013.md',
    'Tong-disk-audit-README.txt',
    'Tong-disk-audit-summary.csv',
    'Tong-disk-audit-buckets.csv',
    'Tong-cleanup-dependency-review.txt',
    'Tong-cleanup-dependency-review.csv',
    'Tong-Commit-And-FirstCacheCleanup.ps1'
)

function Assert-LastExit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit code $LASTEXITCODE)" }
}

Write-Host '== Phase 1: targeted local Git commit (no push) =='
$git = Get-Command git.exe -ErrorAction Stop
if (-not (Test-Path -LiteralPath $repo -PathType Container)) { throw "Repository is missing: $repo" }
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "Source is missing: $src" }

$repoRoot = ((& $git.Source -C $repo rev-parse --show-toplevel) | Out-String).Trim()
Assert-LastExit 'Git repository detection'
if ($repoRoot.Replace('/','\').TrimEnd('\') -ine $repo.TrimEnd('\')) {
    throw "Unexpected repository root: $repoRoot"
}
$branch = ((& $git.Source -C $repo branch --show-current) | Out-String).Trim()
Assert-LastExit 'Branch inspection'
if ([string]::IsNullOrWhiteSpace($branch)) { throw 'Detached HEAD: not creating a commit' }
Write-Host ("Current branch: {0}" -f $branch)

$alreadyStaged = @(& $git.Source -C $repo diff --cached --name-only)
Assert-LastExit 'Staged changes inspection'
if ($alreadyStaged.Count -gt 0) {
    throw 'Other staged Git changes exist; refusing to mix them with this audit commit.'
}

foreach ($name in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $src $name) -PathType Leaf)) {
        throw "Audit source file missing: $name"
    }
    if (Test-Path -LiteralPath (Join-Path $destDir $name)) {
        throw "Destination already exists, refusing overwrite: $name"
    }
}
if ($branch -notlike 'codex/*') {
    $newBranch = 'codex/tong-disk-audit-20261013'
    Write-Host ("Creating task branch: {0}" -f $newBranch)
    & $git.Source -C $repo switch -c $newBranch
    Assert-LastExit 'Create audit branch'
    $branch = $newBranch
}

New-Item -ItemType Directory -Path $destDir -Force | Out-Null
$relativePaths = @()
foreach ($name in $files) {
    Copy-Item -LiteralPath (Join-Path $src $name) -Destination (Join-Path $destDir $name) -ErrorAction Stop
    $relativePaths += "$relativeDir/$name"
}
& $git.Source -C $repo add -- $relativePaths
Assert-LastExit 'Stage audit files'
$stagedPaths = @(& $git.Source -C $repo diff --cached --name-only)
Assert-LastExit 'Inspect precise staging'
$unexpected = @($stagedPaths | Where-Object { $relativePaths -notcontains $_ })
if ($unexpected.Count -gt 0 -or $stagedPaths.Count -ne $relativePaths.Count) {
    throw 'Unexpected staged files; refusing commit. Inspect Git index before retrying.'
}
& $git.Source -C $repo diff --cached --check
Assert-LastExit 'Validate staged whitespace'
& $git.Source -C $repo commit -m 'docs: preserve Tong disk audit and cleanup review'
Assert-LastExit 'Commit audit artifacts'
$sha = ((& $git.Source -C $repo rev-parse --short HEAD) | Out-String).Trim()
Assert-LastExit 'Commit verification'
Write-Host ("Local commit created: {0} on {1}" -f $sha, $branch)
Write-Host 'No git push performed.'

Write-Host '== Phase 2: exact npm _cacache deletion =='
# Check active npm installations before touching the cache; do not stop any processes.
try { $procs = @(Get-CimInstance Win32_Process -ErrorAction Stop) }
catch { throw 'Unable to check running npm operations. Git commit succeeded; cache NOT deleted.' }
$pattern = '(?i)(?:npm-cli\.js|npx-cli\.js|\bnpm(?:\.cmd)?\b|\bnpx(?:\.cmd)?\b).{0,220}\b(?:install|ci|update|exec|audit)\b'
$busy = @($procs | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern })
if ($busy.Count -gt 0) {
    Write-Host ("Found {0} possible active npm/npx operations; cache deletion skipped." -f $busy.Count)
    @(
        "Git commit: $sha",
        "Branch: $branch",
        'Cache cleanup: SKIPPED, possible active npm/npx operations',
        'No push performed'
    ) | Set-Content -LiteralPath $receipt -Encoding UTF8
    exit 0
}

# Fixed, canonical path; do not infer from npm's config and do not touch _npx.
$actual = [System.IO.Path]::GetFullPath($approvedCache).TrimEnd('\')
if ($actual -ine 'C:\Users\Rune\AppData\Local\npm-cache\_cacache') {
    throw 'Unexpected cache path; no deletion performed.'
}
if (-not (Test-Path -LiteralPath $approvedCache -PathType Container)) {
    Write-Host 'Cache directory is already absent; nothing to delete.'
    $cacheState = 'ALREADY_ABSENT'
} else {
    foreach ($p in @($cacheParent, $approvedCache)) {
        $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Cache path is a junction/symlink, refusing removal: $p"
        }
    }
    Write-Host ("Deleting approved cache directory ONLY: {0}" -f $approvedCache)
    Remove-Item -LiteralPath $approvedCache -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $approvedCache) {
        throw 'Cache directory remains after deletion; inspect errors.'
    }
    $cacheState = 'REMOVED'
}

@(
    "Local Git commit: $sha",
    "Branch: $branch",
    'Git push: NOT PERFORMED',
    "Approved cache path: $approvedCache",
    "Cache cleanup status: $cacheState",
    "Other cache directories (_npx, logs): NOT TARGETED",
    "Completed local time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
) | Set-Content -LiteralPath $receipt -Encoding UTF8

Write-Host '== Done =='
Write-Host ("Git commit: {0}" -f $sha)
Write-Host ("Cache cleanup: {0}" -f $cacheState)
Write-Host ("Receipt: {0}" -f $receipt)
