import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir,rename,lstat,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {validateProductionProfile,runtimeApprovalStore} from '../scripts/TongProductionProfile.mjs';
import {processIdentity,sameProcess,startupJobsState,safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';
import {open024Handoff} from '../scripts/Tong024Handoff.mjs';

const [root,releaseMetadata,baselineCommit='34e26801876d8b1a2fc874dddce72b0939924e87']=process.argv.slice(2);
assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
assert.ok(releaseMetadata,'explicit verified release metadata required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const release=await readJson(releaseMetadata);
const manifest=await verifyRelease({releaseRoot:release.releaseRoot});assert.equal(manifest.commit,release.candidate);
assert.equal(sha(await readFile(join(release.releaseRoot,'release-manifest.json'))),release.releaseDigest);
const previous=validateProductionProfile(await readJson(join(root,'profile.json')));assert.equal(previous.mode,'production-simulation');assert.equal(previous.root,root);
assert.match(baselineCommit,/^[a-f0-9]{40}$/);
const oldPin=await readJson(join(root,'run/release-pin.json'));assert.equal(oldPin.commit,baselineCommit);
await verifyRuntimeCandidate(previous);await verifyRuntimeCandidate(previous,{manager:true,reviewedManagerProfile:{...previous,agentdockEnabled:false}});
const oldRecord=await readJson(join(root,'run/runtime.json')),oldGuardian=await readJson(join(root,'run/guardian.json'));
assert.equal(oldRecord.phase,'stopped');assert.ok(Object.values(await startupJobsState(oldRecord.runId)).every(value=>value===0));
for(const expected of [oldGuardian,oldRecord.supervisor,...oldRecord.children,...oldRecord.descendants]){const actual=await processIdentity(expected.pid);assert.ok(!actual||actual.exe&&/^\d+$/.test(actual.startTicks));assert.equal(sameProcess(actual,expected),false);}
const profile=validateProductionProfile({...previous,sourceDigest:release.sourceDigest,releaseDigest:release.releaseDigest});
await writeFile(join(root,'run/backup.freeze'),'',{flag:'wx'});
let lease=await open024Handoff(profile,{expectedSha256:sha('')});
const folder=lease.proof.folder,preimage=join(folder,'preimage');await mkdir(preimage);
console.log(JSON.stringify({event:'native_fixture_held',root,candidate:release.candidate,sessionId:lease.sessionId,folder,fileKey:lease.proof.fileKey}));
const entries=[];
async function snapshot(path,name,bytes){bytes??=await readFile(path);const to=join(preimage,...name.split('/'));await mkdir(dirname(to),{recursive:true});await writeFile(to,bytes,{flag:'wx'});const handle=await open(to,'r+');try{await handle.sync();}finally{await handle.close();}assert.equal(sha(await readFile(to)),sha(bytes));entries.push({path,name,size:bytes.length,sha256:sha(bytes)});}
for(const [label,target]of[['app',previous.codeRoot],['manager',previous.managerRoot]])for(const file of [...oldPin.sourceFiles,...oldPin.native])await snapshot(join(target,...file.path.split('/')),label+'/'+file.path);
await snapshot(join(root,'profile.json'),'state/profile.json');
for(const name of await readdir(join(root,'run')))if((await lstat(join(root,'run',name))).isFile())await snapshot(join(root,'run',name),'state/run/'+name,name==='backup.freeze'?await readFile(join(folder,'original.freeze')):undefined);
for(const name of await readdir(join(root,'secrets')))if((await lstat(join(root,'secrets',name))).isFile())await snapshot(join(root,'secrets',name),'state/secrets/'+name);
const approvalStore=runtimeApprovalStore(root),prefix='simulation-'+sha(root);
for(const name of await readdir(approvalStore))if(name.startsWith(prefix)&&name.endsWith('.dpapi.json'))await snapshot(join(approvalStore,name),'permissions/'+name);
const preimageBytes=Buffer.from(JSON.stringify({kind:'024-native-gate-fixture-preimage',root,baseline:oldPin.commit,candidate:release.candidate,entries},null,2));
await writeFile(join(folder,'preimage-manifest.json'),preimageBytes,{flag:'wx',flush:true});
console.log(JSON.stringify({event:'preimage_verified',entries:entries.length,preimageSha256:sha(preimageBytes),bytes:entries.reduce((n,e)=>n+e.size,0),not024Baseline:true}));

const commands=[];let login,grantIssued=false,monitor,monitorClosed,monitorOutput='',monitorError='';
const manager=join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs');
async function command(action,args=[]){const child=spawn(process.execPath,[manager,action,'--root',root,'--login-recovery','--error-json',...args],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill(),180000);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);const result={action,code,stdout,stderr};commands.push({action,code});await writeFile(join(folder,'command-'+commands.length+'.json'),JSON.stringify(result),{flag:'wx'});return {code,result:stdout.trim()?JSON.parse(stdout):null};}
try{
 const run=join(root,'run'),retired=join(folder,'retired-controls');await mkdir(retired);
 for(const name of await readdir(run))if(['runtime.json','guardian.json','request.json','abort.json','stop.json'].includes(name)||/^(launcher|guardian)\.[a-f0-9-]{36}\.json$/.test(name))await rename(join(run,name),join(retired,name));
 await lease.prove();
 // The same original file remains held during every copy and binding change.
 let copied=0;for(const target of [profile.codeRoot,profile.managerRoot])for(const file of manifest.sourceFiles){const to=join(target,...file.path.split('/'));await mkdir(dirname(to),{recursive:true});await copyFile(join(release.releaseRoot,'code/source',...file.path.split('/')),to);if(++copied%100===0){await lease.prove();await assert.rejects(open(join(run,'backup.freeze'),'wx'));}}
 for(const target of [profile.codeRoot,profile.managerRoot])for(const file of manifest.native)await copyFile(join(release.releaseRoot,'native',...file.path.split('/')),join(target,...file.path.split('/')));
 const pinBytes=await readFile(join(release.releaseRoot,'release-manifest.json'));
 for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(run,name),pinBytes);
 await writeFile(join(root,'profile.json'),JSON.stringify(profile));
 await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}});
 login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));
 await login.issueSimulationLoginRecovery(profile);grantIssued=true;
 const ordinary=await command('start');assert.equal(ordinary.code,1);assert.equal(ordinary.result.error,'RUNTIME_BUSY');
 const forged=await command('start',['--handoff-id',lease.sessionId]);assert.equal(forged.code,1);assert.equal(forged.result.error,'RUNTIME_OPERATION_REFUSED');
 await assert.rejects(lstat(join(run,'request.json')),{code:'ENOENT'});
 await lease.launch('start',{loginRecovery:true});
 const deadline=Date.now()+180000;let status;
 while(Date.now()<deadline){status=await lease.prove();if(status.exited)break;await new Promise(ok=>setTimeout(ok,500));}
 assert.ok(status.exited,'native Manager startup budget');assert.equal(status.exitCode,0,JSON.stringify({status,native:lease.diagnostics()}));
 const started=await readJson(join(run,'runtime.json'));assert.equal(started.phase,'ready');assert.equal(started.sourceCommit,release.candidate);assert.equal(started.managerCommit,release.candidate);assert.ok(status.active>=4);
 const doctor=await command('doctor');assert.equal(doctor.code,0);assert.equal(doctor.result.healthy,true);
 console.log(JSON.stringify({event:'native_start_ready',runId:started.runId,nativeJobActive:status.active,managerExitCode:status.exitCode,doctor:true}));
 const gateway=spawn(process.execPath,[new URL('./Test-Tong024HandoffGateway.mjs',import.meta.url).pathname.slice(1),root,release.candidate],{windowsHide:true,stdio:['ignore','pipe','pipe']});let gatewayOut='',gatewayErr='';gateway.stdout.on('data',b=>gatewayOut+=b);gateway.stderr.on('data',b=>gatewayErr+=b);const gatewayCode=await new Promise((ok,reject)=>{gateway.once('error',reject);gateway.once('close',ok);});await writeFile(join(folder,'gateway-result.json'),JSON.stringify({code:gatewayCode,stdout:gatewayOut,stderr:gatewayErr}),{flag:'wx'});assert.equal(gatewayCode,0,gatewayErr);console.log(gatewayOut.trim());
 const runnerSource=await readFile(join(profile.managerRoot,'scripts/TongLoginRuntime.ps1'),'utf8');
 const needle="                    $doctor=Runtime 'doctor'";assert.equal(runnerSource.split(needle).length,2);
 const runner=runnerSource.replace("$runtime='D:\\Tong\\runtime'","$runtime='"+root+"'").replace('Local\\TongLoginRuntime-','Local\\Tong024GateIsolation-'+lease.sessionId+'-').replace(needle,needle+"\n                    if($doctor.healthy){Write-RuntimeEvent 'handoff_periodic_health' $status ''}");
 const runnerPath=join(folder,'TongLoginRuntime.ps1');await writeFile(runnerPath,runner,{flag:'wx'});
 monitor=spawn(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',runnerPath,'-Mode','run'],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});monitor.stdout.on('data',b=>monitorOutput+=b);monitor.stderr.on('data',b=>monitorError+=b);monitorClosed=new Promise((ok,reject)=>{monitor.once('error',reject);monitor.once('close',ok);});
 const monitorDeadline=Date.now()+90000;let events=[];
 while(Date.now()<monitorDeadline){assert.equal(monitor.exitCode,null,'monitor exited: '+monitorError);try{events=(await readFile(join(root,'logs/login-management.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(e=>e.runnerPid===monitor.pid&&e.runId===started.runId);}catch(error){if(error.code!=='ENOENT')throw error;}if(events.some(e=>e.event==='handoff_periodic_health'))break;await new Promise(ok=>setTimeout(ok,500));}
 assert.ok(events.some(e=>e.event==='runtime_healthy')&&events.some(e=>e.event==='handoff_periodic_health'));
 const monitorIdentity=await processIdentity(monitor.pid);assert.ok(monitorIdentity?.exe&&monitorIdentity.startTicks);
 const completed=await lease.complete(started.runId,monitorIdentity);assert.equal(completed.phase,'completed');lease=null;
 await assert.rejects(lstat(join(run,'backup.freeze')),{code:'ENOENT'});
 const stopped=await command('stop-run',['--run-id',started.runId]);assert.equal(stopped.code,0);
 let timer;const monitorCode=await Promise.race([monitorClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MONITOR_STOP_TIMEOUT')),30000);})]).finally(()=>clearTimeout(timer));assert.equal(monitorCode,0,monitorError);
 await writeFile(join(folder,'monitor-result.json'),JSON.stringify({code:monitorCode,stdout:monitorOutput,stderr:monitorError,events}),{flag:'wx'});
 const restarted=await command('start');assert.equal(restarted.code,0);assert.equal(restarted.result.phase,'ready');assert.notEqual(restarted.result.runId,started.runId);
 const again=await command('doctor');assert.equal(again.code,0);assert.equal(again.result.healthy,true);
 assert.equal((await command('stop-run',['--run-id',restarted.result.runId])).code,0);
 assert.ok(Object.values(await startupJobsState(restarted.result.runId)).every(value=>value===0));await assert.rejects(lstat(join(run,'backup.freeze')),{code:'ENOENT'});
 const outcome={passed:true,root,folder,candidate:release.candidate,releaseDigest:release.releaseDigest,sourceDigest:release.sourceDigest,unrelatedAndForgedStartDenied:true,heldAcrossAllCopies:true,nestedGuardianAndSupervisorVerified:true,monitorInitialAndPeriodicHealth:true,monitorCode,normalStopRestart:true,noResidualFreeze:true,firstRunId:started.runId,restartedRunId:restarted.result.runId,commands,full024RollbackTested:false,productionExecutionAllowed:false};
 await writeFile(join(folder,'gate-outcome.json'),JSON.stringify(outcome,null,2),{flag:'wx'});console.log(JSON.stringify(outcome));
}catch(error){console.error(JSON.stringify({error:error.message,native:lease?.diagnostics(),root,folder,commands,preimageSha256:sha(preimageBytes),gatePreserved:true}));throw error;}
finally{if(lease)await lease.close();if(monitor&&monitor.exitCode===null&&monitor.signalCode===null){monitor.kill();await monitorClosed;}if(grantIssued)await login.revokeSimulationLoginRecovery(root);}
