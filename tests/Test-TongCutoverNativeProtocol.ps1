$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\Invoke-TongQuickTrustFullProduction.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Native','Convert-NativeResult','Restore-Old')},$true)){
  . ([scriptblock]::Create($fn.Extent.Text))
}
$script:node='D:\node\node.exe';$script:helper='unused-helper'
function Assert-Fails([scriptblock]$Operation,[string]$Expected){
  $message='';try{& $Operation|Out-Null}catch{$message=$_.Exception.Message}
  if(-not $message.Contains($Expected)){throw ('Expected '+$Expected+', received '+$message)}
}
$value=Native 'single result' @('-e','console.log(JSON.stringify({ok:true,stage:"done"}))')
if($value.stage -cne 'done'){throw 'Valid final object lost'}
$value=Native 'stderr diagnostic' @('-e','console.error("synthetic diagnostic");console.log(JSON.stringify({ok:true,stage:"done"}))')
if($value.stage -cne 'done'){throw 'stderr diagnostic polluted stdout'}
Assert-Fails {Native 'composite install' @('-e','console.log("{\"ok\":true}");console.log("{\"ok\":true}")')} 'INVALID_NATIVE_JSON: composite install'
Assert-Fails {Native 'stdout diagnostic' @('-e','console.log("progress");console.log("{\"ok\":true}")')} 'INVALID_NATIVE_JSON: stdout diagnostic'
Assert-Fails {Native 'empty' @('-e','')} 'INVALID_NATIVE_JSON: empty'
Assert-Fails {Native 'array' @('-e','console.log("[{\"ok\":true}]")')} 'INVALID_NATIVE_JSON: array'
Assert-Fails {Native 'false success' @('-e','console.log("{\"ok\":false,\"error\":\"INJECTED_FAILURE\"}")')} 'FAILED: false success exit=0 code=INJECTED_FAILURE'
Assert-Fails {Native 'partial install' @('-e','console.log("{\"ok\":false,\"error\":\"INJECTED_PARTIAL_INSTALL\"}");process.exitCode=3')} 'FAILED: partial install exit=3 code=INJECTED_PARTIAL_INSTALL'
Assert-Fails {Native 'native crash' @('-e','process.exitCode=4')} 'FAILED: native crash exit=4'

# The actual deployment catch calls actual Restore-Old; replace only its
# external lifecycle operations. File restoration is tested in the Node fixture.
$catchClause=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})[-1]
$catchBody=[scriptblock]::Create($catchClause.CatchClauses[0].Body.Extent.Text.TrimStart('{').TrimEnd('}'))
$root='D:\synthetic-runtime';$snapshot='D:\synthetic-snapshot';$ExpectedOldCommit='a';$wasStopped=$true;$didInstall=$true;$taskDisabled=$true;$recoverySigned=$true
function CurrentStatus {[pscustomobject]@{supervisorAlive=$false}}
function Await-Stopped {[pscustomobject]@{phase='stopped'}}
function Native {param($Name,$Arguments)
  if($Name -eq 'restore exact old sources'){
    $script:restoreCalls++
    if($script:scenario -eq 'source-restore-fails'){throw 'INJECTED_SOURCE_RESTORE_FAILURE'}
    return [pscustomobject]@{ok=$true}
  }
  if($Name -eq 'verify restored login recovery'){return [pscustomobject]@{approved=$true}}
  if($Name -eq 'release restored lifecycle gate'){$script:gateReleases++;return [pscustomobject]@{ok=$true}}
  throw ('Unexpected Native '+$Name)
}
function Enable-Login {$script:enabled++}
function Await-Healthy {if($script:scenario -eq 'startup-fails'){throw 'INJECTED_STARTUP_FAILURE'};return [pscustomobject]@{runId='isolated-recovered-run'}}
function Write-Host {param($Object,$ForegroundColor) $script:messages+= [string]$Object}
foreach($scenario in @('recovered','source-restore-fails','startup-fails')){
  $script:scenario=$scenario;$script:restoreCalls=0;$script:enabled=0;$script:gateReleases=0;$script:messages=@()
  $failure='';try{try{throw 'INJECTED_INSTALL_FAILURE'}catch{. $catchBody}}catch{$failure=$_.Exception.Message}
  if($script:restoreCalls -ne 1){throw 'Auto rollback must run exactly once'}
  if(-not $failure.Contains('INJECTED_INSTALL_FAILURE')){throw 'Original installation failure lost'}
  if($scenario -eq 'recovered'){
    if(-not $failure.Contains('UPGRADE_FAILED_OLD_VERSION_RECOVERED') -or $script:enabled -ne 1 -or $script:gateReleases -ne 1 -or -not ($script:messages -match 'Old version recovered')){throw 'Recovered outcome not distinguished'}
  }else{
    if(-not $failure.Contains('UPGRADE_FAILED_ROLLBACK_FAILED') -or ($script:messages -match 'Old version recovered')){throw 'Failed recovery must not report success'}
    $expectedCause=if($scenario -eq 'source-restore-fails'){'INJECTED_SOURCE_RESTORE_FAILURE'}else{'INJECTED_STARTUP_FAILURE'}
    if(-not $failure.Contains($expectedCause)){throw 'Recovery failure cause lost'}
    if($scenario -eq 'source-restore-fails' -and ($script:enabled -or $script:gateReleases)){throw 'Failed source restore must keep task/gate closed'}
  }
}
Write-Output 'PASS: strict single JSON consumption, operation-specific failures, automatic rollback success and source/startup recovery failures.'
