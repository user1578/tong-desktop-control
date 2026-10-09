param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts\native'))

$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The .NET Framework x64 C# compiler is unavailable.' }
$source = Join-Path $PSScriptRoot '..\native\TongWorkerSupervisor'
$files = Get-ChildItem -LiteralPath $source -Filter '*.cs' -File | Sort-Object Name | ForEach-Object FullName
if ($files.Count -lt 4) { throw 'Native Supervisor source files are incomplete.' }
$target = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $target -Force | Out-Null
$binary = Join-Path $target 'TongWorkerSupervisor.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll /r:System.ServiceProcess.dll "/out:$binary" $files
if ($LASTEXITCODE -ne 0) { throw "Native Supervisor build failed ($LASTEXITCODE)." }
$hash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{ executable=$binary; sha256=$hash; sourceCount=$files.Count; compiler=$compiler } | ConvertTo-Json
