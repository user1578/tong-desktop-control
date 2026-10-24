import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const api=await import('../scripts/Tong024LegacyRecovery.mjs').catch(()=>({}));
assert.equal(typeof api.assessLegacyRecovery,'function','the legacy incident needs a separate recovery protocol');
const {assessLegacyRecovery,createLegacyRecoveryRehearsal,incident}=api;
const identity=pid=>({pid,exe:'D:\\node\\node.exe',startTicks:String(pid)});
const runtime={runId:incident.oldRunId,phase:'abnormal_exit',supervisor:identity(11),children:[identity(12)],descendants:[]};
const guardian={...identity(10),runId:incident.oldRunId,nodePid:11,finishedAt:'2026-10-23T01:51:05.356Z',jobAssigned:true,killOnJobClose:true,jobName:'Local\\TongRuntime-'+incident.oldRunId,jobActiveAfterCleanup:0};
const request={runId:incident.failedRunId,createdAt:'2026-10-23T10:55:13.368Z'};
const abort={runId:incident.failedRunId,requestedAt:'2026-10-23T10:55:28.390Z',reason:'START_ABORT'};
const observation={observedAt:new Date().toISOString(),lifecycleExclusive:true,monitorStopped:true,processInventoryComplete:true,matchingProcesses:[],
  identities:[10,11,12].map(pid=>({...identity(pid),state:'gone'})),
  jobs:[incident.oldRunId,incident.firstFailedRunId,incident.failedRunId].flatMap(runId=>['runtime','owner','launcher','guardian'].map(role=>({runId,role,active:0}))),
  ports:[7676,7677,18765].map(port=>({port,free:true})),failedAttemptReceipts:'absent-legacy'};
