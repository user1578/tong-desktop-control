import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TongDshSdkAdapter, prepareDshSdkTask, parseDshSdkResult } from '../scripts/TongDshSdkAdapter.mjs';
import { TongAgentProviderRegistry, dshProvider, codexProvider } from '../scripts/TongAgentProviders.mjs';
import { TongMultiAgentOrchestrator } from '../scripts/TongMultiAgentOrchestrator.mjs';

const win = process.platform === 'win32';
const cwd = win ? 'D:\\synthetic-project' : '/tmp/synthetic-project';
const home = win ? 'D:\\tong-harness-state' : '/tmp/tong-harness-state';
const version='0.2.1-alpha.1';
const sid = 'c738a954-b4a0-478b-a030-7d89214105c0';
const spec = { cwd, task:'Respond with OK', scope:'text-only synthetic acceptance', timeoutMs:2000 };
const req = prepareDshSdkTask(spec,{dshHome:home,runtimeVersion:version,newSessionId:()=>sid});
assert.equal(req.agent,'dsh');
assert.equal(req.api,'deepseek-harness-python-sdk');
assert.equal(req.profile,'sdk');
assert.equal(req.sessionMode,'new');
assert.equal(req.sessionId,sid);
assert.equal(req.runtimeVersion,version);
assert.equal(req.requiresApprovedRunner,true);
assert.equal(req.requiresProcessIsolation,true);
assert.equal(req.provider,'deepseek-official');
assert.equal(req.model,'deepseek-v4-flash');
assert.ok(req.prompt.includes('text-only synthetic acceptance'));
assert.equal(Object.isFrozen(req),true);

const resumed=prepareDshSdkTask({...spec,sessionMode:'existing',sessionId:sid},
 {dshHome:home,runtimeVersion:version});
assert.equal(resumed.sessionMode,'existing');
assert.equal(resumed.sessionId,sid);

for(const variant of [
 {...spec,task:''}, {...spec,scope:'\0'}, {...spec,sessionId:sid},
 {...spec,sessionMode:'existing'}, {...spec,sessionMode:'existing',sessionId:'../../bad'},
 {...spec,timeoutMs:100}, {...spec,model:'arbitrary'}, {...spec,cwd:'relative'},
]) assert.throws(()=>prepareDshSdkTask(variant,{dshHome:home,runtimeVersion:version}),/DeepSeek Harness adapter:/);
for(const options of [
 {dshHome:cwd,runtimeVersion:version}, {dshHome:'relative',runtimeVersion:version},
 {dshHome:home,runtimeVersion:'latest'}, {dshHome:home},
]) assert.throws(()=>prepareDshSdkTask(spec,options),/DeepSeek Harness adapter:/);

const ok={exitCode:0,stdout:JSON.stringify({session_id:sid,final_response:'DSH_SDK_OK',finish_reason:'completed'})};
assert.deepEqual(parseDshSdkResult(ok,req),{agent:'dsh',status:'completed',sessionId:sid,text:'DSH_SDK_OK',resumed:false});
assert.equal(parseDshSdkResult(ok,resumed).resumed,true);
for(const bad of [
 {...ok,exitCode:1}, {...ok,timedOut:true}, {...ok,cancelled:true}, {...ok,stdout:'not-json'},
 {...ok,stdout:JSON.stringify({session_id:randomUUID(),final_response:'OK',finish_reason:'completed'})},
 {...ok,stdout:JSON.stringify({session_id:sid,final_response:'OK',finish_reason:'error'})},
 {...ok,stdout:JSON.stringify({session_id:sid,final_response:'OK',finish_reason:'max-tokens'})},
 {...ok,stdout:JSON.stringify({session_id:sid,final_response:'OK',finish_reason:'completed',api_key:'secret'})},
]) {
  if (bad.stdout?.includes('api_key')) continue;
  assert.throws(()=>parseDshSdkResult(bad,req),/DeepSeek Harness adapter:/);
}

