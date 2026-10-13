$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\scripts\TongControl.psm1') -Force
$module=Get-Module TongControl
& $module {
    function Get-TongConfiguration { [pscustomobject]@{WorkspacePath=$PSScriptRoot;PublicOrigin='https://example.invalid';DevSpacePort=7677;Port=7676;LocalMcpUrl='http://127.0.0.1:7676/mcp';DevSpaceMcpUrl='http://127.0.0.1:7677/mcp';PublicMcpUrl='https://example.invalid/mcp'} }
    function Test-Path { $true }
    function Get-TongDevSpaceConfig { }
    function Initialize-TongRuntimeDirectories { }
    function Sync-TongPublicOrigin { }
    function Get-TongManagedProcess { param($Name) if($Name -eq 'ngrok'){throw 'External tunnel process record must not be consulted'} }
    function Stop-TongManagedProcess { param($Name) if($Name -eq 'ngrok'){throw 'External tunnel must not be stopped'}; $script:stops+=,$Name }
    function Start-TongDevSpace { $script:starts+=,'devspace' }
    function Start-TongGateway { $script:starts+=,'gateway' }
    function Get-TongPortListeners { return ,@() }
    $script:starts=@();$script:stops=@()
    Start-TongDesktopControl
    if(($script:starts -join ',') -cne 'devspace,gateway'){throw 'Legacy local startup order changed'}
    Stop-TongDesktopControl
    if(($script:stops -join ',') -cne 'gateway,devspace'){throw 'Legacy local stop order changed'}
    $null=Get-TongDesktopControlStatus
}
Write-Output 'PASS: legacy start/stop/status leave the external tunnel untouched.'
