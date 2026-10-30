$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$project=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path 'D:\Tong\development\test-temp' ('monitor-deployment-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
# Only this newly created test root receives a test ACL. No real deployment,
# task, grant, account data, service or production mutex is used.
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid)
foreach($allow in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($allow),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
Set-Acl -LiteralPath $fixture -AclObject $acl
function Prepare-Fixture([string]$Path){
    $scripts=Join-Path $Path 'releases\manager\scripts'
    [void][IO.Directory]::CreateDirectory($scripts)
    foreach($name in @('TongRuntimeSecurity.mjs','TongRuntimeSecurity.ps1')){Copy-Item -LiteralPath (Join-Path $project ('scripts\'+$name)) -Destination (Join-Path $scripts $name)}
}
Prepare-Fixture $fixture
$login=Join-Path $fixture 'login-management'
[void][IO.Directory]::CreateDirectory($login)
foreach($name in @('TongLoginHost.exe','TongLoginRuntime.ps1')){[IO.File]::WriteAllText((Join-Path $login $name),'fixture bytes; never executed')}
$script:root=$fixture;$script:node='D:\node\node.exe';$script:helper='unused-fixture-helper'
$t=$null;$e=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'scripts\Invoke-TongQuickTrustFullProduction.ps1'),[ref]$t,[ref]$e)
foreach($name in @('Convert-NativeResult','Native','Assert-LoginRecoveryDeployment')){$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);. ([scriptblock]::Create($fn.Extent.Text))}
Assert-LoginRecoveryDeployment
function Assert-Refused {
    $failed=$false;try{Assert-LoginRecoveryDeployment}catch{$failed=$true}
    if(-not $failed){throw 'Unsafe login deployment accepted'}
}
$unsafe=Get-Acl -LiteralPath $login
$unsafe.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Modify','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $login -AclObject $unsafe
Assert-Refused
# Restore this fixture's protected inherited ACL before testing a different risk.
Set-Acl -LiteralPath $login -AclObject $acl
Assert-LoginRecoveryDeployment
$linked=Join-Path $fixture 'linked-root'
Prepare-Fixture $linked
$null=New-Item -ItemType Junction -Path (Join-Path $linked 'login-management') -Value $login
$script:root=$linked
Assert-Refused
$script:root=$fixture
$null=New-Item -ItemType HardLink -Path (Join-Path $login 'Host.alias') -Value (Join-Path $login 'TongLoginHost.exe')
Assert-Refused
[pscustomobject]@{passed=$true;root=$fixture;realSecurityHelper=$true;foreignAclRejected=$true;parentJunctionRejected=$true;hardlinkRejected=$true;productionAcceptance=$false}|ConvertTo-Json -Compress
