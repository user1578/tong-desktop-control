import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath,rename,open} from 'node:fs/promises';
import {resolve,relative,join,sep,isAbsolute} from 'node:path';

// A separate, offline rehearsal of this incident. Normal startup never imports
// it. No task, ACL, approval signer, production entrypoint or process control.
export const incident=Object.freeze({baselineCommit:'024d5b0920d9ad8f1a2baf2e55640a5666ad4739',oldRunId:'74cd4ad3-f21b-40ec-96f5-3f9015649e5d',firstFailedRunId:'bee3d9d4-1dd9-4ed6-80d1-07a2b7e11bdd',failedRunId:'d348ae39-27cf-4167-8e35-58de75421309'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const identity=value=>Number.isSafeInteger(value?.pid)&&value.pid>0&&isAbsolute(value.exe??'')&&/^\d+$/.test(value.startTicks??'');
const same=(a,b)=>identity(a)&&identity(b)&&a.pid===b.pid&&a.exe.toLowerCase()===b.exe.toLowerCase()&&a.startTicks===b.startTicks;
export function assessLegacyRecovery({baselineCommit,runtime,guardian,request,abort,observation:o}={}){
 const failures=[];
 if(baselineCommit!==incident.baselineCommit||runtime?.runId!==incident.oldRunId||guardian?.runId!==incident.oldRunId||request?.runId!==incident.failedRunId||abort?.runId!==incident.failedRunId)failures.push('INCIDENT_IDENTITY_MISMATCH');
 if(!['stopped','abnormal_exit'].includes(runtime?.phase)||!identity(runtime?.supervisor)||!Array.isArray(runtime?.children)||!Array.isArray(runtime?.descendants)||!identity(guardian)||guardian.nodePid!==runtime?.supervisor?.pid||!guardian.finishedAt||guardian.jobAssigned!==true||guardian.killOnJobClose!==true||guardian.jobName!==`Local\\TongRuntime-${incident.oldRunId}`||guardian.jobActiveAfterCleanup!==0)failures.push('OLD_RUN_CLEANUP_UNPROVEN');
 if(abort?.reason!=='START_ABORT'||!Number.isFinite(Date.parse(request?.createdAt))||!Number.isFinite(Date.parse(abort?.requestedAt))||Date.parse(abort.requestedAt)<Date.parse(request.createdAt))failures.push('FAILED_ATTEMPT_UNBOUND');
 const age=Date.now()-Date.parse(o?.observedAt);
 if(!Number.isFinite(age)||age< -5000||age>30000||o?.lifecycleExclusive!==true||o.monitorStopped!==true||o.processInventoryComplete!==true||!Array.isArray(o.matchingProcesses)||o.matchingProcesses.length)failures.push('LIVE_OBSERVATION_REQUIRED');
 const owned=[guardian,runtime?.supervisor,...(Array.isArray(runtime?.children)?runtime.children:[]),...(Array.isArray(runtime?.descendants)?runtime.descendants:[])];
 if(!Array.isArray(o?.identities)||o.identities.some(value=>!identity(value)||value.state!=='gone')||owned.some(value=>!identity(value)||!o?.identities?.some(found=>same(value,found))))failures.push('PROCESS_PROOF_REQUIRED');
 const roles=['runtime','owner','launcher','guardian'],runs=[incident.oldRunId,incident.firstFailedRunId,incident.failedRunId];
 if(!Array.isArray(o?.jobs)||o.jobs.some(value=>value.active!==0||!roles.includes(value.role)||!runs.includes(value.runId))||runs.some(runId=>roles.some(role=>o?.jobs?.filter(value=>value.runId===runId&&value.role===role&&value.active===0).length!==1)))failures.push('JOB_PROOF_REQUIRED');
 if(!Array.isArray(o?.ports)||o.ports.some(value=>value.free!==true)||[7676,7677,18765].some(port=>o?.ports?.filter(value=>value.port===port&&value.free===true).length!==1))failures.push('PORT_PROOF_REQUIRED');
 // Missing legacy receipts are recorded as missing, never converted into a
 // negative creation receipt or accepted by the normal startup protocol.
 if(o?.failedAttemptReceipts!=='absent-legacy')failures.push('LEGACY_RECEIPT_OBSERVATION_REQUIRED');
 return failures;
}
async function ordinary(path,directory=false){
 const info=await lstat(path);
 if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()||info.nlink!==1)||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())fail('RECOVERY_PATH_DENIED');
 return info;
}
async function bytes(path){await ordinary(path);return readFile(path);}
async function absent(path){try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
const required=['runtime.json','guardian.json','request.json','abort.json','backup.freeze'];
const optional=['stop.json','login-recovery-budget.json','stale-reconciliation.json'];
export async function createLegacyRecoveryRehearsal({root,observe,confirm,beforeMove=async()=>{},beforeRestore=async()=>{}}){
 const state=resolve('D:\\Tong\\state');
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||root.toLowerCase()===state.toLowerCase()||!root.toLowerCase().startsWith(state.toLowerCase()+sep))fail('SIMULATION_ONLY');
 async function checkRoot(){
  let parent=state;await ordinary(parent,true);
  for(const name of relative(state,root).split(sep)){parent=join(parent,name);await ordinary(parent,true);}
  const marker=JSON.parse(await bytes(join(root,'runtime-synthetic.json')));if(marker.scope!=='024-legacy-recovery-simulation')fail('SIMULATION_ONLY');
  await ordinary(join(root,'run'),true);
 }
 await checkRoot();
 if(typeof observe!=='function'||typeof confirm!=='function')fail('RECOVERY_ADAPTER_REQUIRED');
 let phase='new',archiveRoot,seal,original,manifest,sequence=0;
 const moved=new Set();
 async function checkArchive(){await checkRoot();await ordinary(archiveRoot,true);await ordinary(join(archiveRoot,'original'),true);await ordinary(join(archiveRoot,'retired'),true);}
 async function lease(action){
  await checkRoot();
  const handle=await open(join(root,'legacy-rehearsal.lock'),'wx');
  try{return await action();}finally{await handle.close();await checkRoot();await rename(join(root,'legacy-rehearsal.lock'),join(root,'legacy-rehearsal-'+randomUUID()+'.closed'));}
 }
 async function journal(event){await checkArchive();await writeFile(join(archiveRoot,String(++sequence).padStart(3,'0')+'-'+event+'.json'),JSON.stringify({kind:'offline-legacy-recovery',event,phase,seal,oldRunId:incident.oldRunId,failedRunId:incident.failedRunId}),{flag:'wx'});}
 async function proof(){
  const observation=await observe();const evidence={baselineCommit:incident.baselineCommit,...Object.fromEntries(['runtime','guardian','request','abort'].map(key=>[key,JSON.parse(original[key+'.json'])])),observation};
  if(assessLegacyRecovery(evidence).length)fail('RECOVERY_PROOF_REQUIRED');
  for(const role of ['launcher','guardian'])if(!await absent(join(root,'run',role+'.'+incident.failedRunId+'.json')))fail('RECOVERY_CONFLICT');
  return observation;
 }
 async function approved(action){
  const binding={action,root,archiveRoot,seal,oldRunId:incident.oldRunId,failedRunId:incident.failedRunId};
  const receipt=await confirm(binding);
  if(receipt?.kind!=='simulation-only'||!Number.isSafeInteger(receipt.expiresAt)||receipt.expiresAt<=Date.now()||receipt.expiresAt>Date.now()+300000||Object.entries(binding).some(([key,value])=>receipt[key]!==value))fail('RECOVERY_APPROVAL_REQUIRED');
 }
 async function verifyArchive(){
  await checkArchive();
  if(sha(await bytes(join(archiveRoot,'snapshot.json')))!==seal)fail('RECOVERY_SNAPSHOT_CHANGED');
  for(const file of manifest.files)if(sha(await bytes(join(archiveRoot,'original',file.name)))!==file.sha256)fail('RECOVERY_SNAPSHOT_CHANGED');
 }
 return {
  get phase(){return phase;},
  async prepare(){return lease(async()=>{
   if(phase!=='new')fail('RECOVERY_STAGE_DENIED');
   original={};for(const name of required)original[name]=await bytes(join(root,'run',name));
   for(const name of optional)if(!await absent(join(root,'run',name)))original[name]=await bytes(join(root,'run',name));
   if(original['backup.freeze'].length!==0)fail('RECOVERY_CONFLICT');
   const observation=await proof();await checkRoot();
   archiveRoot=join(root,'legacy-evidence-'+randomUUID());await mkdir(archiveRoot);await mkdir(join(archiveRoot,'original'));await mkdir(join(archiveRoot,'retired'));
   for(const [name,value] of Object.entries(original))await writeFile(join(archiveRoot,'original',name),value,{flag:'wx'});
   manifest={schemaVersion:1,kind:'024-legacy-recovery-simulation',root,...incident,observation,files:Object.entries(original).map(([name,value])=>({name,size:value.length,sha256:sha(value)}))};
   const encoded=Buffer.from(JSON.stringify(manifest));seal=sha(encoded);await writeFile(join(archiveRoot,'snapshot.json'),encoded,{flag:'wx'});phase='prepared';await journal('prepared');
   return {phase,seal,archiveRoot,oldRunId:incident.oldRunId,failedRunId:incident.failedRunId,productionExecutionAllowed:false};
  });},
  async retire(){return lease(async()=>{
   if(phase!=='prepared')fail('RECOVERY_STAGE_DENIED');
   await verifyArchive();await proof();await approved('retire-legacy-control-records');await verifyArchive();await proof();
   for(const [name,value] of Object.entries(original))if(sha(await bytes(join(root,'run',name)))!==sha(value))fail('RECOVERY_CONFLICT');
   phase='retiring';await journal('retiring');
   try{
    // Keep the real start/freeze gate present until every old control record is
    // retained. A future production adapter must also hold the lifecycle mutex.
    for(const name of [...Object.keys(original).filter(name=>name!=='backup.freeze'),'backup.freeze']){
     await beforeMove(name);await checkArchive();if(sha(await bytes(join(root,'run',name)))!==sha(original[name]))fail('RECOVERY_CONFLICT');
     await rename(join(root,'run',name),join(archiveRoot,'retired',name));moved.add(name);
    }
    phase='retired';await journal('retired');return {phase,productionExecutionAllowed:false};
   }catch(error){phase='failed';await journal('failed');throw error;}
  });},
  async rollback(){return lease(async()=>{
   if(!['retired','failed','rollback-failed'].includes(phase))fail('RECOVERY_STAGE_DENIED');
   await verifyArchive();await proof();await approved('restore-legacy-control-records');await verifyArchive();await proof();
   // Any new request/runtime or third-party edit is a conflict, never a target
   // for rollback. Restore the freeze first before exposing any old record.
   for(const [name,value] of Object.entries(original)){
    const path=join(root,'run',name);
    if(moved.has(name)){if(!await absent(path)||sha(await bytes(join(archiveRoot,'retired',name)))!==sha(value))fail('RECOVERY_CONFLICT');}
    else if(sha(await bytes(path))!==sha(value))fail('RECOVERY_CONFLICT');
   }
   phase='rolling-back';
   try{
    await journal('rolling-back');
    for(const name of ['backup.freeze',...Object.keys(original).filter(name=>name!=='backup.freeze')])if(moved.has(name)){
     await beforeRestore(name);await checkArchive();if(!await absent(join(root,'run',name)))fail('RECOVERY_CONFLICT');
     // wx refuses a new writer between the preceding check and restoration.
     await writeFile(join(root,'run',name),original[name],{flag:'wx'});moved.delete(name);
    }
    phase='rolled-back';await journal('rolled-back');return {phase,productionExecutionAllowed:false};
   }catch(error){phase='rollback-failed';try{await journal('rollback-failed');}catch{}throw error;}
  });}
 };
}
