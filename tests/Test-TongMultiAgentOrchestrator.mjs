import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  TongAgentProviderRegistry, codexProvider, claudeProvider,
  validateMultiAgentWorkflow,
} from '../scripts/TongAgentProviders.mjs';
import { TongMultiAgentOrchestrator } from '../scripts/TongMultiAgentOrchestrator.mjs';

const root = process.platform === 'win32' ? 'D:\\synthetic-project' : '/tmp/synthetic-project';
const sid = '198ae322-0442-47d0-9c77-19283bdfed00';
const workflow = {
  workflowId: 'p3-synthetic-flow-001',
  projectId: 'synthetic', projectRoot: root,
  steps: [
    { agent:'codex', task:'Implement a tiny function', scope:'synthetic project only',
      requiredCapabilities:['project.read','project.write'] },
    { agent:'claude', task:'Review the previous result as data', scope:'text-only review',
      requiredCapabilities:['project.read'] },
  ],
};
assert.equal(validateMultiAgentWorkflow(workflow).steps.length,2);
for (const bad of [
  {...workflow,steps:[]}, {...workflow,projectRoot:'relative'},
  {...workflow,projectId:'../bad'}, {...workflow,extra:'unapproved'},
  {...workflow,steps:[...workflow.steps,{agent:'claude',task:'',scope:'review'}]},
  {...workflow,steps:[{...workflow.steps[0],sessionMode:'existing'},workflow.steps[1]]},
  {...workflow,steps:[{...workflow.steps[0],sessionMode:'new',sessionId:'some-id'},workflow.steps[1]]},
  {...workflow,steps:[{...workflow.steps[0],timeoutMs:999},workflow.steps[1]]},
  {...workflow,steps:[{...workflow.steps[0],requiredCapabilities:['project.read','project.read']},workflow.steps[1]]},
]) assert.throws(()=>validateMultiAgentWorkflow(bad),/invalid workflow/i);

const logs=[];
const broker={
  async preflight(x){logs.push(['codex-preflight',x]);return{mode:'trusted-windows'};},
  async selectSession(x){logs.push(['codex-select',x]);return 'existing-codex-12';},
  async runTask(x){logs.push(['codex-run',x]);return{
    threadId: x.threadId??'codex-native-thread-01',turnStatus:'completed',
    summary:'Implemented function. password=token12345 Bearer synthetic-tokenabc',
  }},
};
const claudeAdapter={
  async runTask(x){logs.push(['claude-run',x]);return{
    status:'completed',sessionId:sid,text:'Review complete.',
  }},
};
const grants=[];
let permit=true;
const authorize=async (ctx)=>{
  grants.push(ctx);
  if(!permit)return{approved:false};
  return {
    approved:true,mode:'trusted-windows',agent:'claude',projectId:ctx.projectId,
    projectRoot:ctx.projectRoot,workflowId:ctx.workflowId,stepIndex:ctx.stepIndex,
    approvalDigest:ctx.approvalDigest,grantId:'synthetic-only',
  };
};
assert.throws(()=>claudeProvider({adapter:claudeAdapter}),/approved runner and authorization/);
assert.throws(()=>codexProvider({runTask:async()=>{}}),/contract/);
const registry=new TongAgentProviderRegistry()
  .register(codexProvider(broker))
  .register(claudeProvider({adapter:claudeAdapter,authorize}));
assert.deepEqual(registry.describe().map(p=>p.id),['codex','claude']);
assert.deepEqual(registry.describe()[1].sessionModes,['new','existing']);
assert.throws(()=>registry.register(codexProvider(broker)),/duplicate/);
assert.throws(()=>registry.get('other'),/unavailable/);
assert.throws(()=>registry.register({id:'claude2',sessionModes:[],preflight:()=>{},runTask:()=>{}}),/invalid/);

