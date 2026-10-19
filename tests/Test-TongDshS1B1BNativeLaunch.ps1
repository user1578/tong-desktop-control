param([switch]$UseDriveRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'Windows only: DSH B1B fixed native canary'
}
$frameworkCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$gcc=Get-Command gcc.exe -ErrorAction SilentlyContinue
if(!$gcc -and (Test-Path -LiteralPath 'D:\C\mingw64\bin\gcc.exe' -PathType Leaf)){
    $gcc=[pscustomobject]@{Source='D:\C\mingw64\bin\gcc.exe'}
}
if(!$gcc) {throw 'GCC is not installed or visible; B1B native canary NOT verified'}
$nativeSource=Join-Path $PSScriptRoot 'TongDshS1B1BNativeChild.c'
$parentSource=Join-Path $PSScriptRoot 'TongDshS1B1BNativeLaunch.cs'
if(!(Test-Path -LiteralPath $frameworkCompiler -PathType Leaf) -or
   !(Test-Path -LiteralPath $nativeSource -PathType Leaf) -or
   !(Test-Path -LiteralPath $parentSource -PathType Leaf)){
    throw 'Required fixed compiler or test source missing'
}
$temporary=if($UseDriveRoot){[IO.Path]::GetPathRoot($PSScriptRoot)}else{[IO.Path]::GetTempPath()}
$temporary=[IO.Path]::GetFullPath($temporary).TrimEnd('\')+'\'
$root=[IO.Path]::GetFullPath((Join-Path $temporary ('TongDshS1B1BBuild-'+[guid]::NewGuid().ToString('N'))))
if(!$root.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -or
   (Test-Path -LiteralPath $root)){throw 'Unexpected test build path'}
New-Item -ItemType Directory -Path $root -Force|Out-Null
$originalTemp=$env:TEMP; $originalTmp=$env:TMP
try{
    $child=Join-Path $root 'TongDshS1B1BNativeChild.exe'
    $parent=Join-Path $root 'TongDshS1B1BNativeLaunch.exe'
    # Fixed source, fixed flags; no user command injection or download.
    & $gcc.Source -Os -s -static -municode '-mcrtdll=msvcrt' '-o' $child $nativeSource
    if($LASTEXITCODE -ne 0){throw 'Native Win32 test child compile failed'}
    & $frameworkCompiler /nologo /target:exe /platform:x64 /optimize+ "/out:$parent" $parentSource
    if($LASTEXITCODE -ne 0){throw 'Native Win32 test controller compile failed'}
    # Grant ONLY generated binaries read/execute for the synthetic Users restricting SID.
    # No host-runtime, Windows, DSH, existing project, or user ACL modification.
    $sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
    foreach($path in @($root,$child,$parent)){
        $acl=Get-Acl -LiteralPath $path
        $folder=(Test-Path -LiteralPath $path -PathType Container)
        $inherit=if($folder){
            [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
        }else{[Security.AccessControl.InheritanceFlags]::None}
        $ace=[Security.AccessControl.FileSystemAccessRule]::new(
            $sid,[Security.AccessControl.FileSystemRights]::ReadAndExecute,$inherit,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($ace)
        Set-Acl -LiteralPath $path -AclObject $acl
    }
    # The native and managed fixed canary both create test files ONLY beneath
    # the newly minted build root. Never change ACLs on its ancestors.
    $env:TEMP=$root; $env:TMP=$root
    $comparison=@(& $parent '--baseline-test')
    if($LASTEXITCODE -ne 0){throw 'Native Win32 baseline comparison did not start'}
    $comparisonResult=($comparison -join [Environment]::NewLine)|ConvertFrom-Json
    if($comparisonResult.status -ne 'passed' -or !$comparisonResult.fixedNativeChildLoaded -or
       !$comparisonResult.comparisonOnly -or $comparisonResult.privateFileDenied -ne $false){
        throw 'Native Win32 baseline produced unexpected output'
    }
    Write-Host 'B1B baseline: privilege-reduced native child loaded; private ACL isolation is NOT proven.'
    $lines=@(& $parent '--fixed-test')
    if($LASTEXITCODE -ne 0){throw 'Restricted native loader/JobObject canary failed; no model called'}
    $data=($lines -join [Environment]::NewLine)|ConvertFrom-Json
    if($data.status -ne 'passed' -or !$data.fixedNativeChild -or
       !$data.restrictedChildStarted -or !$data.restrictedChildTokenVerified -or
       !$data.readAllowed -or !$data.privateDenied -or
       !$data.parentPrivateReadable -or !$data.jobAssignedBeforeResume -or
       $data.activeAfterStop -ne 0 -or $data.modelCalled -ne $false -or
       $data.dshStarted -ne $false -or
       $data.networkIsolationVerified -ne $false -or
       $data.fullSandboxVerified -ne $false){
        throw 'Unexpected native child/Job/ACL result'
    }
    $negative=@(& $parent '--launch-user-program' 2>&1)
    if($LASTEXITCODE -eq 0){throw 'Unexpected arbitrary-command acceptance'}
    $global:LASTEXITCODE=0
    [pscustomobject]@{
        status='passed';nativeChildStarted=$true;restrictedTokenVerified=$true
        jobAssignedBeforeResume=$true;privateCanaryDenied=$true
        allowedCanaryRead=$true;arbitraryCommandRejected=$true
        fullSandboxVerified=$false;networkIsolationVerified=$false
        dshStarted=$false;modelCalled=$false
        nativeChildSha256=$data.childSha256
    }|ConvertTo-Json -Compress
} finally{
    $env:TEMP=$originalTemp; $env:TMP=$originalTmp
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    if(Test-Path -LiteralPath $root){Write-Warning 'B1B test temporary build root may need cleanup'}
}
