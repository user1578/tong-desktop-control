$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$project=Split-Path -Parent $PSScriptRoot
$files=@('scripts/Install-TongLoginManagement.ps1','scripts/TongLoginRuntime.ps1','scripts/TongRuntimeLaunch.ps1','scripts/TongRuntimeGuardian.ps1','scripts/TongControl.psm1','scripts/TongRuntimeSecurity.ps1','scripts/TongProductionApproval.ps1','tests/Test-TongExternalTunnel.ps1','tests/Test-TongRuntimePowerShell.ps1')
foreach($name in $files) {
    $tokens=$null;$errors=$null
    $null=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project $name),[ref]$tokens,[ref]$errors)
    if($errors.Count -gt 0){throw ($name+': '+($errors.Message -join '; '))}
}
& (Join-Path $PSScriptRoot 'Test-TongExternalTunnel.ps1')
& (Join-Path $PSScriptRoot 'Test-TongPortListenerArray.ps1')
Write-Output ('PASS: '+$files.Count+' runtime PowerShell sources parsed under '+$PSVersionTable.PSVersion.ToString())
