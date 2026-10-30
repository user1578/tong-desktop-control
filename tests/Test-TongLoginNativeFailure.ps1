$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\TongLoginRuntime.ps1'),[ref]$tokens,[ref]$errors)
foreach($name in @('Runtime','Read-ManagerProbeDiagnostic')){
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if($null -ne $fn){. ([scriptblock]::Create($fn.Extent.Text))}
}
$script:Mode='run';$script:runtime='D:\synthetic-tong';$script:manager='synthetic-manager'
$script:node={ $global:LASTEXITCODE=-1073740791 }
$script:observed=$null
function Write-RuntimeEvent {param($Event,$Status,$Reason,$Details) $script:observed=$Details;$script:reason=$Reason}
$exception=$null
try{Runtime 'doctor'}catch{$exception=$_.Exception}
if($null -eq $exception){throw 'Native exit must be refused'}
if($script:reason -cne 'NATIVE_FAST_FAIL'){throw ('Native failure misclassified as '+$script:reason)}
if($observed.nativeExitCode -ne -1073740791 -or $observed.exitHex -cne '0xC0000409' -or $observed.outputKind -cne 'empty'){throw 'Original native exit lost'}
if($exception.Data['nativeExitCode'] -ne -1073740791){throw 'Native exception data lost'}
$script:node={ $global:LASTEXITCODE=1;'{"error":"APPROVAL_DENIED"}' }
try{Runtime 'doctor'}catch{}
if($script:reason -cne 'APPROVAL_DENIED' -or $observed.outputKind -cne 'error_json'){throw 'Authorization refusal must stay distinct'}
[pscustomobject]@{passed=$true;nativeFastFailPreserved=$true;authorizationPreserved=$true;productionAcceptance=$false}|ConvertTo-Json -Compress
