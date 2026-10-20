param([ValidateSet('Preflight','Deploy')][string]$Mode='Preflight')
# The app-only procedure is obsolete: production login recovery requires
# application and Manager to share the SAME signed release digest.
if($Mode -eq 'Deploy'){throw 'APP_ONLY_UPGRADE_DISABLED: use Invoke-TongQuickTrustFullProduction.ps1'}
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$node='D:\node\node.exe'
$root='D:\Tong\runtime'
$base='D:\Tong\state\p27-autonomy-candidate-20261017'
$helper=Join-Path $PSScriptRoot 'TongQuickTrustProductionCutover.mjs'
$release=Join-Path $base 'quick-trust-release-0a2da3c'
$snapshot=Join-Path $base 'quick-trust-snapshot-0a2da3c'
$manager=Join-Path $root 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$signer=Join-Path $root 'releases\manager\scripts\TongProductionApproval.ps1'
$taskName='TongLoginRuntime'
$expectedOld='a1b56b3666651c3648327f05e0ea4154284645c3'
$expectedNew='0a2da3c61a71da65191640bd18e4711992430667'
$wasStopped=$false;$didInstall=$false;$taskDisabled=$false;$recoverySigned=$false

function Native([string]$Name,[string[]]$Arguments){
  $raw=& $node @Arguments
  if($LASTEXITCODE -ne 0){throw ('FAILED: '+$Name+' exit='+$LASTEXITCODE)}
  return (($raw -join [Environment]::NewLine)|ConvertFrom-Json)
}
function CurrentStatus(){
  return (Native 'manager status' @($manager,'status','--root',$root))
}


function Assert-Release(){
  $proof=Native 'verified old and new app' @($helper,'preflight')
  if($proof.status -cne 'preflight-passed' -or $proof.old -cne $expectedOld -or
     $proof.new -cne $expectedNew -or -not $proof.managerUnchanged){
      throw 'Version mismatch; upgrade refused'
  }
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $expectedHost=Join-Path $root 'login-management\TongLoginHost.exe'
  if($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine $expectedHost)
    {throw 'Unexpected login monitor definition'}
  $s=CurrentStatus
  if($s.phase -cne 'ready' -or -not $s.supervisorAlive -or -not $s.guardianAlive -or
     $s.sourceCommit -cne $expectedOld -or $s.managerCommit -cne $expectedOld)
      {throw 'Production is not in the reviewed healthy state'}
  $d=Native 'production doctor' @($manager,'doctor','--root',$root)
  if(-not $d.healthy) {throw 'Production doctor is not healthy'}
  if(!(Test-Path -LiteralPath (Join-Path $snapshot 'snapshot.json') -PathType Leaf))
    {throw 'Reviewed rollback source snapshot was not prepared'}
  return $s
}
function Get-NewProfile(){
  $script=@'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const source='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-0a2da3c';
const bin=await readFile(join(source,'release-manifest.json'));
const manifest=JSON.parse(bin);
const api=await import(pathToFileURL('D:\\Tong\\runtime\\releases\\manager\\scripts\\TongProductionProfile.mjs').href);
const profile=api.createProductionProfile({sourceDigest:manifest.files.find(x=>x.path==='code/source.tar').sha256,
 releaseDigest:createHash('sha256').update(bin).digest('hex'),agentdockEnabled:true});
console.log(JSON.stringify({commit:manifest.commit,encoded:Buffer.from(JSON.stringify(profile)).toString('base64')}));
'@
  $raw=& $node --input-type=module -e $script
  if($LASTEXITCODE -ne 0) {throw 'Unable to derive reviewed profile'}
  $value=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if($value.commit -cne $expectedNew){throw 'Unexpected candidate profile'}
  return $value
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


function Activate-NewApplication(){
  # Official app-only activation. Installed, pinned manager stays at a1b56b3.
  $code=@'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root='D:\\Tong\\runtime';
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-0a2da3c';
const bytes=await readFile(join(release,'release-manifest.json'));
const manifest=JSON.parse(bytes);
const profileUrl=pathToFileURL(join(root,'releases','manager','scripts','TongProductionProfile.mjs')).href;
const runtimeUrl=pathToFileURL(join(root,'releases','manager','scripts','TongAgentDockRuntime.mjs')).href;
const {createProductionProfile}=await import(profileUrl);
const {updateRuntimeProfile}=await import(runtimeUrl);
const profile=createProductionProfile({sourceDigest:manifest.files.find(x=>x.path==='code/source.tar').sha256,
 releaseDigest:createHash('sha256').update(bytes).digest('hex'),agentdockEnabled:true});
await updateRuntimeProfile(profile,{releaseRoot:release});
console.log(JSON.stringify({activated:true,app:manifest.commit}));
'@
  $lines=& $node --input-type=module -e $code
  if($LASTEXITCODE -ne 0){throw 'Official application pin activation failed'}
  $output=($lines -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $output.activated -or $output.app -cne $expectedNew)
    {throw 'Application activation returned wrong commit'}
}
function Restore-Old(){
  Write-Warning 'Upgrade failed; returning app code and pin to the original snapshot.'
  if(-not $taskDisabled){Stop-Login}
  $current=CurrentStatus
  if($current.supervisorAlive){$null=Stop-ExactRun $recoverySigned}
  $null=Await-Stopped
  $snapshotStage=(Get-Content -LiteralPath (Join-Path $snapshot 'snapshot.json') -Raw|ConvertFrom-Json).stage
  if($snapshotStage -eq 'state-backed-up'){
    $check=Native 'original source still verified' @($helper,'preflight')
    if($check.old -cne $expectedOld){throw 'Old version could not be revalidated'}
  }else{
    $back=Native 'rollback original application' @($helper,'rollback')
    if($back.releaseCommit -cne $expectedOld){throw 'Rollback source mismatch'}
  }
  Write-Warning 'Restored source/pin; old login recovery credential must be reapproved locally.'
  & $signer -Mode approve-login-recovery
  if(-not $? -or $LASTEXITCODE -ne 0){throw 'Old login recovery approval is still required'}
  Enable-Login
  $ready=Await-Healthy
  Write-Host ('Old production recovered, runId='+$ready.runId) -ForegroundColor Green
}


if($Mode -eq 'Preflight'){
  $s=Assert-Release
  Write-Host ('PRECHECK PASS: running '+$s.runId+'; candidate '+$expectedNew+
    '; old Manager remains untouched; no production state changed.')
  exit 0
}
if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or
   -not [Environment]::UserInteractive -or $Host.Name -cne 'ConsoleHost' -or
   $PSVersionTable.PSVersion.Major -lt 7)
    {throw 'Visible, nonredirected PowerShell 7 ConsoleHost required'}
