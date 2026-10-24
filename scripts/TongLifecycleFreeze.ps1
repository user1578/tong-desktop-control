$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$held=$null
try {
    $request=[Console]::ReadLine()|ConvertFrom-Json
    if($request.expectedSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'binding'}
    $path=Join-Path ([IO.Path]::GetFullPath([string]$request.root)) 'run\backup.freeze'
    # RW + Share.Read admits snapshot readers but denies every other writer,
    # delete and rename. This is the original gate, never a replacement lock.
    $held=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    function Proof {
        $held.Position=0;$algorithm=[Security.Cryptography.SHA256]::Create()
        try{$hash=([BitConverter]::ToString($algorithm.ComputeHash($held))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
        if($hash -cne $request.expectedSha256){throw 'changed'}
        [ordered]@{root=[string]$request.root;sha256=$hash;holderPid=$PID;exclusiveWriter=$true}|ConvertTo-Json -Compress
    }
    Proof
    while($null -ne ($line=[Console]::ReadLine())) {
        if($line -ceq 'close'){break}
        if($line -cne 'proof'){throw 'command'}
        Proof
    }
} catch {
    [Console]::Error.WriteLine('LIFECYCLE_FREEZE_UNAVAILABLE')
    exit 2
} finally {if($null -ne $held){$held.Dispose()}}
