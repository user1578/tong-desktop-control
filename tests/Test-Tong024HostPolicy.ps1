$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Join-Path 'D:\Tong\state' ('b23-host-policy-'+[guid]::NewGuid().ToString());$null=[IO.Directory]::CreateDirectory($root)
$exe=Join-Path $root 'TongLoginHost.exe';$runner=Join-Path $root 'TongLoginRuntime.ps1';$marker=Join-Path $root 'executed.marker'
& (Join-Path $PSScriptRoot '..\scripts\Build-TongLoginHost.ps1') -OutputPath $exe
[IO.File]::WriteAllText($runner,"[IO.File]::WriteAllText((Join-Path `$PSScriptRoot 'executed.marker'),'unexpected')",[Text.UTF8Encoding]::new($false))
# New adversarial fixture only. Never clear/change an existing file's mark.
[IO.File]::WriteAllText($runner+':Zone.Identifier',"[ZoneTransfer]`r`nZoneId=3`r`n",[Text.UTF8Encoding]::new($false))
$before=(Get-FileHash -LiteralPath $runner).Hash
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\');$definition=$scheduler.NewTask(0)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT1M';$a=$definition.Actions.Create(0);$a.Path=$exe;$a.WorkingDirectory=$root
$task=$folder.RegisterTaskDefinition(('Tong024Acceptance-'+[guid]::NewGuid().ToString()),$definition,2,$sid,$null,3)
try{$null=$task.Run($null);Start-Sleep -Milliseconds 500;$until=[DateTime]::UtcNow.AddSeconds(30);while(@($task.GetInstances(0)).Count -gt 0 -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100};if(@($task.GetInstances(0)).Count -gt 0){throw 'SIGNATURE_CHECK_TIMEOUT'};$exitCode=$task.LastTaskResult}finally{$task.Enabled=$false}
if($exitCode -eq 0 -or [IO.File]::Exists($marker)){throw 'SIGNATURE_POLICY_BYPASSED'}
if((Get-FileHash -LiteralPath $runner).Hash -cne $before -or -not [IO.File]::ReadAllText($runner+':Zone.Identifier').Contains('ZoneId=3')){throw 'POLICY_FIXTURE_MODIFIED'}
if([IO.File]::ReadAllText((Join-Path $root 'host.stderr.log')) -notmatch 'UnauthorizedAccess|PSSecurityException|SecurityError:'){throw 'SIGNATURE_REJECTION_UNPROVEN'}
@{passed=$true;root=$root;task=$task.Name;hostExit=$exitCode;internetMarkedRunnerRejected=$true;markerUnchanged=$true;productionMutation=$false}|ConvertTo-Json -Compress
