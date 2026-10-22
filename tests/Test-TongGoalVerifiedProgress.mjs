import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {TongGoalSupervisor} from "../scripts/TongGoalSupervisor.mjs";

const root=await mkdtemp(join(tmpdir(),"tong-verified-progress-"));
const project=join(root,"111");await mkdir(project);
const state=new Map(),starts=[],notices=[];
const session="native-session-for-progress";
const tasks={
  projectForExecution:async id=>({id,root:project}),
  async start(request,{parentGoalId}={}) {
    const n=starts.length+1;
    const taskId="child-"+n;
    assert.ok(parentGoalId);
    starts.push({request,parentGoalId,taskId});
    state.set(taskId,{taskId,status:"running",codexSessionId:session,
      updatedAt:"2026-10-22T00:00:00.000Z",
      progress:{phase:"executing",message:"Preparing task "+n,
        checklist:{kind:"verified-lifecycle",completedCount:2,totalCount:4}}});
    return {taskId,status:"running",codexSessionId:session};
  },
  async status(id){return state.get(id);},
  async result(id){return state.get(id);},
  async cancel(id){state.get(id).status="cancelled";},
};
const sup=new TongGoalSupervisor({tasks,statePath:join(root,"state.json"),pollMs:100,
  notifier:async notice=>{notices.push(notice);return true}});
async function until(fn,ms=4500) {
  const end=Date.now()+ms;
  while(Date.now()<end){const v=await fn();if(v)return v;await delay(15);}
  throw Error("Progress test timed out");
}
const steps=[
  {id:"one",title:"Analyze requirements",instruction:"Read-only check",
    verification:{type:"read-only-turn"}},
  {id:"two",title:"Verify implementation",instruction:"Read-only check again",
    verification:{type:"read-only-turn"}}
];
const spec=(key,steps)=>({projectId:"p0-homework-111",agent:"codex",goal:"Show verified progress",
  scope:"Synthetic project read-only checks",idempotencyKey:key,steps,maxRounds:4,
  maxAttemptsPerStep:1,roundTimeoutSeconds:120});
