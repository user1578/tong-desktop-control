import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,revokeSimulationLoginRecovery,withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret,readSecret,processIdentity,sameProcess,terminateOwnedProcess,safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';

// One real three-component runtime, one 601 MB dependency tree; no production
// port, task, source, credentials, permission, process or Codex UI is modified.
const {root,profile,project}=await loginFixture({full:true,sharedDependencies:true,reuseRoot:process.env.TONG_LOGIN_AUTO_REUSE});
console.log(JSON.stringify({event:'fixture_ready',root}));
const manager=join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs');
const reuse=!!process.env.TONG_LOGIN_AUTO_REUSE;
const token=reuse?await readSecret(root,'agentdock'):randomBytes(32).toString('hex'),owner=reuse?await readSecret(root,'oauth-owner'):randomBytes(32).toString('hex');
if(!reuse){await protectSecret(root,'agentdock',token);await protectSecret(root,'oauth-owner',owner);}
await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});
await writeFile(join(profile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
await issueSimulationLoginRecovery(profile);
const env=safeEnvironment(root),shell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
async function execute(exe,args,timeoutMs=180000){
  const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const timeout=setTimeout(()=>child.kill(),timeoutMs);
  const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timeout);
  for(const secret of [token,owner])assert.ok(!stdout.includes(secret)&&!stderr.includes(secret));
  return {code,stdout,stderr};
}
async function command(action,args=[],recovery=true){
  const result=await execute(process.execPath,[manager,action,'--root',root,...args,...(recovery?['--login-recovery']:[])]);
  return {...result,result:result.code===0?JSON.parse(result.stdout):null};
}
async function read(name){return readFile(join(root,'run',name),'utf8').then(JSON.parse);}
async function waitReady(previousRunId){
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    if(monitor?.exitCode!==null)throw Error('Monitor exited: '+monitorError);
    const record=await read('runtime.json');
    if(record.phase==='ready'&&record.runId!==previousRunId){
      const events=(await readFile(join(root,'logs','login-management.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      if(events.some(e=>e.event==='recovery_succeeded'&&e.runId===record.runId)){assert.equal((await command('doctor')).result.healthy,true);return record;}
    }
    await new Promise(ok=>setTimeout(ok,500));
  }
  throw Error('Automatic recovery timed out: '+monitorError);
}
let monitor,monitorError='',current;const crashed=[];
try{
  assert.notEqual((await command('start',[],false)).code,0,'ordinary start has no maintenance receipt');
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:1})),/START_TIMEOUT/);
  const aborted=await read('guardian.json');assert.equal(aborted.jobActiveAfterCleanup,0);assert.ok(aborted.finishedAt);
  const abortEvent=(await readFile(join(root,'logs','lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).find(e=>e.runId===aborted.runId&&e.event==='startup_failure');
  assert.equal(abortEvent.code,'START_TIMEOUT');assert.equal(abortEvent.budgetMs,1);assert.ok(abortEvent.durationMs>=1);assert.ok(Number.isFinite(abortEvent.stageDurationMs));
  let result=await command('start');assert.equal(result.code,0,result.stderr);current=result.result;
  assert.deepEqual(current.children.map(c=>c.role),['agentdock','devspace','gateway']);
  assert.equal((await command('doctor')).result.healthy,true);
  assert.notEqual((await command('start')).code,0,'duplicate Supervisor must be refused');
  assert.notEqual((await command('stop-run',['--run-id','00000000-0000-0000-0000-000000000000'])).code,0);
  result=await command('stop-run',['--run-id',current.runId]);assert.equal(result.code,0,result.stderr);
  result=await command('start');assert.equal(result.code,0,result.stderr);assert.notEqual(result.result.runId,current.runId);current=result.result;
  const runner=join(root,'login-runner.ps1');
  const source=(await readFile(join(project,'scripts','TongLoginRuntime.ps1'),'utf8')).replaceAll('D:\\Tong\\runtime',root).replaceAll('Local\\TongLoginRuntime-','Local\\TongLoginAutoTest-'+basename(root)+'-');
  await writeFile(runner,source);
  monitor=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',runner,'-Mode','run'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  monitor.stdout.resume();monitor.stderr.on('data',data=>monitorError+=data);
  // Observe the real monitor's first health result before injecting any fault.
  const readyDeadline=Date.now()+60000;
  while(!(await readFile(join(root,'logs','login-management.jsonl'),'utf8').catch(()=>'' )).split('\n').filter(Boolean).map(JSON.parse).some(e=>e.event==='runtime_healthy'&&e.runId===current.runId)){
    assert.ok(Date.now()<readyDeadline,'login monitor must become ready');await new Promise(ok=>setTimeout(ok,500));
  }
  for(const fault of ['supervisor','guardian','guardian']){
    const old=current,guardian=await read('guardian.json');crashed.push(old);
    const identity=fault==='supervisor'?old.supervisor:guardian;
    assert.equal((await terminateOwnedProcess(identity)).matched,true,'only the fixture identity is terminated');
    current=await waitReady(old.runId);
    console.log(JSON.stringify({event:'recovered',fault,from:old.runId,to:current.runId}));
    for(const child of old.children)assert.equal(sameProcess(await processIdentity(child.pid),child),false);
    if(fault==='guardian'){
      const proof=await readFile(join(root,'run',`stale-reconciliation.${old.runId}.json`));
      const parsed=JSON.parse(proof);assert.equal(parsed.runId,old.runId);assert.equal(JSON.parse(parsed.runtimeRecord).runId,old.runId);
      // Preserve the first guardian-loss proof also under the legacy fixed name.
      // The next real crash must recover without moving or replacing it.
      if(crashed.length===2)await writeFile(join(root,'run','stale-reconciliation.json'),proof,{flag:'wx'});
      else assert.equal(JSON.parse(await readFile(join(root,'run','stale-reconciliation.json'),'utf8')).runId,crashed[1].runId);
    }
  }
  assert.equal((await read('login-recovery-budget.json')).attempts.length,3);
  // Closing the login wrapper/initiator leaves its independent Guardian healthy.
  const closed=new Promise(ok=>monitor.once('close',ok));monitor.kill();await closed;monitor=undefined;
  assert.equal((await command('doctor')).result.healthy,true);
  const healthyStart=await execute(shell,['-NoProfile','-NonInteractive','-File',runner,'-Mode','start']);
  assert.equal(healthyStart.code,0,healthyStart.stderr);assert.equal((await command('status',[],false)).result.runId,current.runId);
  result=await command('stop-run',['--run-id',current.runId]);assert.equal(result.code,0,result.stderr);
  const events=(await readFile(join(root,'logs','guardian.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.event==='node_supervisor_exit'&&e.runId===crashed[0].runId&&e.exitCode!==0));
  assert.ok(events.some(e=>e.event==='guardian_started'&&e.runId===current.runId));
  await revokeSimulationLoginRecovery(root);assert.notEqual((await command('start')).code,0);
  for(const name of await readdir(join(root,'logs'))){if(!/\.(?:log|jsonl)$/.test(name))continue;const bytes=await readFile(join(root,'logs',name));for(const secret of [token,owner])assert.ok(!bytes.includes(Buffer.from(secret)),'no plaintext fixture credentials in '+name);}
  console.log(JSON.stringify({passed:true,root,normalStopRestart:true,supervisorCrashRecovered:true,twoGuardianCrashesRecovered:true,legacyProofPreserved:true,duplicateRefused:true,healthyStartReused:true,initiatorExitSurvived:true,revocationEnforced:true,productionAcceptance:false}));
}finally{
  if(monitor&&monitor.exitCode===null&&monitor.signalCode===null){const closed=new Promise(ok=>monitor.once('close',ok));monitor.kill();await closed;}
  const status=await command('status',[],false);
  if(status.code===0&&status.result.supervisorAlive){const stopped=await command('stop-run',['--run-id',status.result.runId]);assert.equal(stopped.code,0,stopped.stderr);}
}
