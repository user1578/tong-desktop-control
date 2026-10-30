$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$source=Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
$mutexPrefix='Local\TongMonitorRecoveryTest-'+[guid]::NewGuid().ToString('N')+'-'
foreach($name in @('Assert-LoginRecoveryState','Recover-LoginMonitor')){
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if($null -eq $fn){throw ('Missing recovery function: '+$name)}
    . ([scriptblock]::Create($fn.Extent.Text.Replace('New-Object -ComObject Schedule.Service','$script:scheduler').Replace('Local\TongLoginRuntime-',$mutexPrefix+'lifecycle-').Replace('Local\TongLoginMonitorRecovery-',$mutexPrefix+'controller-')))
}
# The real recovery controller executes; external observations and Task start
# are fakes. Any production lifecycle mutation fails this test immediately.
$script:taskName='SyntheticMonitor';$script:root='D:\synthetic-tong'
$script:manager='synthetic-manager';$script:ExpectedRunId='11111111-1111-4111-8111-111111111111'
$script:expectedOldApp='f81d1d0ddcc6da354cb475be628e6b79ca822516'
$script:definition=[pscustomobject]@{}
$definition|Add-Member ScriptMethod GetInstances {param($flags) return $script:instances}
$script:folder=[pscustomobject]@{}
$folder|Add-Member ScriptMethod GetTask {param($name) return $script:definition}
$script:scheduler=[pscustomobject]@{}
$scheduler|Add-Member ScriptMethod Connect {}
$scheduler|Add-Member ScriptMethod GetFolder {param($path) return $script:folder}
function Get-LoginRecoveryState { $script:reads++; if($script:reads -eq 2){& $script:race}; return $script:state.PSObject.Copy() }
function Assert-LoginMonitorAbsent {if($script:orphan){throw 'unclaimed live process'}}
function Get-LoginMonitorIdentity {param($Definition) if($script:instances.Count -ne 1){throw 'Expected exactly one live login monitor instance'};return $script:identity}
function Assert-LoginMonitorIdentity {param($Definition,$Expected) if($script:reused){throw 'Login monitor identity changed'}}
function Assert-LoginMonitorExclusive {param($Identity) if($script:orphan){throw 'Unclaimed login process after recovery'}}
function Get-CimInstance {param($ClassName,$Filter) return [pscustomobject]@{ProcessId=101}}
function Get-LoginFailure {if($script:failed){return 'doctor: NATIVE_FAST_FAIL 0xC0000409'};return $null}
function Test-LoginRecoveryHealthy {param($Identity) return $script:healthy}
function Native {param($Name,$Arguments) if($Name -cne 'verify monitor recovery grant'){throw ('Forbidden manager action: '+$Name)};if($script:denied){throw 'APPROVAL_DENIED'};return [pscustomobject]@{approved=$true;loginRecoverySupported=$true;runnerSha256=('b'*64)}}
function Start-ScheduledTask {param($TaskName) $script:starts++;$script:instances=@([pscustomobject]@{EnginePID=100});$script:state.taskState='Running';& $script:afterStart}
function Start-Sleep {throw 'Recovery did not accept the supplied observation'}
function Stop-Process {throw 'Forbidden force stop'}
function Stop-ScheduledTask {throw 'Forbidden task stop'}
function Enable-ScheduledTask {throw 'Forbidden task enable'}
function Disable-ScheduledTask {throw 'Forbidden task disable'}
function Reset-Case {
    $script:reads=0;$script:starts=0;$script:instances=@();$script:orphan=$false;$script:reused=$false
    $script:failed=$false;$script:healthy=$true;$script:denied=$false;$script:race={};$script:afterStart={}
    $script:identity=[pscustomobject]@{runner=[pscustomobject]@{pid=101};hostProcess=[pscustomobject]@{pid=100}}
    $script:state=[pscustomobject]@{runId=$ExpectedRunId;phase='ready';supervisorAlive=$true;guardianAlive=$true;stopRequested=$false;commit=$expectedOldApp;taskState='Ready';runnerSha256=('b'*64);fingerprint='original'}
}
function Assert-Refused([scriptblock]$Change,[int]$Starts=0){
    Reset-Case;& $Change
    $caught=$false;try{Recover-LoginMonitor}catch{$caught=$true}
    if(-not $caught -or $script:starts -ne $Starts){throw ('Unsafe recovery accepted, starts='+$script:starts)}
}
Reset-Case
$result=Recover-LoginMonitor
if($starts -ne 1 -or $result.runId -cne $ExpectedRunId -or -not $result.monitorRecovered){throw 'Expected one reattached monitor on unchanged runtime'}
Assert-Refused {$script:instances=@(1)}
Assert-Refused {$script:instances=@(1,2)}
Assert-Refused {$script:orphan=$true}
Assert-Refused {$script:state.taskState='Running'}
Assert-Refused {$script:state.phase='stopped'}
Assert-Refused {$script:state.guardianAlive=$false}
Assert-Refused {$script:state.stopRequested=$true}
Assert-Refused {$script:state.commit='other'}
Assert-Refused {$script:state.runId='replacement'}
Assert-Refused {$script:denied=$true}
Assert-Refused {$script:race={$script:state.fingerprint='changed'}}
Assert-Refused {$script:race={$script:instances=@(1)}}
Assert-Refused {$script:afterStart={$script:failed=$true}} 1
Assert-Refused {$script:afterStart={$script:reused=$true}} 1
Assert-Refused {$script:afterStart={$script:state.runId='replacement'}} 1
Assert-Refused {$script:afterStart={$script:instances=@(1,2)}} 1
Assert-Refused {$script:afterStart={$script:orphan=$true}} 1
[pscustomobject]@{passed=$true;zeroMonitorReattached=$true;refusals=17;productionAcceptance=$false}|ConvertTo-Json -Compress
