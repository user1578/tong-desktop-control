import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Only filesystem copies with remapped fixed paths and fake lifecycle boundaries
// are executed. No real task, service, production manager or tunnel is invoked.
const shell=process.argv[2]??'powershell.exe';
const project=fileURLToPath(new URL('../',import.meta.url));
const root=await mkdtemp('D:\\Tong\\state\\login-test-');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const manager=String.raw`import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
if(process.argv[2]==='preflight-production'){console.log(JSON.stringify({approved:true,stopRunSupported:true}));process.exit(0);}
const root=process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:dirname(process.argv[1]);
const path=join(root,'fixture.json'),s=JSON.parse(readFileSync(path,'utf8')),action=process.argv[2];
appendFileSync(join(root,'calls.jsonl'),JSON.stringify({action})+'\n');
if(s.refuse===action){console.error('APPROVAL_DENIED');process.exit(1);}
if(action==='start'){s.phase='ready';s.supervisorAlive=true;s.runId='new-run';}
if(action==='stop'||action==='stop-run'){
  if(s.replaceAtStop)s.runId='replacement-run';
  if(action==='stop-run'&&process.argv[process.argv.indexOf('--run-id')+1]!==s.runId){console.error('IDENTITY_MISMATCH');process.exit(1);}
  s.phase='stopped';s.supervisorAlive=false;
}
if(action==='reconcile-stale'){s.phase='abnormal_exit';}
if(action==='status'){s.statusCalls=(s.statusCalls??0)+1;if(s.replaceOnStatusCall===s.statusCalls)s.runId='replacement-run';}
if(action==='status'&&s.phase==='starting'&&s.becomeReady&&s.statusCalls>1){s.phase='ready';}
const healthy=action==='doctor'&&s.health?.length?s.health.shift():s.healthy!==false;
writeFileSync(path,JSON.stringify(s));
console.log(JSON.stringify(action==='doctor'?{healthy}:action==='start'?{phase:s.phase,runId:s.runId}:s));`;
// Do not inherit a PS7-only module search path when invoking Windows PS5.1.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
const run=(path,args=[])=>spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',path,...args],{env,encoding:'utf8',windowsHide:true,timeout:20000});
async function runner(name,state,mode){
  const dir=join(root,name);await mkdir(join(dir,'logs'),{recursive:true});
  await mkdir(join(dir,'releases','manager','scripts'),{recursive:true});
  await writeFile(join(dir,'releases','manager','scripts','TongAgentDockRuntime.mjs'),manager);
  await writeFile(join(dir,'fixture.json'),JSON.stringify(state));
  const source=(await readFile(join(project,'scripts','TongLoginRuntime.ps1'),'utf8')).replaceAll('D:\\Tong\\runtime',dir).replaceAll('Local\\TongLoginRuntime-','Local\\TongLoginTest-'+basename(root)+'-');
  assert.ok(!source.includes('D:\\Tong\\runtime'));
  await writeFile(join(dir,'runner.ps1'),source);
  const harness=`param([string]$Mode)
$ErrorActionPreference='Stop'
function Start-Process { throw 'TEST: direct process startup forbidden' }
function Stop-Process { throw 'TEST: direct process stop forbidden' }
function Get-CimInstance { throw 'TEST: tunnel identity access forbidden' }
function Invoke-RestMethod { throw 'TEST: tunnel API access forbidden' }
function Start-Sleep { }
& ${quote(join(dir,'runner.ps1'))} -Mode $Mode
exit $LASTEXITCODE
`;
  await writeFile(join(dir,'harness.ps1'),harness);
  const result=run(join(dir,'harness.ps1'),['-Mode',mode]);
  const calls=(await readFile(join(dir,'calls.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).action);
  return {result,calls,dir};
}
const ready={phase:'ready',supervisorAlive:true,runId:'old-run',healthy:true};
let t=await runner('healthy-existing',ready,'start');
assert.equal(t.result.status,0,t.result.stderr);assert.deepEqual(t.calls,['status','doctor']);
t=await runner('empty',{phase:'not_started',supervisorAlive:false},'start');
assert.equal(t.result.status,0,t.result.stderr);assert.deepEqual(t.calls,['status','start','status','doctor']);
t=await runner('stale',{phase:'stale_record',supervisorAlive:false},'start');
assert.equal(t.result.status,0,t.result.stderr);assert.deepEqual(t.calls,['status','reconcile-stale','start','status','doctor']);
t=await runner('stale-refused',{phase:'stale_record',supervisorAlive:false,refuse:'reconcile-stale'},'start');
assert.notEqual(t.result.status,0);assert.deepEqual(t.calls,['status','reconcile-stale']);
t=await runner('status',ready,'status');
assert.equal(t.result.status,0,t.result.stderr);assert.equal(JSON.parse(t.result.stdout).tongPhase,'ready');assert.deepEqual(t.calls,['status']);
t=await runner('stop',ready,'stop');
assert.equal(t.result.status,0,t.result.stderr);assert.deepEqual(t.calls,['status','stop']);
t=await runner('stop-refused',{...ready,refuse:'stop'},'stop');
assert.notEqual(t.result.status,0);assert.deepEqual(t.calls,['status','stop']);
t=await runner('unhealthy',{...ready,healthy:false},'start');
assert.notEqual(t.result.status,0);assert.equal(t.calls.filter(x=>x==='doctor').length,3);assert.equal(t.calls.at(-1),'stop-run');
t=await runner('transient',{...ready,health:[false,false,true]},'start');
assert.equal(t.result.status,0,t.result.stderr);assert.ok(!t.calls.includes('stop'));
t=await runner('replacement',{...ready,healthy:false,replaceOnStatusCall:2},'start');
assert.notEqual(t.result.status,0);assert.ok(!t.calls.includes('stop'),'a replacement run must not be stopped on old health evidence');
t=await runner('health-stop-refused',{...ready,healthy:false,refuse:'stop-run'},'start');
assert.notEqual(t.result.status,0);assert.equal(t.calls.at(-1),'stop-run');assert.ok(!t.calls.includes('start'));
t=await runner('stop-race',{...ready,healthy:false,replaceAtStop:true},'start');
assert.notEqual(t.result.status,0);assert.equal(t.calls.at(-1),'stop-run');assert.equal(JSON.parse(await readFile(join(t.dir,'fixture.json'),'utf8')).phase,'ready');
t=await runner('monitor',{...ready,health:[true,false,false,false,false]},'run');
assert.notEqual(t.result.status,0);assert.equal(t.calls.at(-1),'stop-run');
t=await runner('in-flight',{phase:'starting',supervisorAlive:true,runId:'old-run',becomeReady:true},'start');
assert.equal(t.result.status,0,t.result.stderr);assert.deepEqual(t.calls,['status','status','doctor']);
t=await runner('stopping',{phase:'stopping',supervisorAlive:true,runId:'old-run'},'start');
assert.notEqual(t.result.status,0);assert.deepEqual(t.calls,['status']);
t=await runner('status-empty',{phase:'not_started',supervisorAlive:false},'status');
assert.equal(t.result.status,0,t.result.stderr);assert.equal(JSON.parse(t.result.stdout).runId,null);
const holdScript=join(root,'hold-lock.ps1'),lockSignal=join(root,'locked');
await writeFile(holdScript,`$m=[Threading.Mutex]::new($false,('Local\\TongLoginTest-${basename(root)}-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
if(-not $m.WaitOne(0)){throw 'Fixture lock busy'}
[IO.File]::WriteAllText(${quote(lockSignal)},'locked')
try{Start-Sleep -Seconds 20}finally{$m.ReleaseMutex();$m.Dispose()}
`);
const holder=spawn(shell,['-NoProfile','-NonInteractive','-File',holdScript],{env,windowsHide:true,stdio:'ignore'});
try{
  let acquired=false;
  for(let i=0;i<50;i++){if(await readFile(lockSignal,'utf8').catch(()=>null)){acquired=true;break;}await new Promise(ok=>setTimeout(ok,100));}
  assert.ok(acquired,'isolated mutex owner must start');
  t=await runner('concurrent',ready,'start');
  assert.notEqual(t.result.status,0);assert.match(t.result.stderr,/Another Tong lifecycle operation/);assert.deepEqual(t.calls,[]);
}finally{const closed=once(holder,'close');holder.kill();await closed;}

// Real filesystem prepare/install/rollback, with Task Scheduler and manager
// calls confined to explicit fakes. Any ngrok copy/config access fails closed.
const dir=join(root,'installer'),runtime=join(dir,'runtime'),preparation=join(dir,'preparation');
await mkdir(join(runtime,'releases','manager','scripts'),{recursive:true});
await writeFile(join(runtime,'releases','manager','scripts','TongAgentDockRuntime.mjs'),manager);
await writeFile(join(dir,'fixture.json'),JSON.stringify(ready));
let installer=await readFile(join(project,'scripts','Install-TongLoginManagement.ps1'),'utf8');
installer=installer.replaceAll('D:\\Tong\\state\\p26-login-preparation-v2','@PREPARATION@').replaceAll('D:\\Tong\\state\\p26-login-preparation','@PREPARATION@').replaceAll('D:\\Tong\\state','@STATE@').replaceAll('D:\\Tong\\runtime','@RUNTIME@').replaceAll('@PREPARATION@',preparation).replaceAll('@STATE@',dir).replaceAll('@RUNTIME@',runtime);
await writeFile(join(dir,'Install-TongLoginManagement.ps1'),installer);
await writeFile(join(dir,'TongLoginRuntime.ps1'),(await readFile(join(project,'scripts','TongLoginRuntime.ps1'),'utf8')).replaceAll('D:\\Tong\\runtime',runtime));
const taskFile=join(dir,'task.json'),taskCalls=join(dir,'task-calls.jsonl'),registerFailure=join(dir,'fail-register');
await writeFile(join(dir,'harness.ps1'),`param([string]$Mode)
$ErrorActionPreference='Stop'
function TaskCall($action,$name) { if($name -cne 'TongLoginRuntime'){throw 'TEST: foreign task touched'}; [IO.File]::AppendAllText(${quote(taskCalls)},$action+"\n") }
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) [pscustomobject]@{Execute=$Execute;Argument=$Argument;WorkingDirectory=$WorkingDirectory} }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn,$User) [pscustomobject]@{User=$User;Delay=''} }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel) [pscustomobject]@{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel} }
function New-ScheduledTaskSettingsSet { param($MultipleInstances,$ExecutionTimeLimit,$RestartCount,$RestartInterval,[switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries) [pscustomobject]@{MultipleInstances=$MultipleInstances;ExecutionTimeLimit=$ExecutionTimeLimit;RestartCount=$RestartCount} }
function New-ScheduledTask { param($Action,$Trigger,$Principal,$Settings,$Description) [pscustomobject]@{Action=$Action;Trigger=$Trigger;Principal=$Principal;Settings=$Settings;Description=$Description} }
function Export-ScheduledTask { param([Parameter(ValueFromPipeline)]$InputObject,$TaskName) process { if($TaskName){throw 'TEST: legacy export forbidden'}; $InputObject|ConvertTo-Json -Depth 8 -Compress } }
function Get-ScheduledTask { param($TaskName,$ErrorAction) TaskCall 'get' $TaskName; if(Test-Path -LiteralPath ${quote(taskFile)}){[pscustomobject]@{TaskName=$TaskName;State='Ready'}} }
function Register-ScheduledTask { param($TaskName,$Xml) TaskCall 'register' $TaskName; if(Test-Path -LiteralPath ${quote(registerFailure)}){throw 'TEST: registration refused'}; [IO.File]::WriteAllText(${quote(taskFile)},$Xml) }
function Start-ScheduledTask { param($TaskName) TaskCall 'start' $TaskName }
function Stop-ScheduledTask { param($TaskName) TaskCall 'stop' $TaskName }
function Disable-ScheduledTask { param($TaskName) TaskCall 'disable' $TaskName }
function Enable-ScheduledTask { param($TaskName) TaskCall 'enable' $TaskName }
function Copy-Item { param($LiteralPath,$Destination) if([IO.Path]::GetFileName($LiteralPath) -cne 'TongLoginRuntime.ps1'){throw 'TEST: unrelated copy forbidden'}; Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination }
function Get-CimInstance { throw 'TEST: ngrok process access forbidden' }
function Stop-Process { throw 'TEST: direct process stop forbidden' }
& ${quote(join(dir,'Install-TongLoginManagement.ps1'))} -Mode $Mode
`);
let result=run(join(dir,'harness.ps1'),['-Mode','prepare']);assert.equal(result.status,0,result.stderr);
assert.deepEqual((await readdir(preparation)).sort(),['TongLoginRuntime.ps1','TongLoginRuntime.review.xml','preparation.json']);
const task=JSON.parse(await readFile(join(preparation,'TongLoginRuntime.review.xml'),'utf16le').then(x=>x.replace(/^\uFEFF/,'')));
assert.equal(task.Principal.RunLevel,'Limited');assert.equal(task.Settings.MultipleInstances,'IgnoreNew');assert.equal(task.Settings.RestartCount,3);assert.equal(task.Settings.ExecutionTimeLimit.Ticks,0);
const managerPath=join(runtime,'releases','manager','scripts','TongAgentDockRuntime.mjs');
await writeFile(managerPath,manager.replace(',stopRunSupported:true',''));
result=run(join(dir,'harness.ps1'),['-Mode','install']);assert.notEqual(result.status,0);assert.match(result.stderr,/Pinned manager update required/);
await assert.rejects(readFile(taskFile),{code:'ENOENT'});
await writeFile(managerPath,manager);
// Hash tampering must be refused before any deployment or task registration.
const reviewed=await readFile(join(preparation,'TongLoginRuntime.ps1'));
await writeFile(join(preparation,'TongLoginRuntime.ps1'),Buffer.concat([reviewed,Buffer.from('\n# tamper')]));
result=run(join(dir,'harness.ps1'),['-Mode','install']);assert.notEqual(result.status,0);assert.match(result.stderr,/Reviewed preparation changed/);
await writeFile(join(preparation,'TongLoginRuntime.ps1'),reviewed);
await writeFile(registerFailure,'refuse');
result=run(join(dir,'harness.ps1'),['-Mode','install']);assert.notEqual(result.status,0);assert.match(result.stderr,/TEST: registration refused/);
const deployedRunner=join(runtime,'login-management','TongLoginRuntime.ps1');
await writeFile(deployedRunner,Buffer.concat([reviewed,Buffer.from('\n# unrelated change')]));
result=run(join(dir,'harness.ps1'),['-Mode','install']);assert.notEqual(result.status,0);assert.match(result.stderr,/Existing deployment differs/);
assert.ok((await readFile(deployedRunner,'utf8')).endsWith('# unrelated change'));
await writeFile(deployedRunner,reviewed);
// Only the fixture signal is moved; failed deployment evidence is retained.
const {rename}=await import('node:fs/promises');await rename(registerFailure,registerFailure+'.observed');
result=run(join(dir,'harness.ps1'),['-Mode','install']);assert.equal(result.status,0,result.stderr);
assert.deepEqual(await readdir(join(runtime,'login-management')),['TongLoginRuntime.ps1']);
result=run(join(dir,'harness.ps1'),['-Mode','rollback']);assert.equal(result.status,0,result.stderr);
const actions=(await readFile(taskCalls,'utf8')).trim().split('\n');assert.deepEqual(actions,['get','get','register','get','get','register','start','get','disable','stop']);
console.log(JSON.stringify({passed:true,shell,root,runnerCases:17,prepareInstallRollback:true,partialInstallRetry:true,reviewTamperRejected:true,noProductionMutation:true}));
