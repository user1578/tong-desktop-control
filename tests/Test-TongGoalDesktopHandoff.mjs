import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {TongAgentTaskManager} from "../scripts/TongAgentTasks.mjs";
import {TongGoalSupervisor} from "../scripts/TongGoalSupervisor.mjs";

// Integration test: real TaskManager + real GoalSupervisor, synthetic Codex
// executor. No Codex binaries, production policy, real projects or UI.
const root=await mkdtemp(join(tmpdir(),"tong-goal-desktop-handoff-"));
const project=join(root,"111");await mkdir(project);
const opened=[],notices=[],turns=[];
const sid="01a15ecd-c7e7-76d2-88f3-bef00176bf14";
let releaseFirst,firstReady=false;
const manager=new TongAgentTaskManager({
  statePath:join(root,"tasks.json"),notifyOnCompletion:true,
  notifyTask:async info=>{notices.push({source:"child",...info});return true;},
  openDesktopThread:async thread=>{opened.push({source:"child",thread,afterTurns:turns.length});return true;},
  access:{
    authorize:async(mode,id)=>mode==="agent.execute"&&id==="p0-homework-111",
    listProjects:async()=>[{id:"p0-homework-111",root:project,status:"enabled",available:true}],
  },
  workerBroker:{
    preflight:async()=>({mode:"trusted-windows",authorization:{mode:"project-development",capabilities:["project.read","codex.session"]}}),
    selectSession:async ({sessionMode,codexSessionId})=>{
      assert.equal(sessionMode,"existing");
      assert.equal(codexSessionId,sid);
      return sid;
    },
    runTask:async(spec,{onSessionId,onLog})=>{
      const round=turns.length+1;
      assert.equal(spec.cwd,project);
      assert.equal(spec.threadId??sid,sid);
      // The first turn cannot start the second via Desktop UI. This is the
      // regression for the real 111 failure from the Oct-21 acceptance.
      if(round===2) {
        assert.deepEqual(opened,[],"Desktop must not seize writer between turns");
        assert.deepEqual(notices,[],"Intermediate turn must not notify user");
      }
      turns.push({round,thread:spec.threadId??sid});
      await onSessionId(sid);
      await onLog(round===1?"你好！":"Hello!","agent");
      if(round===1) {
        firstReady=true;
        await new Promise(r=>{releaseFirst=r});
      }
      return {threadId:sid,turnId:"turn-"+round,turnStatus:"completed",summary:round===1?"你好！":"Hello!"};
    },
    close:async()=>{}
  },
  collectResult:async()=>({changedFiles:[],diffSummary:"",gitAvailable:false,tests:[]})
});
const supervisor=new TongGoalSupervisor({
  tasks:manager,statePath:join(root,"goals.json"),pollMs:100,
  openDesktopThread:async thread=>{opened.push({source:"goal",thread,afterTurns:turns.length});return true},
  notifier:async info=>{notices.push({source:"goal",...info});return true},
});
async function until(pred,ms=5000) {
  const end=Date.now()+ms;
  while(Date.now()<end) {
    const v=await pred();if(v)return v;
    await delay(12);
  }
  const current=await supervisor.list();
  throw Error("Timed out waiting for supervisor: "+JSON.stringify(current)
    +" opened="+JSON.stringify(opened)+" notices="+JSON.stringify(notices)
    +" tasks="+JSON.stringify((await manager.list({limit:10})).tasks.map(t=>({status:t.status,error:t.error}))));
}
try {
  const request={projectId:"p0-homework-111",agent:"codex",
    goal:"Ensure native dialogue stays in one session until whole goal complete",
    scope:"Only two spoken messages; no project changes",
    idempotencyKey:"integrated-goal-writer-handoff-"+randomUUID(),
    sessionMode:"new",maxRounds:2,maxAttemptsPerStep:1,roundTimeoutSeconds:60,
    steps:[
      {id:"hello-cn",title:"Greet in Chinese",instruction:"你好",verification:{type:"read-only-turn"}},
      {id:"hello-en",title:"Greet in English",instruction:"hello",verification:{type:"read-only-turn"}}
    ]};
  const goal=await supervisor.start(request);
  await until(()=>firstReady);
  assert.equal((await supervisor.status(goal.goalId)).stepIndex,0);
  assert.deepEqual(opened,[]);
  assert.deepEqual(notices,[]);
  releaseFirst();
  const finished=await until(async()=>{
    const s=await supervisor.status(goal.goalId);
    return s.status==="completed"?s:null;
  },12000);
  await until(()=>opened.length===1&&notices.length===1);
  assert.equal(finished.roundCount,2);
  assert.deepEqual(turns.map(t=>t.thread),[sid,sid]);
  assert.deepEqual(opened,[{source:"goal",thread:sid,afterTurns:2}]);
  assert.deepEqual(notices,[{source:"goal",projectId:"p0-homework-111",status:"success",goalId:goal.goalId}]);
  const children=JSON.parse(await readFile(join(root,"tasks.json"),"utf8")).tasks;
  assert.equal(children.length,2);
  assert.ok(children.every(x=>x.parentGoalId===goal.goalId));
  assert.deepEqual(children.map(x=>x.summary),["你好！","Hello!"]);
  console.log("PASS: real goal+task manager defer Desktop and Windows notice until both native turns complete.");
} finally {
  if(releaseFirst)releaseFirst();
  await supervisor.close();
  await manager.close();
  await rm(root,{recursive:true,force:true});
}
