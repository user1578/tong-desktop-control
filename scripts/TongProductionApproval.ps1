param(
    [Parameter(Mandatory=$true)][ValidateSet('approve','receipt-simulation','receipt-unseal','init-root','approve-login-recovery','revoke-login-recovery','login-recovery-simulation','login-recovery-unseal')][string]$Mode,
    [string]$ProfileJson,
    [ValidateSet('init','start','stop','enable-agentdock','disable-agentdock','backup','restore','manager')][string]$Action
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$stateRoot='D:\Tong\state'
$productionRoot='D:\Tong\runtime'
$productionStore=Join-Path $productionRoot 'secrets\runtime-permissions'
$simulationStore=Join-Path $stateRoot 'b23-simulation-approvals'
$store=$productionStore
$storeIsProduction=$true
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids=@($sid,'S-1-5-18','S-1-5-32-544')
$js=Join-Path $PSScriptRoot 'TongProductionProfile.mjs'
$entropy=[Text.Encoding]::UTF8.GetBytes('Tong-B2.3:noncredential-runtime-permission:v1')
$recoveryEntropy=[Text.Encoding]::UTF8.GetBytes('Tong:fixed-login-recovery:v1')
$approvalStage='operation'
function Read-TypedChallenge {
    # Framework's default console reader has a 256-character buffer. A manager
    # challenge is 259 characters; read the whole line before the exact compare.
    $reader=[IO.StreamReader]::new([Console]::OpenStandardInput(4096),[Console]::InputEncoding,$false,4096,$true)
    try {return $reader.ReadLine()} finally {$reader.Dispose()}
}
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
function Select-Store([string]$Root) {
    if($Root -ceq $productionRoot){$script:store=$productionStore;$script:storeIsProduction=$true}
    elseif([IO.Path]::GetDirectoryName($Root) -ceq $stateRoot -and [IO.Path]::GetFileName($Root) -cmatch '^b23-[a-zA-Z0-9_-]{1,100}$'){$script:store=$simulationStore;$script:storeIsProduction=$false}
    else{throw 'Approval root refused'}
}
function Select-StoreFile([string]$Path) {
    $parent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    if($parent -ceq $productionStore){Select-Store $productionRoot}
    elseif($parent -ceq $simulationStore){$script:store=$simulationStore;$script:storeIsProduction=$false}
    else{throw 'Receipt store refused'}
}
function Assert-ApprovalScope([string]$ModeValue,[string]$Root) {
    if($storeIsProduction){if($ModeValue -cne 'production' -or $Root -cne $productionRoot){throw 'Production receipt scope refused'}}
    elseif($ModeValue -cne 'production-simulation' -or [IO.Path]::GetDirectoryName($Root) -cne $stateRoot -or [IO.Path]::GetFileName($Root) -cnotmatch '^b23-[a-zA-Z0-9_-]{1,100}$'){throw 'Simulation receipt scope refused'}
}
function Assert-ApprovalPath([string]$Path) {
    if($storeIsProduction){Assert-Protected $Path}else{Assert-NoReparse $Path}
}
function Assert-StoreParents {
    if($storeIsProduction){Assert-Protected $productionRoot;Assert-Protected (Join-Path $productionRoot 'secrets')}
    else{Assert-NoReparse $stateRoot}
}
function Assert-StoreFile([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetDirectoryName($full) -cne $store -or [IO.Path]::GetFileName($full) -notmatch '^(?:[a-f0-9]{64}\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager|enabled)|(?:production|simulation-[a-f0-9]{64})\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager|login-recovery)\.current)\.dpapi\.json$') {throw 'Receipt path refused'}
    $name=[IO.Path]::GetFileName($full)
    if(($storeIsProduction -and $name.StartsWith('simulation-')) -or (-not $storeIsProduction -and $name.StartsWith('production.'))){throw 'Receipt namespace refused'}
}
function Recovery-Descriptor($Value) {
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 12 -Compress)))
    $raw=& 'D:\node\node.exe' $js --validate-login-recovery-descriptor $encoded
    if($LASTEXITCODE -ne 0){throw 'Recovery descriptor refused'}
    return ($raw|ConvertFrom-Json)
}
function Recovery-Prefix($Descriptor) {
    if($Descriptor.runtimeProfile.mode -ceq 'production'){return 'production'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return 'simulation-'+([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Descriptor.root)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Open-Recovery([string]$Path) {
    Select-StoreFile $Path
    Assert-StoreFile $Path
    if([IO.Path]::GetFileName($Path) -notmatch '\.login-recovery\.current\.dpapi\.json$'){throw 'Recovery path refused'}
    Assert-StoreParents;Assert-ApprovalPath $store;Assert-ApprovalPath $Path
    if((Get-Item -LiteralPath $Path).Length -gt 65536){throw 'Recovery size refused'}
    $envelope=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
    if($envelope.schemaVersion -ne 1 -or $envelope.purpose -cne 'tong-login-recovery' -or $envelope.scope -cne 'CurrentUser' -or $envelope.userSid -cne $sid){throw 'Recovery envelope refused'}
    $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($envelope.ciphertext),$recoveryEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try{$grant=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json}finally{[Array]::Clear($plain,0,$plain.Length)}
    if($grant.schemaVersion -ne 1 -or $grant.purpose -cne 'tong-login-recovery'){throw 'Recovery purpose refused'}
    $descriptor=Recovery-Descriptor $grant.descriptor
    Assert-ApprovalScope $descriptor.runtimeProfile.mode $descriptor.root
    if([IO.Path]::GetFileName($Path) -cne ((Recovery-Prefix $descriptor)+'.login-recovery.current.dpapi.json')){throw 'Recovery identity refused'}
    return $grant
}
function Save-Recovery($Descriptor,[bool]$Enabled,[string]$ExpectedGrantId) {
    $Descriptor=Recovery-Descriptor $Descriptor
    Select-Store $Descriptor.root
    Assert-ApprovalScope $Descriptor.runtimeProfile.mode $Descriptor.root
    $prefix=Recovery-Prefix $Descriptor
    $path=Join-Path $store ($prefix+'.login-recovery.current.dpapi.json')
    $auditRoot=$store;if($storeIsProduction){$auditRoot=Join-Path $productionRoot 'logs';Assert-Protected $auditRoot}
    $auditPath=Join-Path $auditRoot ($prefix+'.login-recovery.audit.jsonl')
    Ensure-Store;Assert-StoreFile $path
    if(Test-Path -LiteralPath $auditPath){Assert-ApprovalPath $auditPath}
    $grantId=[guid]::NewGuid().ToString()
    if(Test-Path -LiteralPath $path){Assert-ApprovalPath $path}
    if(-not $Enabled){
        $previous=Open-Recovery $path
        if($previous.grantId -cne $ExpectedGrantId){throw 'Recovery grant changed'}
        $Descriptor=Recovery-Descriptor $previous.descriptor
        $grantId=$previous.grantId
    }
    $at=[DateTime]::UtcNow.ToString('o')
    $grant=[ordered]@{schemaVersion=1;purpose='tong-login-recovery';grantId=$grantId;enabled=$Enabled;issuedAt=$at;descriptor=$Descriptor}
    $plain=[Text.Encoding]::UTF8.GetBytes(($grant|ConvertTo-Json -Depth 12 -Compress))
    try{$encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$recoveryEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{[Array]::Clear($plain,0,$plain.Length)}
    $envelope=[ordered]@{schemaVersion=1;purpose='tong-login-recovery';scope='CurrentUser';userSid=$sid;ciphertext=[Convert]::ToBase64String($encrypted)}
    # Audit must be writable before granting capability. The current envelope
    # is replaced atomically, preserving its ACL; no old state is deleted.
    $event=if($Enabled){'enabled'}else{'revoked'}
    [IO.File]::AppendAllText($auditPath,((@{at=$at;event=$event;grantId=$grantId;root=$Descriptor.root;runtimeReleaseDigest=$Descriptor.runtimeProfile.releaseDigest;managerReleaseDigest=$Descriptor.managerProfile.releaseDigest;runnerSha256=$Descriptor.runnerSha256;phase='intent'}|ConvertTo-Json -Compress)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
    Assert-ApprovalPath $auditPath
    $temporary=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($envelope|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));Assert-ApprovalPath $temporary
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temporary,$path,[NullString]::Value)}else{[IO.File]::Move($temporary,$path)}
    Assert-ApprovalPath $path
    [IO.File]::AppendAllText($auditPath,((@{at=$at;event=$event;grantId=$grantId;root=$Descriptor.root;runtimeReleaseDigest=$Descriptor.runtimeProfile.releaseDigest;managerReleaseDigest=$Descriptor.managerProfile.releaseDigest;runnerSha256=$Descriptor.runnerSha256;phase='committed'}|ConvertTo-Json -Compress)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
    return $grant
}
function New-ProtectedRoot([string]$Root) {
    Assert-NoReparse ([IO.Path]::GetDirectoryName($Root))
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($sid))
    foreach($allow in $allowedSids){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($allow),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))}
    [IO.Directory]::CreateDirectory($Root,$acl)|Out-Null
    Assert-Protected $Root
}
function Ensure-Store([bool]$Bootstrap=$false) {
    # Only the existing typed production init approval may seed its own storage
    # parents. Other signing/unseal operations never initialize a runtime root.
    if($Bootstrap -and $storeIsProduction) {
        if(-not [IO.Directory]::Exists($productionRoot)){New-ProtectedRoot $productionRoot}
        Assert-Protected $productionRoot
        if(-not (Get-Acl -LiteralPath $productionRoot).AreAccessRulesProtected){throw 'Production root must be protected'}
        $marker=Join-Path $productionRoot 'production-root.json'
        $empty=@(Get-ChildItem -LiteralPath $productionRoot -Force).Count -eq 0
        if(-not $empty) {
            Assert-Protected $marker
            $known=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
            if($known.schemaVersion -ne 1 -or $known.root -cne $productionRoot -or $known.mode -cne 'production'){throw 'Unknown root refused'}
        }
        if($empty) {
            $value=[ordered]@{schemaVersion=1;root=$productionRoot;mode='production';createdAt=[DateTime]::UtcNow.ToString('o')}
            $stream=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try{$bytes=[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
            Assert-Protected $marker
        }
        $secrets=Join-Path $productionRoot 'secrets'
        if(-not [IO.Directory]::Exists($secrets)){[IO.Directory]::CreateDirectory($secrets)|Out-Null}
        Assert-Protected $secrets
    }
    Assert-StoreParents
    $existing=Get-Item -LiteralPath $store -Force -ErrorAction SilentlyContinue
    if($null -ne $existing){Assert-ApprovalPath $store}
    if(-not [IO.Directory]::Exists($store)){[IO.Directory]::CreateDirectory($store)|Out-Null}
    Assert-ApprovalPath $store
}
function Write-Sealed([string]$Path,$Envelope,[bool]$Replace=$false) {
    Assert-StoreFile $Path
    $existing=Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if($null -ne $existing){Assert-ApprovalPath $Path}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Envelope|ConvertTo-Json -Depth 8 -Compress))
    $fileMode=[IO.FileMode]::CreateNew;if($Replace){$fileMode=[IO.FileMode]::Create}
    $stream=[IO.File]::Open($Path,$fileMode,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    Assert-ApprovalPath $Path
}
function Seal-Receipt($Descriptor,$Profile,[string]$ExpiresAt) {
    Select-Store $Descriptor.root
    Assert-ApprovalScope $Descriptor.mode $Descriptor.root
    if($Descriptor.approvalStore -cne $store){throw 'Descriptor store refused'}
    $issued=[DateTime]::UtcNow
    $expires=[DateTime]::Parse($ExpiresAt).ToUniversalTime()
    if($expires -le $issued -or $expires -gt $issued.AddHours(1)){throw 'Receipt expiry refused'}
    $receipt=[ordered]@{schemaVersion=1;purpose='tong-runtime-permission';scope='CurrentUser';userSid=$sid;mode=$Descriptor.mode;root=$Descriptor.root;action=$Descriptor.action;profileDigest=$Descriptor.profileDigest;sourceDigest=$Descriptor.sourceDigest;releaseDigest=$Descriptor.releaseDigest;agentdockEnabled=[bool]$Descriptor.agentdockEnabled;issuedAt=$issued.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');expiresAt=$expires.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');profile=$Profile}
    $plain=[Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Depth 8 -Compress))
    try{$encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{[Array]::Clear($plain,0,$plain.Length)}
    $envelope=[ordered]@{schemaVersion=1;purpose='tong-runtime-permission';scope='CurrentUser';userSid=$sid;ciphertext=[Convert]::ToBase64String($encrypted)}
    Ensure-Store ($storeIsProduction -and $Descriptor.action -ceq 'init')
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
        if($null -ne $existing){Assert-ApprovalPath $target}
    }
    # Renewal requires the same typed console gate, or the strictly simulation-only minting path.
    Write-Sealed $Descriptor.receiptPath $envelope $true
    Write-Sealed $current $envelope $true
    return [pscustomobject]@{approved=$true;path=$Descriptor.receiptPath;profileDigest=$Descriptor.profileDigest;action=$Descriptor.action;mode=$Descriptor.mode;expiresAt=$receipt.expiresAt}
}
try {
    Add-Type -AssemblyName System.Security
    if($Mode -in @('approve-login-recovery','revoke-login-recovery')) {
        $approvalStage='interactive-entry'
        if($PSCommandPath -cne 'D:\Tong\runtime\releases\manager\scripts\TongProductionApproval.ps1'){throw 'Formal manager entry required'}
        if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or -not [Environment]::UserInteractive -or $Host.Name -cne 'ConsoleHost'){throw 'Human interactive console required'}
        if($Host.UI.RawUI.WindowSize.Width -le 0 -or $Host.UI.RawUI.WindowSize.Height -le 0){throw 'Visible console required'}
        $enabled=$Mode -eq 'approve-login-recovery'
        if($enabled){
            $raw=& 'D:\node\node.exe' $js --login-recovery-descriptor
            if($LASTEXITCODE -ne 0){throw 'Installed recovery version refused'}
            $descriptor=$raw|ConvertFrom-Json;$expectedGrantId=''
        }else{
            $previous=Open-Recovery (Join-Path $store 'production.login-recovery.current.dpapi.json')
            $descriptor=Recovery-Descriptor $previous.descriptor;$expectedGrantId=$previous.grantId
        }
        $descriptor=Recovery-Descriptor $descriptor
        if($descriptor.root -cne 'D:\Tong\runtime' -or $descriptor.runtimeProfile.mode -cne 'production'){throw 'Production recovery scope refused'}
        [Console]::WriteLine('本次仅'+$(if($enabled){'启用'}else{'撤销'})+'固定 Tong 登录恢复授权：Gateway、DevSpace、AgentDock 的启动、按运行身份停止和陈旧状态核对。')
        [Console]::WriteLine('影响 D:\Tong\runtime 的已核验运行版本及 secrets\runtime-permissions 中的独立恢复凭据；不修改 ngrok、计划任务或生产代码。')
        [Console]::WriteLine('这是固定运行环境的持续授权，与普通任务的30分钟审批分开；不授权 Shell、Codex任务、项目修改、部署或权限扩张。')
        [Console]::WriteLine('失败时安全拒绝恢复；可用 revoke-login-recovery 撤销，新版本必须重新启用。撤销不停止当前健康服务。')
        [Console]::WriteLine('有效至本人撤销或核验版本改变；仅包含上述后续恢复操作，不包含后续任务执行。')
        $nonce=[guid]::NewGuid().ToString('N')
        $challenge='APPROVE TongLoginRecovery '+$Mode+' '+$descriptor.runtimeProfile.releaseDigest+' '+$descriptor.managerProfile.releaseDigest+' '+$nonce
        [Console]::WriteLine('请本人输入下面的完整挑战：');[Console]::WriteLine($challenge)
        $approvalStage='typed-challenge'
        if((Read-TypedChallenge) -cne $challenge){throw 'Typed recovery challenge refused'}
        $approvalStage='save-recovery'
        if($enabled){
            $raw=& 'D:\node\node.exe' $js --login-recovery-descriptor
            if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json|ConvertTo-Json -Depth 12 -Compress) -cne ($descriptor|ConvertTo-Json -Depth 12 -Compress)){throw 'Reviewed recovery changed'}
        }
        Save-Recovery $descriptor $enabled $expectedGrantId|ConvertTo-Json -Depth 12 -Compress
    }elseif($Mode -eq 'approve') {
        $approvalStage='interactive-entry'
        # This is the sole production minting path. Redirected stdin/console-less automation cannot approve.
        if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or -not [Environment]::UserInteractive){throw 'Interactive console required'}
        if($Host.Name -cne 'ConsoleHost' -or $null -eq $Host.UI -or $null -eq $Host.UI.RawUI){throw 'Interactive console host required'}
        if($Host.UI.RawUI.WindowSize.Width -le 0 -or $Host.UI.RawUI.WindowSize.Height -le 0){throw 'Interactive console window required'}
        $profile=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ProfileJson))|ConvertFrom-Json
        $approvalStage='descriptor'
        $descriptor=Get-Descriptor $profile $Action
        $nonce=[Guid]::NewGuid().ToString('N')
        $challenge='APPROVE '+$descriptor.root+' '+$descriptor.action+' '+$descriptor.profileDigest+' '+$descriptor.sourceDigest+' '+$descriptor.releaseDigest+' '+$nonce
        [Console]::WriteLine('Local noncredential runtime permission; valid for 30 minutes. AgentDock enabled: '+$descriptor.agentdockEnabled)
        [Console]::WriteLine('Code root: '+$descriptor.codeRoot+'; manager root: '+$descriptor.managerRoot)
        [Console]::WriteLine('Type the exact challenge to authorize this path, action, profile and reviewed source/release hashes:')
        [Console]::WriteLine($challenge)
        $approvalStage='typed-challenge'
        if((Read-TypedChallenge) -cne $challenge){throw 'Typed challenge refused'}
        $approvalStage='seal-receipt'
        Seal-Receipt $descriptor $profile ([DateTime]::UtcNow.AddMinutes(30).ToString('o'))|ConvertTo-Json -Compress
    } else {
        $raw=[Console]::In.ReadToEnd()
        if($raw.Length -gt 65536){throw 'Input size refused'}
        $data=$raw|ConvertFrom-Json
        if($Mode -eq 'login-recovery-unseal') {
            Open-Recovery $data.path|ConvertTo-Json -Depth 12 -Compress
        }elseif($Mode -eq 'login-recovery-simulation') {
            $descriptor=Recovery-Descriptor $data.descriptor
            if($descriptor.runtimeProfile.mode -cne 'production-simulation' -or $data.enabled -isnot [bool]){throw 'Simulation recovery only'}
            $expected='';if($data.PSObject.Properties['grantId']){$expected=[string]$data.grantId}
            Save-Recovery $descriptor $data.enabled $expected|ConvertTo-Json -Depth 12 -Compress
        }elseif($Mode -eq 'receipt-simulation') {
            $descriptor=Get-Descriptor $data.profile $data.action
            if($descriptor.mode -cne 'production-simulation' -or -not $descriptor.root.StartsWith($stateRoot+'\',[StringComparison]::Ordinal)){throw 'Simulation only'}
            Seal-Receipt $descriptor $data.profile $data.expiresAt|ConvertTo-Json -Compress
        } elseif($Mode -eq 'receipt-unseal') {
            Select-StoreFile $data.path
            Assert-StoreFile $data.path
            Assert-StoreParents;Assert-ApprovalPath $store;Assert-ApprovalPath $data.path
            $info=Get-Item -LiteralPath $data.path -Force
            if($info.Length -gt 65536){throw 'Receipt size refused'}
            $envelope=Get-Content -LiteralPath $data.path -Raw|ConvertFrom-Json
            # Dedicated purpose/entropy accepts typed permission receipts only, never credential envelopes.
            if($envelope.schemaVersion -ne 1 -or $envelope.purpose -cne 'tong-runtime-permission' -or $envelope.scope -cne 'CurrentUser' -or $envelope.userSid -cne $sid){throw 'Receipt identity refused'}
            $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($envelope.ciphertext),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            try{$receipt=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json}finally{[Array]::Clear($plain,0,$plain.Length)}
            if($receipt.schemaVersion -ne 1 -or $receipt.purpose -cne 'tong-runtime-permission' -or $receipt.scope -cne 'CurrentUser' -or $receipt.userSid -cne $sid){throw 'Receipt purpose refused'}
            Assert-ApprovalScope $receipt.mode $receipt.root
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
                    $names=@('production-root.json','profile.json','backend-state','workspace','tong-policy','secrets','logs','run','temp','home','tong','releases','agentdock','state-backups','state-restores')
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
                    New-ProtectedRoot $root
                } else {
                    Assert-NoReparse $stateRoot
                    New-ProtectedRoot $root
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
} catch {
    # Keep fail-closed behavior and expose the failing stage/location without
    # dumping input, profiles, plaintext receipts or ciphertext into stderr.
    $cause=$_.Exception
    while($null -ne $cause.InnerException){$cause=$cause.InnerException}
    [Console]::Error.WriteLine('Tong production approval operation refused (stage='+$approvalStage+'; type='+$_.Exception.GetType().FullName+'; cause='+$cause.GetType().FullName+'; hresult=0x'+$cause.HResult.ToString('X8')+'; line='+$_.InvocationInfo.ScriptLineNumber+')')
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 2
}