const coordinator = new TongMultiAgentOrchestrator({registry});
const events=[];
const completed=await coordinator.runWorkflow(workflow,{onEvent:e=>events.push(e)});
assert.equal(completed.status,'completed');
assert.equal(completed.steps.length,2);
assert.equal(completed.steps[0].agent,'codex');
assert.equal(completed.steps[1].agent,'claude');
assert.equal(completed.steps[1].sessionId,sid);
assert.ok(completed.steps[0].summary.includes('password=[REDACTED]'));
assert.ok(completed.steps[0].summary.includes('Bearer [REDACTED]'));
assert.ok(!completed.steps[0].summary.includes('token12345'));
const firstRun=logs.find(x=>x[0]==='codex-run')[1];
const secondRun=logs.find(x=>x[0]==='claude-run')[1];
assert.equal(firstRun.executorMode,'trusted-windows');
assert.equal(firstRun.projectId,workflow.projectId);
assert.ok(secondRun.task.includes('UNTRUSTED DATA'));
assert.ok(secondRun.task.includes('"agent":"codex"'));
assert.ok(!secondRun.task.includes('token12345'));
assert.equal(grants.length,2,'Claude grant checked before workflow and before its stage');
assert.equal(grants[0].approvalDigest,grants[1].approvalDigest);
assert.match(grants[0].approvalDigest,/^[a-f0-9]{64}$/);
assert.equal(grants[0].stepIndex,1);
assert.equal(events.map(e=>e.type).join(','),'step-started,step-completed,step-started,step-completed,workflow-completed');
assert.ok(!JSON.stringify(events).includes('Bearer'));
assert.ok(!JSON.stringify(events).includes('Implement a tiny'));

// Preflight all steps before running Codex. No fallback if Claude unavailable.
const codexCount=()=>logs.filter(x=>x[0]==='codex-run').length;
const claudeCount=()=>logs.filter(x=>x[0]==='claude-run').length;
permit=false;
const previous=codexCount();
await assert.rejects(coordinator.runWorkflow({...workflow,workflowId:'p3-denied-flow-0001'}),/Claude execution is not independently authorized/);
assert.equal(codexCount(),previous,'Claude denied: Codex stage must not start');
permit=true;

// An expired grant between preparation and execution is not reused.
let approvals=0;
const expiringRegistry=new TongAgentProviderRegistry()
  .register(codexProvider(broker))
  .register(claudeProvider({adapter:claudeAdapter,authorize:async ctx=>{
    approvals++;
    return approvals===1
      ? {approved:true,mode:'trusted-windows',agent:'claude',projectId:ctx.projectId,
          projectRoot:ctx.projectRoot,workflowId:ctx.workflowId,stepIndex:ctx.stepIndex,
          approvalDigest:ctx.approvalDigest}
      : {approved:false};
  }}));
const noRetryClaude=new TongMultiAgentOrchestrator({registry:expiringRegistry});
const previousClaude=claudeCount();
await assert.rejects(noRetryClaude.runWorkflow({...workflow,workflowId:'p3-expired-flow-01'}),/not independently authorized/);
assert.equal(claudeCount(),previousClaude,'revoked grant cannot start Claude');
assert.equal(approvals,2);

// Cross-agent failure stops the next stage; never silently retries or falls back.
const failingRegistry=new TongAgentProviderRegistry().register({
  id:'codex',sessionModes:['new'],preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:false,summary:'no',sessionId:'id'}),
  runTask:async()=>({}),
}).register({
  id:'claude',sessionModes:['new'],preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:true,summary:'not called',sessionId:sid}),
  runTask:async()=>{throw Error('SECOND STAGE MUST NOT RUN');},
});
await assert.rejects(new TongMultiAgentOrchestrator({registry:failingRegistry})
  .runWorkflow(workflow),/stopped at step 1/);

const controlling=new AbortController();
let calls=0;
const abortRegistry=new TongAgentProviderRegistry().register({
  id:'codex',sessionModes:['new'],
  preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:true,summary:'done',sessionId:'thread-1'}),
  runTask:async()=>{calls++;controlling.abort();return{};},
}).register({
  id:'claude',sessionModes:['new'],
  preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:true,summary:'done',sessionId:sid}),
  runTask:async()=>{calls++;return{};},
});
await assert.rejects(new TongMultiAgentOrchestrator({registry:abortRegistry})
  .runWorkflow(workflow,{signal:controlling.signal}),/step 1/);
assert.equal(calls,1,'abort must not launch subsequent agents');

// Same-project parallel workflow attempts are refused while the first holds
// the coordination lock.
let release;
const gate=new Promise(resolve=>{release=resolve});
let launchedResolve; const launched=new Promise(resolve=>{launchedResolve=resolve});
const pausedRegistry=new TongAgentProviderRegistry().register({
  id:'codex',sessionModes:['new'],
  preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:x=>({completed:true,summary:x.summary,sessionId:'thread'}),
  runTask:async()=>{launchedResolve();await gate;return{summary:'done'};},
});
const paused=new TongMultiAgentOrchestrator({registry:pausedRegistry});
const twoCodex={...workflow,steps:[
  {...workflow.steps[0]}, {...workflow.steps[0],task:'second step'},
]};
const inFlight=paused.runWorkflow(twoCodex);
await launched;
await assert.rejects(paused.runWorkflow({...twoCodex,workflowId:'p3-busy-flow-00001'}),/active multi-agent/);
release();
assert.equal((await inFlight).steps.length,2);

