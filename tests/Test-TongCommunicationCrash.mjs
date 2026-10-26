// Kill one precisely identified synthetic Supervisor. Only the existing Task
// runner may restart it; no direct start, budget reset or receipt fabrication.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
const [root,runId,evidenceDir]=process.argv.slice(2);
assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
assert.equal(resolve(evidenceDir,'..'),root);assert.match(basename(evidenceDir),/^task-originals-[a-f0-9]{32}$/);
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const profile=await json(join(root,'profile.json')),previous=await json(join(root,'run/runtime.json'));
assert.equal(profile.mode,'production-simulation');assert.equal(previous.phase,'ready');assert.equal(previous.runId,runId);
const moduleUrl=name=>pathToFileURL(join(profile.managerRoot,'scripts',name));
const security=await import(moduleUrl('TongRuntimeSecurity.mjs'));
assert.equal(security.sameProcess(await security.processIdentity(previous.supervisor.pid),previous.supervisor),true);
const origin=await json(join(evidenceDir,'crash-origin.json'));
assert.equal(origin.initialHealthyEvent.runId,runId);assert.equal(origin.initialHealthyEvent.runnerPid,origin.runner.pid);
assert.equal(security.sameProcess(await security.processIdentity(origin.runner.pid),origin.runner),true);
const budgetBefore=await json(join(root,'run/login-recovery-budget.json'));
await writeFile(join(evidenceDir,'budget.before-crash.json'),JSON.stringify(budgetBefore,null,2),{flag:'wx'});
const evidence={syntheticOnly:true,oldRunId:runId,beganAt:new Date().toISOString(),productionChanged:false};
try{
 assert.equal((await security.terminateOwnedProcess(previous.supervisor)).matched,true);
 let recovered,healthy;
 const deadline=Date.now()+240000;
 while(Date.now()<deadline){
  const r=await json(join(root,'run/runtime.json'));
  if(r.runId!==runId&&r.phase==='ready'){
   const events=(await readFile(join(root,'logs/login-management.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
   healthy=events.find(e=>e.runId===r.runId&&e.runnerPid===origin.runner.pid&&e.event==='recovery_succeeded');
   if(healthy){recovered=r;break;}
  }
  await delay(250);
 }
 assert.ok(recovered,'The existing runner must recover within one bounded observation');
 assert.equal(security.sameProcess(await security.processIdentity(origin.runner.pid),origin.runner),true);
 const budgetAfter=await json(join(root,'run/login-recovery-budget.json'));
 await writeFile(join(evidenceDir,'budget.after-crash.json'),JSON.stringify(budgetAfter,null,2),{flag:'wx'});
 // The native runner may prune naturally expired attempts. Keep the complete
 // before file as evidence and require every still-current entry unchanged.
 const reservedAt=Date.parse(budgetAfter.attempts.at(-1).at);
 assert.ok(reservedAt>=Date.parse(evidence.beganAt)&&reservedAt<=Date.now());
 const retained=budgetBefore.attempts.filter(a=>reservedAt-Date.parse(a.at)<30*60*1000);
 assert.deepEqual(budgetAfter.attempts.slice(0,-1),retained);
 assert.equal(budgetAfter.attempts.length,retained.length+1);
 assert.ok(budgetAfter.attempts.length<=3);
 assert.equal(budgetAfter.attempts.at(-1).runId,runId);
 assert.equal(budgetAfter.attempts.at(-1).reason,'process_or_readiness_lost');
 evidence.sameRunnerPreserved=true;evidence.budgetConsumedOnce=true;evidence.naturallyExpiredAttempts=budgetBefore.attempts.length-retained.length;
 assert.equal(security.sameProcess(await security.processIdentity(previous.supervisor.pid),previous.supervisor),false);
 assert.deepEqual(await security.startupJobsState(runId),{owner:0,launcher:0,guardian:0,runtime:0});
 const oldGuardian=await json(join(root,`run/guardian.${runId}.json`));
 assert.equal(oldGuardian.runtimeClean,true);assert.ok(oldGuardian.finishedAt);assert.equal(oldGuardian.jobActiveAfterCleanup,0);
 const login=await import(moduleUrl('TongLoginRecovery.mjs')),runtime=await import(moduleUrl('TongAgentDockRuntime.mjs'));
 const doctor=await login.withLoginRecovery(root,'doctor',()=>runtime.runtimeDoctor(root));
 assert.equal(doctor.healthy,true);evidence.doctorHealthy=true;evidence.recoveredRunId=recovered.runId;
 const request=await json(join(root,'run/request.json'));
 const events=(await readFile(join(root,'logs/lifecycle.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
 const ready=events.find(e=>e.runId===recovered.runId&&e.event==='ready');
 evidence.requestToReadyMs=Date.parse(ready.at)-Date.parse(request.createdAt);
 evidence.startupBudgetMs=request.startupDeadline-Date.parse(request.createdAt);
 assert.ok(evidence.startupBudgetMs>0&&evidence.startupBudgetMs<=180000);
 assert.ok(evidence.requestToReadyMs>=0&&evidence.requestToReadyMs<evidence.startupBudgetMs);
 const test=fileURLToPath(new URL('Test-TongCommunicationFiles.mjs',import.meta.url));
 const child=spawn(process.execPath,[test,root,recovered.runId,evidenceDir,'recovered'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});
 assert.equal(code,0,stderr||stdout);evidence.communication=JSON.parse(stdout);
 evidence.oldJobsEmpty=true;evidence.oldSupervisorGone=true;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.failure=String(error.stack??error);process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(join(evidenceDir,'crash-recovery.json'),JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify(evidence));}
