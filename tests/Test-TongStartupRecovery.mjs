import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture,sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,revokeSimulationLoginRecovery,withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret,readSecret,safeEnvironment,processIdentity,sameProcess,runtimeJobState,startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';

// Reuse only the validated, stopped synthetic dependency tree. The fixture
// retains the previous run and source, and binds the final working-tree bytes.
const {root,profile:initialProfile}=await loginFixture({full:true,sharedDependencies:true,reuseRoot:process.env.TONG_LOGIN_AUTO_REUSE});
const profile={...initialProfile};
const reuse=!!process.env.TONG_LOGIN_AUTO_REUSE;
const token=reuse?await readSecret(root,'agentdock'):randomBytes(32).toString('hex'),owner=reuse?await readSecret(root,'oauth-owner'):randomBytes(32).toString('hex');
if(!reuse){await protectSecret(root,'agentdock',token);await protectSecret(root,'oauth-owner',owner);}
await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});
await writeFile(join(profile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));

// Fault injection lives exclusively in this test's newly pinned simulation
// scripts. Production code has no delay, crash or timeout override switches.
const scenarioPath=join(root,'startup-scenario.json');
const childPath=join(profile.managerRoot,'scripts','TongRuntimeServer.mjs');
let childSource=await readFile(childPath,'utf8');
childSource=childSource.replace("const stage=(name,details={})=>process.send({event:'stage',stage:name,...details});",`const scenario=JSON.parse(await readFile(${JSON.stringify(scenarioPath)},'utf8'));
const stage=(name,details={})=>process.send({event:'stage',stage:name,...details});
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));`)
 .replace("stage('approval_verified');","stage('approval_verified');if(scenario.mode==='slow'&&settings.role==='devspace')await pause(12000);")
 .replace("stage('candidate_verified');","stage('candidate_verified');if(scenario.mode==='slow'&&settings.role==='devspace')await pause(5000);")
 .replace("stage('log_protection_ready');","stage('log_protection_ready');if(scenario.mode==='slow')await pause(5000);")
 .replace("stage('server_import_begin');","stage('server_import_begin');if(scenario.mode==='slow')await pause(20000);if(scenario.mode==='stall')await new Promise(()=>setInterval(()=>{},1000));if(scenario.mode==='exit')process.exit(29);");
const pin=JSON.parse(await readFile(join(root,'run','manager-pin.json'),'utf8'));
const sourceFile=pin.sourceFiles.find(file=>file.path==='scripts/TongRuntimeServer.mjs');sourceFile.size=Buffer.byteLength(childSource);sourceFile.sha256=sha(childSource);
for(const target of [profile.codeRoot,profile.managerRoot])await writeFile(join(target,'scripts','TongRuntimeServer.mjs'),childSource);
const pinBytes=JSON.stringify(pin);profile.releaseDigest=sha(pinBytes);
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));await issueSimulationLoginRecovery(profile);
const manager=join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs');
async function command(action,args=[]){
  const began=Date.now();
  const child=spawn(process.execPath,['--report-on-fatalerror','--report-exclude-env','--report-exclude-network','--report-directory='+root,manager,action,'--root',root,'--login-recovery','--error-json',...args],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});
  console.log(JSON.stringify({event:'manager_command_started',action,pid:child.pid,exe:process.execPath,at:new Date(began).toISOString()}));
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const timeout=setTimeout(()=>child.kill(),180000);let code;try{code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});}finally{clearTimeout(timeout);}
  console.log(JSON.stringify({event:'manager_command_exited',action,pid:child.pid,code,hex:Number.isInteger(code)?'0x'+(code>>>0).toString(16).padStart(8,'0'):null,signal:child.signalCode,durationMs:Date.now()-began,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr)}));
  for(const secret of [token,owner])assert.ok(!stdout.includes(secret)&&!stderr.includes(secret));
  return {code,result:stdout.trim()?JSON.parse(stdout):null,stderr};
}
const read=name=>readFile(join(root,'run',name),'utf8').then(JSON.parse);
async function clean(run){
  const guardian=await read('guardian.json');assert.equal(guardian.runId,run.runId);assert.equal(guardian.jobActiveAfterCleanup,0);assert.ok(guardian.finishedAt);
  assert.equal((await runtimeJobState(run.runId)).activeProcesses,0);
  for(const identity of [guardian,run.supervisor,...run.children])assert.equal(sameProcess(await processIdentity(identity.pid),identity),false);
}
try{
  for(const mode of ['normal','slow','stall','exit']){
    await writeFile(scenarioPath,JSON.stringify({mode}));
    const result=await command('start');const run=await read('runtime.json');
    if(['normal','slow'].includes(mode)){
      assert.equal(result.code,0,result.stderr+JSON.stringify(result.result));assert.equal((await command('doctor')).result.healthy,true);
      const events=(await readFile(join(root,'logs','lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(e=>e.runId===run.runId);
      const ready=events.find(e=>e.event==='readiness_complete'&&e.role==='devspace');
      if(mode==='slow')assert.ok(ready.durationMs>45000&&ready.durationMs<75000,JSON.stringify(ready));
      assert.ok(events.some(e=>e.stage==='server_import_complete'&&Number.isSafeInteger(e.importCpuUserMs)));
      assert.equal((await command('stop-run',['--run-id',run.runId])).code,0);
    }else{
      assert.notEqual(result.code,0);assert.equal(run.startupFailure.code,mode==='stall'?'CHILD_STAGE_TIMEOUT':'CHILD_EXIT');
      assert.equal(run.startupFailure.role,'devspace');assert.equal(run.startupFailure.stage,'server_import_begin');
      if(mode==='stall')assert.ok(run.startupFailure.stageDurationMs>=30000&&run.startupFailure.stageDurationMs<35000);
      else assert.equal(run.startupFailure.exitCode,29);
    }
    await clean(run);console.log(JSON.stringify({event:'startup_scenario_passed',mode,root,runId:run.runId}));
  }
  await writeFile(scenarioPath,JSON.stringify({mode:'normal'}));
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:1})),/START_TIMEOUT/);
  const attempted=await read('request.json'),receipt=await read(`launcher.${attempted.runId}.json`);
  assert.equal(receipt.guardianCreated,false);assert.equal(receipt.preflightClean,true);assert.ok(receipt.finishedAt);
  assert.deepEqual(await startupJobsState(attempted.runId),{owner:0,launcher:0,guardian:0,runtime:0});
  await assert.rejects(readFile(join(root,'run','backup.freeze')),{code:'ENOENT'});
  await clean(await read('runtime.json'));
  const restored=await command('start');assert.equal(restored.code,0,JSON.stringify(restored));assert.equal((await command('doctor')).result.healthy,true);
  const run=await read('runtime.json');assert.equal((await command('stop-run',['--run-id',run.runId])).code,0);await clean(run);
  console.log(JSON.stringify({passed:true,root,normal:true,slowAbove45s:true,stageStall:true,childExit:true,totalTimeoutCleanup:true,restartAfterTimeout:true,productionMutation:false}));
}finally{
  const status=await command('status');if(status.code===0&&status.result.supervisorAlive)assert.equal((await command('stop-run',['--run-id',status.result.runId])).code,0);
  await revokeSimulationLoginRecovery(root);
}
