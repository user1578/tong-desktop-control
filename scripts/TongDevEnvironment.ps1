param(
  [ValidateSet('all','python','py','node','npm','git','pwsh','cmake','gcc','java','mvn')]
  [string]$Tool = 'all'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# Only inspect commands visible on the current process PATH. Do not execute
# any located program, resolve registry-wide installs, or change the system.
$allowed = @('python','py','node','npm','git','pwsh','cmake','gcc','java','mvn')
$names = if($Tool -eq 'all') { $allowed } else { @($Tool) }
$rows = @(
  foreach($name in $names) {
    $found = @(
      Get-Command -Name $name -All -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.Source) }
    )
    $unique = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $candidates = @(
      foreach($command in $found) {
        if(-not $unique.Add([string]$command.Source)) { continue }
        if($unique.Count -gt 3) { break }
        $fullPath = [string]$command.Source
        $version = $null
        try {
          $item = Get-Item -LiteralPath $fullPath -ErrorAction Stop
          if($item -is [System.IO.FileInfo]) {
            $raw = [string]$item.VersionInfo.FileVersion
            if(-not [string]::IsNullOrWhiteSpace($raw)) { $version = $raw.Substring(0, [Math]::Min(80, $raw.Length)) }
          }
        } catch {
          # A command can disappear between discovery and metadata reading.
          # Its path remains visible; version stays unavailable.
        }
        [pscustomobject]@{ path = $fullPath; fileVersion = $version }
      }
    )
    [pscustomobject]@{
      name = $name
      available = ($candidates.Count -gt 0)
      candidates = @($candidates)
      truncated = ($unique.Count -gt 3)
    }
  }
)
[pscustomobject]@{
  source = 'process-path'
  versionSource = 'file-metadata'
  tools = @($rows)
} | ConvertTo-Json -Depth 6 -Compress
