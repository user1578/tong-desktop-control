$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Execute only the real acceptance function. All runtime/log/clock boundaries
# below are in memory; this test never invokes a Manager or a scheduled task.
$wrapper=Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($wrapper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
$fn=$ast.Find({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Await-Healthy'},$true)
Invoke-Expression $fn.Extent.Text
$root='synthetic-root';$manager='synthetic-manager'
function Reset-Health {
  $script:nowMs=0;$script:readyAtMs=51000;$script:queryMs=0
  $script:polls=0;$script:doctorCalls=0;$script:doctorHealthy=$true
  $script:failure='';$script:doctorFailure='';$script:replaceDuringDoctor=$false
  $script:loseDuringDoctor=$false;$script:doctorThrows=$false
}
function Get-Date {return ([datetime]'2026-10-22T00:00:00Z').AddMilliseconds($script:nowMs)}
function Start-Sleep {param($Seconds) $script:nowMs+=1000*$Seconds}
function CurrentStatus {
  $phase=if($script:nowMs -ge $script:readyAtMs){'ready'}else{'starting'}
  $script:nowMs+=$script:queryMs;$script:polls++
  $runId=if($script:replaceDuringDoctor -and $script:doctorCalls){'replacement'}else{'original'}
  $alive=-not ($script:loseDuringDoctor -and $script:doctorCalls)
  return [pscustomobject]@{runId=$runId;phase=$phase;supervisorAlive=$alive;guardianAlive=$alive}
}
function Get-LoginFailure {return $script:failure}
function Native {
  param($Name,$Arguments)
  if($Name -cne 'production doctor'){throw 'Unexpected native call'}
  $script:doctorCalls++
  if($script:doctorThrows){throw 'Synthetic doctor refused'}
  $script:failure=$script:doctorFailure
  return [pscustomobject]@{healthy=$script:doctorHealthy}
}
function Assert-Fails([scriptblock]$Action,[string]$Message){
  $caught='';try{& $Action}catch{$caught=$_.Exception.Message}
  if(-not $caught.Contains($Message)){throw ('Expected ['+$Message+'], got ['+$caught+']')}
}
Reset-Health
$result=Await-Healthy
if($result.phase -cne 'ready' -or $script:nowMs -ne 51000 -or $script:doctorCalls -ne 1){throw 'A progressing 51-second startup must pass'}
Reset-Health;$script:readyAtMs=239000;$script:queryMs=2000
$result=Await-Healthy
if($result.phase -cne 'ready' -or $script:doctorCalls -ne 1){throw 'Ready just before the deadline must receive a final acceptance probe'}
Reset-Health;$script:readyAtMs=[double]::PositiveInfinity
Assert-Fails {Await-Healthy} 'phase=starting; supervisorAlive=True; guardianAlive=True'
if($script:nowMs -ne 240000 -or $script:doctorCalls){throw 'A stuck startup must fail at the existing deadline without doctor calls'}
Reset-Health;$script:readyAtMs=0;$script:doctorHealthy=$false
Assert-Fails {Await-Healthy} 'Production failed the ready/doctor acceptance'
if($script:nowMs -ne 240000){throw 'An unhealthy doctor must not extend the acceptance budget'}
Reset-Health;$script:failure='start: START_TIMEOUT'
Assert-Fails {Await-Healthy} 'Login monitor exited: start: START_TIMEOUT'
if($script:doctorCalls -or $script:nowMs){throw 'Terminal monitor failures must still fail immediately'}
Reset-Health;$script:readyAtMs=240000;$script:replaceDuringDoctor=$true
Assert-Fails {Await-Healthy} 'Production failed the ready/doctor acceptance'
if($script:doctorCalls -ne 1){throw 'A replacement run cannot inherit the previous doctor result'}
Reset-Health;$script:readyAtMs=240000;$script:loseDuringDoctor=$true
Assert-Fails {Await-Healthy} 'supervisorAlive=False; guardianAlive=False'
Reset-Health;$script:readyAtMs=0;$script:doctorFailure='runner_failed'
Assert-Fails {Await-Healthy} 'Login monitor exited: runner_failed'
Reset-Health;$script:readyAtMs=0;$script:doctorThrows=$true
Assert-Fails {Await-Healthy} 'Synthetic doctor refused'
Write-Output 'PASS: slow startup, deadline-edge readiness, bounded startup/doctor failures, terminal monitor failures, and post-doctor run/liveness verification.'
