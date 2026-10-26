// Real native timeout/cancel probes in the existing stopped synthetic root.
// Stage stalls/early child exits use the real readiness IPC tests separately.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runtimeProcessInventory} from '../scripts/TongRuntimeSecurity.mjs';
const root='D:\\Tong\\state\\b23-login-70f1b7d66215458c8ffa0d822348de0f';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const profile=await json(join(root,'profile.json'));assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,root);
const module=name=>import(pathToFileURL(join(profile.managerRoot,'scripts',name)));
const runtime=await module('TongAgentDockRuntime.mjs'),login=await module('TongLoginRecovery.mjs'),security=await module('TongRuntimeSecurity.mjs');
const directory=join(root,'startup-failures-'+randomUUID().replaceAll('-',''));await mkdir(directory);
async function save(path,value){const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx'});await rename(temporary,path);}
async function gone(runId){
 const launcher=await json(join(root,'run',`launcher.${runId}.json`));assert.equal(launcher.preflightClean,true);assert.ok(launcher.finishedAt);
 for(const identity of [launcher.launcher,launcher.preflight?.child,launcher.guardian].filter(Boolean))assert.equal(security.sameProcess(await security.processIdentity(identity.pid),identity),false);
 assert.deepEqual(await security.startupJobsState(runId),{owner:0,launcher:0,guardian:0,runtime:0});
 const inventory=await runtimeProcessInventory({roots:[root],runIds:[runId],mode:profile.mode});assert.equal(inventory.complete,true);
 const self=await security.processIdentity(process.pid);
 assert.equal(inventory.matchingProcesses.filter(p=>!security.sameProcess(p,self)).length,0);
 return {fourJobsEmpty:true,exactOriginalIdentitiesGone:true,completeInventoryEmpty:true,launcherFailure:launcher.failure};
}
const budgetBefore=await readFile(join(root,'run/login-recovery-budget.json'));
await login.issueSimulationLoginRecovery(profile);
const results=[];
try{
 for(const mode of ['startup-total-timeout','native-cancel']){
  const began=Date.now();let runId,cancelled=false,observerError;
  const watch=mode==='native-cancel'?setInterval(()=>{void (async()=>{
   if(cancelled)return;
   const request=await json(join(root,'run/request.json'));if(Date.parse(request.createdAt)<began)return;
   let receipt;try{receipt=await json(join(root,'run',`launcher.${request.runId}.json`));}catch(error){if(error.code==='ENOENT')return;throw error;}
   if(receipt.stage!=='preflight'||!receipt.preflight?.child)return;
   cancelled=true;runId=request.runId;
   await save(join(root,'run/abort.json'),{runId,requestedAt:new Date().toISOString(),reason:'ISOLATED_CANCEL_TEST'});
  })().catch(error=>{observerError=error;});},50):null;
  let error;
  try{await login.withLoginRecovery(root,'start',()=>runtime.startRuntime(root,{startupTimeoutMs:mode==='startup-total-timeout'?4000:30000}));}
  catch(value){error=value;}
  finally{clearInterval(watch);}
  if(observerError)throw observerError;
  assert.ok(error,'startup must refuse');assert.equal(error.startupFailure.cleanup.proven,true);
  const request=await json(join(root,'run/request.json'));runId??=request.runId;
  assert.equal(request.runId,runId);
  const configured=mode==='startup-total-timeout'?4000:30000;
  // deadline is sampled just before UUID/createdAt, so the later timestamp can
  // be a millisecond smaller than the configured window. It may never extend it.
  assert.ok(request.startupDeadline>=began+configured&&request.startupDeadline-Date.parse(request.createdAt)>0&&request.startupDeadline-Date.parse(request.createdAt)<=configured);
  const cleanup=await gone(runId);
  if(mode==='startup-total-timeout'){
   assert.equal(error.startupFailure.code,'START_TIMEOUT');assert.ok(['START_TIMEOUT','START_ABORT'].includes(cleanup.launcherFailure.code),'Manager deadline may publish abort before the native deadline poll');
   const events=(await readFile(join(root,'logs/lifecycle.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
   assert.equal(events.find(e=>e.runId===runId&&e.event==='startup_failure'&&e.timeoutKind==='startup_total'&&e.budgetMs).budgetMs,configured);
  }
  else{assert.equal(cancelled,true);assert.equal(cleanup.launcherFailure.code,'START_ABORT');}
  assert.ok(Date.now()-began<90000,'a short failure never consumes the new 180s cap');
  assert.deepEqual(await readFile(join(root,'run/login-recovery-budget.json')),budgetBefore,'direct synthetic failure probes cannot reset or consume runner budget');
  results.push({mode,runId,elapsedMs:Date.now()-began,failure:error.startupFailure,cleanup});
 }
}finally{await login.revokeSimulationLoginRecovery(root);await writeFile(join(directory,'results.json'),JSON.stringify({results,productionChanged:false},null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({passed:true,root,directory,results,budgetUnchanged:true,productionChanged:false}));