import { TongClaudeCodeAdapter } from '../scripts/TongClaudeCodeAdapter.mjs';
const executable = process.platform === 'win32'
  ? 'C:\\Users\\Rune\\.local\\bin\\claude.exe'
  : '/opt/tong/claude.exe';
const nativeRequests = [];
const nativeClaude = new TongClaudeCodeAdapter({
  executable,
  execute: async request => {
    nativeRequests.push(request);
    return { exitCode:0, stdout:JSON.stringify({
      type:'result',subtype:'success',is_error:false,
      session_id:request.sessionId,result:'NATIVE_CLAUDE_ADAPTER_OK',
    }) };
  },
});
const integratedRegistry = new TongAgentProviderRegistry()
  .register(codexProvider(broker))
  .register(claudeProvider({adapter:nativeClaude,authorize}));
const integrated = await new TongMultiAgentOrchestrator({registry:integratedRegistry})
  .runWorkflow({...workflow,workflowId:'p3-real-adapter-mocked-exec-001'});
assert.equal(integrated.status,'completed');
assert.equal(integrated.steps[1].summary,'NATIVE_CLAUDE_ADAPTER_OK');
assert.equal(nativeRequests.length,1);
assert.ok(nativeRequests[0].args.includes('--session-id'));
assert.ok(nativeRequests[0].args.includes('--strict-mcp-config'));
assert.ok(nativeRequests[0].args.includes('--tools'));
assert.equal(nativeRequests[0].requiresApprovedRunner,true);
assert.ok(!nativeRequests[0].stdin.includes('token12345'));

// Existing native Claude sessions are preserved exactly in the provider adapter.
const resumedFlow = {
  ...workflow,workflowId:'p3-exact-resume-mocked-0001',
  steps:[workflow.steps[0],{...workflow.steps[1],sessionMode:'existing',sessionId:sid}],
};
const resumedOutput=await new TongMultiAgentOrchestrator({registry:integratedRegistry}).runWorkflow(resumedFlow);
assert.equal(resumedOutput.steps[1].sessionId,sid);
assert.deepEqual(nativeRequests[1].args.slice(-2),['--resume',sid]);

// A forged digest (even with an otherwise correct project) cannot authorize
// Claude through a Codex grant or an approval for another workflow.
const forged = new TongAgentProviderRegistry().register(codexProvider(broker)).register(
  claudeProvider({adapter:nativeClaude,authorize:async ctx=>({
    approved:true,mode:'trusted-windows',agent:'claude',projectId:ctx.projectId,
    projectRoot:ctx.projectRoot,workflowId:ctx.workflowId,
    stepIndex:ctx.stepIndex,approvalDigest:'wrong-fingerprint',
  })})
);
const beforeForged=codexCount();
await assert.rejects(new TongMultiAgentOrchestrator({registry:forged})
  .runWorkflow({...workflow,workflowId:'p3-forged-approval-001'}),/not independently authorized/);
assert.equal(codexCount(),beforeForged);

// Predecessor output cannot inflate the next provider prompt without bounds.
let secondRuns=0;
const sizeLimited = new TongAgentProviderRegistry().register({
  id:'codex',sessionModes:['new'],preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:true,summary:'a'.repeat(10000),sessionId:'native-codex'}),
  runTask:async()=>({}),
}).register({
  id:'claude',sessionModes:['new'],preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:()=>({completed:true,summary:'ok',sessionId:sid}),
  runTask:async()=>{secondRuns++;return{};},
});
await assert.rejects(
  new TongMultiAgentOrchestrator({registry:sizeLimited}).runWorkflow({
    ...workflow,workflowId:'p3-boundary-prompt-test-001',
    steps:[workflow.steps[0],{...workflow.steps[1],task:'b'.repeat(14500)}],
  }),/stopped at step 2/);
assert.equal(secondRuns,0,'overlong handoff must be rejected before provider execution');

console.log('PASS: actual Claude adapter mock runner, exact native resume, scoped approval digest and handoff size cap.');