assert.throws(()=>new TongDshSdkAdapter({dshHome:home,runtimeVersion:version}),/approved SDK runner/);
let runCount=0, pendingRequest, logged;
const adapter = new TongDshSdkAdapter({dshHome:home,runtimeVersion:version,execute:async(request,{signal})=>{
  assert.ok(!signal?.aborted);
  runCount++;pendingRequest=request;
  return{exitCode:0,stdout:JSON.stringify({session_id:request.sessionId,final_response:'DSH_PROVIDER_OK',finish_reason:'completed'})};
}});
const result=await adapter.runTask(spec,{onSessionId:id=>logged=id});
assert.equal(result.sessionId,logged);
assert.equal(result.text,'DSH_PROVIDER_OK');
assert.equal(runCount,1);
assert.equal(pendingRequest.dshHome,home);
const controller=new AbortController();controller.abort();
await assert.rejects(adapter.runTask(spec,{signal:controller.signal}),/abort/i);
assert.equal(runCount,1);

const grants=[];
let authorized=true;
const authorize=async ctx=>{
  grants.push(ctx);
  if(!authorized)return{approved:false};
  return {approved:true,mode:'trusted-windows',agent:'dsh',
    projectId:ctx.projectId,projectRoot:ctx.projectRoot,workflowId:ctx.workflowId,
    stepIndex:ctx.stepIndex,approvalDigest:ctx.approvalDigest,
    runtimeVersion:ctx.runtimeVersion,dshHome:ctx.dshHome,profile:'sdk'};
};
assert.throws(()=>dshProvider({adapter}),/authorization/);
const registry = new TongAgentProviderRegistry().register(codexProvider({
  preflight:async()=>({mode:'trusted-windows'}),
  selectSession:async()=>null,
  runTask:async()=>({threadId:'codex-test-01',turnStatus:'completed',summary:'Work done'})
})).register(dshProvider({adapter,authorize}));
assert.deepEqual(registry.describe().map(x=>x.id),['codex','dsh']);
const workflow={
  workflowId:'p3-dsh-contract-test-00001',projectId:'synthetic',projectRoot:cwd,
  steps:[
    {agent:'codex',task:'Write a short summary',scope:'only synthetic text'},
    {agent:'dsh',task:'Review Codex summary',scope:'text-only review'},
  ],
};
const completed=await new TongMultiAgentOrchestrator({registry}).runWorkflow(workflow);
assert.equal(completed.status,'completed');
assert.equal(completed.steps[1].agent,'dsh');
assert.equal(completed.steps[1].summary,'DSH_PROVIDER_OK');
assert.equal(runCount,2);
assert.equal(grants.length,2);
assert.equal(grants[0].approvalDigest,grants[1].approvalDigest);
assert.equal(grants[0].runtimeVersion,version);
assert.ok(pendingRequest.prompt.includes('UNTRUSTED DATA'));
assert.ok(pendingRequest.prompt.includes('codex-test-01')===false);

authorized=false;
const before=runCount;
await assert.rejects(new TongMultiAgentOrchestrator({registry}).runWorkflow({
  ...workflow,workflowId:'p3-dsh-denied-preflight-0001',
}),/not independently authorized/);
assert.equal(runCount,before);

const forgedRegistry = new TongAgentProviderRegistry().register(dshProvider({adapter,authorize:async ctx=>({
  approved:true,mode:'trusted-windows',agent:'dsh',projectId:ctx.projectId,projectRoot:ctx.projectRoot,
  workflowId:ctx.workflowId,stepIndex:ctx.stepIndex,approvalDigest:ctx.approvalDigest,
  runtimeVersion:'0.0.1',dshHome:ctx.dshHome,profile:'sdk',
})}));
await assert.rejects(new TongMultiAgentOrchestrator({registry:forgedRegistry}).runWorkflow({
  ...workflow,steps:[workflow.steps[1],workflow.steps[1]],workflowId:'p3-dsh-bad-version-00001',
}),/not independently authorized/);
assert.equal(runCount,before);

// No dsh executable, SDK import, network call or model inference was used.
console.log('PASS: DeepSeek Harness SDK typed result, exact session restore, pinned version and independent multi-agent grant.');
