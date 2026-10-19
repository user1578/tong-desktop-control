$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'DSH-S1B1 Windows AccessCheck canary needs Windows'
}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $PSScriptRoot 'TongDshS1B1TokenCanary.cs'
if(!(Test-Path -LiteralPath $compiler -PathType Leaf) -or
   !(Test-Path -LiteralPath $source -PathType Leaf)){
    throw 'DSH-S1B1 pinned compiler or source is missing'
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('TongDshS1B1Build-'+[guid]::NewGuid().ToString('N'))
$root=[IO.Path]::GetFullPath($root)
$prefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
if(!$root.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){
    throw 'DSH-S1B1 temporary compiler output path invalid'
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
try{
    $exe=Join-Path $root 'TongDshS1B1TokenCanary.exe'
    & $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$exe" $source
    if($LASTEXITCODE -ne 0){throw 'DSH-S1B1 fixed synthetic binary did not compile'}
    $output=@(& $exe '--test')
    if($LASTEXITCODE -ne 0){throw 'DSH-S1B1 real Win32 AccessCheck synthetic canary failed'}
    $result=($output -join [Environment]::NewLine)|ConvertFrom-Json
    if($result.status -ne 'passed' -or !$result.realRestrictedToken -or
       !$result.originalTokenCanReadPrivate -or
       !$result.restrictedCanReadAllowed -or
       !$result.restrictedDeniedPrivate -or
       !$result.publicAceRestoresAccess -or
       $result.restrictedChildStarted -ne $false -or
       $result.productionPermissionSandboxVerified -ne $false -or
       $result.networkIsolationProved -ne $false -or
       $result.dshStarted -ne $false -or $result.modelCalled -ne $false){
        throw 'DSH-S1B1 synthetic ACL result is inconsistent'
    }
    $negative=@(& $exe '--launch-external-provider' 2>&1)
    if($LASTEXITCODE -eq 0){throw 'Arbitrary provider invocation was accepted'}
    $global:LASTEXITCODE=0
    [pscustomobject]@{
        status='passed'
        restrictedTokenCreated=$true
        windowsAccessCheckDualDacl=$true
        originalPrivateAllowed=$true
        restrictedPrivateDenied=$true
        restrictedAllowedFileAccepted=$true
        publicAceRestoresAccess=$true
        syntheticOnly=$true
        modelCalled=$false
        jobObjectIntegrationVerified=$false
        productionPermissionSandboxVerified=$false
    }|ConvertTo-Json -Compress
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    if(Test-Path -LiteralPath $root) {Write-Warning 'Temporary AccessCheck compiler directory requires cleanup'}
}
