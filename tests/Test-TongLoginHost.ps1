param([string]$EvidenceRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $EvidenceRoot){$EvidenceRoot=Join-Path 'D:\Tong\state' ('silent-host-test-'+[guid]::NewGuid().ToString('N'))}
$null=New-Item -ItemType Directory -Path $EvidenceRoot
$exe=Join-Path $EvidenceRoot 'TongLoginHost.exe'
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
if($LASTEXITCODE -ne 0){throw 'Host build failed'}
$fixture=Join-Path $EvidenceRoot 'TongLoginRuntime.ps1'
# A missing wait, console creation or discarded child status must fail this probe.
@'
param([string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
if($Mode -cne 'run'){exit 94}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'probe.json'),(@{pid=$PID;console=[ConsoleProbe]::GetConsoleWindow().ToInt64();identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;cwd=[Environment]::CurrentDirectory}|ConvertTo-Json))
[Console]::Out.WriteLine('probe stdout')
[Console]::Error.WriteLine('probe stderr')
while(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release'))){Start-Sleep -Milliseconds 100}
exit 37
'@ | Set-Content -LiteralPath $fixture -Encoding utf8
$hostProcess=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
$deadline=[DateTime]::UtcNow.AddSeconds(20)
$probePath=Join-Path $EvidenceRoot 'probe.json'
while(-not (Test-Path -LiteralPath $probePath) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
if(-not (Test-Path -LiteralPath $probePath)){throw 'Probe did not run'}
$probe=Get-Content -LiteralPath $probePath -Raw|ConvertFrom-Json
if($hostProcess.HasExited){throw 'Host ended before its runner'}
if($probe.console -ne 0){throw 'Runner has a console window'}
if($probe.identity -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Interactive identity changed'}
if((Get-Process -Id $probe.pid).MainWindowHandle -ne 0){throw 'Runner owns a window'}
[IO.File]::WriteAllText((Join-Path $EvidenceRoot 'release'),'exit')
if(-not $hostProcess.WaitForExit(15000)){throw 'Host did not finish'}
if($hostProcess.ExitCode -ne 37){throw ('Child exit code not propagated: '+$hostProcess.ExitCode)}
if((Get-Content -LiteralPath (Join-Path $EvidenceRoot 'host.stdout.log') -Raw).Trim() -cne 'probe stdout'){throw 'stdout not drained'}
if((Get-Content -LiteralPath (Join-Path $EvidenceRoot 'host.stderr.log') -Raw).Trim() -cne 'probe stderr'){throw 'stderr not drained'}
$bytes=[IO.File]::ReadAllBytes($exe);$pe=[BitConverter]::ToInt32($bytes,60)
if([BitConverter]::ToUInt16($bytes,$pe+92) -ne 2){throw 'Host is not a Windows GUI executable'}
$null=Rename-Item -LiteralPath $fixture -NewName 'TongLoginRuntime.observed.ps1'
$missing=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
if(-not $missing.WaitForExit(10000) -or $missing.ExitCode -ne 1){throw 'Missing runner must produce task failure'}
Write-Output (@{passed=$true;root=$EvidenceRoot;runnerConsole=$probe.console;exitCode=$hostProcess.ExitCode;identityPreserved=$true}|ConvertTo-Json -Compress)
