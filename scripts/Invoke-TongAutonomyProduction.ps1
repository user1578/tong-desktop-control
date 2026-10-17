param(
  [ValidateSet('Preflight','Deploy')][string]$Mode='Preflight'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$node='D:\node\node.exe'
$root='D:\Tong\runtime'
$base='D:\Tong\state\p27-autonomy-candidate-20261017'
$helper=Join-Path $base 'TongAutonomyProductionCutover.mjs'
$helperSha256='c57656624dc2d770cfc25d20fd9a28cf9089b8820149f3a425e7de4f8333cc2b'
$release=Join-Path $base 'release'
$manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$signer=Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1'
$taskName='TongLoginRuntime'
$originalRun='f308bff5-2cb7-4480-b82c-4271a233dbf9'
$expectedOldApp='3442cbb938dea887a55bf13a72a5213ae4c5dbe5'
$expectedOldManager='1eac7502a9cf89be7daf63d59843ad9f49b61877'
$expectedNew='bb234ec794c1d8180586781c92601f2eae95e750'
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
function Assert-Release(){
  if(-not (Test-Path -LiteralPath $helper -PathType Leaf) -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $helperSha256){throw 'Maintenance helper changed since review'}
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
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\release';
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
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  $script:taskDisabled=$true
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $definition=$scheduler.GetFolder('\\').GetTask($taskName)
  $limit=(Get-Date).AddSeconds(30)
  while((Get-Date) -lt $limit){
    if(@($definition.GetInstances(0)).Count -eq 0){return}
    Start-Sleep -Seconds 1
  }
  throw 'TongLoginRuntime still has a live task instance'
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
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\release';
const data=JSON.parse(await readFile(join(release,'release-manifest.json'),'utf8'));
const contents=await readFile(join(release,'release-manifest.json'));
const crypto=await import('node:crypto');
const hash=crypto.createHash('sha256').update(contents).digest('hex');
const input={sourceDigest:data.files.find(x=>x.path==='code/source.tar').sha256,releaseDigest:hash};
const resolve=name=>pathToFileURL(join(root,'releases','manager','scripts',name)).href;
const {createProductionProfile}=await import(resolve('TongProductionProfile.mjs'));
const {pinRuntimeRelease}=await import(resolve('TongRuntimeCandidate.mjs'));
const {updateRuntimeProfile,verifyRuntimeCandidate}=await import(resolve('TongAgentDockRuntime.mjs'));
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
  if($old.runId -cne $originalRun){throw 'Unexpected production run identity, rerun preflight with reviewed context'}
  $plan=Get-NewProfiles
  Write-Host ('Reviewed upgrade '+$expectedOldApp+' / '+$expectedOldManager+' -> '+$expectedNew) -ForegroundColor Cyan
  Write-Host 'Type the separate hash-bound approval challenges below. Nothing will be stopped until all are approved.'
  foreach($action in @('start','stop','enable-agentdock')){Sign $action $plan.app}
  Sign 'manager' $plan.manager
  $record=Native 'immutable production snapshot' @($helper,'snapshot')
  if(-not $record.ok -or $record.stage -cne 'snapshotted'){throw 'Production rollback snapshot creation failed'}
  $snapshot=[string]$record.snapshot
  [IO.File]::WriteAllText((Join-Path $snapshot 'original-task.xml'),[string](Export-ScheduledTask -TaskName $taskName),[Text.UTF8Encoding]::new($false))
  Write-Host ('Production snapshot saved: '+$snapshot) -ForegroundColor Cyan
  Stop-Login
  $null=Stop-ExactRun $true
  $wasStopped=$true
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
