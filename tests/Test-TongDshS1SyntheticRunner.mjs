import assert from 'node:assert/strict';
import {TongDshS1SyntheticRunner} from '../scripts/TongDshS1SyntheticRunner.mjs';

const request={
  projectId:'demo-project',taskId:'task1',projectRoot:'D:\\Projects\\Demo',
  prompt:'SYNTHETIC_ONLY_SHORT_TASK',scope:'simulated text only',
  sessionMode:'new',timeoutMs:1000,
};
let now=1000;
let count=0;
const backend=async input=>{
  count++;
  assert.equal(input.backend,'synthetic-only');
  assert.equal(input.protocol,'dsh-sdk-jsonrpc');
  assert.equal(input.prompt,request.prompt);
  return [
    {type:'session-open',sessionId:input.sessionId},
    {type:'message-enqueued',sessionId:input.sessionId,messageId:'message-1'},
    {type:'session-completed',sessionId:input.sessionId,response:'SIMULATION_OK'},
  ];
};
const runner=new TongDshS1SyntheticRunner({
  simulate:backend,now:()=>now,newId:()=> 'session-synthetic-1',
});
const approve=spec=>({
  syntheticApproval:true,projectId:spec.projectId,taskId:spec.taskId,
  scopeDigest:TongDshS1SyntheticRunner.syntheticDigest(spec),expiresAt:1500,
});
const created=await runner.runTask(request,{authorization:approve(request)});
assert.deepEqual(created,{
  status:'completed',sessionId:'session-synthetic-1',
  resumed:false,messageId:'message-1',
  text:'SIMULATION_OK',syntheticOnly:true,osIsolated:false,
});
assert.equal(count,1);
assert.ok(Object.isFrozen(created));
const resume={...request,taskId:'task2',sessionMode:'existing',
  sessionId:'session-synthetic-1'};
const resumed=await runner.runTask(resume,{authorization:approve(resume)});
assert.equal(resumed.sessionId,created.sessionId);
assert.equal(resumed.resumed,true);
assert.equal(count,2);
assert.equal(resumed.syntheticOnly,true);
await assert.rejects(runner.runTask({...resume,
  projectId:'other-project',taskId:'task9'},{authorization:approve({
    ...resume,projectId:'other-project',taskId:'task9'
  })}),/another project/);
await assert.rejects(runner.runTask({...resume,
  sessionId:'session-unknown'},{authorization:approve({
    ...resume,sessionId:'session-unknown'
  })}),/session missing/);
await assert.rejects(runner.runTask(request,{authorization:approve(request)}),
  /collision/);
await assert.rejects(runner.runTask(resume,{authorization:{
  ...approve(resume),scopeDigest:'0'.repeat(64),
}}),/approval denied/);
await assert.rejects(runner.runTask(resume,{authorization:{
  ...approve(resume),expiresAt:now-1,
}}),/approval denied/);
const badRequest={...resume,sessionId:'../../windows'};
await assert.rejects(runner.runTask(badRequest,{authorization:approve(badRequest)}),
  /invalid synthetic request/);
const invalidTask={...request,taskId:'task-new',projectRoot:'relative'};
await assert.rejects(runner.runTask(invalidTask,{authorization:approve(request)}),
  /invalid synthetic request/);
const missingApproval={...resume,taskId:'missing'};
await assert.rejects(runner.runTask(missingApproval),/approval denied/);

// An enqueue acknowledgment is not a completed assistant turn.
const queuedOnly=new TongDshS1SyntheticRunner({
  now:()=>now,newId:()=> 'new-session-only-queued',
  simulate:async args=>[
    {type:'session-open',sessionId:args.sessionId},
    {type:'message-enqueued',sessionId:args.sessionId,messageId:'msg1'},
  ],
});
const next={...request,taskId:'queued'};
await assert.rejects(queuedOnly.runTask(next,{authorization:approve(next)}),
  /not only enqueue/);
const swapped=new TongDshS1SyntheticRunner({
  now:()=>now,newId:()=> 'new-session-mismatch',
  simulate:async args=>[
    {type:'session-open',sessionId:'not-current'},
    {type:'message-enqueued',sessionId:args.sessionId,messageId:'msg2'},
    {type:'session-completed',sessionId:args.sessionId,response:'bad'},
  ],
});
const mismatch={...request,taskId:'mismatch'};
await assert.rejects(swapped.runTask(mismatch,{authorization:approve(mismatch)}),
  /exact native session/);

// Expiration is revalidated after simulated completion.
const late=new TongDshS1SyntheticRunner({
  now:()=>now,newId:()=> 'expired-session',
  simulate:async args=>{
    now=1501;
    return [
      {type:'session-open',sessionId:args.sessionId},
      {type:'message-enqueued',sessionId:args.sessionId,messageId:'msg3'},
      {type:'session-completed',sessionId:args.sessionId,response:'completed-too-late'},
    ];
  },
});
const expired={...request,taskId:'expiry'};
await assert.rejects(late.runTask(expired,{authorization:approve(expired)}),
  /approval denied or expired/);
now=1000;

// Cancellation must settle without waiting for synthetic backend cooperation.
const blocked=new TongDshS1SyntheticRunner({
  now:()=>now,newId:()=> 'pending-session',
  simulate:async()=>await new Promise(()=>{}),
});
const slow={...request,taskId:'slow',timeoutMs:1000};
const controller=new AbortController();
const pending=blocked.runTask(slow,{authorization:approve(slow),signal:controller.signal});
await Promise.resolve();
await assert.rejects(blocked.runTask(slow,{authorization:approve(slow)}),
  /already has a running/);
controller.abort();
await assert.rejects(pending,/cancelled|aborted/i);
const timeoutRunner=new TongDshS1SyntheticRunner({
  now:()=>now,newId:()=> 'timed-out-session',
  simulate:async()=>await new Promise(()=>{}),
});
const timeoutTask={...request,taskId:'timeout',timeoutMs:12};
await assert.rejects(timeoutRunner.runTask(timeoutTask,{authorization:approve(timeoutTask)}),
  /synthetic timeout/);

// These tests do not launch DSH, impersonate a Windows grant, or assert that
// the synthetic cancellation cleans real OS child processes.
console.log('PASS DSH S1: mocked new/resume, scoped digest/expiry, project exclusion, strict completion, cancel, timeout.');