function resolveTurn(id,n) {
  const s=state.get(id);
  assert.ok(s);
  s.status="success";s.codexTurnId="native-turn-"+n;
  s.agentSummary="Codex says the turn completed";s.changedFiles=[];
  s.updatedAt="2026-10-22T00:00:0"+n+".000Z";
  s.progress={phase:"success",message:"Turn completed"};
}
try {
  const g=await sup.start(spec("progress-verified-two-rounds-001",steps));
  assert.equal(g.progress.completedCount,0);
  const running=await until(async()=>{
    const s=await sup.status(g.goalId);
    return s.activeTaskId?s:null;
  });
  assert.deepEqual(running.progress.steps.map(x=>x.state),["active","pending"]);
  assert.equal(running.progress.completedCount,0);
  assert.equal(running.progress.activeTurn.phase,"executing");
  assert.equal(running.progress.activeTurn.lifecycle.completedCount,2);
  assert.equal(running.progress.steps[0].proofLevel,null);
  assert.equal(running.progress.kind,"evidence-backed-steps");
  assert.equal(notices.length,0);
  const firstCursor=running.progress.cursor;
  assert.equal((await sup.status(g.goalId)).progress.cursor,firstCursor);
  const firstWatcher=sup.wait({goalId:g.goalId,afterCursor:firstCursor,waitSeconds:3});
  await delay(125);
  const first=state.get(running.activeTaskId);
  first.updatedAt="2026-10-22T00:00:00.500Z";
  first.progress={...first.progress,phase:"running-tests",message:"Tests are running"};
  const firstChanged=await firstWatcher;
  assert.equal(firstChanged.changed,true);
  assert.notEqual(firstChanged.goal.progress.cursor,firstCursor);
  assert.equal(firstChanged.goal.progress.activeTurn.phase,"running-tests");
  assert.equal(firstChanged.goal.progress.completedCount,0,
    "Agent activity and checklist completion must not be misread as accepted functionality");
  resolveTurn(running.activeTaskId,1);
  const halfway=await until(async()=>{
    const s=await sup.status(g.goalId);
    return s.stepIndex===1 && s.activeTaskId?s:null;
  });
  assert.deepEqual(halfway.progress.steps.map(x=>x.state),["technical-only","active"]);
  assert.equal(halfway.progress.completedCount,0,
    "A finished read-only Codex turn is not business acceptance");
  assert.equal(halfway.progress.technicalCheckCount,1);
  assert.equal(halfway.progress.steps[0].proofLevel,"workspace-metadata");
  assert.match(halfway.progress.steps[0].evidence.join(" "),/workspace-metadata-unchanged/);
  assert.equal(halfway.progress.steps[1].evidence.length,0);
  assert.equal(notices.length,0);
  resolveTurn(halfway.activeTaskId,2);
  const completed=await until(async()=>{
    const s=await sup.status(g.goalId);
    return s.status==="completed"?s:null;
  });
  assert.equal(completed.progress.completedCount,0);
  assert.equal(completed.progress.technicalCheckCount,2);
  assert.equal(completed.progress.businessComplete,false);
  assert.equal(completed.progress.acceptanceScope,"technical-only-or-pending-review");
  assert.deepEqual(completed.progress.steps.map(x=>x.state),["technical-only","technical-only"]);
  assert.equal(completed.progress.activeTurn,null);
  assert.deepEqual((await sup.wait({goalId:g.goalId,afterCursor:completed.progress.cursor,
    waitSeconds:1})).changed,false);
  await until(()=>notices.length===1);
  assert.equal(starts.length,2);
  assert.equal(starts[1].request.codexSessionId,session);
  assert.equal(notices.length,1);

  const review=await sup.start(spec("progress-needs-independent-review-002",[
    {id:"review",title:"Business acceptance",instruction:"Code work",
      verification:{type:"review-required"}}
  ]));
  const reviewActive=await until(async()=>{
    const s=await sup.status(review.goalId);
    return s.activeTaskId?s:null;
  });
  resolveTurn(reviewActive.activeTaskId,3);
  const waiting=await until(async()=>{
    const s=await sup.status(review.goalId);
    return s.status==="awaiting_review"?s:null;
  });
  assert.equal(waiting.progress.completedCount,0);
  assert.equal(waiting.progress.steps[0].state,"awaiting-review");
  assert.equal(waiting.progress.needsSupervisorReview,true);
  assert.equal(waiting.progress.needsUserAction,false);
  assert.equal(notices.length,1,"Internal review must not generate user completion notice");
  await sup.review({goalId:review.goalId,accepted:true,
    evidence:"Inspected independent code evidence and checked the defined acceptance criteria"});
  const approved=await until(async()=>{
    const s=await sup.status(review.goalId);return s.status==="completed"?s:null;
  });
  assert.equal(approved.progress.completedCount,1);
  assert.equal(approved.progress.businessComplete,true);
  assert.equal(approved.progress.acceptanceScope,"independently-reviewed");
  assert.equal(approved.progress.steps[0].proofLevel,"independent-review");

  // File presence can be checked, but is never displayed as a verified
  // implementation until a separate code-quality review step is accepted.
  await writeFile(join(project,"artifact.txt"),"fixture");
  const presence=await sup.start(spec("progress-file-presence-not-functional-003",[
    {id:"present",title:"Output exists",instruction:"Confirm generated file",
      verification:{type:"files-exist",paths:["artifact.txt"]}},
    {id:"acceptance",title:"Functional verification",instruction:"Review actual behavior",
      verification:{type:"review-required"}}
  ]));
  const presentRunning=await until(async()=>{
    const s=await sup.status(presence.goalId);
    return s.activeTaskId?s:null;
  });
  resolveTurn(presentRunning.activeTaskId,4);
  const presenceChecked=await until(async()=>{
    const s=await sup.status(presence.goalId);
    return s.stepIndex===1 && s.activeTaskId?s:null;
  });
  assert.equal(presenceChecked.progress.completedCount,0);
  assert.equal(presenceChecked.progress.technicalCheckCount,1);
  assert.equal(presenceChecked.progress.steps[0].state,"technical-only");
  assert.equal(presenceChecked.progress.steps[0].proofLevel,"file-presence-only");
  assert.equal(presenceChecked.progress.steps[1].state,"active");
  assert.equal(presenceChecked.progress.steps[1].proofLevel,null);
  resolveTurn(presenceChecked.activeTaskId,5);
  const awaitingAcceptance=await until(async()=>{
    const s=await sup.status(presence.goalId);
    return s.status==="awaiting_review"?s:null;
  });
  assert.equal(awaitingAcceptance.progress.completedCount,0,
    "A file existing is not functional acceptance");
  assert.equal(awaitingAcceptance.progress.steps[1].state,"awaiting-review");
  await sup.review({goalId:presence.goalId,accepted:true,
    evidence:"Independently verified the bounded fixture and expected outcomes"});
  await until(async()=> (await sup.status(presence.goalId)).status==="completed");

  // This is the actual production regression: Codex says it was unable to
  // check the directory, but the native turn itself terminated successfully.
  const refused=await sup.start(spec("progress-rejects-noncompletion-004",[
    {id:"inventory",title:"Directory contents",instruction:"Try read-only inventory",
      verification:{type:"read-only-turn"}},
    {id:"later",title:"Do not start",instruction:"Should never run",
      verification:{type:"read-only-turn"}}
  ]));
  const refusedActive=await until(async()=>{
    const s=await sup.status(refused.goalId);return s.activeTaskId?s:null;
  });
  resolveTurn(refusedActive.activeTaskId,6);
  state.get(refusedActive.activeTaskId).agentSummary=
    "第1/2步目录清点未完成：只读元数据工具被拒绝，无法核实文件名。";
  const refusedBlocked=await until(async()=>{
    const s=await sup.status(refused.goalId);return s.status==="blocked"?s:null;
  });
  assert.equal(refusedBlocked.blockedReason,"child-reported-incomplete");
  assert.equal(refusedBlocked.progress.completedCount,0);
  assert.equal(refusedBlocked.progress.technicalCheckCount,0);
  assert.equal(refusedBlocked.progress.steps[0].state,"blocked");
  assert.equal(starts.some(x=>x.request.task?.includes("Do not start")),false);
  assert.equal((await sup.result(refused.goalId)).rounds[0].status,"reported-incomplete");

  // A real policy-denial event also vetoes success even if agent prose omits it.
  const denied=await sup.start(spec("progress-policy-denial-veto-005",[
    {id:"denial",title:"Permission check",instruction:"Synthetic policy denial",
      verification:{type:"read-only-turn"}}
  ]));
  const deniedActive=await until(async()=>{
    const s=await sup.status(denied.goalId);return s.activeTaskId?s:null;
  });
  tasks.logs=async ({taskId,limit})=>{
    assert.equal(limit,100);
    return {entries:taskId===deniedActive.activeTaskId
      ? [{kind:"policy",message:"Approval request declined by policy: mcpServer/elicitation/request"}]
      : []};
  };
  resolveTurn(deniedActive.activeTaskId,7);
  const deniedBlocked=await until(async()=>{
    const s=await sup.status(denied.goalId);return s.status==="blocked"?s:null;
  });
  assert.equal(deniedBlocked.blockedReason,"child-policy-denied");
  assert.equal(deniedBlocked.progress.completedCount,0);
  assert.equal(deniedBlocked.progress.technicalCheckCount,0);

  await assert.rejects(sup.wait({goalId:g.goalId,afterCursor:"../secret"}),/Invalid goal progress watch/);
  await assert.rejects(sup.wait({goalId:g.goalId,waitSeconds:16}),/Invalid goal progress watch/);
  await assert.rejects(sup.wait({goalId:"unknown"}),/Invalid goal progress watch/);
  console.log("PASS: live Goal status and bounded watch distinguish Codex activity from independently checked steps.");
} finally {
  await sup.close();
  await rm(root,{recursive:true,force:true});
}
