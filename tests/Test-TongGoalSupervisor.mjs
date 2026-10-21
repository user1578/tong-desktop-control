import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TongGoalSupervisor } from "../scripts/TongGoalSupervisor.mjs";

const root=await mkdtemp(join(tmpdir(),"tong-goal-supervisor-"));
const project=join(root,"project");await mkdir(project);
const store=join(root,"goals.json");
const sessions=[];
const starts=[];
const notifications=[];
const state=new Map();
let failVerificationOnce=false;
const tasks={
  projectForExecution:async id=>({id,root:project}),
  async start(req,opts) {
    starts.push({req,opts});
    const taskId="task-"+starts.length;
    const threadId=req.codexSessionId ?? "native-thread-for-project";
    sessions.push(threadId);
    const item={taskId,status:"success",codexSessionId:threadId,codexTurnId:"turn-"+starts.length,
      agentSummary:"A bounded synthetic Codex task completed.",changedFiles:[],gitAvailable:false};
    state.set(taskId,item);
    return item;
  },
  async status(id){return state.get(id)},
  async result(id){return state.get(id)},
  async cancel(id){const task=state.get(id);if(task)task.status="cancelled";return task}
};
const supervisor=new TongGoalSupervisor({tasks,statePath:store,pollMs:100,
  notifier:async notice=>{notifications.push(notice);return true}});
async function until(fn,ms=3500) {
  const end=Date.now()+ms;
  while(Date.now()<end) {
    const v=await fn();if(v)return v;
    await new Promise(r=>setTimeout(r,15));
  }
  throw Error("Timed out waiting for goal state");
}
function spec(key,steps) {
  return {projectId:"p0-homework-111",agent:"codex",goal:"Finish the whole validation",
    scope:"Read only project checks, no writes except fixtures",idempotencyKey:key,
    steps,maxRounds:6,maxAttemptsPerStep:2,roundTimeoutSeconds:120};
}
const readStep=id=>({id,title:id,instruction:"Report current directory, do not alter anything",
  verification:{type:"read-only-turn"}});
