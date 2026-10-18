param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('processes','services')]
    [string]$Kind,
    [ValidateRange(1,100)]
    [int]$Limit = 30,
    [string]$Name = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$filtered = @()
if($Kind -eq 'processes') {
    $filtered = @(Get-Process -ErrorAction Stop | Where-Object {
        -not $Name -or $_.ProcessName -ieq $Name -or ($_.ProcessName + '.exe') -ieq $Name
    } | Sort-Object ProcessName,Id)
    $entries = @($filtered | Select-Object -First $Limit | ForEach-Object {
        [pscustomobject]@{
            pid = [int]$_.Id
            name = [string]$_.ProcessName
            workingSetBytes = [long]$_.WorkingSet64
        }
    })
} else {
    $filtered = @(Get-Service -ErrorAction Stop | Where-Object {
        -not $Name -or $_.Name -ieq $Name -or $_.DisplayName -ieq $Name
    } | Sort-Object Name)
    $entries = @($filtered | Select-Object -First $Limit | ForEach-Object {
        [pscustomobject]@{
            name = [string]$_.Name
            displayName = [string]$_.DisplayName
            status = [string]$_.Status
        }
    })
}
[pscustomobject]@{
    kind = $Kind
    entries = @($entries)
    count = $entries.Count
    truncated = ($filtered.Count -gt $Limit)
} | ConvertTo-Json -Depth 4 -Compress
