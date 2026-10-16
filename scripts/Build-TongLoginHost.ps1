param([Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not [IO.Path]::IsPathRooted($OutputPath) -or (Test-Path -LiteralPath $OutputPath)){throw 'A new absolute output path is required'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ ('/out:'+$OutputPath) (Join-Path $PSScriptRoot 'TongLoginHost.cs')
if($LASTEXITCODE -ne 0){throw 'Login host compilation failed'}
