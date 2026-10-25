// Test-only adapter around the existing LegacyRecovery transaction. It cannot
// target production and does not create missing launcher/guardian receipts.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLegacyRecoveryRehearsal,incident,assessLegacyRecovery} from '../scripts/Tong024LegacyRecovery.mjs';
import {processIdentity,sameProcess,startupJobsState,runtimeProcessInventory} from '../scripts/TongRuntimeSecurity.mjs';
import {sha} from './fixtures/TongLoginRecoveryFixture.mjs';
const project=fileURLToPath(new URL('../',import.meta.url)),json=async p=>JSON.parse(await readFile(p,'utf8'));
const root=(await json(join(project,'artifacts/024-recovery/seven-file-prep-current.local.json'))).root;
assert.match(root,/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);assert.equal((await json(join(root,'seven-file-preparation.json'))).scope,'seven-file-preparation-isolation');
const old='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const be3='be3f5c49-d824-4edd-b8fc-7ee70d7f9a00',runs=[incident.oldRunId,incident.firstFailedRunId,incident.failedRunId,be3];
const be3Dir=join(old,'offline-9850e1a/production-state2-71f18ee9-734c-48d1-b550-129af5c5fb08/failed-attempt/run');
const controller=await json(join(root,'controller.json'));
assert.equal(controller.mutexHeld,true);assert.equal(sameProcess(await processIdentity(controller.pid),controller.identity),true);
if(process.argv[2]==='verify-retired'){
  const done=await json(join(root,'legacy-handoff-result.json'));
  assert.equal(done.passed,true);assert.equal(done.additionalFailedRequest,be3);
  for(const [name,v] of Object.entries(done.originals)){const p=join(done.retired,'retired',name);assert.equal(sha(await readFile(p)),v.sha256);assert.equal(String((await stat(p,{bigint:true})).ino),v.fileKey);if(name==='login-recovery-budget.json')assert.equal(sha(await readFile(join(root,'run',name))),v.sha256);else await assert.rejects(readFile(join(root,'run',name)),{code:'ENOENT'});}
  const g=await json(join(done.retired,'retired/guardian.json')),r=await json(join(done.retired,'retired/runtime.json')),expected=[g,r.supervisor,...r.children,...r.descendants];
  const inv=await runtimeProcessInventory({roots:[root],runIds:runs,pids:expected.map(x=>x.pid),mode:'production-simulation'});assert.equal(inv.complete,true);assert.equal(inv.matchingProcesses.length,0);
  for(const p of expected)assert.equal(sameProcess(inv.identities.find(a=>a.pid===p.pid),p),false);
  for(const id of runs)assert.deepEqual(await startupJobsState(id),{owner:0,launcher:0,guardian:0,runtime:0});
  const proof=(await json(join(done.retired,'snapshot.json'))).observation.latestFailedAttempt;
  for(const name of ['request','abort'])assert.equal(sha(await readFile(join(be3Dir,name+'.json'))),proof[name+'Sha256']);
  for(const role of ['launcher','guardian'])await assert.rejects(readFile(join(be3Dir,`${role}.${be3}.json`)),{code:'ENOENT'});
  const {assertPortUnused}=await import('../scripts/TongRuntimePort.mjs');for(const port of [7676,7677,18765,29675,29676,29677])await assertPortUnused(port);
  console.log(JSON.stringify({retiredReverified:true,root,originalsUnchanged:true,fourRunJobsEmpty:true,inventoryEmpty:true}));process.exit(0);
}
const originals={};
for(const name of ['runtime.json','guardian.json','request.json','abort.json','backup.freeze','stop.json','login-recovery-budget.json','stale-reconciliation.json']){
  try{const bytes=await readFile(join(old,'run',name));await writeFile(join(root,'run',name),bytes,{flag:'wx'});originals[name]={bytes,fileKey:String((await stat(join(root,'run',name),{bigint:true})).ino)};}catch(error){if(error.code!=='ENOENT')throw error;}
}
const runtime=JSON.parse(originals['runtime.json'].bytes),guardian=JSON.parse(originals['guardian.json'].bytes),request=JSON.parse(originals['request.json'].bytes),abort=JSON.parse(originals['abort.json'].bytes);
assert.equal(runtime.runId,incident.oldRunId);assert.equal(request.runId,incident.failedRunId);
const latest={request:await json(join(be3Dir,'request.json')),abort:await json(join(be3Dir,'abort.json'))};
assert.equal(latest.request.runId,be3);assert.equal(latest.abort.runId,be3);assert.equal(latest.abort.reason,'START_ABORT');assert.ok(Date.parse(latest.abort.requestedAt)>=Date.parse(latest.request.createdAt));
for(const role of ['launcher','guardian'])await assert.rejects(readFile(join(be3Dir,`${role}.${be3}.json`)),{code:'ENOENT'});
await writeFile(join(root,'runtime-synthetic.json'),JSON.stringify({scope:'024-legacy-recovery-simulation'}));
const expected=[guardian,runtime.supervisor,...runtime.children,...runtime.descendants];
let observations=0;
async function observation(){
  const inventory=await runtimeProcessInventory({roots:[root],runIds:runs,pids:expected.map(p=>p.pid),mode:'production-simulation'});assert.equal(inventory.complete,true);assert.equal(inventory.matchingProcesses.length,0);
  const identities=[];for(const p of expected){assert.equal(sameProcess(inventory.identities.find(actual=>actual.pid===p.pid),p),false);identities.push({...p,state:'gone'});}
  const allJobs=[];for(const id of runs){const jobs=await startupJobsState(id);assert.deepEqual(jobs,{owner:0,launcher:0,guardian:0,runtime:0});for(const [role,active] of Object.entries(jobs))allJobs.push({runId:id,role,active});}
  // The existing core has a deliberately fixed three-run incident identity.
  // Validate be3 independently, retain that extra proof in the sealed snapshot,
  // then pass only the original three runs to its unchanged strict predicate.
  for(const role of ['launcher','guardian'])await assert.rejects(readFile(join(be3Dir,`${role}.${be3}.json`)),{code:'ENOENT'});
  assert.deepEqual(await json(join(be3Dir,'request.json')),latest.request);assert.deepEqual(await json(join(be3Dir,'abort.json')),latest.abort);
  observations++;
  return {observedAt:new Date().toISOString(),lifecycleExclusive:true,monitorStopped:true,processInventoryComplete:true,matchingProcesses:[],identities,jobs:allJobs.filter(j=>j.runId!==be3),ports:[7676,7677,18765].map(port=>({port,free:true})),failedAttemptReceipts:'absent-legacy',latestFailedAttempt:{runId:be3,requestSha256:sha(await readFile(join(be3Dir,'request.json'))),abortSha256:sha(await readFile(join(be3Dir,'abort.json'))),receipts:'absent-legacy',jobs:allJobs.filter(j=>j.runId===be3),inventoryComplete:true,matchingProcesses:0}};
}
// Actual port observations, not the fixture booleans used by legacy unit tests.
const {assertPortUnused}=await import('../scripts/TongRuntimePort.mjs');
async function observe(){for(const port of [7676,7677,18765,29675,29676,29677])await assertPortUnused(port);return observation();}
const first=await observe();assert.deepEqual(assessLegacyRecovery({baselineCommit:incident.baselineCommit,runtime,guardian,request,abort,observation:first}),[]);
for(const mutate of [o=>o.processInventoryComplete=false,o=>o.matchingProcesses=[controller.identity],o=>o.jobs[0].active=1,o=>o.identities[0].state='alive',o=>o.monitorStopped=false,o=>o.lifecycleExclusive=false]){
  const bad=structuredClone(first);mutate(bad);assert.ok(assessLegacyRecovery({baselineCommit:incident.baselineCommit,runtime,guardian,request,abort,observation:bad}).length);
}
const create=()=>createLegacyRecoveryRehearsal({root,observe,confirm:async b=>({...b,kind:'simulation-only',expiresAt:Date.now()+30000})});
const tx=await create(),plan=await tx.prepare();await tx.retire();
for(const [name,value] of Object.entries(originals)){const physical=join(plan.archiveRoot,'retired',name);assert.equal(String((await stat(physical,{bigint:true})).ino),value.fileKey);assert.equal(sha(await readFile(physical)),sha(value.bytes));}
await tx.rollback();
const copies=join(root,'rollback-working-copies');await mkdir(copies);
for(const name of ['backup.freeze',...Object.keys(originals).filter(x=>x!=='backup.freeze')]){
  assert.equal(sha(await readFile(join(root,'run',name))),sha(originals[name].bytes));
  await rename(join(root,'run',name),join(copies,name));await rename(join(plan.archiveRoot,'retired',name),join(root,'run',name));
  assert.equal(String((await stat(join(root,'run',name),{bigint:true})).ino),originals[name].fileKey);
}
const finalTx=await create(),finalPlan=await finalTx.prepare();await finalTx.retire();
// Keep the real historical recovery budget as an identical working copy. The
// unchanged runner alone may subsequently age/append it; no reset is performed.
if(originals['login-recovery-budget.json'])await writeFile(join(root,'run/login-recovery-budget.json'),originals['login-recovery-budget.json'].bytes,{flag:'wx'});
for(const [name,value] of Object.entries(originals))assert.equal(String((await stat(join(finalPlan.archiveRoot,'retired',name),{bigint:true})).ino),value.fileKey);
for(const role of ['launcher','guardian'])for(const id of runs)await assert.rejects(readFile(join(root,'run',`${role}.${id}.json`)),{code:'ENOENT'});
const result={passed:true,root,retired:finalPlan.archiveRoot,seal:finalPlan.seal,originalCount:Object.keys(originals).length,originals:Object.fromEntries(Object.entries(originals).map(([name,v])=>[name,{sha256:sha(v.bytes),fileKey:v.fileKey}])),oldRunId:incident.oldRunId,oldFailedRequest:incident.failedRunId,additionalFailedRequest:be3,additionalReceiptAbsencePreserved:true,allFourRunsFourJobKindsObserved:true,observations,physicalOriginalsRetained:true,physicalOriginalRollbackVerified:true,budgetWorkingCopyIdentical:true,noReceiptsFabricated:true,productionExecutionAllowed:false};
await writeFile(join(root,'legacy-handoff-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
