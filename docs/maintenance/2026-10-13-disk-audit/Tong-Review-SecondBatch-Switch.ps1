# Tong second-batch cleanup evidence, READ-ONLY, Windows PowerShell 5.1-compatible.
# Inspects only specified candidates, current Tong release pins, process path references,
# and a few sample NTFS hardlink/content identities. Never deletes or changes system state.
# Outputs only nonsecret match locations and evidence into the authorized demo workspace.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$reportDir = 'D:\Tong\app\demo-workspace'
$oldPocRoot = 'D:\agentdock-poc-20261010'
$oldSwitch = 'D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9'
$stateSwitch = 'D:\Tong\state\b23-switch-c104fcca2aa9'
$oldDeployment = 'D:\tong-agentdock-local'
$sourceWorktree = Join-Path $env:USERPROFILE '.codex\worktrees'
$activeRuntime = 'D:\Tong\runtime'

if (-not (Test-Path -LiteralPath $reportDir -PathType Container)) {
    throw 'Expected demo workspace missing.'
}
$targets = [ordered]@{
    oldPoc = $oldPocRoot
    oldPocSwitch = $oldSwitch
    migratedStateSwitch = $stateSwitch
    oldDeployment = $oldDeployment
    codexWorktrees = $sourceWorktree
}
$matches = New-Object System.Collections.ArrayList
$notes = New-Object System.Collections.ArrayList

function Record([string]$Category,[string]$Candidate,[string]$Location,[string]$Observation) {
    [void]$matches.Add([pscustomobject]@{
        Category=$Category; Candidate=$Candidate; Location=$Location; Observation=$Observation
    })
}
function Note([string]$Value) { [void]$notes.Add($Value) }

# Output the JSON key path that contains each reference, not the string value itself.
function Walk-Json($Value,[string]$JsonPath,[string]$Source,[int]$Depth) {
    if ($Depth -gt 25 -or $null -eq $Value) { return }
    if ($Value -is [string]) {
        foreach ($key in $targets.Keys) {
            $p=[string]$targets[$key]
            if ($Value.IndexOf($p,[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Record 'JSON_PROPERTY_REFERENCE' $key $Source $JsonPath
            }
        }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($prop in $Value.PSObject.Properties) {
            Walk-Json $prop.Value ($JsonPath+'.'+$prop.Name) $Source ($Depth+1)
        }
        return
    }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
            Walk-Json $Value[$key] ($JsonPath+'.'+[string]$key) $Source ($Depth+1)
        }
        return
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $i=0
        foreach ($item in $Value) {
            Walk-Json $item ($JsonPath+'['+$i+']') $Source ($Depth+1)
            $i++
        }
    }
}

Write-Host 'Inspecting active Tong runtime metadata (property names only)...'
$configPaths = @(
    'D:\Tong\runtime\run\release-pin.json',
    'D:\Tong\runtime\run\manager-pin.json',
    'D:\Tong\runtime\run\runtime.json',
    'D:\Tong\runtime\profile.json',
    'D:\Tong\runtime\production-root.json',
    'D:\Tong\app\config\tong.config.json'
)
foreach ($path in $configPaths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Note ('CONFIG_MISSING: '+$path); continue
    }
    try {
        $f=Get-Item -LiteralPath $path -Force
        if ($f.Length -gt 2097152) {
            Note ('CONFIG_TOO_LARGE: '+$path); continue
        }
        $raw=[System.IO.File]::ReadAllText($path)
        $parsed=ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        Walk-Json $parsed '$' $path 0
        Record 'CONFIG_CHECKED' '-' $path 'JSON parsed; raw values not recorded'
    } catch {
        Note ('CONFIG_READ_OR_PARSE_FAILED: '+$path+' | '+$_.Exception.GetType().Name)
    }
}

