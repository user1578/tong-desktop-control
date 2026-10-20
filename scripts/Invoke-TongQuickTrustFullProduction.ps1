param(
  [ValidateSet('Preflight','Deploy')][string]$Mode='Preflight'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$node='D:\node\node.exe'
$root='D:\Tong\runtime'
$base='D:\Tong\state\p27-autonomy-candidate-20261017'
$helper=Join-Path $PSScriptRoot 'TongQuickTrustFullCutover.mjs'
$helperSha256='cc25a53ed6ef05992e669efbef5bfc63e4b18e743ad85e00450a744800bf2b51'
$release=Join-Path $base 'quick-trust-release-d9983bb'
$reviewedSnapshot=Join-Path $base 'quick-trust-full-cutover-20261020084000551-ffdcdbb2'
$manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$signer=Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1'
$taskName='TongLoginRuntime'
$originalRun=$null
$expectedOldApp='a1b56b3666651c3648327f05e0ea4154284645c3'
$expectedOldManager='a1b56b3666651c3648327f05e0ea4154284645c3'
$expectedNew='d9983bbc5fe1640f51d4a649ff0f018c9f458c6f'
$snapshot=$null
$wasStopped=$false
$didInstall=$false
$recoverySigned=$false
$taskDisabled=$false
function Native([string]$Name,[string[]]$Arguments){
  $raw=& $node @Arguments
  if($LASTEXITCODE -ne 0){throw ('FAILED: '+$Name+' exit='+$LASTEXITCODE)}
  return (($raw -join [Environment]::NewLine)|ConvertFrom-Json)
}
function CurrentStatus(){
  return (Native 'manager status' @($manager,'status','--root',$root))
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
  'D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-candidate-d9983bb\\scripts'
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
  $raw=& $node --input-type=module -e $probe
  if($LASTEXITCODE -ne 0){throw 'Candidate or production runtime activation exports are incompatible'}
  $result=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $result.activationBindings -or $result.locations -ne 2 -or $result.exportsChecked -ne 4){throw 'Invalid activation export result'}
}
function Assert-Release(){
  Assert-Activation-Bindings
  if(-not (Test-Path -LiteralPath $helper -PathType Leaf) -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $helperSha256){throw 'Maintenance helper changed since review'}
  $checkedSnapshot=Native 'verified source rollback snapshot' @($helper,'verify-snapshot',$reviewedSnapshot)
  if(-not $checkedSnapshot.ok -or $checkedSnapshot.stage -cne 'snapshotted' -or
      $checkedSnapshot.appFiles -ne 191 -or $checkedSnapshot.managerFiles -ne 191){
      throw 'Full rollback snapshot is missing or changed'
  }
  $result=Native 'verified production preflight' @($helper,'preflight')
  if(-not $result.ok -or $result.oldApp -cne $expectedOldApp -or $result.oldManager -cne $expectedOldManager -or $result.newCommit -cne $expectedNew){throw 'Unexpected release hashes or production baseline'}
  $task=Get-ScheduledTask -TaskName $taskName
  if($task.Principal.UserId -notin @('Rune','RUNE') -or $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine (Join-Path $root 'login-management\TongLoginHost.exe')){throw 'Unknown login task definition'}
  $s=CurrentStatus
  if($s.phase -cne 'ready' -or -not $s.supervisorAlive -or -not $s.guardianAlive){throw 'Production is not healthy'}
  $d=Native 'manager doctor' @($manager,'doctor','--root',$root)
  if(-not $d.healthy){throw 'Production doctor is not healthy'}
  return $s
}
function Get-NewProfiles(){
  $program=@'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-d9983bb';
const manager='D:\\Tong\\runtime\\releases\\manager\\scripts\\TongProductionProfile.mjs';
const bytes=await readFile(join(release,'release-manifest.json'));
const m=JSON.parse(bytes);
const {createProductionProfile}=await import(pathToFileURL(manager).href);
const sourceDigest=m.files.find(x=>x.path==='code/source.tar').sha256;
const releaseDigest=createHash('sha256').update(bytes).digest('hex');
const profile=enabled=>createProductionProfile({sourceDigest,releaseDigest,agentdockEnabled:enabled});
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64');
console.log(JSON.stringify({app:encode(profile(true)),manager:encode(profile(false)),commit:m.commit}));
'@
  $raw=& $node --input-type=module -e $program
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
function Await-Stopped(){
  $limit=(Get-Date).AddSeconds(90)
  do {
    $status=CurrentStatus
    if(-not $status.supervisorAlive -and -not $status.guardianAlive -and $status.phase -eq 'stopped'){
      $record=(Get-Content (Join-Path $root 'run\guardian.json') -Raw)|ConvertFrom-Json
      if($record.runId -cne $status.runId -or -not $record.finishedAt -or $record.jobActiveAfterCleanup -ne 0){throw 'Guardian cleanup is not proven'}
      return $status
    }
    Start-Sleep -Seconds 2
  }while((Get-Date) -lt $limit)
  throw 'Private Guardian Job did not complete cleanup in time'
}
function Await-Healthy(){
  $limit=(Get-Date).AddMinutes(4)
  do {
    $status=CurrentStatus
    if($status.phase -eq 'ready' -and $status.supervisorAlive -and $status.guardianAlive){
      $healthy=Native 'production doctor' @($manager,'doctor','--root',$root)
      if($healthy.healthy){return $status}
    }
    Start-Sleep -Seconds 3
  }while((Get-Date) -lt $limit)
  throw 'Production failed the ready/doctor acceptance'
}
function Enable-Login(){
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$false
  Start-ScheduledTask -TaskName $taskName
}
function Stop-Login(){
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $definition=$scheduler.GetFolder('\').GetTask($taskName)
  $instances=@($definition.GetInstances(0))
  if($instances.Count -ne 1){throw 'Expected exactly one live login monitor instance'}
  $engineProcessId=[int]$instances[0].EnginePID
  $hostProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$engineProcessId)
  $expectedHost=Join-Path $root 'login-management\TongLoginHost.exe'
  if($null -eq $hostProcess -or $hostProcess.Name -ine 'TongLoginHost.exe' -or $hostProcess.ExecutablePath -ine $expectedHost){throw 'Login host identity mismatch'}
  $expectedRunner='"C:\Windows\system32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "D:\Tong\runtime\login-management\TongLoginRuntime.ps1" -Mode run'
  $runners=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$engineProcessId) | Where-Object { $_.Name -ieq 'powershell.exe' -and $_.CommandLine -ieq $expectedRunner })
  if($runners.Count -ne 1){throw 'Unable to identify the single original monitor runner'}
  $runner=$runners[0]
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$true
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$runner.ProcessId)
  if($null -eq $current -or $current.ParentProcessId -ne $engineProcessId -or $current.CreationDate -ne $runner.CreationDate -or $current.CommandLine -ine $expectedRunner){throw 'Monitor runner identity changed'}
  # Terminate only the exact login runner. The GUI host waits for it and exits;
  # Supervisor and Guardian are independent and must remain untouched.
  Stop-Process -Id $runner.ProcessId -Force -ErrorAction Stop
  $limit=(Get-Date).AddSeconds(30)
  while((Get-Date) -lt $limit){
    if(@($definition.GetInstances(0)).Count -eq 0 -and -not (Get-Process -Id $runner.ProcessId -ErrorAction SilentlyContinue)){return}
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
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-d9983bb';
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
  $raw=& $node --input-type=module -e $program
  if($LASTEXITCODE -ne 0){throw 'Official runtime pin activation refused'}
  $value=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $value.pinsUpdated -or $value.commit -cne $expectedNew){throw 'Pin activation result mismatch'}
}
function Restore-Old(){
  if(-not $snapshot){throw 'No exact restore snapshot available'}
  Write-Warning ('Initiating bounded source rollback from '+$snapshot)
  if(-not $taskDisabled){Stop-Login}
  $s=CurrentStatus
  if($s.supervisorAlive){$null=Stop-ExactRun $recoverySigned}
  $null=Await-Stopped
  $restore=Native 'restore exact old sources' @($helper,'rollback',$snapshot)
  if(-not $restore.ok){throw 'Source rollback not completed'}
  $script:manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
  Write-Warning 'Old login recovery credential must be renewed by a real local console challenge.'
  & (Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery
  if(-not $? -or $LASTEXITCODE -ne 0){throw 'Old login recovery challenge not completed. Task remains disabled.'}
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
try{
  $old=Assert-Release
  $originalRun=[string]$old.runId
  if(-not $originalRun -or $old.phase -cne 'ready'){throw 'Invalid production run identity'}
  $plan=Get-NewProfiles
  Write-Host ('Reviewed upgrade '+$expectedOldApp+' / '+$expectedOldManager+' -> '+$expectedNew) -ForegroundColor Cyan
  Write-Host 'Type the separate hash-bound approval challenges below. Nothing will be stopped until all are approved.'
  foreach($action in @('start','stop','enable-agentdock')){Sign $action $plan.app}
  Sign 'manager' $plan.manager
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
  $state=Native 'backup private production state' @($helper,'backup-state',$snapshot)
  if(-not $state.ok -or $state.stage -cne 'state-backed-up'){
    throw 'Consistent private runtime-state backup was not verified'
  }
  $didInstall=$true
  $result=Native 'copy reviewed candidate sources' @($helper,'install',$snapshot)
  if(-not $result.ok){throw 'Candidate files not fully installed'}
  Activate-Pins
  $null=Native 'copy and hash login runner' @($helper,'install-runner',$snapshot)
  $null=Native 'verify entire installed candidate' @($helper,'verify-installed')
  Write-Host 'Installed files and pins verified; the new login recovery grant requires your exact local challenge.'
  & (Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1') -Mode approve-login-recovery
  if(-not $? -or $LASTEXITCODE -ne 0){throw 'New login recovery grant not approved'}
  $recoverySigned=$true
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
    try{Enable-Login;$null=Await-Healthy}catch{Write-Warning ('Old startup needs attention: '+$_.Exception.Message)}
  }
  if($snapshot){Write-Warning ('Evidence: '+$snapshot)}
  throw $failure
}