try {
  const firstRequest={...spec("test-goal-multi-round-one",[readStep("check"),readStep("summarize")]),
    requiredCapabilities:["project.read","codex.session"],workType:"development"};
  const first=await supervisor.start(firstRequest);
  const done=await until(async()=>{const s=await supervisor.status(first.goalId);return s.status==="completed"?s:null});
  assert.equal(done.roundCount,2,"Two internal Codex turns belong to one goal");
  assert.equal(done.steps.filter(s=>s.status==="completed").length,2);
  assert.equal(notifications.length,1,"Only completed goal sends a single notification");
  assert.equal(starts.length,2);
  assert.equal(starts[0].req.sessionMode,"new");
  assert.deepEqual(starts[0].req.requiredCapabilities,["project.read","codex.session"]);
  assert.equal(starts[0].req.workType,"development");
  assert.equal(starts[1].req.sessionMode,"existing");
  assert.equal(starts[1].req.codexSessionId,"native-thread-for-project");
  assert.ok(starts.every(x=>x.opts.parentGoalId===first.goalId),
    "Each internal turn is linked to the same parent goal");
  assert.equal((await supervisor.start(firstRequest)).goalId,first.goalId);
  const listing=await supervisor.list();
  assert.equal(listing.goals.length,1);
  assert.equal(listing.goals[0].goalId,first.goalId);
  assert.equal("goal" in listing.goals[0],false,"list must not disclose goal instructions");
  assert.equal("steps" in listing.goals[0],false,"list must not disclose verification paths");
  await assert.rejects(supervisor.start(spec("test-goal-multi-round-one",[readStep("different")])),/idempotency conflict/);
  await assert.rejects(supervisor.start({...spec("goal-unsafe-capabilities-001",[readStep("inspect")]),
    requiredCapabilities:["git.push","git.push"]}),/Invalid supervised goal/);
  const report=await supervisor.result(first.goalId);
  assert.equal(report.report.rounds.length,2);
  assert.equal(report.report.nativeSessionId,"native-thread-for-project");

  const pending=await supervisor.start(spec("test-goal-explicit-review",[
    {id:"review",title:"Need actual review",instruction:"Do only requested work",
      verification:{type:"review-required"}}
  ]));
  const reviewNeeded=await until(async()=>{const s=await supervisor.status(pending.goalId);return s.status==="awaiting_review"?s:null});
  assert.equal(reviewNeeded.needsSupervisorReview,true);
  assert.equal(reviewNeeded.needsUserAction,false);
  assert.equal(reviewNeeded.reviewStepId,"review");
  assert.equal(notifications.length,1,"internal independent review is not a user interruption");
  await assert.rejects(supervisor.review({goalId:pending.goalId,accepted:true,evidence:"short"}),/Invalid independent goal review/);
  await supervisor.review({goalId:pending.goalId,accepted:true,
    evidence:"Independently inspected the files and confirmed the scoped acceptance checks"});
  const reviewed=await until(async()=>{const s=await supervisor.status(pending.goalId);return s.status==="completed"?s:null});
  assert.equal(reviewed.steps[0].status,"completed");
  await until(()=>notifications.length===2);
  assert.equal(notifications.length,2,"review approval completes the whole goal and notifies once");
  let resolveChild;
  tasks.start=async (req,opts)=>{
    starts.push({req,opts});const taskId="task-hold";
    state.set(taskId,{taskId,status:"running",codexSessionId:"native-active"});
    resolveChild=()=>{
      state.set(taskId,{taskId,status:"success",codexSessionId:"native-active",
        codexTurnId:"turn-active",agentSummary:"done",changedFiles:[]});
    };
    return {taskId,status:"running"};
  };
  const active=await supervisor.start(spec("test-goal-resume-after-restart",[readStep("active")]));
  await until(()=>Boolean(resolveChild));
  await supervisor.close();
  assert.equal(notifications.length,2,"Closing a process does not notify or claim completion");
  // Persisted active child must be consulted; supervisor must not create a duplicate.
  const restore=new TongGoalSupervisor({tasks,statePath:store,pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true}});
  resolveChild();
  const revived=await until(async()=>{const s=await restore.status(active.goalId);return s.status==="completed"?s:null});
  assert.equal(revived.roundCount,1);
  assert.equal(starts.filter(v=>v.req.idempotencyKey===starts.at(-1).req.idempotencyKey).length,1);
  assert.equal(notifications.length,3);
  await restore.close();

  let mutationAttempts=0;
  const modifyingTasks={...tasks,
    start:async () => {
      mutationAttempts++;
      await writeFile(join(project,"unwanted.txt"),"a change that violates the read-only step");
      state.set("mutating-task",{taskId:"mutating-task",status:"success",
        codexSessionId:"native-mutating",codexTurnId:"turn-mutating",
        agentSummary:"I finished the task",changedFiles:[]});
      return {taskId:"mutating-task",status:"success"};
    },
  };
  const mutationCheck=new TongGoalSupervisor({
    tasks:modifyingTasks,statePath:join(root,"mutation.json"),pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true},
  });
  const bad=await mutationCheck.start(spec("test-readonly-detects-writes",[readStep("pure")]));
  const blockedChange=await until(async()=>{
    const s=await mutationCheck.status(bad.goalId);
    return s.status==="blocked"?s:null;
  });
  assert.match(blockedChange.blockedReason,/read-only-workspace-changed/,
    "a Codex self-reported success cannot override an observed file modification");
  assert.equal(mutationAttempts,1,"unsafe write must stop retries");
  await mutationCheck.close();

  const cancelStore=join(root,"cancel.json");
  let activeCancelTask=null;
  const cancellingTasks={
    projectForExecution:async id=>({id,root:project}),
    async start() {
      activeCancelTask={taskId:"cancel-child",status:"running"};
      return activeCancelTask;
    },
    async status() {return activeCancelTask;},
    async result(){throw Error("Cancelled goal must never inspect child result");},
    async cancel(){activeCancelTask.status="cancelled";return activeCancelTask;},
  };
  const beforeCancelNotices=notifications.length;
  const cancelling=new TongGoalSupervisor({tasks:cancellingTasks,statePath:cancelStore,pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true}});
  const cancelGoal=await cancelling.start(spec("goal-cancel-remains-terminal",[readStep("cancel")]));
  await until(async()=>(await cancelling.status(cancelGoal.goalId)).activeTaskId);
  const stopped=await cancelling.cancel(cancelGoal.goalId);
  assert.equal(stopped.status,"cancelled");
  await new Promise(r=>setTimeout(r,200));
  assert.equal((await cancelling.status(cancelGoal.goalId)).status,"cancelled",
    "late child state updates must not reopen a cancelled goal");
  assert.equal(notifications.length,beforeCancelNotices+1);
  assert.equal(notifications.at(-1).status,"cancelled");
  await cancelling.close();

  let pausedChild=null;
  let pausedStarts=0;
  let pausedResumes=0;
  const pausedTasks={
    projectForExecution:async id=>({id,root:project}),
    async start() {
      pausedStarts++;
      pausedChild={taskId:"paused-child",status:"waiting_user_action",
        codexSessionId:"native-paused",resumeAvailable:true};
      return pausedChild;
    },
    async status() {return pausedChild;},
    async result() {return {...pausedChild,codexTurnId:"turn-resumed",
      agentSummary:"The original native turn continued and completed.",changedFiles:[]};},
    async resume() {pausedResumes++;pausedChild.status="success";return pausedChild;},
    async cancel(){pausedChild.status="cancelled";return pausedChild;},
  };
  const resumeNotices=notifications.length;
  const pausing=new TongGoalSupervisor({tasks:pausedTasks,statePath:join(root,"resume.json"),pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true}});
  const resumedGoal=await pausing.start(spec("goal-recover-same-native-turn",[readStep("resume")]));
  const blockedGoal=await until(async()=>{
    const s=await pausing.status(resumedGoal.goalId);
    return s.status==="blocked"?s:null;
  });
  assert.equal(blockedGoal.activeTaskId,"paused-child");
  await assert.rejects(pausing.resume("not-a-goal"),/Goal not found/);
  const continuing=await pausing.resume(resumedGoal.goalId);
  assert.equal(continuing.status,"running");
  const completedResume=await until(async()=>{
    const s=await pausing.status(resumedGoal.goalId);
    return s.status==="completed"?s:null;
  });
  assert.equal(completedResume.roundCount,1);
  assert.equal(pausedStarts,1,"resume must not create a second Codex task or session");
  assert.equal(pausedResumes,1);
  assert.equal(completedResume.nativeSessionId,"native-paused");
  assert.equal(notifications.length,resumeNotices+2,"only blocker and final completion notify");
  await pausing.close();

  let releaseLateStart;
  let cancelledChildCount=0;
  const lateTasks={
    projectForExecution:async id=>({id,root:project}),
    async start() {return new Promise(resolve=>{releaseLateStart=()=>resolve({taskId:"late-child",status:"queued"});});},
    async status(){return {taskId:"late-child",status:"running"};},
    async result(){throw Error("Cancelled launch must never read a result");},
    async cancel(id){assert.equal(id,"late-child");cancelledChildCount++;return {taskId:id,status:"cancelled"};},
  };
  const lateSupervisor=new TongGoalSupervisor({tasks:lateTasks,statePath:join(root,"late-launch.json"),pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true}});
  const lateGoal=await lateSupervisor.start(spec("cancel-during-child-creation",[readStep("launch")]));
  await until(()=>Boolean(releaseLateStart));
  const beforeLateNotify=notifications.length;
  assert.equal((await lateSupervisor.cancel(lateGoal.goalId)).status,"cancelled");
  releaseLateStart();
  await until(()=>cancelledChildCount===1);
  assert.equal((await lateSupervisor.status(lateGoal.goalId)).roundCount,0,
    "cancelled goals cannot adopt an in-flight child created after cancellation");
  assert.equal(notifications.length,beforeLateNotify+1);
  await lateSupervisor.close();

  let capacityStarts=0;
  const providerCapacityTasks={
    projectForExecution:async id=>({id,root:project}),
    async start(req) {
      capacityStarts++;
      const status=capacityStarts===1?"failed":"success";
      return {taskId:"capacity-"+capacityStarts,status,
        codexSessionId:"native-capacity-session",codexTurnId:"capacity-turn-"+capacityStarts,
        agentSummary:status==="success"?"Verified read-only status":null,
        error:status==="failed"?{message:"Selected model is at capacity. Please try a different model."}:null};
    },
    async status(id) {
      const n=Number(id.slice(-1)),status=n===1?"failed":"success";
      return {taskId:id,status,codexSessionId:"native-capacity-session",
        codexTurnId:"capacity-turn-"+n,
        agentSummary:status==="success"?"Verified read-only status":null,
        error:status==="failed"?{message:"Selected model is at capacity. Please try a different model."}:null};
    },
    async result(id){return this.status(id);},
    async cancel(id){return {taskId:id,status:"cancelled"};}
  };
  const beforeCapacityNotices=notifications.length;
  const capacitySupervisor=new TongGoalSupervisor({
    tasks:providerCapacityTasks,statePath:join(root,"capacity.json"),pollMs:100,
    notifier:async notice=>{notifications.push(notice);return true}});
  const cap=await capacitySupervisor.start({...spec("goal-retry-known-capacity-only",[readStep("retry")]),
    maxRounds:2,maxAttemptsPerStep:2});
  const capDone=await until(async()=>{const s=await capacitySupervisor.status(cap.goalId);return s.status==="completed"?s:null},9500);
  assert.equal(capDone.roundCount,2);
  assert.equal(capacityStarts,2);
  assert.equal((await capacitySupervisor.result(cap.goalId)).rounds[0].status,"transient-capacity-retry");
  assert.equal(notifications.length,beforeCapacityNotices+1,
    "transient failure must not notify until the entire goal is completed");
  await capacitySupervisor.close();

  for (const path of ["../escape","..\\private","C:/abs","CON","nested/../escape","nested//file","trailing.","bad\u0000name"]) {
    await assert.rejects(supervisor.start({
      ...spec("unsafe-goal-relative-"+Buffer.from(path).toString("hex"),[
        {id:"check",title:"Check",instruction:"Inspect",verification:{type:"files-exist",paths:[path]}}
      ])
    }),/Invalid supervised goal|Invalid supervised goal verification paths|File existence is not final code acceptance/);
  }
  await assert.rejects(supervisor.start(spec("file-presence-not-code-validation",[
    {id:"check",title:"Check",instruction:"Inspect",verification:{type:"files-exist",paths:["output.txt"]}}
  ])),/File existence is not final code acceptance/);
  await assert.rejects(supervisor.start(spec("file-presence-unknown-params",[
    {id:"check",title:"Check",instruction:"Inspect",verification:{type:"files-exist",paths:["output.txt"],externalPath:"../bad"}},
    {id:"review",title:"Review",instruction:"Independently verify",verification:{type:"review-required"}}
  ])),/Invalid supervised goal verification paths/);
  console.log("PASS: goal supervisor persists multi-turn sessions, notifies once, detects write violations, requires independent review, validates paths and resumes without duplicate dispatch.");
} finally {
  await rm(root,{recursive:true,force:true});
}