import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const TERMINAL = new Set(["completed","blocked","cancelled"]);
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const clamp = (v,n) => String(v ?? "").slice(0,n);
const taskKey = (id,index,attempt) => createHash("sha256")
  .update(`goal:${id}:${index}:${attempt}`).digest("hex");

function request(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(k => !["projectId","agent","goal","scope","steps",
      "idempotencyKey","sessionMode","maxRounds","maxAttemptsPerStep","roundTimeoutSeconds",
      "deadlineSeconds","workType","requiredCapabilities"].includes(k))) throw Error("Invalid supervised goal");
  const {projectId,agent,goal,scope,steps,idempotencyKey} = input;
  if (!ID.test(projectId ?? "") || agent !== "codex"
      || typeof goal !== "string" || !goal.trim() || goal.length > 4000
      || typeof scope !== "string" || !scope.trim() || scope.length > 2000
      || typeof idempotencyKey !== "string" || idempotencyKey.length < 16
      || idempotencyKey.length > 128 || /\s/.test(idempotencyKey)
      || !Array.isArray(steps) || !steps.length || steps.length > 12
      || (input.sessionMode !== undefined && !["new","latest"].includes(input.sessionMode))
      || (input.workType !== undefined && !["development","high-impact"].includes(input.workType))
      || (input.requiredCapabilities !== undefined && (
        !Array.isArray(input.requiredCapabilities) || input.requiredCapabilities.length<1
        || input.requiredCapabilities.length>7
        || new Set(input.requiredCapabilities).size!==input.requiredCapabilities.length
        || input.requiredCapabilities.some(cap=>!["project.read","project.write","command.execute",
          "dependency.install","codex.session","git.commit","git.push"].includes(cap))))
      || (input.maxRounds !== undefined && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 20))
      || (input.maxAttemptsPerStep !== undefined && (!Number.isInteger(input.maxAttemptsPerStep)
         || input.maxAttemptsPerStep < 1 || input.maxAttemptsPerStep > 3))
      || (input.roundTimeoutSeconds !== undefined && (!Number.isInteger(input.roundTimeoutSeconds)
         || input.roundTimeoutSeconds < 10 || input.roundTimeoutSeconds > 3600))
      || (input.deadlineSeconds !== undefined && (!Number.isInteger(input.deadlineSeconds)
         || input.deadlineSeconds < 60 || input.deadlineSeconds > 14400))) throw Error("Invalid supervised goal");
  const keys = new Set();
  for (const s of steps) {
    if (!s || typeof s !== "object" || Array.isArray(s)
        || Object.keys(s).some(k => !["id","title","instruction","verification"].includes(k))
        || !STEP_ID.test(s.id ?? "") || keys.has(s.id) || typeof s.title !== "string"
        || !s.title.trim() || s.title.length > 120
        || typeof s.instruction !== "string" || !s.instruction.trim() || s.instruction.length > 3000
        || !s.verification || typeof s.verification !== "object"
        || !["read-only-turn","files-exist","review-required"].includes(s.verification.type))
      throw Error("Invalid supervised goal step");
    keys.add(s.id);
    if (s.verification.type === "files-exist") {
      if (!Array.isArray(s.verification.paths) || s.verification.paths.length < 1
          || s.verification.paths.length > 15 || s.verification.paths.some(p => !safeRelativePath(p))
        || Object.keys(s.verification).some(k=>!["type","paths"].includes(k)))
        throw Error("Invalid supervised goal verification paths");
    } else if (Object.keys(s.verification).some(k => k !== "type")) {
      throw Error("Invalid supervised goal verification");
    }
  }
  const maxRounds = input.maxRounds ?? Math.min(20,Math.max(5,steps.length * 2));
  if (maxRounds < steps.length) throw Error("Goal round budget is smaller than the plan");
  // Presence of output files does not establish code correctness. A final
  // independent review is mandatory for work assessed with file existence.
  if(steps.some(s=>s.verification.type==="files-exist")
      && steps.at(-1).verification.type!=="review-required")
    throw Error("File existence is not final code acceptance");
  return {projectId,agent,goal:goal.trim(),scope:scope.trim(),steps:steps.map(s=>({
    id:s.id,title:s.title.trim(),instruction:s.instruction.trim(),
    verification:structuredClone(s.verification)
  })),idempotencyKey,sessionMode:input.sessionMode ?? "new",
  ...(input.workType!==undefined?{workType:input.workType}:{}),
  ...(input.requiredCapabilities!==undefined?{requiredCapabilities:[...input.requiredCapabilities]}:{}),
  maxRounds,maxAttemptsPerStep:input.maxAttemptsPerStep ?? 2,
  roundTimeoutSeconds:input.roundTimeoutSeconds ?? 600,
  deadlineSeconds:input.deadlineSeconds ?? 3600};
}
function safeRelativePath(p) {
  // Accept slash-separated project-relative names only. Backslashes, control
  // characters, Windows device names and unsafe segments are forbidden.
  if (typeof p !== "string" || !p || p.length > 240
      || /[\\:\x00-\x1f<>"|?*]/.test(p) || p.startsWith("/")
      || isAbsolute(p)) return false;
  return p.split("/").every(part => part && part !== "." && part !== ".."
    && !/[. ]$/.test(part)
    && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}
async function verifyFiles(root, paths) {
  const base=await realpath(root);
  for(const entry of paths) {
    if(!safeRelativePath(entry))return {ok:false,reason:"invalid-relative-path"};
    let parent=base;
    try {
      const components=entry.split("/");
      for(const [index,name] of components.entries()) {
        const path=resolve(parent,name);
        const rel=relative(base,path);
        if (rel.startsWith("..") || isAbsolute(rel) || rel==="")
          return {ok:false,reason:"path-outside-project"};
        const item=await lstat(path);
        if (item.isSymbolicLink()
            || (index < components.length-1 && !item.isDirectory())
            || (index === components.length-1 && !item.isFile()))
          return {ok:false,reason:"invalid-file-component:"+entry};
        const actual=await realpath(path);
        const actualRel=relative(base,actual);
        if (actualRel.startsWith("..") || isAbsolute(actualRel))
          return {ok:false,reason:"path-outside-project"};
        parent=actual;
      }
    } catch(error) {
      return {ok:false,reason:error?.code==="ENOENT"?"missing-file:"+entry:"verification-unavailable"};
    }
  }
  return {ok:true,evidence:paths.map(p=>"exists:"+p)};
}
// Bounded file metadata fingerprint: no file bodies are read and links are not
// traversed. Refuse huge/unknown trees instead of claiming a read-only success.
async function metadataFingerprint(root) {
  const base=await realpath(root);
  const queue=[{path:base,depth:0}];
  const records=[];
  while(queue.length) {
    const dir=queue.shift();
    const items=(await readdir(dir.path)).sort();
    for(const name of items) {
      if(records.length>=1500)throw Error("read-only-verification-tree-too-large");
      const path=join(dir.path,name);
      const stat=await lstat(path);
      if(stat.isSymbolicLink())throw Error("read-only-verification-link-present");
      const rel=relative(base,path);
      if(rel.startsWith("..")||isAbsolute(rel))throw Error("read-only-verification-out-of-root");
      records.push([rel,stat.isDirectory()?"d":"f",stat.size,
        Math.round(stat.mtimeMs),Math.round(stat.ctimeMs)]);
      if(stat.isDirectory()) {
        if(dir.depth>=5)throw Error("read-only-verification-tree-too-deep");
        queue.push({path,depth:dir.depth+1});
      } else if(!stat.isFile())throw Error("read-only-verification-special-file");
    }
  }
  records.sort((a,b)=>a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

// Progress is derived from persisted verification evidence, never from
// Codex's natural-language claims. Active-turn telemetry is deliberately
// separate from the checked business milestones.
function goalProgress(g, child = null, telemetryUnavailable = false) {
  const steps = g.steps.map((s,i) => {
    const evidence = Array.isArray(s.evidence) ? s.evidence : [];
    const completed = s.status === "completed" && evidence.length > 0;
    const state = completed ? "completed"
      : g.status === "blocked" && i === g.stepIndex ? "blocked"
      : g.status === "cancelled" && i === g.stepIndex ? "cancelled"
      : g.status === "awaiting_review" && i === g.stepIndex ? "awaiting-review"
      : s.status === "running" ? "active"
      : "pending";
    const proofLevel = completed ? ({
      "read-only-turn":"workspace-metadata",
      "files-exist":"file-presence-only",
      "review-required":"independent-review"
    }[s.verification?.type] ?? "unspecified") : null;
    return {id:s.id,title:s.title,state,proofLevel,
      evidence:completed?evidence.slice(0,15).map(v=>clamp(v,2000)):[],
      attempts:s.attempts ?? 0};
  });
  const current = g.activeTaskId && child
    ? {taskId:g.activeTaskId,status:clamp(child.status,40),
      phase:clamp(child.progress?.phase ?? child.status,80),
      message:clamp(child.progress?.message,320) || null,
      updatedAt:typeof child.updatedAt==="string" ? child.updatedAt : null,
      lifecycle:child.progress?.checklist?.kind==="verified-lifecycle"
        ? {completedCount:child.progress.checklist.completedCount,
          totalCount:child.progress.checklist.totalCount} : null}
    : null;
  const summary = {kind:"evidence-backed-steps",status:g.status,
    completedCount:steps.filter(s=>s.state==="completed").length,
    totalCount:steps.length,steps,activeTurn:current,
    telemetryUnavailable:Boolean(g.activeTaskId && telemetryUnavailable),
    needsSupervisorReview:g.status==="awaiting_review",
    needsUserAction:g.status==="blocked"};
  // Hash only the bounded visible state. A change to an active native turn's
  // phase/message produces a new cursor even without a parent-state mutation.
  return {...summary,cursor:createHash("sha256")
    .update(JSON.stringify(summary)).digest("hex")};
}

const publicGoal = g => ({
  goalId:g.goalId,projectId:g.projectId,agent:g.agent,goal:g.goal,
  status:g.status,createdAt:g.createdAt,updatedAt:g.updatedAt,finishedAt:g.finishedAt,
  stepIndex:g.stepIndex,roundCount:g.rounds.length,maxRounds:g.maxRounds,
  steps:g.steps.map((s,i)=>({id:s.id,title:s.title,status:s.status,
    evidence:s.evidence ?? [],attempts:s.attempts})),
  activeTaskId:g.activeTaskId,nativeSessionId:g.nativeSessionId,
  sessionMode:g.sessionMode,
  blockedReason:g.blockedReason??null,needsUserAction:g.status==="blocked",
  needsSupervisorReview:g.status==="awaiting_review",
  reviewStepId:g.status==="awaiting_review"?g.reviewStepId:null,
  finalReport:g.status==="completed"?g.report:null,
  progress:goalProgress(g)
});

/** Sequential, durable goal-level scheduler. Only the final goal produces a notification.
 * Future providers implement the same {start,status,result,cancel} adapter surface.
 */
export class TongGoalSupervisor {
  constructor({tasks,statePath,notifier=async()=>false,openDesktopThread=null,
    pollMs=350,now=()=>Date.now()}={}) {
    if (!tasks || ["start","status","result","cancel"].some(k=>typeof tasks[k]!=="function")
        || !isAbsolute(statePath??"")) throw Error("Invalid goal supervisor dependency");
    this.tasks=tasks;this.statePath=resolve(statePath);
    this.notifier=notifier;this.openDesktopThread=openDesktopThread;
    this.now=now;this.pollMs=Math.max(100,Math.min(5000,pollMs));
    this.goals=[];this.running=new Map();this.lock=Promise.resolve();this.closed=false;
    this.ready=this.initialize();
  }
  async initialize() {
    try {
      const data=JSON.parse(await readFile(this.statePath,"utf8"));
      if(data?.schemaVersion!==1||!Array.isArray(data.goals)) throw Error("Invalid goal supervisor state");
      this.goals=data.goals;
    } catch(error) {if(error?.code!=="ENOENT") throw Error("Invalid goal supervisor state");}
    // A saved child task is inspected before any additional turn is enqueued.
    for (const g of this.goals) if (!TERMINAL.has(g.status)) this.schedule(g.goalId);
  }
  async exclusive(fn) {
    const prior=this.lock;let free;this.lock=new Promise(r=>{free=r;});
    await prior;try {return await fn();}finally{free();}
  }
  async save() {
    await mkdir(dirname(this.statePath),{recursive:true});
    const temp=this.statePath+"."+randomUUID()+".tmp";
    await writeFile(temp,JSON.stringify({schemaVersion:1,goals:this.goals})+"\n",{flag:"wx",mode:0o600});
    await rename(temp,this.statePath);
  }
  async mutate(id,fn) {
    return this.exclusive(async()=>{
      const g=this.goals.find(g=>g.goalId===id);
      if(!g) throw Error("Goal not found");
      fn(g);g.updatedAt=new Date(this.now()).toISOString();await this.save();return publicGoal(g);
    });
  }
  async start(input) {
    await this.ready;
    const r=request(input);
    const signature=createHash("sha256").update(JSON.stringify({...r,idempotencyKey:undefined})).digest("hex");
    const hash=createHash("sha256").update(r.idempotencyKey).digest("hex");
    const existing=this.goals.find(x=>x.idempotencyHash===hash);
    if(existing) {
      if(existing.requestHash!==signature)throw Error("Goal idempotency conflict");
      return publicGoal(existing);
    }
    const active=this.goals.find(g=>g.projectId===r.projectId&&!TERMINAL.has(g.status));
    if(active) throw Error("A supervised goal is already active in this project");
    // Check a valid project grant with the existing Agent manager's read-only entry.
    if(typeof this.tasks.projectForExecution==="function")await this.tasks.projectForExecution(r.projectId);
    return this.exclusive(async()=>{
      if(this.closed)throw Error("Goal supervisor is closed");
      const duplicate=this.goals.find(x=>x.idempotencyHash===hash);
      if(duplicate) {
        if(duplicate.requestHash!==signature)throw Error("Goal idempotency conflict");
        return publicGoal(duplicate);
      }
      if(this.goals.some(x=>x.projectId===r.projectId&&!TERMINAL.has(x.status)))
        throw Error("A supervised goal is already active in this project");
      const at=new Date(this.now()).toISOString();
      const g={...r,goalId:randomUUID(),idempotencyHash:hash,requestHash:signature,
        steps:r.steps.map(s=>({...s,status:"pending",attempts:0,evidence:[]})),
        status:"running",createdAt:at,updatedAt:at,finishedAt:null,
        activeTaskId:null,nativeSessionId:null,stepIndex:0,rounds:[],blockedReason:null,
        report:null,deadlineAt:new Date(this.now()+r.deadlineSeconds*1000).toISOString()};
      delete g.idempotencyKey;
      this.goals.push(g);await this.save();this.schedule(g.goalId);return publicGoal(g);
    });
  }
  schedule(id) {
    if(this.running.has(id)||this.closed)return;
    const work=this.run(id).catch(async error=>{
      await this.block(id,"supervisor-error:"+clamp(error?.message,160)).catch(()=>{});
    }).finally(()=>this.running.delete(id));
    this.running.set(id,work);
  }
  async block(id,reason) {
    let changed=false;
    const g=await this.mutate(id,rec=>{
      if(TERMINAL.has(rec.status))return;
      changed=true;rec.status="blocked";rec.blockedReason=clamp(reason,240);
      rec.finishedAt=new Date(this.now()).toISOString();
    });
    if(changed)await this.notify(g,"waiting_user_action");
    return g;
  }
  async notify(g,status) {
    // Give Desktop one finished thread per goal, never steal focus each round.
    if(status==="success" && g.nativeSessionId && g.sessionMode==="new"
      && typeof this.openDesktopThread==="function") {
      try {await this.openDesktopThread(g.nativeSessionId);}catch{ /* optional UI */ }
    }
    try {await this.notifier({projectId:g.projectId,status,goalId:g.goalId});}catch{ /* best effort */ }
  }
  async run(id) {
    await this.ready;
    while(!this.closed) {
      const g=this.goals.find(r=>r.goalId===id);
      if(!g||TERMINAL.has(g.status)||g.status==="awaiting_review")return;
      if(this.now()>=Date.parse(g.deadlineAt)) {await this.block(id,"goal-deadline-exceeded");return;}
      const step=g.steps[g.stepIndex];
      if(!step) {
        let final;
        await this.mutate(id,r=>{
          r.status="completed";r.finishedAt=new Date(this.now()).toISOString();
          r.report={goal:r.goal,rounds:r.rounds.map(x=>({...x})),
            completedSteps:r.steps.map(x=>({id:x.id,title:x.title,evidence:x.evidence})),
            nativeSessionId:r.nativeSessionId,verified:true};
        });final=await this.status(id);await this.notify(final,"success");return;
      }
      // A goal that used its last allowed round but verified its final step is
      // complete, not exhausted. Enforce the budget only before new work.
      if(g.rounds.length>=g.maxRounds && !g.activeTaskId) {
        await this.block(id,"round-budget-exhausted");return;
      }
      if(!g.activeTaskId) {
        const attempt=step.attempts+1;
        if(attempt>g.maxAttemptsPerStep) {await this.block(id,"step-attempts-exhausted:"+step.id);return;}
        // Same native thread across rounds; never steal another active writer.
        const mode=g.nativeSessionId?"existing":g.sessionMode;
        const savedBaseline=g.launchBaseline?.stepIndex===g.stepIndex
          && g.launchBaseline.attempt===attempt ? g.launchBaseline.value : undefined;
        const baseline=step.verification.type==="read-only-turn"
          ? (savedBaseline ?? await metadataFingerprint((await this.tasks.projectForExecution(g.projectId)).root))
          : null;
        // Persist the fingerprint *before* launching any child process. A crash
        // between start() and saving the task ID must not invalidate the check.
        if(!g.launchBaseline || g.launchBaseline.stepIndex!==g.stepIndex
            || g.launchBaseline.attempt!==attempt)
          await this.mutate(id,rec=>{rec.launchBaseline={stepIndex:g.stepIndex,attempt,value:baseline};});
        const task=await this.tasks.start({
          projectId:g.projectId,agent:g.agent,
          task:`Goal: ${g.goal}\nCurrent step ${g.stepIndex+1}/${g.steps.length}: ${step.title}\n${step.instruction}\nCheck existing work before edits. Keep within scope. Do not claim unverified tests passed.`,
          scope:g.scope,idempotencyKey:taskKey(g.goalId,g.stepIndex,attempt),
          timeoutSeconds:Math.max(1,Math.min(g.roundTimeoutSeconds,
            Math.ceil((Date.parse(g.deadlineAt)-this.now())/1000))),sessionMode:mode,
          ...(g.workType!==undefined?{workType:g.workType}:{}),
          ...(g.requiredCapabilities!==undefined?{requiredCapabilities:g.requiredCapabilities}:{}),
          ...(mode==="existing"?{codexSessionId:g.nativeSessionId}:{})
        },{parentGoalId:g.goalId});
        let stopped=false;
        await this.mutate(id,rec=>{
          if(TERMINAL.has(rec.status)){stopped=true;return;}
          rec.activeTaskId=task.taskId;rec.steps[rec.stepIndex].status="running";
          rec.steps[rec.stepIndex].attempts=attempt;rec.launchBaseline=null;
          rec.rounds.push({stepId:step.id,attempt,taskId:task.taskId,status:"running",
            nativeSessionId:null,metadataBaseline:baseline});
        });
        if(stopped) {
          // Cancel was requested while the child start call was in flight.
          // Do not let this untracked turn run after its parent has stopped.
          await this.tasks.cancel(task.taskId);
          return;
        }
        continue;
      }
      const task=await this.tasks.status(g.activeTaskId);
      if(["queued","running"].includes(task.status)) {
        await delay(this.pollMs);
        continue;
      }
      if(task.status!=="success") {
        // A known, external provider-capacity failure can be retried once
        // within the existing step/round budget. Never retry an unknown
        // failure, a local permission denial or a possibly modified tree.
        const capacity = task.status==="failed"
          && /^Selected model is at capacity\. Please try a different model\.?$/i
            .test(task.error?.message?.trim()??"");
        if(capacity && step.attempts<g.maxAttemptsPerStep
            && g.rounds.length<g.maxRounds) {
          const baseline=g.rounds.at(-1)?.metadataBaseline;
          const unchanged=step.verification.type==="read-only-turn"
            && typeof baseline==="string"
            && baseline===await metadataFingerprint((await this.tasks.projectForExecution(g.projectId)).root);
          if(unchanged) {
            await this.mutate(id,rec=>{
              if(TERMINAL.has(rec.status))return;
              const round=rec.rounds.at(-1);
              round.status="transient-capacity-retry";
              round.error="model-capacity";
              round.nativeSessionId=task.codexSessionId??null;
              rec.activeTaskId=null;
              rec.steps[rec.stepIndex].status="pending";
              if(task.codexSessionId)rec.nativeSessionId=task.codexSessionId;
            });
            // Controlled delay for a capacity spike; task budget and global
            // goal deadline remain in force, no model or permissions change.
            await delay(Math.min(3500,Math.max(0,Date.parse(g.deadlineAt)-this.now())));
            continue;
          }
        }
        await this.block(id,`child-task-${task.status}:${task.taskId}`);return;
      }
      const result=await this.tasks.result(g.activeTaskId);
      if(!result.codexSessionId || !result.agentSummary?.trim()) {
        await this.block(id,"no-native-session-or-summary-evidence");return;
      }
      if(g.nativeSessionId && g.nativeSessionId!==result.codexSessionId) {
        await this.block(id,"unexpected-native-session-switch");return;
      }
      let proof;
      if(step.verification.type==="read-only-turn") {
        const project=await this.tasks.projectForExecution(g.projectId);
        const currentFingerprint=await metadataFingerprint(project.root);
        const unchanged=currentFingerprint===g.rounds.at(-1).metadataBaseline;
        proof=unchanged
          ? {ok:true,evidence:["native-turn-completed:"+result.codexTurnId,"workspace-metadata-unchanged"]}
          : {ok:false,reason:"read-only-workspace-changed"};
      } else if(step.verification.type==="files-exist") {
        const project=await this.tasks.projectForExecution(g.projectId);
        proof=await verifyFiles(project.root,step.verification.paths);
      } else {
        await this.mutate(id,rec=>{
          const round=rec.rounds.at(-1);
          round.status="awaiting-review";round.nativeSessionId=result.codexSessionId;
          round.summary=clamp(result.agentSummary,800);
          round.changedFiles=Array.isArray(result.changedFiles)?result.changedFiles.slice(0,100):[];
          round.diffSummary=clamp(result.diffSummary,1000);
          round.tests=Array.isArray(result.tests)?result.tests.slice(0,50):[];
          rec.nativeSessionId=result.codexSessionId;
          rec.activeTaskId=null;rec.steps[rec.stepIndex].status="waiting";
          // This is a supervisor checkpoint, not a decision to bother the user.
          rec.status="awaiting_review";rec.reviewStepId=step.id;
        });return;
      }
      await this.mutate(id,rec=>{
        const round=rec.rounds.at(-1);
        round.status=proof.ok?"verified":"not-verified";
        round.nativeSessionId=result.codexSessionId;
        round.summary=clamp(result.agentSummary,800);
        round.changedFiles=Array.isArray(result.changedFiles)?result.changedFiles.slice(0,100):[];
        round.diffSummary=clamp(result.diffSummary,1000);
        round.tests=Array.isArray(result.tests)?result.tests.slice(0,50):[];
        round.evidence=proof.evidence??[];
        rec.nativeSessionId=result.codexSessionId;rec.activeTaskId=null;
        if(proof.ok) {
          rec.steps[rec.stepIndex].status="completed";
          rec.steps[rec.stepIndex].evidence=proof.evidence;
          rec.stepIndex++;
        } else {
          rec.steps[rec.stepIndex].status="pending";
          round.verificationError=proof.reason;
        }
      });
      if(!proof.ok && (proof.reason==="read-only-workspace-changed"
        || step.attempts>=g.maxAttemptsPerStep)) {
        await this.block(id,"verification-failed:"+proof.reason);return;
      }
    }
  }
  async status(id) {
    await this.ready;await this.lock;
    const g=this.goals.find(g=>g.goalId===id);
    if(!g)throw Error("Goal not found");
    // Snapshot both the goal and its current child ID before the next
    // asynchronous task-status lookup to prevent mixed-step progress cards.
    const record=structuredClone(g);
    const snapshot=publicGoal(record);
    let child=null,telemetryUnavailable=false;
    if(record.activeTaskId && typeof this.tasks.status==="function") {
      try {child=await this.tasks.status(record.activeTaskId);}
      catch {telemetryUnavailable=true;}
    }
    return {...snapshot,progress:goalProgress(record,child,telemetryUnavailable)};
  }
  async wait({goalId,afterCursor,waitSeconds=15}={}) {
    if(typeof goalId!=="string" || !/^[a-f0-9-]{36}$/i.test(goalId)
      || (afterCursor!==undefined && (typeof afterCursor!=="string"
        || !/^[a-f0-9]{64}$/.test(afterCursor)))
      || !Number.isInteger(waitSeconds) || waitSeconds<1 || waitSeconds>15)
      throw Error("Invalid goal progress watch");
    const until=this.now()+waitSeconds*1000;
    while(true) {
      const goal=await this.status(goalId);
      const changed=!afterCursor || goal.progress.cursor!==afterCursor;
      if(changed || TERMINAL.has(goal.status) || goal.status==="awaiting_review"
        || this.now()>=until || this.closed) return {goal,changed};
      await delay(Math.min(350,Math.max(1,until-this.now())));
    }
  }
  async list() {
    await this.ready;await this.lock;
    // List metadata only: do not leak goal instructions, individual steps,
    // verification paths, native session transcripts or review evidence.
    return {goals:this.goals.slice(-50).reverse().map(g=>({
      goalId:g.goalId,projectId:g.projectId,agent:g.agent,status:g.status,
      createdAt:g.createdAt,updatedAt:g.updatedAt,finishedAt:g.finishedAt,
      stepIndex:g.stepIndex,stepCount:g.steps.length,roundCount:g.rounds.length,
      needsUserAction:g.status==="blocked",needsSupervisorReview:g.status==="awaiting_review",
    }))};
  }
  async result(id) {
    await this.ready;await this.lock;
    const g=this.goals.find(g=>g.goalId===id);
    if(!g)throw Error("Goal not found");
    return { ...publicGoal(g),rounds:g.rounds.map(r=>({...r})),
      ...(g.status==="completed"?{report:g.report}:{}) };
  }
  async review({goalId,accepted,evidence}={}) {
    if(typeof goalId!=="string" || typeof accepted!=="boolean"
      || typeof evidence!=="string" || evidence.trim().length<8 || evidence.length>2000)
      throw Error("Invalid independent goal review");
    await this.ready;
    const updated=await this.mutate(goalId,g=>{
      if(g.status!=="awaiting_review")
        throw Error("Goal is not awaiting independent review");
      const step=g.steps[g.stepIndex];
      if(!step || g.reviewStepId!==step.id)
        throw Error("Review step mismatch");
      const last=g.rounds.at(-1);
      if(!last || last.stepId!==step.id || last.status!=="awaiting-review")
        throw Error("Review evidence missing");
      last.evidence=[clamp("independent-review:"+evidence.trim(),2000)];
      g.reviewStepId=null;
      if(accepted) {
        last.status="verified-by-review";
        step.status="completed";step.evidence=last.evidence;g.stepIndex++;
        g.status="running";g.blockedReason=null;g.finishedAt=null;
      } else if(step.attempts<g.maxAttemptsPerStep && g.rounds.length<g.maxRounds) {
        last.status="review-rejected";
        step.status="pending";g.status="running";g.blockedReason=null;g.finishedAt=null;
      } else {
        last.status="review-rejected";g.status="blocked";
        g.finishedAt=new Date(this.now()).toISOString();
        g.blockedReason="review-rejected-at-budget:"+step.id;
      }
    });
    if(updated.status==="blocked")await this.notify(updated,"waiting_user_action");
    if(updated.status==="running") {
      const previous=this.running.get(goalId);
      if(previous)await previous;
      this.schedule(goalId);
    }
    return updated;
  }
  async resume(id) {
    const g=await this.status(id);
    if(g.status!=="blocked" || !g.blockedReason?.startsWith("child-task-waiting_user_action:")
        || !g.activeTaskId || typeof this.tasks.resume!=="function")
      throw Error("Goal cannot resume without a saved waiting Codex turn");
    const record=this.goals.find(x=>x.goalId===id);
    if(this.now()>=Date.parse(record.deadlineAt))
      throw Error("Goal deadline expired; review a new scoped request");
    const child=await this.tasks.status(g.activeTaskId);
    if(child.status!=="waiting_user_action" || !child.resumeAvailable)
      throw Error("Saved Codex turn is not resumable");
    // Re-authorize using the existing per-turn manager. A blocked goal does
    // not authorize new permissions or silently create a replacement thread.
    await this.tasks.resume(g.activeTaskId);
    const updated=await this.mutate(id,rec=>{
      if(rec.status!=="blocked" || rec.activeTaskId!==g.activeTaskId)
        throw Error("Goal state changed during recovery");
      rec.status="running";rec.blockedReason=null;rec.finishedAt=null;
    });
    const previous=this.running.get(id);
    if(previous)await previous;
    this.schedule(id);
    return updated;
  }
  async cancel(id) {
    const g=await this.status(id);
    if(TERMINAL.has(g.status))return g;
    if(g.activeTaskId)await this.tasks.cancel(g.activeTaskId);
    const done=await this.mutate(id,rec=>{
      rec.status="cancelled";rec.finishedAt=new Date(this.now()).toISOString();
    });
    await this.notify(done,"cancelled");return done;
  }
  async close() {
    this.closed=true;
    await this.ready;
    await Promise.allSettled([...this.running.values()]);
  }
}