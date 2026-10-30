$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$script:root=Join-Path 'D:\Tong\development\test-temp' ('monitor-binding-'+[guid]::NewGuid().ToString('N'))
foreach($dir in @('run','login-management')){[void][IO.Directory]::CreateDirectory((Join-Path $root $dir))}
$script:node=Join-Path $root 'node.fixture'
$script:taskName='SyntheticMonitor'
$script:expectedOldApp='f81d1d0ddcc6da354cb475be628e6b79ca822516'
$script:ExpectedRunId='11111111-1111-4111-8111-111111111111'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'),[ref]$tokens,[ref]$errors)
foreach($name in @('Get-LoginRecoveryState','Assert-LoginRecoveryState')){
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    . ([scriptblock]::Create($fn.Extent.Text))
}
function Get-ScheduledTask {param($TaskName) return $script:task}
function Export-ScheduledTask {param($TaskName) return ($script:task|ConvertTo-Json -Depth 6 -Compress)}
function CurrentStatus {return $script:status}
function Assert-LoginRecoveryDeployment {if($script:unsafeDeployment){throw 'ACL_DENIED'}}
function Reset-Case {
    $script:unsafeDeployment=$false
    $script:task=[pscustomobject]@{State='Ready';Actions=@([pscustomobject]@{Execute=(Join-Path $root 'login-management\TongLoginHost.exe');Arguments='';WorkingDirectory=$root});Settings=[pscustomobject]@{Enabled=$true;MultipleInstances=2};Principal=[pscustomobject]@{UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;LogonType='Interactive';RunLevel=0}}
    $script:status=[pscustomobject]@{runId=$ExpectedRunId;phase='ready';supervisorAlive=$true;guardianAlive=$true;stopRequested=$false;supervisor=[pscustomobject]@{pid=10;startTicks='100';exe='synthetic-node';parentPid=9}}
    foreach($path in @('profile.json','node.fixture','login-management\TongLoginHost.exe','login-management\TongLoginRuntime.ps1')){[IO.File]::WriteAllText((Join-Path $root $path),'fixture')}
    $script:ExpectedHostSha256=(Get-FileHash -LiteralPath (Join-Path $root 'login-management\TongLoginHost.exe')).Hash.ToLowerInvariant()
    $runnerHash=(Get-FileHash -LiteralPath (Join-Path $root 'login-management\TongLoginRuntime.ps1')).Hash.ToLowerInvariant()
    $pin=@{commit=$expectedOldApp;sourceFiles=@(@{path='scripts/TongLoginRuntime.ps1';sha256=$runnerHash})}|ConvertTo-Json -Depth 4
    foreach($path in @('run\release-pin.json','run\manager-pin.json')){[IO.File]::WriteAllText((Join-Path $root $path),$pin)}
    [IO.File]::WriteAllText((Join-Path $root 'run\guardian.json'),(@{runId=$ExpectedRunId;pid=9;startTicks='90'}|ConvertTo-Json))
}
function Assert-Refused([scriptblock]$Change){
    Reset-Case;& $Change
    $caught=$false;try{$s=Get-LoginRecoveryState;Assert-LoginRecoveryState $s}catch{$caught=$true}
    if(-not $caught){throw 'Changed file/task/runtime binding was accepted'}
}
Reset-Case
$baseline=Get-LoginRecoveryState
Assert-LoginRecoveryState $baseline
Assert-LoginRecoveryState (Get-LoginRecoveryState) $baseline
Assert-Refused {$script:task.Actions[0].Arguments='unexpected'}
Assert-Refused {$script:task.Actions[0].Execute='D:\other\host.exe'}
Assert-Refused {$script:task.Settings.Enabled=$false}
Assert-Refused {$script:task.Settings.MultipleInstances=0}
Assert-Refused {$script:task.Principal.UserId='S-1-5-18'}
Assert-Refused {$script:task.Principal.RunLevel=1}
Assert-Refused {$script:unsafeDeployment=$true}
Assert-Refused {[IO.File]::AppendAllText((Join-Path $root 'login-management\TongLoginRuntime.ps1'),'changed')}
Assert-Refused {[IO.File]::AppendAllText((Join-Path $root 'login-management\TongLoginHost.exe'),'changed')}
Assert-Refused {[IO.File]::WriteAllText((Join-Path $root 'run\manager-pin.json'),'{"commit":"changed"}')}
Assert-Refused {$script:status.supervisorAlive=$false}
Assert-Refused {$script:status.runId='replacement'}
Reset-Case;$baseline=Get-LoginRecoveryState
$script:status.supervisor.startTicks='101'
$caught=$false;try{Assert-LoginRecoveryState (Get-LoginRecoveryState) $baseline}catch{$caught=$true}
if(-not $caught){throw 'Supervisor PID reuse accepted'}
Reset-Case
[IO.File]::WriteAllText((Join-Path $root 'run\upgrade-gate.json'),'{}')
$caught=$false;try{Get-LoginRecoveryState}catch{$caught=$true}
if(-not $caught){throw 'Active upgrade gate accepted'}
[pscustomobject]@{passed=$true;root=$root;realFileHashBindings=$true;refusals=14;productionAcceptance=$false}|ConvertTo-Json -Compress