Write-Host 'Inspecting live process and service references...'
try {
    $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach ($p in $processes) {
        foreach ($key in $targets.Keys) {
            $root=[string]$targets[$key]
            $exe=[string]$p.ExecutablePath
            $args=[string]$p.CommandLine
            if ($exe.IndexOf($root,[System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $args.IndexOf($root,[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Record 'RUNNING_PROCESS_REFERENCE' $key ([string]$p.ProcessId+' '+[string]$p.Name) 'Executable path or arguments contain candidate path; argument string not exported'
            }
        }
    }
    Record 'PROCESS_CHECKED' '-' 'Win32_Process' ('Read '+$processes.Count+' process records')
} catch { Note ('PROCESS_INSPECTION_FAILED: '+$_.Exception.GetType().Name) }

try {
    $services=@(Get-CimInstance Win32_Service -ErrorAction Stop)
    foreach ($s in $services) {
        foreach ($key in $targets.Keys) {
            $root=[string]$targets[$key]
            if (([string]$s.PathName).IndexOf($root,[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Record 'SERVICE_REFERENCE' $key ([string]$s.Name) ('State='+[string]$s.State)
            }
        }
    }
    Record 'SERVICE_CHECKED' '-' 'Win32_Service' ('Read '+$services.Count+' service records')
} catch { Note ('SERVICE_INSPECTION_FAILED: '+$_.Exception.GetType().Name) }

Write-Host 'Inspecting candidate root attributes and sampled file identities...'
foreach ($key in $targets.Keys) {
    $p=[string]$targets[$key]
    if (-not (Test-Path -LiteralPath $p -PathType Container)) {
        Record 'DIRECTORY' $key $p 'NOT_FOUND'; continue
    }
    try {
        $item=Get-Item -LiteralPath $p -Force
        $link=(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
        Record 'DIRECTORY' $key $p ('Exists; ReparsePoint='+$link+'; LastWrite='+$item.LastWriteTime.ToString('s'))
    } catch { Note ('DIR_INSPECTION_FAILED: '+$p) }
}

$relatives=@(
 'profile.json',
 'production-root.json',
 'run\runtime.json',
 'run\release-pin.json',
 'tong\package-lock.json',
 'tong\README.md',
 'tong\package.json'
)
$sha=[System.Security.Cryptography.SHA256]::Create()
foreach ($rel in $relatives) {
    $a=Join-Path $oldSwitch $rel
    $b=Join-Path $stateSwitch $rel
    if (-not ((Test-Path -LiteralPath $a -PathType Leaf) -and (Test-Path -LiteralPath $b -PathType Leaf))) {
        Record 'SAMPLE_FILE' 'both-switches' $rel 'MISSING_ON_ONE_OR_BOTH'; continue
    }
    try {
        $ai=Get-Item -LiteralPath $a; $bi=Get-Item -LiteralPath $b
        if ($ai.Length -ne $bi.Length) {
            Record 'SAMPLE_FILE' 'both-switches' $rel 'DIFFERENT_SIZE'; continue
        }
        $stream=[System.IO.File]::OpenRead($a)
        try {$ha=[Convert]::ToBase64String($sha.ComputeHash($stream))}
        finally {$stream.Dispose()}
        $stream=[System.IO.File]::OpenRead($b)
        try {$hb=[Convert]::ToBase64String($sha.ComputeHash($stream))}
        finally {$stream.Dispose()}
        $value=if ($ha -eq $hb) {'SAME_SHA256'} else {'DIFFERENT_SHA256'}
        Record 'SAMPLE_FILE' 'both-switches' $rel $value
    } catch { Note ('SAMPLE_HASH_FAILED: '+$rel+' | '+$_.Exception.GetType().Name) }
}
$sha.Dispose()

# Hardlink sampling is optional; if unavailable, explicitly record that physical
# reclaim size cannot be determined from logical totals. This never modifies links.
$fsutil=Get-Command 'fsutil.exe' -ErrorAction SilentlyContinue
if ($null -ne $fsutil) {
    foreach ($rel in @('profile.json','tong\package-lock.json')) {
        $a=Join-Path $oldSwitch $rel
        if (-not (Test-Path -LiteralPath $a -PathType Leaf)) { continue }
        try {
            $output=@(& $fsutil.Source hardlink list $a 2>&1 | ForEach-Object { [string]$_ })
            if ($LASTEXITCODE -ne 0) {
                Record 'HARDLINK_SAMPLE' 'oldPocSwitch' $rel 'UNAVAILABLE_OR_DENIED'
            } else {
                $links=@($output | Where-Object { $_.Trim().StartsWith('\') })
                $crossState=@($links | Where-Object {
                    $_.IndexOf('\Tong\state\b23-switch-c104fcca2aa9',[System.StringComparison]::OrdinalIgnoreCase) -ge 0
                }).Count -gt 0
                Record 'HARDLINK_SAMPLE' 'oldPocSwitch' $rel (
                    'Hardlink paths returned='+$links.Count+'; IncludesMigratedStatePath='+$crossState+'; DoesNotProveAllFilesUnique'
                )
            }
        } catch { Record 'HARDLINK_SAMPLE' 'oldPocSwitch' $rel 'CHECK_ERROR' }
    }
} else { Note 'FSUTIL_UNAVAILABLE: Hardlink samples not checked.' }

$outCsv=Join-Path $reportDir 'Tong-b23-switch-second-review.csv'
$outTxt=Join-Path $reportDir 'Tong-b23-switch-second-review.txt'
$matches.ToArray() | Export-Csv -LiteralPath $outCsv -Encoding UTF8 -NoTypeInformation
$text = New-Object System.Collections.Generic.List[string]
$text.Add('Tong B2.4 second-batch targeted dependency review; local time '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$text.Add('Read-only inspection only. No deletion is authorized by this report.')
$text.Add('JSON references are reported by property path only; raw sensitive contents are not copied.')
$text.Add('A path not referenced in inspected fields can still be necessary for historical restore/other workflows.')
$text.Add('Apparent sizes: old PoC switch ~3.542 GiB; migrated Tong state switch ~3.542 GiB. Do NOT sum sizes to predict freed disk bytes.')
$text.Add('')
$text.Add('MATCHES')
foreach ($r in $matches.ToArray()) {
    $text.Add($r.Category+' | '+$r.Candidate+' | '+$r.Location+' | '+$r.Observation)
}
$text.Add('')
$text.Add('NOTES')
if ($notes.Count -eq 0) { $text.Add('None') }
else { foreach ($n in $notes.ToArray()) {$text.Add([string]$n)} }
$text | Set-Content -LiteralPath $outTxt -Encoding UTF8
Write-Host 'Read-only review finished:'
Write-Host $outTxt
Write-Host $outCsv
