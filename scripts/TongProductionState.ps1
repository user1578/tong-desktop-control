param([Parameter(Mandatory=$true)][ValidateSet('snapshot','restore','quiescence')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids=@($sid,'S-1-5-18','S-1-5-32-544')
function Assert-Protected([string]$Path) {
  $current=[IO.Path]::GetFullPath($Path)
  while($current) {
    $item=Get-Item -LiteralPath $current -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.PSObject.Properties['LinkType'] -and $item.LinkType -eq 'HardLink')){throw 'link'}
    $parent=[IO.Directory]::GetParent($current);if($null -eq $parent){break};$current=$parent.FullName
  }
  $acl=Get-Acl -LiteralPath $Path
  $raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
  if($null -eq $raw.DiscretionaryAcl -or -not $acl.AreAccessRulesCanonical -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids){throw 'acl'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowedSids){throw 'acl'}}
}
function Hash-Bytes([byte[]]$Bytes) {
  $algorithm=[System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $algorithm.Dispose() }
}
try {
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $profile=$request.profile
  if($profile.mode -ne 'production-simulation' -and $profile.mode -ne 'production'){throw 'scope'}
  $module=Join-Path $PSScriptRoot 'TongProductionProfile.mjs'
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($profile | ConvertTo-Json -Depth 12 -Compress)))
  $action=if($Mode -eq 'snapshot'){'backup'}elseif($Mode -eq 'quiescence'){[string]$request.action}else{'restore'}
  if($action -notin @('backup','restore')){throw 'action'}
  $approval=& 'D:\node\node.exe' $module '--verify-approval-profile' $encoded $action 2>$null
  if($LASTEXITCODE -ne 0){throw 'approval'}
  $validated=$approval | ConvertFrom-Json
  if($validated.root -ne $profile.root){throw 'profile'}
  if($Mode -eq 'quiescence') {
    # No fabricated Job record for the first offline backup. Prove the fixed
    # topology is idle; locked snapshot sources still reject every writer.
    $ports=@([int]$validated.gatewayPort,[int]$validated.upstreamPort,[int]$validated.agentdockPort)
    if($validated.mode -eq 'production'){$ports+=4040}
    if(@(Get-NetTCPConnection -ErrorAction Stop | Where-Object {$_.State -eq 'Listen' -and $_.LocalPort -in $ports}).Count){throw 'listener'}
    $processes=@(Get-CimInstance Win32_Process)
    $allowedNodeIds=New-Object 'System.Collections.Generic.HashSet[int]'
    $caller=($processes | Where-Object {$_.ProcessId -eq $PID}).ParentProcessId
    $visited=New-Object 'System.Collections.Generic.HashSet[int]'
    while($caller -and $visited.Add([int]$caller)) {
      $ancestor=$processes | Where-Object {$_.ProcessId -eq $caller} | Select-Object -First 1
      if($null -eq $ancestor){break}
      if($ancestor.ExecutablePath -ieq 'D:\node\node.exe') {
        # A production backup may exclude only its native, observed ancestor
        # chain running the fixed reviewed state entry. Unrelated Node workers
        # (even with relative argv) make an initial offline proof inconclusive.
        $entry=Join-Path $validated.managerRoot 'scripts\TongProductionState.mjs'
        if($validated.mode -eq 'production' -and (-not $ancestor.CommandLine -or
          $ancestor.CommandLine.Replace('/','\').IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0)){throw 'unverified-caller'}
        $allowedNodeIds.Add([int]$ancestor.ProcessId)|Out-Null
      }
      $caller=$ancestor.ParentProcessId
    }
    foreach($process in $processes) {
      if($process.ExecutablePath -ieq 'D:\agentdock-poc-20261010\runtime\agentdock.exe' -or
        ($validated.mode -eq 'production' -and $process.Name -ieq 'ngrok.exe')){throw 'active-backend'}
      if($process.ExecutablePath -ieq 'D:\node\node.exe') {
        if(-not $allowedNodeIds.Contains([int]$process.ProcessId)){throw 'active-or-unknown-node'}
      }
    }
    @{quiescent=$true;checkedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
    exit 0
  }
  $stateModule=Join-Path $PSScriptRoot 'TongProductionState.mjs'
  $arguments=@($stateModule,'--native-preflight',$encoded,$action,[string]$request.backupRoot)
  if($Mode -eq 'restore'){$arguments+=[string]$request.restoreRoot}
  $preflight=& 'D:\node\node.exe' @arguments 2>$null
  if($LASTEXITCODE -ne 0 -or ($preflight|ConvertFrom-Json).approved -ne $true){throw 'stopped-preflight'}
  $protected=[IO.Path]::GetFullPath('D:\agentdock-poc-20261010\isolated\state')+'\'
  if($profile.mode -eq 'production'){$protected=[IO.Path]::GetFullPath($validated.root)+'\'}
  $backup=[IO.Path]::GetFullPath($request.backupRoot)
  if(-not $backup.StartsWith($protected,[StringComparison]::OrdinalIgnoreCase) -or -not $backup.StartsWith($profile.root+'\',[StringComparison]::OrdinalIgnoreCase) -or $backup.StartsWith($profile.codeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'path'}
  Assert-Protected $backup
  if($request.files.Count -gt 2048){throw 'count'}
  $entropy=[Text.Encoding]::UTF8.GetBytes([string]$request.binding)
  if($request.binding -ne ('tong-production-state-v1:'+$profile.mode+':'+$profile.root)){throw 'binding'}
  $handles=New-Object 'System.Collections.Generic.List[System.IO.FileStream]'
  $records=New-Object 'System.Collections.Generic.List[object]'
  try {
    if($Mode -eq 'snapshot') {
      $total=0
      # Hold every source with FileShare.Read; concurrent writers/deletes cannot
      # produce a mixed snapshot while the encrypted files are generated.
      foreach($file in $request.files) {
        $logical=[string]$file.logical
        if($logical -notmatch '^(runtime|config|oauth|policy|tong-config)/[^:]+$' -or $logical.Contains('..') -or $logical.Contains('\')){throw 'logical'}
        $prefix=$logical.Split('/')[0]
        $sourceBase=switch($prefix){'runtime'{$profile.runtimeDir};'config'{$profile.configDir};'tong-config'{Join-Path $profile.originalTongRoot 'config'};'oauth'{$profile.oauthStateDir};'policy'{Join-Path $profile.root 'tong-policy'};default{throw 'logical'}}
        $expected=Join-Path $sourceBase $logical.Substring($prefix.Length+1).Replace('/','\')
        if([IO.Path]::GetFullPath($expected) -ne [IO.Path]::GetFullPath($file.path)){throw 'source'}
        Assert-Protected $file.path
        $stream=[IO.File]::Open($file.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        if($stream.Length -gt 67108864){throw 'size'}
        $total+=$stream.Length;if($total -gt 134217728){throw 'total'}
        $handles.Add($stream)
      }
      for($index=0;$index -lt $handles.Count;$index++) {
        $stream=$handles[$index];$bytes=New-Object byte[] ([int]$stream.Length)
        $offset=0;while($offset -lt $bytes.Length){$read=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($read -le 0){throw 'short'};$offset+=$read}
        $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $encryptedFile=[string]$index+'.dpapi.bin'
        $output=[IO.File]::Open((Join-Path $backup $encryptedFile),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$output.Write($encrypted,0,$encrypted.Length);$output.Flush($true)}finally{$output.Dispose()}
        $records.Add(@{logical=$request.files[$index].logical;size=$bytes.Length;sha256=(Hash-Bytes $bytes);encryptedFile=$encryptedFile;encryptedSha256=(Hash-Bytes $encrypted)})
        [Array]::Clear($bytes,0,$bytes.Length)
      }
      @{files=@($records.ToArray())} | ConvertTo-Json -Depth 8 -Compress
    } else {
      $restore=[IO.Path]::GetFullPath($request.restoreRoot)
      if(-not $restore.StartsWith($protected,[StringComparison]::OrdinalIgnoreCase) -or -not $restore.StartsWith($profile.root+'\',[StringComparison]::OrdinalIgnoreCase) -or $restore.StartsWith($profile.codeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'path'}
      Assert-Protected $restore
      foreach($file in $request.files) {
        if($file.logical -notmatch '^(runtime|config|policy|tong-config)/[^:]+$' -or $file.logical.Contains('..') -or $file.logical.Contains('\')){throw 'logical'}
        if($file.encryptedFile -notmatch '^\d+\.dpapi\.bin$'){throw 'encryptedfile'}
        $encryptedPath=Join-Path $backup $file.encryptedFile;Assert-Protected $encryptedPath
        $encrypted=[IO.File]::ReadAllBytes($encryptedPath)
        if((Hash-Bytes $encrypted) -ne $file.encryptedSha256){throw 'encryptedhash'}
        $bytes=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        if($bytes.Length -ne $file.size -or (Hash-Bytes $bytes) -ne $file.sha256){throw 'hash'}
        $target=[IO.Path]::GetFullPath((Join-Path $restore $file.logical.Replace('/','\')))
        if(-not $target.StartsWith($restore+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'target'}
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        $output=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$output.Write($bytes,0,$bytes.Length);$output.Flush($true)}finally{$output.Dispose()}
        [Array]::Clear($bytes,0,$bytes.Length)
      }
      @{restored=$request.files.Count;encrypted=$true} | ConvertTo-Json -Compress
    }
  } finally {foreach($handle in $handles){$handle.Dispose()}}
} catch {[Console]::Error.WriteLine('Production state operation refused');exit 2}
