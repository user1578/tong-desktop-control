import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,rename,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {open024Handoff,recover024Freeze} from '../scripts/Tong024Handoff.mjs';
import {runMaintenanceTransaction,resumeMaintenanceTransaction} from '../scripts/TongMaintenanceTransaction.mjs';
import {maintenanceFreeze,withMaintenanceFreeze} from '../scripts/TongLifecycleFreeze.mjs';
import {verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {issueSimulationApproval,recordApprovedEnabledState,readApprovedEnabledState,productionProfileDigest,runtimeApprovalStore} from '../scripts/TongProductionProfile.mjs';
import {processIdentity,sameProcess,startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';
import {restoreProductionStateBackup} from '../scripts/TongProductionState.mjs';

const [action,rootArgument,argument,stage]=process.argv.slice(2),root=rootArgument==='from-env'?process.env.TONG_024_HANDOFF_ROOT:rootArgument,sha=b=>createHash('sha256').update(b).digest('hex');
assert.match(root??'',/^D:\\Tong\\state\\b23-maint-native-[a-f0-9]{32}$/);
const json=async p=>JSON.parse(await readFile(p,'utf8')),metadata=join(root,'024-handoff-crash-fixture.json');
const txPath=join(root,'logs/maintenance-transaction.json'),script=fileURLToPath(import.meta.url);
if(action==='run'){
 const before=await json(join(root,'024-handoff-install-fixture.json')),release=await json(argument);
 await assert.rejects(lstat(txPath),{code:'ENOENT'});
 assert.equal((await verifyRuntimeCandidate(before.baselineProfile)).commit,'024d5b0920d9ad8f1a2baf2e55640a5666ad4739');
 assert.equal((await verifyRelease({releaseRoot:release.releaseRoot})).commit,release.candidate);
 const fx={...before,candidateProfile:{...before.baselineProfile,sourceDigest:release.sourceDigest,releaseDigest:release.releaseDigest},candidateCommit:release.candidate,releaseRoot:release.releaseRoot};
 for(const profile of [fx.candidateProfile,fx.baselineProfile]){
  for(const permission of ['backup','restore','start','stop','manager','enable-agentdock'])await issueSimulationApproval(permission==='manager'?{...profile,agentdockEnabled:false}:profile,permission,{expiresAt:new Date(Date.now()+3500000).toISOString()});
  const enabled=join(runtimeApprovalStore(root),productionProfileDigest(profile)+'.enabled.dpapi.json');
  try{await lstat(enabled);await readApprovedEnabledState(profile);}catch(error){if(error.code!=='ENOENT')throw error;await recordApprovedEnabledState(profile);}
 }
 try{await lstat(metadata);await rename(metadata,join(root,'024-handoff-crash-fixture-before-'+release.candidate.slice(0,7)+'-'+randomUUID()+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(metadata,JSON.stringify(fx),{flag:'wx'});
 const evidence=join(root,'024-handoff-crash-evidence-'+release.candidate.slice(0,7)+'-'+randomUUID());await mkdir(evidence);const results=[];
 async function invoke(action,stage){const child=spawn(process.execPath,[script,action,root,evidence,stage],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});await writeFile(join(evidence,stage+'-'+action+'.json'),JSON.stringify({code,stdout:out,stderr:err}),{flag:'wx'});results.push({stage,action,code,stdoutSha256:sha(out),stderrSha256:sha(err)});console.log(JSON.stringify({...results.at(-1),stdout:out,stderr:err}));return {code,events:out.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)};}
 const stages=stage?[stage]:['start-failure','controller-crash'];assert.ok(stages.every(s=>['start-failure','controller-crash'].includes(s)));
 for(const stage of stages){
  const installation=await invoke('install',stage);assert.equal(installation.code,71);
  const held=installation.events.find(e=>e.event==='installed_before_native_handoff');assert.ok(held);
  for(let n=0;n<100&&await processIdentity(held.holderPid);n++)await new Promise(ok=>setTimeout(ok,100));assert.equal(await processIdentity(held.holderPid),null);
  const child=spawn(process.execPath,[script,'control',root,evidence,stage],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stderr.on('data',b=>stderr+=b);const closed=new Promise(ok=>child.once('close',ok));
  let buffered='';const ready=new Promise((ok,reject)=>{child.stdout.on('data',b=>{output+=b;buffered+=b;let n;while((n=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,n);buffered=buffered.slice(n+1);const event=JSON.parse(line);if(event.event==='controller_ready'||event.event==='native_start_failure')ok(event);}});child.once('close',()=>reject(Error('NATIVE_CONTROLLER_REFUSED:'+stderr)));});
  let observed;try{observed=await ready;await writeFile(join(evidence,stage+'-proof.json'),JSON.stringify(observed),{flag:'wx'});if(stage==='controller-crash')child.kill();const code=await closed;results.push({stage,action:'control',code,signal:child.signalCode});await writeFile(join(evidence,stage+'-control.json'),JSON.stringify({code,signal:child.signalCode,stdout:output,stderr}),{flag:'wx'});}finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await closed;}}
  for(let n=0;n<100&&await processIdentity(observed.proof.owner.pid);n++)await new Promise(ok=>setTimeout(ok,100));assert.equal(await processIdentity(observed.proof.owner.pid),null);
  assert.equal((await invoke('recover',stage)).code,0);
  await rename(txPath,join(evidence,stage+'.restored-transaction.json'));
 }
 const outcome={passed:true,root,evidence,candidate:release.candidate,baselineCommit:'024d5b0920d9ad8f1a2baf2e55640a5666ad4739',results,nativeReadyTreeKilledOnControllerExit:stages.includes('controller-crash'),independentFreezeAndFullVersionRestore:true,productionExecutionAllowed:false};await writeFile(join(evidence,'outcome.json'),JSON.stringify(outcome,null,2),{flag:'wx'});console.log(JSON.stringify(outcome));
}else{
 const fx=await json(metadata),evidence=argument;assert.equal(fx.root,root);assert.equal(fx.baselineProfile.mode,'production-simulation');
 if(action==='install'){
  await runMaintenanceTransaction(fx,{onCheckpoint:async e=>{if(e.name==='starting'){const proof=await maintenanceFreeze(root).proof();console.log(JSON.stringify({event:'installed_before_native_handoff',transactionId:e.transactionId,holderPid:proof.holderPid}));process.exit(71);}}});
 }else if(action==='control'){
  let occupied;if(stage==='start-failure'){occupied=createServer();await new Promise((ok,reject)=>{occupied.once('error',reject);occupied.listen(fx.candidateProfile.gatewayPort,'127.0.0.1',ok);});}
  const lease=await open024Handoff(fx.candidateProfile,{expectedSha256:sha('')});await lease.launch('start');let status;
  const until=Date.now()+180000;while(Date.now()<until){status=await lease.prove();if(status.exited)break;await new Promise(ok=>setTimeout(ok,300));}assert.equal(status.exited,true);
  if(stage==='start-failure'){assert.equal(status.exitCode,1);assert.equal(status.active,0);await assert.rejects(lstat(join(root,'run/request.json')),{code:'ENOENT'});console.log(JSON.stringify({event:'native_start_failure',proof:lease.proof,status,actualOccupiedPort:fx.candidateProfile.gatewayPort}));await lease.close();occupied.close();}
  else{assert.equal(status.exitCode,0);const record=await json(join(root,'run/runtime.json'));assert.equal(record.phase,'ready');assert.equal(record.sourceCommit,fx.candidateCommit);assert.ok(status.active>=4);console.log(JSON.stringify({event:'controller_ready',proof:lease.proof,status,runId:record.runId}));setInterval(()=>{},1000);}
 }else if(action==='recover'){
  const observed=await json(join(evidence,stage+'-proof.json')),gate=await readFile(join(root,'run/backup.freeze'));
  const prior=JSON.parse(gate);assert.equal(prior.sessionId,observed.proof.sessionId);assert.equal(prior.profileDigest,productionProfileDigest(fx.candidateProfile));
  await recover024Freeze(fx.candidateProfile,{sessionId:prior.sessionId,snapshotSha256:observed.proof.snapshotSha256,gateSha256:sha(gate)});
  const tx=await json(txPath);
  if(stage==='controller-crash'){
   const bytes=await readFile(join(root,'run/request.json')),request=JSON.parse(bytes),record=await json(join(root,'run/runtime.json')),guardian=await json(join(root,'run/guardian.json'));
   assert.equal(request.handoff.sessionId,prior.sessionId);assert.equal(request.handoff.profileDigest,prior.profileDigest);assert.equal(request.runId,observed.runId);assert.equal(record.runId,observed.runId);assert.equal(record.sourceCommit,fx.candidateCommit);assert.equal(record.releaseDigest,fx.candidateProfile.releaseDigest);
   assert.ok(Object.values(await startupJobsState(record.runId)).every(n=>n===0));
   for(const expected of [guardian,record.supervisor,...record.children,...record.descendants])assert.equal(sameProcess(await processIdentity(expected.pid),expected),false);
   // This adapter imports the actually observed successful native run into the
   // old restorer's ledger. It never fabricates a Launcher/Guardian receipt.
   tx.candidateRunId=request.runId;tx.startedRunId=request.runId;tx.requestSha256=sha(bytes);tx.handoffEvidence={sessionId:prior.sessionId,snapshotSha256:observed.proof.snapshotSha256,nativeManagerExitCode:observed.status.exitCode};await writeFile(txPath,JSON.stringify(tx),{flush:true});
  }
  const restored=await resumeMaintenanceTransaction(fx.baselineProfile,{transactionId:tx.transactionId});assert.equal(restored.verified,true);
  const state=await withMaintenanceFreeze(fx.baselineProfile,{expectedSha256:sha('')},()=>restoreProductionStateBackup(fx.baselineProfile,{backupRoot:tx.backupRoot,restoreRoot:join(root,'024-native-state-restore-'+stage+'-'+tx.transactionId)}));assert.equal(state.encryptedBackup,true);
  console.log(JSON.stringify({event:'actual_independent_handoff_restore',workerPid:process.pid,stage,...restored,nativeDpapiRestore:true,restoredState:state.restoreRoot}));
 }else throw Error('ISOLATION_ACTION_DENIED');
}
