param(
    [Parameter(Mandatory=$true)][ValidateSet('approve','receipt-simulation','receipt-unseal','init-root')][string]$Mode,
    [string]$ProfileJson,
    [ValidateSet('init','start','stop','enable-agentdock','disable-agentdock','backup','restore','manager')][string]$Action
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$stateRoot='D:\agentdock-poc-20261010\isolated\state'
$store=Join-Path $stateRoot 'b23-production-approvals'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids=@($sid,'S-1-5-18','S-1-5-32-544')
$js=Join-Path $PSScriptRoot 'TongProductionProfile.mjs'
$entropy=[Text.Encoding]::UTF8.GetBytes('Tong-B2.3:noncredential-runtime-permission:v1')
function Assert-NoReparse([string]$Path) {
    $current=[IO.Path]::GetFullPath($Path)
    while ($current) {
        $item=Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Reparse point refused'}
        if($item.PSObject.Properties['LinkType'] -and $item.LinkType -eq 'HardLink'){throw 'Hardlink refused'}
        $parent=[IO.Directory]::GetParent($current)
        if ($null -eq $parent) {break}
        $current=$parent.FullName
    }
}
function Assert-Protected([string]$Path,[bool]$Ancestors=$true) {
    if($Ancestors){Assert-NoReparse $Path}else{
        $item=Get-Item -LiteralPath $Path -Force
        if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties['LinkType'] -and $item.LinkType -eq 'HardLink')){throw 'Linked entry refused'}
    }
    $acl=Get-Acl -LiteralPath $Path
    $raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    if ($null -eq $raw.DiscretionaryAcl -or -not $acl.AreAccessRulesCanonical -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids) {throw 'DACL refused'}
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowedSids) {throw 'Foreign DACL refused'}
    }
}
function Get-Descriptor($Profile,[string]$RequestedAction,[bool]$Verify=$false) {
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Profile|ConvertTo-Json -Depth 8 -Compress)))
    $command='--approval-descriptor';if($Verify){$command='--verify-approval-profile'}
    $result=& 'D:\node\node.exe' $js $command $encoded $RequestedAction
    if($LASTEXITCODE -ne 0){throw 'Descriptor refused'}
    return ($result|ConvertFrom-Json)
}
function Assert-StoreFile([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetDirectoryName($full) -cne $store -or [IO.Path]::GetFileName($full) -notmatch '^(?:[a-f0-9]{64}\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager|enabled)|(?:production|simulation-[a-f0-9]{64})\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager)\.current)\.dpapi\.json$') {throw 'Receipt path refused'}
}
function Ensure-Store {
    Assert-Protected $stateRoot
    $existing=Get-Item -LiteralPath $store -Force -ErrorAction SilentlyContinue
    if($null -ne $existing){Assert-Protected $store}
    if(-not [IO.Directory]::Exists($store)){[IO.Directory]::CreateDirectory($store)|Out-Null}
    Assert-Protected $store
}
function Write-Sealed([string]$Path,$Envelope,[bool]$Replace=$false) {
    Assert-StoreFile $Path
    $existing=Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if($null -ne $existing){Assert-Protected $Path}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Envelope|ConvertTo-Json -Depth 8 -Compress))
    $fileMode=[IO.FileMode]::CreateNew;if($Replace){$fileMode=[IO.FileMode]::Create}
    $stream=[IO.File]::Open($Path,$fileMode,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    Assert-Protected $Path
}
function Seal-Receipt($Descriptor,$Profile,[string]$ExpiresAt) {
    $issued=[DateTime]::UtcNow
    $expires=[DateTime]::Parse($ExpiresAt).ToUniversalTime()
    if($expires -le $issued -or $expires -gt $issued.AddHours(1)){throw 'Receipt expiry refused'}
    $receipt=[ordered]@{schemaVersion=1;purpose='tong-runtime-permission';scope='CurrentUser';userSid=$sid;mode=$Descriptor.mode;root=$Descriptor.root;action=$Descriptor.action;profileDigest=$Descriptor.profileDigest;sourceDigest=$Descriptor.sourceDigest;releaseDigest=$Descriptor.releaseDigest;agentdockEnabled=[bool]$Descriptor.agentdockEnabled;issuedAt=$issued.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');expiresAt=$expires.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');profile=$Profile}
    $plain=[Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Depth 8 -Compress))
    try{$encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{[Array]::Clear($plain,0,$plain.Length)}
    $envelope=[ordered]@{schemaVersion=1;purpose='tong-runtime-permission';scope='CurrentUser';userSid=$sid;ciphertext=[Convert]::ToBase64String($encrypted)}
    Ensure-Store
    $prefix='production'
    if($Descriptor.mode -eq 'production-simulation') {
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$rootHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Descriptor.root)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
        $prefix='simulation-'+$rootHash
    }
    $current=Join-Path $store ($prefix+'.'+$Descriptor.action+'.current.dpapi.json')
    # Inspect both destinations before any write, so a denied index cannot leave an issued receipt.
    foreach($target in @($Descriptor.receiptPath,$current)) {
        Assert-StoreFile $target
        $existing=Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        if($null -ne $existing){Assert-Protected $target}
    }
    # Renewal requires the same typed console gate, or the strictly simulation-only minting path.
    Write-Sealed $Descriptor.receiptPath $envelope $true
    Write-Sealed $current $envelope $true
    return [pscustomobject]@{approved=$true;path=$Descriptor.receiptPath;profileDigest=$Descriptor.profileDigest;action=$Descriptor.action;mode=$Descriptor.mode;expiresAt=$receipt.expiresAt}
}
try {
    Add-Type -AssemblyName System.Security
    if($Mode -eq 'approve') {
        # This is the sole production minting path. Redirected stdin/console-less automation cannot approve.
        if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or -not [Environment]::UserInteractive){throw 'Interactive console required'}
        if($Host.Name -cne 'ConsoleHost' -or $null -eq $Host.UI -or $null -eq $Host.UI.RawUI){throw 'Interactive console host required'}
        if($Host.UI.RawUI.WindowSize.Width -le 0 -or $Host.UI.RawUI.WindowSize.Height -le 0){throw 'Interactive console window required'}
        $profile=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ProfileJson))|ConvertFrom-Json
        $descriptor=Get-Descriptor $profile $Action
        $nonce=[Guid]::NewGuid().ToString('N')
        $challenge='APPROVE '+$descriptor.root+' '+$descriptor.action+' '+$descriptor.profileDigest+' '+$descriptor.sourceDigest+' '+$descriptor.releaseDigest+' '+$nonce
        [Console]::WriteLine('Local noncredential runtime permission; valid for 30 minutes. AgentDock enabled: '+$descriptor.agentdockEnabled)
        [Console]::WriteLine('Code root: '+$descriptor.codeRoot+'; manager root: '+$descriptor.managerRoot)
        [Console]::WriteLine('Type the exact challenge to authorize this path, action, profile and reviewed source/release hashes:')
        [Console]::WriteLine($challenge)
        if([Console]::ReadLine() -cne $challenge){throw 'Typed challenge refused'}
        Seal-Receipt $descriptor $profile ([DateTime]::UtcNow.AddMinutes(30).ToString('o'))|ConvertTo-Json -Compress
    } else {
        $raw=[Console]::In.ReadToEnd()
        if($raw.Length -gt 65536){throw 'Input size refused'}
        $data=$raw|ConvertFrom-Json
        if($Mode -eq 'receipt-simulation') {
            $descriptor=Get-Descriptor $data.profile $data.action
            if($descriptor.mode -cne 'production-simulation' -or -not $descriptor.root.StartsWith($stateRoot+'\',[StringComparison]::Ordinal)){throw 'Simulation only'}
            Seal-Receipt $descriptor $data.profile $data.expiresAt|ConvertTo-Json -Compress
        } elseif($Mode -eq 'receipt-unseal') {
            Assert-StoreFile $data.path
            Assert-Protected $stateRoot;Assert-Protected $store;Assert-Protected $data.path
            $info=Get-Item -LiteralPath $data.path -Force
            if($info.Length -gt 65536){throw 'Receipt size refused'}
            $envelope=Get-Content -LiteralPath $data.path -Raw|ConvertFrom-Json
            # Dedicated purpose/entropy accepts typed permission receipts only, never credential envelopes.
            if($envelope.schemaVersion -ne 1 -or $envelope.purpose -cne 'tong-runtime-permission' -or $envelope.scope -cne 'CurrentUser' -or $envelope.userSid -cne $sid){throw 'Receipt identity refused'}
            $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($envelope.ciphertext),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            try{$receipt=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json}finally{[Array]::Clear($plain,0,$plain.Length)}
            if($receipt.schemaVersion -ne 1 -or $receipt.purpose -cne 'tong-runtime-permission' -or $receipt.scope -cne 'CurrentUser' -or $receipt.userSid -cne $sid){throw 'Receipt purpose refused'}
            $receipt|ConvertTo-Json -Depth 8 -Compress
        } else {
            # Independently verifies the sealed bootstrap before touching the target, even for direct PS invocation.
            $descriptor=Get-Descriptor $data.profile 'init' $true
            $root=$descriptor.root
            $created=$false
            Assert-NoReparse ([IO.Path]::GetDirectoryName($root))
            $existing=Get-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue
            if($null -ne $existing){Assert-Protected $root}
            if([IO.Directory]::Exists($root)) {
                Assert-Protected $root
                if($descriptor.mode -eq 'production' -and -not (Get-Acl -LiteralPath $root).AreAccessRulesProtected){throw 'Production root must be protected'}
                $entries=@(Get-ChildItem -LiteralPath $root -Force)
                if($entries.Count -gt 0) {
                    $marker=Join-Path $root 'production-root.json'
                    Assert-Protected $marker
                    $known=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
                    if($known.schemaVersion -ne 1 -or $known.root -cne $root -or $known.mode -cne $descriptor.mode){throw 'Unknown root refused'}
                    $names=@('production-root.json','profile.json','backend-state','workspace','tong-policy','secrets','logs','run','temp','home','tong','releases','state-backups','state-restores')
                    foreach($entry in $entries){if($entry.Name -cnotin $names){throw 'Unknown root entry refused'};Assert-Protected $entry.FullName}
                    $queue=[Collections.Generic.Queue[string]]::new();$queue.Enqueue($root);$visited=0
                    while($queue.Count -gt 0) {
                        foreach($entry in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
                            if(++$visited -gt 100000){throw 'Root tree too large'}
                            Assert-Protected $entry.FullName $false
                            if($entry.PSIsContainer){$queue.Enqueue($entry.FullName)}
                        }
                    }
                }
            } else {
                if([IO.File]::Exists($root)){throw 'Root is a file'}
                if($descriptor.mode -eq 'production') {
                    $acl=[Security.AccessControl.DirectorySecurity]::new()
                    $acl.SetAccessRuleProtection($true,$false)
                    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($sid))
                    foreach($allow in $allowedSids){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($allow),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))}
                    [IO.Directory]::CreateDirectory($root,$acl)|Out-Null
                } else {
                    Assert-Protected $stateRoot
                    [IO.Directory]::CreateDirectory($root)|Out-Null
                }
                $created=$true
                Assert-Protected $root
            }
            $paths=[ordered]@{root=$root;created=$created;backendState=(Join-Path $root 'backend-state');workspace=(Join-Path $root 'workspace');policyDir=(Join-Path $root 'tong-policy');secrets=(Join-Path $root 'secrets');logs=(Join-Path $root 'logs');run=(Join-Path $root 'run');temp=(Join-Path $root 'temp');home=(Join-Path $root 'home')}
            foreach($key in @('backendState','workspace','policyDir','secrets','logs','run','temp','home')) {
                $target=$paths[$key]
                $existing=Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
                if($null -ne $existing){Assert-Protected $target}
                if([IO.Directory]::Exists($target)){Assert-Protected $target}else{[IO.Directory]::CreateDirectory($target)|Out-Null;Assert-Protected $target}
            }
            $marker=Join-Path $root 'production-root.json'
            if(-not [IO.File]::Exists($marker)) {
                $markerBytes=[Text.Encoding]::UTF8.GetBytes(([ordered]@{schemaVersion=1;root=$root;mode=$descriptor.mode;createdAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress))
                $stream=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
                try{$stream.Write($markerBytes,0,$markerBytes.Length)}finally{$stream.Dispose()}
                Assert-Protected $marker
            }
            [pscustomobject]$paths|ConvertTo-Json -Compress
        }
    }
} catch {[Console]::Error.WriteLine('Tong production approval operation refused');exit 2}
