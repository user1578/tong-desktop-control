// Manual real-Codex acceptance. Never run from CI or without explicit opt-in.
if(process.platform!=="win32" || process.env.TONG_GOAL_LIVE_ACCEPTANCE!=="YES")
  throw Error("Manual Windows Codex acceptance requires TONG_GOAL_LIVE_ACCEPTANCE=YES");
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,readdir,lstat} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
import {TongProjectAccess} from "../scripts/TongProjectAccess.mjs";
import {TongTrustedPolicy,TongTrustedCodexBroker,TongExecutorRouter} from "../scripts/TongTrustedCodexBroker.mjs";
import {TongAgentTaskManager} from "../scripts/TongAgentTasks.mjs";
import {TongGoalSupervisor} from "../scripts/TongGoalSupervisor.mjs";
import {openCodexDesktopThread} from "../scripts/TongCodexDesktopLink.mjs";

const liveRoot="D:\\Tong\\app\\runtime";
const target="D:\\作业\\111";
const testRoot="D:\\Tong\\state\\goal-supervisor-live-acceptance-20261021-r2";
const state=join(testRoot,"test-state");
await mkdir(state,{recursive:true});
const prior=await readFile(join(state,"acceptance-summary.json"),"utf8")
  .then(()=>true,error=>{if(error?.code==="ENOENT")return false;throw error;});
if(prior)throw Error("Live acceptance already passed in this directory; do not repeat.");
const begin=await readdir(target);
const baseline={};
for(const name of begin){const info=await lstat(join(target,name));baseline[name]={size:info.size,mtimeMs:info.mtimeMs};}
const access=new TongProjectAccess({
  registryPath:join(liveRoot,"project-access.json"),
  agentAccessPath:join(liveRoot,"agent-execution.json"),
  demoRoot:"D:\\Tong\\development\\tong-desktop-control\\demo-workspace",scanRoots:[]});
assert.equal(await access.authorize("agent.execute","p0-homework-111"),true,"111 execution permission required");
const livePolicy=new TongTrustedPolicy({policyPath:join(liveRoot,"trusted-codex.json"),
  taskStatePath:join(liveRoot,"agent-tasks.json")});
const shadow=new TongTrustedPolicy({policyPath:join(state,"isolated-policy-unused.json"),
  taskStatePath:join(state,"agent-tasks.json"),auditPath:join(state,"trusted-audit.jsonl")});
// Validate the real project's authorization before every turn without ever
// mutating production approvals, task state or the production project lock.
shadow.read=()=>livePolicy.read();
const trusted=new TongTrustedCodexBroker({access,policy:shadow,pollMs:350});
const denied={async preflight(){throw Error("Unexpected isolated executor");},async runTask(){throw Error("Unexpected isolated executor");},async close(){}};
const tasks=new TongAgentTaskManager({access,workerBroker:new TongExecutorRouter({policy:shadow,isolated:denied,trusted}),
  statePath:join(state,"agent-tasks.json"),maxConcurrent:1,notifyOnCompletion:false,
  openDesktopThread:async()=>false});
const notices=[];
const goals=new TongGoalSupervisor({tasks,statePath:join(state,"goals.json"),pollMs:350,
  notifier:async notice=>{notices.push(notice);return true;},
  openDesktopThread:async thread=>{const ok=await openCodexDesktopThread(thread);return ok;}});
const key="goal-live-111-"+randomUUID();
let goalId=null,report=null,error=null;
try{
  const accepted=await goals.start({
    projectId:"p0-homework-111",agent:"codex",
    goal:"验收Tong Supervisor在111项目连续两轮只读任务、相同Codex原生会话及总体通知",
    scope:"仅D:\\作业\\111顶层文件名和数量；不读取正文，不增删改文件，不提交Git，不安装依赖，不访问其他项目。",
    idempotencyKey:key,sessionMode:"new",maxRounds:4,maxAttemptsPerStep:2,
    roundTimeoutSeconds:110,deadlineSeconds:300,
    requiredCapabilities:["project.read","command.execute","codex.session"],
    steps:[
      {id:"inspect",title:"只读检查顶层文件清单",
        instruction:"只读检查当前项目顶层文件名和文件数量，回复精确数量。不要读取任何文件正文，不能写文件、Git或系统设置。",
        verification:{type:"read-only-turn"}},
      {id:"continue",title:"在同一原生会话继续核查",
        instruction:"请使用本会话上一轮的上下文，复述前轮得到的文件数量，并再次独立只读检查当前顶层文件数量。两者一致就说明；全程不读取文件正文、不改任何文件。",
        verification:{type:"read-only-turn"}}
    ]});
  goalId=accepted.goalId;
  const endAt=Date.now()+300000;let last="";
  while(Date.now()<endAt){
    const g=await goals.status(goalId);
    const keyStatus=g.status+"|"+g.stepIndex+"|"+g.roundCount+"|"+g.activeTaskId;
    if(keyStatus!==last){console.log("GOAL_PROGRESS "+JSON.stringify({status:g.status,stepIndex:g.stepIndex,rounds:g.roundCount,steps:g.steps.map(s=>s.status)}));last=keyStatus;}
    if(["completed","blocked","cancelled"].includes(g.status))break;
    await pause(800);
  }
  report=await goals.result(goalId);
  const end=await readdir(target);const after={};
  for(const name of end){const info=await lstat(join(target,name));after[name]={size:info.size,mtimeMs:info.mtimeMs};}
  const sids=report.rounds.map(r=>r.nativeSessionId);
  console.log("ACCEPTANCE_EVIDENCE "+JSON.stringify({goalId,status:report.status,rounds:report.roundCount,
    steps:report.steps.map(x=>({id:x.id,status:x.status,evidence:x.evidence})),
    sessions:sids,sameSession:sids.length===2&&sids[0]===sids[1],
    notifications:notices,filesUnchanged:JSON.stringify(baseline)===JSON.stringify(after),
    tasks:report.rounds.map(r=>({taskId:r.taskId,status:r.status,summary:r.summary?.slice(0,400)})),
    blockedReason:report.blockedReason}));
  assert.equal(report.status,"completed","Goal must finish rather than merely have one successful Codex turn");
  assert.equal(report.roundCount,2);
  assert.equal(sids.length,2);assert.equal(sids[0],sids[1]);
  assert.deepEqual(notices.map(x=>x.status),["success"],"Only goal completion emits one notice");
  assert.deepEqual(after,baseline,"111 project files must remain unchanged");
  await writeFile(join(state,"acceptance-summary.json"),JSON.stringify({
    goalId,at:new Date().toISOString(),status:report.status,
    nativeSessionId:sids[0],rounds:report.rounds.map(x=>({taskId:x.taskId,status:x.status,summary:x.summary})),
    notifications:notices,filesUnchanged:true,verified:true},null,2));
  console.log("TONG_GOAL_111_LIVE_ACCEPTANCE_OK");
}catch(e){error=e;console.error("TONG_GOAL_111_LIVE_ACCEPTANCE_FAILED "+String(e?.stack??e));process.exitCode=1;}
finally{
  if(goalId) { const s=await goals.status(goalId).catch(()=>null);if(s&&["running","awaiting_review"].includes(s.status))await goals.cancel(goalId).catch(()=>{});}
  await goals.close().catch(()=>{});
  await tasks.close().catch(()=>{});
}
