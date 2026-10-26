// Finite fault injection: real IPC children inherit the wrapper's native Job.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {waitForChildReadiness} from '../../scripts/TongAgentDockRuntime.mjs';
const [mode,output]=process.argv.slice(2);
if(mode==='child'){
 process.once('message',value=>{
  if(value==='early-exit')process.exit(7);
  if(value==='stage-stall')for(const stage of ['settings_received','approval_verified','candidate_verified','config_loaded','log_protection_ready','server_import_begin'])process.send({event:'stage',stage});
  setInterval(()=>{},1000);
 });
}else{
 const results=[];let failed;
 try{
 for(const fault of ['stage-stall','early-exit','cancel']){
  const child=fork(fileURLToPath(import.meta.url),['child'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  const closed=once(child,'close');const controller=new AbortController(),began=Date.now();let timer;
  const waiting=waitForChildReadiness(child,{role:'devspace',preserved:true,began,startupDeadline:began+180000,signal:controller.signal});
  child.send(fault);if(fault==='cancel')timer=setTimeout(()=>controller.abort(),1000);
  let failure;
  try{await waiting;}catch(error){failure=error;}finally{clearTimeout(timer);if(child.exitCode===null)child.kill();await closed;}
  assert.ok(failure);assert.equal(failure.message,{'stage-stall':'CHILD_STAGE_TIMEOUT','early-exit':'CHILD_EXIT',cancel:'START_ABORTED'}[fault]);
  if(fault==='stage-stall'){assert.equal(failure.readiness.stage,'server_import_begin');assert.ok(failure.readiness.stageDurationMs>=30000&&failure.readiness.stageDurationMs<32000);}
  if(fault==='early-exit')assert.equal(failure.readiness.exitCode,7);
  assert.ok(Date.now()-began<33000);assert.equal(child.listenerCount('message'),0);assert.ok(child.exitCode!==null||child.signalCode!==null,'closed Windows child may report a terminating signal');
  results.push({fault,wallMs:Date.now()-began,code:failure.message,readiness:failure.readiness,childClosed:true,ipcHandlersRemoved:true});
 }
 }catch(error){failed=String(error.stack??error);process.exitCode=1;}
 await writeFile(output,JSON.stringify({passed:!failed,results,...(failed?{failure:failed}:{}),productionChanged:false},null,2)+'\n',{flag:'wx'});
}
