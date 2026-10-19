$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows Job Object canary requires Windows'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $PSScriptRoot 'TongDshS1BJobCanary.cs'
if(!(Test-Path -LiteralPath $compiler -PathType Leaf) -or
   !(Test-Path -LiteralPath $source -PathType Leaf)){
    throw 'Pinned compiler or DSH canary source unavailable'
}
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) ('TongDshS1BJobCanary-'+[guid]::NewGuid().ToString('N'))
$tempRoot=[IO.Path]::GetFullPath($tempRoot)
$tempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
if(!$tempRoot.StartsWith($tempPrefix,[StringComparison]::OrdinalIgnoreCase)){
    throw 'DSH canary output escaped temp directory'
}
New-Item -ItemType Directory -Force -Path $tempRoot|Out-Null
try {
    $exe=Join-Path $tempRoot 'TongDshS1BJobCanary.exe'
    & $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$exe" $source
    if($LASTEXITCODE -ne 0){throw 'Native DSH-S1B canary build failed'}
    $results=@()
    foreach($scenario in @('normal','timeout','cancel','tree')) {
        $raw=@(& $exe '--canary' $scenario)
        if($LASTEXITCODE -ne 0){throw "Job Object scenario $scenario failed"}
        $r=($raw -join [Environment]::NewLine)|ConvertFrom-Json
        $expected=switch($scenario){
            normal {'completed'}
            timeout {'timed-out'}
            cancel {'cancelled'}
            tree {'descendants-killed'}
        }
        if($r.scenario -ne $scenario -or $r.status -ne $expected -or
           !$r.assignedBeforeResume -or !$r.killOnJobClose -or
           !$r.onlyFixedMock -or $r.activeAfterStop -ne 0 -or
           $r.modelCalled -ne $false -or $r.dshStarted -ne $false -or
           $r.osPermissionSandbox -ne $false -or
           ($scenario -eq 'tree' -and $r.activeBeforeStop -lt 2)){
            throw "DSH-S1B canary validation failed: $scenario"
        }
        $results+= $r
    }
    $rejected=@(& $exe '--canary' 'arbitrary-user-executable' 2>&1)
    if($LASTEXITCODE -eq 0) {throw 'DSH-S1B arbitrary execution option was not rejected'}
    # A deliberate nonzero exit from the negative canary must not become the
    # PowerShell script's final exit code after all assertions have passed.
    $global:LASTEXITCODE = 0
    [pscustomobject]@{
        status='passed'
        canaries=@($results)
        arbitraryExecutableRejected=$true
        productionUnchanged=$true
        dshModelNeverCalled=$true
        binarySha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    }|ConvertTo-Json -Depth 8
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    if(Test-Path -LiteralPath $tempRoot){Write-Warning 'Temporary native canary directory needs manual cleanup'}
}
