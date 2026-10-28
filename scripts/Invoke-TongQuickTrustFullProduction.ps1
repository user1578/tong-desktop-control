param(
  [ValidateSet('Preflight','Deploy','Rollback')][string]$Mode='Preflight',
  [string]$ReleaseRoot='',
  [string]$CandidateRoot='',
  [string]$SnapshotRoot='',
  [string]$ExpectedCommit='',
  [string]$ExpectedOldCommit=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$node='D:\node\node.exe'
$root='D:\Tong\runtime'
$base='D:\Tong\state\p27-autonomy-candidate-20261017'
$customBinding=@($ReleaseRoot,$CandidateRoot,$SnapshotRoot,$ExpectedCommit)|Where-Object {$_}
if(@($customBinding).Count -notin @(0,4)){throw 'Release, candidate, snapshot and exact commit must be supplied together'}
if($ExpectedCommit -and $ExpectedCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'Exact repaired release commit required'}
if($ExpectedOldCommit -and $ExpectedOldCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'Exact baseline commit required'}
$helper=Join-Path $PSScriptRoot 'TongQuickTrustFullCutover.mjs'
$cleanupProbe=Join-Path $PSScriptRoot 'TongCutoverStoppedRunProbe.mjs'
$helperSha256='267ad9dcc55e500f9cfb9643a550b32598e7e834d07691e102bf16d25869aceb'
$cleanupProbeSha256='544a545ce87c50a2e06c1dae5ad4329a69b2c28e71c1f0cd0265dd93d65367ac'
$release=if($ReleaseRoot){$ReleaseRoot}else{Join-Path $base 'quick-trust-release-d9983bb'}
$candidate=if($CandidateRoot){$CandidateRoot}else{Join-Path $base 'quick-trust-candidate-d9983bb'}
$reviewedSnapshot=if($SnapshotRoot){$SnapshotRoot}else{Join-Path $base 'quick-trust-full-cutover-20261020084000551-ffdcdbb2'}
$manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$signer=Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1'
$taskName='TongLoginRuntime'
$originalRun=$null
$expectedOldApp=if($ExpectedOldCommit){$ExpectedOldCommit}else{'a1b56b3666651c3648327f05e0ea4154284645c3'}
$expectedOldManager=$expectedOldApp
$expectedNew=if($ExpectedCommit){$ExpectedCommit}else{'d9983bbc5fe1640f51d4a649ff0f018c9f458c6f'}
$snapshot=$null
$wasStopped=$false
$didInstall=$false
$recoverySigned=$false
$taskDisabled=$false
$stoppingLoginIdentity=$null
$monitorWindowStart=$null
function Native([string]$Name,[string[]]$Arguments){
  if($Arguments[0] -ceq $helper){
    if($Arguments.Count -eq 2){$Arguments+= '-'}
    $Arguments+=@($release,$candidate,$expectedNew)
    if($ExpectedOldCommit){$Arguments+= $ExpectedOldCommit}
  }
  $raw=& $node @Arguments
  if($LASTEXITCODE -ne 0){throw ('FAILED: '+$Name+' exit='+$LASTEXITCODE)}
  return (($raw -join [Environment]::NewLine)|ConvertFrom-Json)
}
function CurrentStatus(){
  return (Native 'manager status' @($manager,'status','--root',$root))
}
function Assert-ControlSourceBinding(){
  if(-not $ExpectedOldCommit){return}
  $manifest=Get-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Raw|ConvertFrom-Json
  if($manifest.commit -cne $expectedNew){throw 'Control source commit mismatch'}
  foreach($entry in @($manifest.sourceFiles|Where-Object path -like 'scripts/*')){
    if($entry.path -notmatch '^scripts/[A-Za-z0-9_.-]+$'){throw 'Control source path denied'}
    $path=Join-Path $PSScriptRoot ([IO.Path]::GetFileName([string]$entry.path))
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256){throw ('Control source differs from reviewed release: '+$entry.path)}
  }
}
function Assert-Activation-Bindings(){
  # Parse and syntax-check the *actual embedded activation code* before stopping Tong.
  # The source is not executed here, so the old production process remains untouched.
  $source=Get-Content -LiteralPath $PSCommandPath -Raw
  $pattern='(?s)function Activate-Pins\(\)\{\s*\$program=@''\r?\n(?<body>.*?)\r?\n''@'
  $match=[regex]::Match($source,$pattern)
  if(-not $match.Success){throw 'Unable to inspect exact activation source'}
  $activation=$match.Groups['body'].Value
  foreach($binding in @(
    "const {createProductionProfile}=await import(resolve('TongProductionProfile.mjs'));",
    "const {pinRuntimeRelease,verifyRuntimeCandidate}=await import(resolve('TongRuntimeCandidate.mjs'));",
    "const {updateRuntimeProfile}=await import(resolve('TongAgentDockRuntime.mjs'));"
  )){
    if(-not $activation.Contains($binding)){throw 'Activation import binding changed'}
  }
  $null=($activation | & $node --check --input-type=module)
  if($LASTEXITCODE -ne 0){throw 'Activation JavaScript syntax rejected'}
  $probe=@'
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const locations=[
  'D:\\Tong\\runtime\\releases\\manager\\scripts',
  join(process.argv[1],'scripts')
];
const required={
  'TongProductionProfile.mjs':['createProductionProfile'],
  'TongRuntimeCandidate.mjs':['pinRuntimeRelease','verifyRuntimeCandidate'],
  'TongAgentDockRuntime.mjs':['updateRuntimeProfile']
};
for(const root of locations)for(const [file,exports] of Object.entries(required)){
  const mod=await import(pathToFileURL(join(root,file)).href);
  for(const name of exports)if(typeof mod[name]!=='function')throw Error('ACTIVATION_EXPORT_MISSING:'+file+':'+name);
}
console.log(JSON.stringify({activationBindings:true,locations:locations.length,exportsChecked:4}));
'@
  $raw=& $node --input-type=module -e $probe $candidate
  if($LASTEXITCODE -ne 0){throw 'Candidate or production runtime activation exports are incompatible'}
  $result=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $result.activationBindings -or $result.locations -ne 2 -or $result.exportsChecked -ne 4){throw 'Invalid activation export result'}
}
function Assert-Release(){
  Assert-ControlSourceBinding
  # Reject the previous failed candidate before stopping anything. A repaired
  # release must contain the exact Manager runtime reviewed with this wrapper.
  $reviewedRuntime=Join-Path $PSScriptRoot 'TongAgentDockRuntime.mjs'
  $candidateRuntime=Join-Path $candidate 'scripts\TongAgentDockRuntime.mjs'
  if((Get-FileHash -LiteralPath $reviewedRuntime -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $candidateRuntime -Algorithm SHA256).Hash){
    throw 'Candidate lacks the reviewed runtime recovery fix; prepare and bind a repaired release before deployment'
  }
  Assert-Activation-Bindings
  if(-not (Test-Path -LiteralPath $helper -PathType Leaf) -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $helperSha256){throw 'Maintenance helper changed since review'}
  if(-not (Test-Path -LiteralPath $cleanupProbe -PathType Leaf) -or (Get-FileHash -LiteralPath $cleanupProbe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $cleanupProbeSha256){throw 'Stopped-runtime proof changed since review'}
  $checkedSnapshot=Native 'verified source rollback snapshot' @($helper,'verify-snapshot',$reviewedSnapshot)
  if(-not $checkedSnapshot.ok -or $checkedSnapshot.stage -cne 'snapshotted' -or
      $checkedSnapshot.appFiles -lt 1 -or $checkedSnapshot.managerFiles -lt 1){
      throw 'Full rollback snapshot is missing or changed'
  }
  $result=Native 'verified production preflight' @($helper,'preflight')
  if(-not $result.ok -or $result.oldApp -cne $expectedOldApp -or $result.oldManager -cne $expectedOldManager -or $result.newCommit -cne $expectedNew){throw 'Unexpected release hashes or production baseline'}
  $task=Get-ScheduledTask -TaskName $taskName
  if($task.Principal.UserId -notin @('Rune','RUNE') -or $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine (Join-Path $root 'login-management\TongLoginHost.exe')){throw 'Unknown login task definition'}
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $null=Get-LoginMonitorIdentity ($scheduler.GetFolder('\').GetTask($taskName))
  $s=CurrentStatus
  if($s.phase -cne 'ready' -or -not $s.supervisorAlive -or -not $s.guardianAlive){throw 'Production is not healthy'}
  $d=Native 'manager doctor' @($manager,'doctor','--root',$root,'--login-recovery')
  if(-not $d.healthy){throw 'Production doctor is not healthy'}
  return $s
}
function Get-NewProfiles(){
  $program=@'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const release=process.argv[1];
const manager='D:\\Tong\\runtime\\releases\\manager\\scripts\\TongProductionProfile.mjs';
const bytes=await readFile(join(release,'release-manifest.json'));
const m=JSON.parse(bytes);
const {createProductionProfile}=await import(pathToFileURL(manager).href);
const sourceDigest=m.files.find(x=>x.path==='code/source.tar').sha256;
const releaseDigest=createHash('sha256').update(bytes).digest('hex');
const profile=enabled=>createProductionProfile({sourceDigest,releaseDigest,agentdockEnabled:enabled});
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64');
console.log(JSON.stringify({app:encode(profile(true)),manager:encode(profile(false)),baseline:encode(JSON.parse(await readFile('D:\\Tong\\runtime\\profile.json','utf8'))),commit:m.commit}));
'@
  $raw=& $node --input-type=module -e $program $release
  if($LASTEXITCODE -ne 0){throw 'Failed to derive exact production grant descriptors'}
  $data=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if($data.commit -cne $expectedNew){throw 'Grant descriptor commit mismatch'}
  return $data
}
function Sign([string]$Action,[string]$Encoded){
  # A previous *interactive*, signed receipt is already scoped to the action,
  # current user, complete profile digest and 30-minute expiry. Reuse it only
  # after the installed production verifier accepts it; never mint via automation.
  $validator=Join-Path $root 'releases\manager\scripts\TongProductionProfile.mjs'
  $verified=& $node $validator --verify-approval-profile $Encoded $Action 2>$null
  if($LASTEXITCODE -eq 0){
    try{
      $binding=($verified -join [Environment]::NewLine)|ConvertFrom-Json
      if($binding.action -cne $Action -or $binding.mode -cne 'production'){throw 'Receipt binding mismatch'}
      Write-Host ('Existing valid hash-bound approval reused: '+$Action) -ForegroundColor Green
      return
    }catch{throw ('Verified approval descriptor invalid: '+$Action)}
  }
  Write-Host ('Production approval: '+$Action) -ForegroundColor Cyan
  & $signer -Mode approve -Action $Action -ProfileJson $Encoded
  if(-not $?) {throw ('Human approval rejected: '+$Action)}
  if($LASTEXITCODE -ne 0) {throw ('Human approval denied: '+$Action)}
}
function Verify-StoppedPreviousRuntime([string]$RunId){
  $proof=Native 'verify stopped runtime' @($cleanupProbe,$RunId)
  if(-not $proof.ok -or -not $proof.readOnly -or $proof.expectedRunId -cne $RunId -or $proof.matchingOwnedPids -ne 0 -or $proof.jobActive -ne 0 -or $proof.blockedPortCount -ne 0){
    throw 'Stopped runtime cleanup proof rejected'
  }
}
function Await-Stopped(){
  $limit=(Get-Date).AddSeconds(90)
  do {
    $status=CurrentStatus
    if(-not $status.supervisorAlive -and -not $status.guardianAlive -and $status.phase -in @('stopped','abnormal_exit')){
      Verify-StoppedPreviousRuntime $status.runId
      return $status
    }
    Start-Sleep -Seconds 2
  }while((Get-Date) -lt $limit)
  throw 'Private Guardian Job did not complete cleanup in time'
}
function Get-LoginFailure(){
  if($null -eq $monitorWindowStart){return $null}
  $log=Join-Path $root 'logs\login-management.jsonl'
  if(-not (Test-Path -LiteralPath $log -PathType Leaf)){return $null}
  $events=@(foreach($line in Get-Content -LiteralPath $log -Tail 40){
    try{
      $entry=$line|ConvertFrom-Json
      $at=if($entry.at -is [DateTime]){$entry.at.ToUniversalTime()}else{[DateTime]::Parse([string]$entry.at,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()}
      if($at -ge $monitorWindowStart){$entry}
    }catch{continue}
  })
  $failed=@($events|Where-Object event -eq 'runner_failed')
  if(-not $failed.Count){return $null}
  $pidFailed=$failed[-1].runnerPid
  $causes=@($events|Where-Object { $_.event -eq 'manager_command_failed' -and $_.runnerPid -eq $pidFailed })
  if($causes.Count -and $causes[-1].reason -cmatch '^[A-Z_]{1,64}$' -and $causes[-1].managerAction -cmatch '^[a-z-]{1,32}$'){
    return ([string]$causes[-1].managerAction+': '+[string]$causes[-1].reason)
  }
  return 'runner_failed (see protected login-management log)'
}
function Await-Healthy(){
  $limit=(Get-Date).AddMinutes(4)
  do {
    $status=CurrentStatus
    $failure=Get-LoginFailure
    if($failure){throw ('Login monitor exited: '+$failure)}
    if($status.phase -eq 'ready' -and $status.supervisorAlive -and $status.guardianAlive){
      $healthy=Native 'production doctor' @($manager,'doctor','--root',$root,'--login-recovery')
      if($healthy.healthy){return $status}
    }
    Start-Sleep -Seconds 3
  }while((Get-Date) -lt $limit)
  throw ('Production failed the ready/doctor acceptance; phase='+$status.phase+'; supervisorAlive='+$status.supervisorAlive+'; guardianAlive='+$status.guardianAlive)
}
function Enable-Login(){
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$false
  $script:monitorWindowStart=[DateTime]::UtcNow
  Start-ScheduledTask -TaskName $taskName
}
function Get-LoginShellPaths(){
  # Match the native Host's fixed PS7 launch contract, plus the fixed legacy
  # Windows shell for a verified old rollback. Never trust PATH or process name.
  return @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'PowerShell\7\pwsh.exe'),
    (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe')
  )
}
function Get-LoginProcessIdentity($Process){
  if($null -eq $Process -or [int]$Process.ProcessId -le 0 -or
      -not $Process.ExecutablePath -or -not $Process.CommandLine -or
      $Process.CreationDate -isnot [DateTime]){throw 'Incomplete login process identity'}
  # Copy scalar values: a later observation must not mutate the saved identity.
  return [pscustomobject]@{
    pid=[int]$Process.ProcessId;parent=[int]$Process.ParentProcessId
    name=[string]$Process.Name;path=[string]$Process.ExecutablePath
    command=[string]$Process.CommandLine;created=$Process.CreationDate.ToUniversalTime().Ticks
  }
}
function Get-LoginMonitorIdentity($Definition){
  $task=Get-ScheduledTask -TaskName $taskName
  $expectedHost=Join-Path $root 'login-management\TongLoginHost.exe'
  $runnerPath=Join-Path $root 'login-management\TongLoginRuntime.ps1'
  if(@($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ine $expectedHost -or
      [string]$task.Actions[0].Arguments -cne '' -or $task.Actions[0].WorkingDirectory -ine $root){throw 'Login task action identity mismatch'}
  $instances=@($Definition.GetInstances(0))
  if($instances.Count -ne 1){throw 'Expected exactly one live login monitor instance'}
  $instance=$instances[0];$instanceId=[guid]::Empty
  if(-not [guid]::TryParse([string]$instance.InstanceGuid,[ref]$instanceId) -or
      $instanceId -eq [guid]::Empty -or [int]$instance.EnginePID -le 0 -or [int]$instance.State -ne 4){throw 'Login task instance identity mismatch'}
  $hosts=@(Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$instance.EnginePID))
  if($hosts.Count -ne 1){throw 'Login host disappeared'}
  $hostIdentity=Get-LoginProcessIdentity $hosts[0]
  $hostCommands=@(('"'+$expectedHost+'"'))
  if($expectedHost -notmatch '\s'){$hostCommands+=$expectedHost}
  if($hostIdentity.pid -ne [int]$instance.EnginePID -or $hostIdentity.name -ine 'TongLoginHost.exe' -or
      $hostIdentity.path -ine $expectedHost -or $hostCommands -inotcontains $hostIdentity.command.Trim()){throw 'Login host identity mismatch'}
  # The native Host owns precisely one child. An extra or malformed child must
  # refuse the stop, even when one other child looks like a legitimate runner.
  $children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$hostIdentity.pid))
  if($children.Count -ne 1){throw 'Unable to identify the single original monitor runner'}
  $runnerIdentity=Get-LoginProcessIdentity $children[0]
  $shells=@(Get-LoginShellPaths | Where-Object {
    $runnerIdentity.path -ieq $_ -and $runnerIdentity.name -ieq [IO.Path]::GetFileName($_) -and
    $runnerIdentity.command -ieq ('"'+$_+'" -NoLogo -NoProfile -NonInteractive -File "'+$runnerPath+'" -Mode run')
  })
  if($shells.Count -ne 1 -or $runnerIdentity.parent -ne $hostIdentity.pid -or
      $runnerIdentity.created -lt $hostIdentity.created -or $runnerIdentity.created -gt [DateTime]::UtcNow.Ticks){throw 'Login runner identity mismatch'}
  return [pscustomobject]@{
    instance=$instanceId.ToString();hostProcess=$hostIdentity;runner=$runnerIdentity
    taskUser=[string]$task.Principal.UserId;taskPath=[string]$task.Actions[0].Execute
    taskArguments=[string]$task.Actions[0].Arguments;taskDirectory=[string]$task.Actions[0].WorkingDirectory
  }
}
function Assert-LoginMonitorIdentity($Definition,$Expected){
  $current=Get-LoginMonitorIdentity $Definition
  if(($current|ConvertTo-Json -Depth 4 -Compress) -cne ($Expected|ConvertTo-Json -Depth 4 -Compress)){throw 'Login monitor identity changed'}
}
function Assert-LoginMonitorAbsent(){
  $expectedHost=Join-Path $root 'login-management\TongLoginHost.exe'
  $runnerPath=Join-Path $root 'login-management\TongLoginRuntime.ps1'
  $unclaimed=@(Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -ieq 'TongLoginHost.exe' -and (-not $_.ExecutablePath -or $_.ExecutablePath -ieq $expectedHost)) -or
    ($_.Name -in @('pwsh.exe','powershell.exe') -and $_.CommandLine -and
      $_.CommandLine.IndexOf($runnerPath,[StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
  if($unclaimed.Count){throw 'Monitor has an unclaimed live process; rollback refused'}
}
function Restore-LoginAfterRejectedStop(){
  # An integrity rejection must survive the outer catch. Only re-enable the
  # same still-running, healthy original; never Start a possibly replaced task.
  if($null -eq $stoppingLoginIdentity){throw 'No verified original login identity; task remains disabled'}
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $definition=$scheduler.GetFolder('\').GetTask($taskName)
  Assert-LoginMonitorIdentity $definition $stoppingLoginIdentity
  $s=CurrentStatus
  if($s.runId -cne $originalRun -or $s.phase -cne 'ready' -or -not $s.supervisorAlive -or -not $s.guardianAlive){throw 'Original runtime no longer healthy; task remains disabled'}
  Assert-LoginMonitorIdentity $definition $stoppingLoginIdentity
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$false
}
function Stop-Login([bool]$AllowAbsent=$false,[bool]$UseRecovery=$true){
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $definition=$scheduler.GetFolder('\').GetTask($taskName)
  $instances=@($definition.GetInstances(0))
  if($instances.Count -eq 0 -and $AllowAbsent){
    if([string](Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){throw 'Scheduler still reports a running monitor'}
    Assert-LoginMonitorAbsent
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    $script:taskDisabled=$true
    if(@($definition.GetInstances(0)).Count){throw 'Monitor appeared while disabling its task'}
    Assert-LoginMonitorAbsent
    return
  }
  if($instances.Count -ne 1){throw 'Expected exactly one live login monitor instance'}
  $identity=Get-LoginMonitorIdentity $definition
  $script:stoppingLoginIdentity=$identity
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$true
  Assert-LoginMonitorIdentity $definition $identity
  # Existing stop-run records a requested stop. The runner observes it and
  # exits normally, then Host exits. Never force-terminate either process.
  $s=CurrentStatus
  Assert-LoginMonitorIdentity $definition $identity
  if($s.supervisorAlive){
    $stopArgs=@($manager,'stop-run','--root',$root,'--run-id',$s.runId,'--error-json')
    if($UseRecovery){$stopArgs+='--login-recovery'}
    $null=Native 'graceful exact-run stop' $stopArgs
  }
  $limit=(Get-Date).AddSeconds(30)
  while((Get-Date) -lt $limit){
    $remaining=@(foreach($original in @($identity.hostProcess,$identity.runner)){
      $found=@(Get-CimInstance Win32_Process -Filter ('ProcessId='+$original.pid))
      if($found.Count){
        if($found.Count -ne 1 -or ((Get-LoginProcessIdentity $found[0])|ConvertTo-Json -Compress) -cne ($original|ConvertTo-Json -Compress)){throw 'Login process identity changed while awaiting exit'}
        $found[0]
      }
    })
    if(@($definition.GetInstances(0)).Count -eq 0 -and $remaining.Count -eq 0){Assert-LoginMonitorAbsent;return}
    Start-Sleep -Seconds 1
  }
  throw 'Login monitor did not fully exit; do not continue to runtime stop'
}
function Stop-ExactRun([bool]$TryRecovery){
  $s=CurrentStatus
  if($s.supervisorAlive){
    $args=@($manager,'stop-run','--root',$root,'--run-id',$s.runId,'--error-json')
    if($TryRecovery){$args+= '--login-recovery'}
    $null=Native 'exact-run stop' $args
  }
  return (Await-Stopped)
}
function Activate-Pins(){
  $program=@'
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root='D:\\Tong\\runtime';
const release=process.argv[1];
const data=JSON.parse(await readFile(join(release,'release-manifest.json'),'utf8'));
const contents=await readFile(join(release,'release-manifest.json'));
const crypto=await import('node:crypto');
const hash=crypto.createHash('sha256').update(contents).digest('hex');
const input={sourceDigest:data.files.find(x=>x.path==='code/source.tar').sha256,releaseDigest:hash};
const resolve=name=>pathToFileURL(join(root,'releases','manager','scripts',name)).href;
const {createProductionProfile}=await import(resolve('TongProductionProfile.mjs'));
const {pinRuntimeRelease,verifyRuntimeCandidate}=await import(resolve('TongRuntimeCandidate.mjs'));
const {updateRuntimeProfile}=await import(resolve('TongAgentDockRuntime.mjs'));
const app=createProductionProfile({...input,agentdockEnabled:true});
const manager=createProductionProfile({...input,agentdockEnabled:false});
await pinRuntimeRelease(manager,release,{manager:true,replace:true});
await updateRuntimeProfile(app,{releaseRoot:release});
await verifyRuntimeCandidate(app);
await verifyRuntimeCandidate(app,{manager:true,reviewedManagerProfile:manager});
console.log(JSON.stringify({pinsUpdated:true,commit:data.commit}));
'@
  $raw=& $node --input-type=module -e $program $release
  if($LASTEXITCODE -ne 0){throw 'Official runtime pin activation refused'}
  $value=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $value.pinsUpdated -or $value.commit -cne $expectedNew){throw 'Pin activation result mismatch'}
}
function Restore-Old(){
  if(-not $snapshot){throw 'No exact restore snapshot available'}
  Write-Warning ('Initiating bounded source rollback from '+$snapshot)
  if(-not $taskDisabled){Stop-Login $true $recoverySigned}
  $s=CurrentStatus
  if($s.supervisorAlive){$null=Stop-ExactRun $recoverySigned}
  $null=Await-Stopped
  $restore=Native 'restore exact old sources' @($helper,'rollback',$snapshot)
  if(-not $restore.ok){throw 'Source rollback not completed'}
  $script:manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
  $oldRecoveryValid=$false
  try{$oldRecoveryValid=(Native 'verify restored login recovery' @($manager,'preflight-login','--root',$root,'--error-json')).approved -eq $true}catch{}
  if(-not $oldRecoveryValid){
    Write-Warning 'Old login recovery credential must be renewed by a real local console challenge.'
    & (Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery
    if(-not $? -or $LASTEXITCODE -ne 0){throw 'Old login recovery challenge not completed. Task remains disabled.'}
  }
  if($ExpectedOldCommit){$null=Native 'release restored lifecycle gate' @($helper,'release-upgrade-gate',$snapshot)}
  Enable-Login
  $back=Await-Healthy
  Write-Host ('Old version recovered: '+$back.runId) -ForegroundColor Green
}
if($Mode -eq 'Preflight'){
  $s=Assert-Release
  Write-Host ('PRECHECK PASS: production '+$s.runId+' healthy; candidate '+$expectedNew+' verified; no production change.')
  exit 0
}
if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or -not [Environment]::UserInteractive -or $Host.Name -cne 'ConsoleHost'){
  throw 'Visible, nonredirected PowerShell 7 ConsoleHost required'
}
if($PSVersionTable.PSVersion.Major -lt 7){throw 'Use PowerShell 7'}
if($Mode -eq 'Rollback'){
  if(-not $ExpectedOldCommit){throw 'Standalone rollback requires explicit baseline binding'}
  Assert-ControlSourceBinding
  if((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $helperSha256 -or (Get-FileHash -LiteralPath $cleanupProbe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $cleanupProbeSha256){throw 'Reviewed rollback helper changed'}
  $null=Native 'verify standalone rollback binding' @($helper,'rollback-preflight',$reviewedSnapshot)
  $plan=Get-NewProfiles
  Sign 'start' $plan.app;Sign 'manager' $plan.manager
  $baseline=Get-Content -LiteralPath (Join-Path $reviewedSnapshot 'profile.json') -Raw
  Sign 'restore' ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($baseline)))
  try{$recoverySigned=(Native 'verify current recovery for rollback' @($manager,'preflight-login','--root',$root,'--error-json')).approved -eq $true}catch{}
  if(-not $recoverySigned){Sign 'stop' $plan.baseline}
  $snapshot=$reviewedSnapshot
  Restore-Old
  exit 0
}
try{
  $old=Assert-Release
  $originalRun=[string]$old.runId
  if(-not $originalRun -or $old.phase -cne 'ready'){throw 'Invalid production run identity'}
  $plan=Get-NewProfiles
  Write-Host ('Reviewed upgrade '+$expectedOldApp+' / '+$expectedOldManager+' -> '+$expectedNew) -ForegroundColor Cyan
  Write-Host 'Approve the two profile-activation scopes below before anything is stopped.'
  # Exact-run stop uses the already granted old recovery capability. The new
  # fixed recovery grant authorizes Manager/start/stop after activation; separate
  # duplicate stop and Manager receipts are neither needed nor minted.
  foreach($action in @('start','enable-agentdock')){Sign $action $plan.app}
  if($ExpectedOldCommit){Sign 'manager' $plan.manager;Sign 'restore' $plan.baseline}
  $record=Native 'verify immutable production snapshot' @($helper,'verify-snapshot',$reviewedSnapshot)
  if(-not $record.ok -or $record.stage -cne 'snapshotted'){
    throw 'Production rollback snapshot verification failed'
  }
  $snapshot=[string]$record.snapshot
  [IO.File]::WriteAllText((Join-Path $snapshot 'original-task.xml'),[string](Export-ScheduledTask -TaskName $taskName),[Text.UTF8Encoding]::new($false))
  Write-Host ('Production snapshot saved: '+$snapshot) -ForegroundColor Cyan
  $check=CurrentStatus
  if($check.runId -cne $originalRun -or -not $check.supervisorAlive -or -not $check.guardianAlive){throw 'Production run identity changed after snapshot'}
  Stop-Login
  $null=Stop-ExactRun $true
  $wasStopped=$true
  $didInstall=$true
  if($ExpectedOldCommit){
    $null=Native 'install and activate under lifecycle gate' @($helper,'install-activate',$snapshot)
  }else{
    $state=Native 'backup private production state' @($helper,'backup-state',$snapshot)
    if(-not $state.ok -or $state.stage -cne 'state-backed-up'){throw 'Consistent private runtime-state backup was not verified'}
    $result=Native 'copy reviewed candidate sources' @($helper,'install',$snapshot)
    if(-not $result.ok){throw 'Candidate files not fully installed'}
    Activate-Pins
    $null=Native 'copy and hash login runner' @($helper,'install-runner',$snapshot)
    $null=Native 'verify entire installed candidate' @($helper,'verify-installed')
  }
  Write-Host 'Installed files and pins verified; the new login recovery grant requires your exact local challenge.'
  & (Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery
  if(-not $? -or $LASTEXITCODE -ne 0){throw 'New login recovery grant not approved'}
  $verifiedRecovery=Native 'verify new login recovery' @($manager,'preflight-login','--root',$root,'--error-json')
  if(-not $verifiedRecovery.approved){throw 'Installed recovery authorization did not validate'}
  $recoverySigned=$true
  if($ExpectedOldCommit){$null=Native 'release verified lifecycle gate' @($helper,'release-upgrade-gate',$snapshot)}
  Enable-Login
  $ready=Await-Healthy
  if([string](Get-ScheduledTask -TaskName $taskName).State -ne 'Running'){throw 'Login monitor did not remain Running'}
  Write-Host ('PRODUCTION-UPGRADE-OK runId='+$ready.runId+' App='+$expectedNew+' Manager='+$expectedNew) -ForegroundColor Green
  Write-Host ('Rollback snapshot: '+$snapshot)
} catch {
  $failure=$_.Exception.Message
  Write-Warning ('Production cutover failed: '+$failure)
  if($wasStopped -and $didInstall){
    try{Restore-Old}catch{Write-Warning ('Automatic rollback requires attention: '+$_.Exception.Message)}
  }elseif($taskDisabled -and -not $didInstall){
    try{Restore-LoginAfterRejectedStop}catch{Write-Warning ('Old startup needs attention: '+$_.Exception.Message)}
  }
  if($snapshot){Write-Warning ('Evidence: '+$snapshot)}
  throw $failure
}