try{
  $before=Assert-Release
  $planned=Get-NewProfile
  Write-Host 'This operation upgrades the Tong APP only, keeping the verified Manager and its binaries unchanged.'
  Write-Host 'You will be prompted to approve hash-bound START and AgentDock enable for the new release.'
  foreach($action in @('start','enable-agentdock')){Sign $action $planned.encoded}
  if((CurrentStatus).runId -cne $before.runId){throw 'Production run changed since review'}
  # Only the exact existing login monitor instance is disabled.
  Stop-Login
  $null=Stop-ExactRun $true
  $wasStopped=$true
  $backup=Native 'backup private state after shutdown' @($helper,'backup-state')
  if($backup.status -cne 'state-snapshotted'){throw 'Consistent private-state backup not confirmed'}
  $didInstall=$true
  $installed=Native 'install checked application files' @($helper,'install-files')
  if($installed.status -cne 'files-installed-not-activated'){throw 'App source install incomplete'}
  Activate-NewApplication
  $verify=Native 'verify app pinned and Manager old' @($helper,'confirm-activated')
  if($verify.app -cne $expectedNew -or $verify.manager -cne $expectedOld)
    {throw 'Production pins not verified'}
  Write-Host 'New app installed, restored state is intact. One final local login recovery approval follows.'
  & $signer -Mode approve-login-recovery
  if(-not $? -or $LASTEXITCODE -ne 0){throw 'New login recovery not approved'}
  $recoverySigned=$true
  Enable-Login
  $ready=Await-Healthy
  if((Get-ScheduledTask -TaskName $taskName).State -ne 'Running')
    {throw 'Login monitor is not running'}
  if($ready.sourceCommit -cne $expectedNew -or $ready.managerCommit -cne $expectedOld)
    {throw 'Unexpected running code commit'}
  Write-Host ('UPGRADE SUCCEEDED: app '+$expectedNew+', manager '+$expectedOld+
    ', runId='+$ready.runId) -ForegroundColor Green
  Write-Host ('Rollback snapshot: '+$snapshot)
}catch{
  $reason=$_.Exception.Message
  Write-Warning ('Upgrade stopped: '+$reason)
  if($wasStopped -and $didInstall){
    try{Restore-Old}catch{Write-Warning ('Automatic rollback requires local attention: '+$_.Exception.Message)}
  }elseif($taskDisabled -and -not $didInstall){
    try{Enable-Login;$null=Await-Healthy}catch{Write-Warning ('Old instance recovery needs local attention: '+$_.Exception.Message)}
  }
  throw $reason
}