const evidence={baselineCommit:incident.baselineCommit,runtime,guardian,request,abort,observation};
assert.deepEqual(assessLegacyRecovery(evidence),[]);
for(const mutate of [e=>e.guardian.runId=e.request.runId,e=>e.abort.runId=e.runtime.runId,e=>e.request.runId=e.runtime.runId,e=>e.guardian.jobAssigned=false,
  e=>e.guardian.jobActiveAfterCleanup=1,e=>e.observation.identities.pop(),e=>e.observation.identities[0].state='alive',e=>e.observation.jobs.pop(),
  e=>e.observation.jobs[0].active=1,e=>e.observation.ports.pop(),e=>e.observation.ports[0].free=false,e=>e.observation.monitorStopped=false,
  e=>e.observation.lifecycleExclusive=false,e=>e.observation.failedAttemptReceipts='unknown',e=>e.observation.processInventoryComplete=false,
  e=>e.observation.matchingProcesses=[identity(33)],e=>e.observation.observedAt='2000-01-01T00:00:00Z']){
 const copy=structuredClone(evidence);mutate(copy);assert.ok(assessLegacyRecovery(copy).length,'incomplete proof must refuse');
}
const parent=await mkdtemp('D:\\Tong\\state\\legacy-024-');
async function fixture(name,options={}){
 const root=join(parent,name);await mkdir(root);await mkdir(join(root,'run'));
 await writeFile(join(root,'runtime-synthetic.json'),JSON.stringify({scope:'024-legacy-recovery-simulation'}));
 const values={'runtime.json':runtime,'guardian.json':guardian,'request.json':request,'abort.json':abort,'backup.freeze':null};
 const original={};for(const [name,value] of Object.entries(values)){const bytes=value===null?Buffer.alloc(0):Buffer.from(JSON.stringify(value));original[name]=bytes;await writeFile(join(root,'run',name),bytes);}
 await writeFile(join(root,'business-sentinel'),'unchanged');
 let current=structuredClone(observation),approve=true;
 const tx=await createLegacyRecoveryRehearsal({root,observe:async()=>({...current,observedAt:new Date().toISOString()}),confirm:async binding=>approve?(options.confirm?options.confirm(binding):{...binding,kind:'simulation-only',expiresAt:Date.now()+60000}):null,beforeMove:options.beforeMove,beforeRestore:options.beforeRestore});
 return {root,original,tx,setObservation:value=>{current=value;},deny:()=>{approve=false;}};
}
const good=await fixture('good');const plan=await good.tx.prepare();assert.equal(plan.productionExecutionAllowed,false);
assert.equal(plan.oldRunId,incident.oldRunId);assert.equal(plan.failedRunId,incident.failedRunId);
const result=await good.tx.retire();assert.equal(result.phase,'retired');
for(const name of Object.keys(good.original))await assert.rejects(readFile(join(good.root,'run',name)),{code:'ENOENT'});
const archived=await readdir(plan.archiveRoot);assert.ok(archived.includes('snapshot.json'));
for(const [name,bytes] of Object.entries(good.original))assert.deepEqual(await readFile(join(plan.archiveRoot,'original',name)),bytes);
assert.equal((await readdir(join(good.root,'run'))).some(name=>/launcher\.|guardian\./.test(name)),false,'never fabricate new protocol receipts');
await good.tx.rollback();for(const [name,bytes] of Object.entries(good.original))assert.deepEqual(await readFile(join(good.root,'run',name)),bytes);
assert.equal(await readFile(join(good.root,'business-sentinel'),'utf8'),'unchanged');
await assert.rejects(good.tx.retire(),/RECOVERY_STAGE_DENIED/);
const denied=await fixture('denied');await denied.tx.prepare();denied.deny();await assert.rejects(denied.tx.retire(),/RECOVERY_APPROVAL_REQUIRED/);
assert.equal((await readFile(join(denied.root,'run','backup.freeze'))).length,0);
for(const expiresAt of [undefined,'never',NaN,Infinity,0]){
 const invalid=await fixture('invalid-'+String(expiresAt),{confirm:binding=>({...binding,kind:'simulation-only',expiresAt})});
 await invalid.tx.prepare();await assert.rejects(invalid.tx.retire(),/RECOVERY_APPROVAL_REQUIRED/,'approval expiry must be a finite timestamp');
}
let move=0;
const interrupted=await fixture('interrupted',{beforeMove:()=>{if(++move===3)throw Error('SIMULATED_WRITE_FAILURE');}});
await interrupted.tx.prepare();await assert.rejects(interrupted.tx.retire(),/SIMULATED_WRITE_FAILURE/);
assert.equal((await readFile(join(interrupted.root,'run','backup.freeze'))).length,0,'partial retirement keeps start locked');
await interrupted.tx.rollback();for(const [name,value] of Object.entries(interrupted.original))assert.deepEqual(await readFile(join(interrupted.root,'run',name)),value);
let restores=0;
const retry=await fixture('restore-interrupted',{beforeRestore:()=>{if(++restores===2)throw Error('SIMULATED_RESTORE_FAILURE');}});
await retry.tx.prepare();await retry.tx.retire();await assert.rejects(retry.tx.rollback(),/SIMULATED_RESTORE_FAILURE/);
assert.equal(retry.tx.phase,'rollback-failed');assert.equal((await readFile(join(retry.root,'run','backup.freeze'))).length,0);
await retry.tx.rollback();for(const [name,value] of Object.entries(retry.original))assert.deepEqual(await readFile(join(retry.root,'run',name)),value);
const changed=await fixture('changed');await changed.tx.prepare();await writeFile(join(changed.root,'run','request.json'),'changed');await assert.rejects(changed.tx.retire(),/RECOVERY_CONFLICT/);
const live=await fixture('live');await live.tx.prepare();live.setObservation({...observation,matchingProcesses:[identity(44)]});await assert.rejects(live.tx.retire(),/RECOVERY_PROOF_REQUIRED/);
let duringConfirmation;
duringConfirmation=await fixture('confirmation-race',{confirm:binding=>{duringConfirmation.setObservation({...observation,monitorStopped:false});return {...binding,kind:'simulation-only',expiresAt:Date.now()+60000};}});
await duringConfirmation.tx.prepare();await assert.rejects(duringConfirmation.tx.retire(),/RECOVERY_PROOF_REQUIRED/);
const rebound=await fixture('wrong-approval-root',{confirm:binding=>({...binding,root:parent,kind:'simulation-only',expiresAt:Date.now()+60000})});
await rebound.tx.prepare();await assert.rejects(rebound.tx.retire(),/RECOVERY_APPROVAL_REQUIRED/);
const tampered=await fixture('tampered');const sealed=await tampered.tx.prepare();await writeFile(join(sealed.archiveRoot,'original','request.json'),'changed');await assert.rejects(tampered.tx.retire(),/RECOVERY_SNAPSHOT_CHANGED/);
const confirmTamper=await fixture('confirmation-tamper',{confirm:async binding=>{await writeFile(join(binding.archiveRoot,'original','request.json'),'changed-during-confirmation');return {...binding,kind:'simulation-only',expiresAt:Date.now()+60000};}});
await confirmTamper.tx.prepare();await assert.rejects(confirmTamper.tx.retire(),/RECOVERY_SNAPSHOT_CHANGED/);
const outside=join(parent,'outside');await mkdir(outside);
for(const target of ['run','retired']){
 const swapped=await fixture('junction-'+target);const prepared=await swapped.tx.prepare();const directory=target==='run'?join(swapped.root,'run'):join(prepared.archiveRoot,'retired');
 await rename(directory,directory+'-retained');await symlink(outside,directory,'junction');
 await assert.rejects(swapped.tx.retire(),/RECOVERY_PATH_DENIED/);assert.deepEqual(await readdir(outside),[],'path replacement must not write outside the reviewed directories');
}
const rollback=await fixture('rollback');await rollback.tx.prepare();await rollback.tx.retire();await writeFile(join(rollback.root,'run','request.json'),JSON.stringify({runId:'replacement'}));await assert.rejects(rollback.tx.rollback(),/RECOVERY_CONFLICT/);
await assert.rejects(createLegacyRecoveryRehearsal({root:'D:\\Tong\\runtime'}),/SIMULATION_ONLY/);
console.log(JSON.stringify({passed:true,parent,separateOldAndFailedIdentity:true,missingLegacyReceiptNotInvented:true,proofsRequired:true,approvalBound:true,confirmationReobserved:true,pathReplacementRefused:true,originalEvidencePreserved:true,partialRetirementRollback:true,partialRestoreRetry:true,rollbackVerified:true,productionExecutionAllowed:false}));
