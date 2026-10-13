# Tong disk-space inventory (metadata only).
# This script does not delete, rename, modify scanned files, change permissions, or invoke Codex.
# It writes four reporting files ONLY to the already authorized Tong demo workspace.
param(
    [string]$ReportDirectory = 'D:\Tong\app\demo-workspace'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$MiB = [double](1024 * 1024)
$GiB = $MiB * 1024
$startTime = Get-Date

if (-not (Test-Path -LiteralPath $ReportDirectory -PathType Container)) {
    throw "Report workspace does not exist: $ReportDirectory"
}

$targets = @(
    @{ Name='legacy-agentdock-poc'; Path='D:\agentdock-poc-20261010'; Class='REVIEW_OLD_TEST_COPIES' },
    @{ Name='tong-production-and-development'; Path='D:\Tong'; Class='KEEP_ACTIVE_PRODUCTION_REVIEW_SUBDIRS' },
    @{ Name='prior-tong-local'; Path='D:\tong-agentdock-local'; Class='REVIEW_ONLY_IF_MIGRATED' },
    @{ Name='prior-tong-checkout'; Path='D:\tong-desktop-control'; Class='REVIEW_ONLY_IF_MIGRATED' },
    @{ Name='codex-worktrees'; Path=(Join-Path $env:USERPROFILE '.codex\worktrees'); Class='REVIEW_GIT_WORKTREES' },
    @{ Name='codex-sessions'; Path=(Join-Path $env:USERPROFILE '.codex\sessions'); Class='KEEP_SESSION_HISTORY_REVIEW_ONLY' },
    @{ Name='windows-user-temp'; Path=$env:TEMP; Class='REVIEW_TEMP_ONLY' },
    @{ Name='user-npm-cache'; Path=(Join-Path $env:LOCALAPPDATA 'npm-cache'); Class='REVIEW_DEPENDENCY_CACHE' },
    @{ Name='roaming-npm-cache'; Path=(Join-Path $env:APPDATA 'npm-cache'); Class='REVIEW_DEPENDENCY_CACHE' },
    @{ Name='pip-cache'; Path=(Join-Path $env:LOCALAPPDATA 'pip\Cache'); Class='REVIEW_DEPENDENCY_CACHE' },
    @{ Name='uv-cache'; Path=(Join-Path $env:LOCALAPPDATA 'uv\cache'); Class='REVIEW_DEPENDENCY_CACHE' },
    @{ Name='user-dot-cache'; Path=(Join-Path $env:USERPROFILE '.cache'); Class='REVIEW_CACHE_CONTENTS' }
)

$rootRows = New-Object 'System.Collections.Generic.List[object]'
$bucketRows = New-Object 'System.Collections.Generic.List[object]'
$issueRows = New-Object 'System.Collections.Generic.List[object]'

foreach ($target in $targets) {
    $name = [string]$target.Name
    $path = [string]$target.Path
    $class = [string]$target.Class
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Container)) {
        $rootRows.Add([pscustomobject]@{
            Root=$name; Path=$path; Class=$class; Status='NOT_FOUND'
            Bytes=0L; GiB=0; Files=0L; Directories=0L; ReparseSkipped=0L; Errors=0L
        })
        continue
    }

    $path = [System.IO.Path]::GetFullPath($path).TrimEnd([char]'\')
    Write-Host ("Scanning {0}: {1}" -f $name, $path)
    $folders = New-Object 'System.Collections.Generic.Stack[string]'
    $folders.Push($path)
    $buckets = @{}
    [long]$bytes = 0
    [long]$files = 0
    [long]$dirs = 0
    [long]$reparseSkipped = 0
    [long]$errors = 0

    while ($folders.Count -gt 0) {
        $folder = $folders.Pop()
        try {
            $items = @(Get-ChildItem -LiteralPath $folder -Force -ErrorAction Stop)
        } catch {
            $errors++
            if ($issueRows.Count -lt 300) {
                $issueRows.Add([pscustomobject]@{ Root=$name; Path=$folder; Issue=$_.Exception.Message })
            }
            continue
        }

        foreach ($item in $items) {
            try {
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    $reparseSkipped++
                    continue
                }
                if ($item.PSIsContainer) {
                    $dirs++
                    $folders.Push($item.FullName)
                    continue
                }

                [long]$size = $item.Length
                $bytes += $size
                $files++

                # Attribute size to ancestor directory buckets, up to three levels per scan root.
                $relative = $item.FullName.Substring($path.Length).TrimStart([char]'\')
                $slash = $relative.LastIndexOf([char]'\')
                if ($slash -ge 0) {
                    $relativeFolder = $relative.Substring(0, $slash)
                    $parts = @($relativeFolder -split '\\')
                    $prefix = ''
                    $levels = [Math]::Min(3, $parts.Count)
                    for ($i=0; $i -lt $levels; $i++) {
                        if ($i -eq 0) { $prefix = $parts[$i] }
                        else { $prefix += '\' + $parts[$i] }
                        if (-not $buckets.ContainsKey($prefix)) {
                            $buckets[$prefix] = @{ Bytes=0L; Files=0L; Depth=($i+1) }
                        }
                        $buckets[$prefix].Bytes = [long]$buckets[$prefix].Bytes + $size
                        $buckets[$prefix].Files = [long]$buckets[$prefix].Files + 1
                    }
                }
                if (($files % 100000) -eq 0) {
                    Write-Host ("  {0} files, {1:N2} GiB..." -f $files, ($bytes / $GiB))
                }
            } catch {
                $errors++
                if ($issueRows.Count -lt 300) {
                    $issueRows.Add([pscustomobject]@{ Root=$name; Path=$item.FullName; Issue=$_.Exception.Message })
                }
            }
        }
    }

    $rootRows.Add([pscustomobject]@{
        Root=$name; Path=$path; Class=$class
        Status=$(if ($errors -eq 0) {'COMPLETE'} else {'PARTIAL_ERRORS'})
        Bytes=$bytes; GiB=[Math]::Round(($bytes/$GiB), 3)
        Files=$files; Directories=$dirs; ReparseSkipped=$reparseSkipped; Errors=$errors
    })
    foreach ($entry in $buckets.GetEnumerator()) {
        $item = $entry.Value
        $bucketRows.Add([pscustomobject]@{
            Root=$name; RelativeDirectory=$entry.Key; Depth=$item.Depth
            Bytes=[long]$item.Bytes; GiB=[Math]::Round(([double]$item.Bytes/$GiB), 3)
            Files=[long]$item.Files; Class=$class
        })
    }
    Write-Host ("  Finished {0}: {1:N2} GiB, {2} files, {3} errors" -f $name, ($bytes/$GiB), $files, $errors)
}

$summaryCsv = Join-Path $ReportDirectory 'Tong-disk-audit-summary.csv'
$bucketsCsv = Join-Path $ReportDirectory 'Tong-disk-audit-buckets.csv'
$issuesCsv = Join-Path $ReportDirectory 'Tong-disk-audit-issues.csv'
$summaryTxt = Join-Path $ReportDirectory 'Tong-disk-audit-README.txt'

@($rootRows | Sort-Object Bytes -Descending) | Export-Csv -LiteralPath $summaryCsv -NoTypeInformation -Encoding UTF8
@($bucketRows | Sort-Object Bytes -Descending) | Export-Csv -LiteralPath $bucketsCsv -NoTypeInformation -Encoding UTF8
if ($issueRows.Count -gt 0) {
    # Explicitly expand the generic list for Windows PowerShell 5.1 compatibility.
    $issueRows.ToArray() | Export-Csv -LiteralPath $issuesCsv -NoTypeInformation -Encoding UTF8
} else {
    'No directory-enumeration errors recorded.' | Set-Content -LiteralPath $issuesCsv -Encoding UTF8
}

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('Tong read-only disk inventory')
$lines.Add(('Completed (local time): {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')))
$lines.Add(('Elapsed minutes: {0:N2}' -f ((Get-Date)-$startTime).TotalMinutes))
$lines.Add('Reports: Tong-disk-audit-summary.csv; Tong-disk-audit-buckets.csv; Tong-disk-audit-issues.csv')
$lines.Add('Bytes are apparent/logical sizes, NOT allocated disk space; hard links may be counted more than once.')
$lines.Add('Reparse points/junctions/symbolic links are not traversed. Missing and inaccessible paths are reported.')
$lines.Add('NO files were deleted, modified, moved, or permission-adjusted by this inventory (except these four reports).')
$lines.Add('KEEP all production secrets, state, release, backup/restore and approval evidence until specifically reviewed.')
$lines.Add('')
$lines.Add('ROOT TOTALS:')
foreach ($r in ($rootRows | Sort-Object Bytes -Descending)) {
    $lines.Add(('{0} | {1:N3} GiB | {2} | {3} files | {4} errors | {5}' -f $r.Root,$r.GiB,$r.Status,$r.Files,$r.Errors,$r.Path))
}
$lines.Add('')
$lines.Add('LARGEST LEVEL-3 DIRECTORY BUCKETS (size includes contents; parent/child sizes overlap):')
foreach ($r in ($bucketRows | Where-Object Depth -eq 3 | Sort-Object Bytes -Descending | Select-Object -First 50)) {
    $lines.Add(('{0:N3} GiB | {1} | {2}' -f $r.GiB,$r.Root,$r.RelativeDirectory))
}
$lines | Set-Content -LiteralPath $summaryTxt -Encoding UTF8

Write-Host ''
Write-Host 'Inventory finished. Reports are in:'
Write-Host $ReportDirectory
Write-Host 'Tong-disk-audit-README.txt'
Write-Host 'Tong-disk-audit-summary.csv'
Write-Host 'Tong-disk-audit-buckets.csv'
Write-Host 'Tong-disk-audit-issues.csv'
