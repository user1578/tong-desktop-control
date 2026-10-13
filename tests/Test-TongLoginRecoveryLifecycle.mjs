import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,revokeSimulationLoginRecovery,loginRecoveryAuditPath} from '../scripts/TongLoginRecovery.mjs';
import {protectSecret,processIdentity,sameProcess,terminateOwnedProcess,safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';
const {root,profile}=await loginFixture({full:true});
const node=process.execPath,manager=join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs');
const token=randomBytes(32).toString('hex'),owner=randomBytes(32).toString('hex');
await protectSecret(root,'agentdock',token);await protectSecret(root,'oauth-owner',owner);
await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});
await writeFile(join(profile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
await issueSimulationLoginRecovery(profile);
async function command(action,args=[],recovery=true){
  const child=spawn(node,[manager,action,'--root',root,...args,...(recovery?['--login-recovery']:[])],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',error='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>error+=bytes);
  const timer=setTimeout(()=>child.kill(),180000);
  const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);
  assert.ok(!output.includes(token)&&!output.includes(owner)&&!error.includes(token)&&!error.includes(owner));
  return {code,result:code===0?JSON.parse(output):null,error};
}
let started;
try{
  const preflight=await command('preflight-login',[],false);assert.equal(preflight.code,0,preflight.error);assert.equal(preflight.result.loginRecoverySupported,true);
  const normal=await command('start',[],false);assert.notEqual(normal.code,0);assert.match(normal.error,/APPROVAL_DENIED/);
  const first=await command('start');assert.equal(first.code,0,first.error);started=first.result;
  assert.deepEqual(started.children.map(child=>child.role),['agentdock','devspace','gateway']);
  assert.equal((await command('doctor')).result.healthy,true);
  assert.notEqual((await command('start')).code,0,'a second login must not spawn a duplicate');
  const events=(await readFile(join(root,'logs','lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.findIndex(e=>e.event==='readiness_complete'&&e.role==='devspace')<events.findIndex(e=>e.event==='readiness_begin'&&e.role==='gateway'));
  // Only this synthetic runtime's exact backend identity is interrupted.
  await terminateOwnedProcess(started.children.find(child=>child.role==='agentdock'));
  for(let i=0;i<200;i++){
    const guardian=await readFile(join(root,'run','guardian.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(guardian?.finishedAt&&guardian.jobActiveAfterCleanup===0)break;
    await new Promise(ok=>setTimeout(ok,100));
  }
  await command('stop-run',['--run-id',started.runId]);
  const restored=await command('start');assert.equal(restored.code,0,restored.error);assert.notEqual(restored.result.runId,started.runId);started=restored.result;
  assert.equal((await command('doctor')).result.healthy,true);
  const stopped=await command('stop-run',['--run-id',started.runId]);assert.equal(stopped.code,0,stopped.error);
  for(const child of started.children)assert.equal(sameProcess(await processIdentity(child.pid),child),false);
  await revokeSimulationLoginRecovery(root);
  assert.notEqual((await command('start')).code,0,'revoked grant cannot restore the stopped runtime');
  const audit=await readFile(loginRecoveryAuditPath(root),'utf8');assert.match(audit,/revoked/);assert.match(audit,/denied/);
  console.log(JSON.stringify({passed:true,root,allThreeComponents:true,ordinaryStartDenied:true,duplicateDenied:true,orderedStartup:true,freshProcessRecovery:true,backendFailureRecovered:true,privateJobClean:true,revokedStartDenied:true}));
}finally{
  // Retain all synthetic evidence. Stop only the recorded fixture run, through
  // its still-active grant, if an assertion fails before normal cleanup.
  const status=await command('status',[],false);
  if(status.code===0&&status.result.supervisorAlive){const stopped=await command('stop-run',['--run-id',status.result.runId]);assert.equal(stopped.code,0,stopped.error);}
}
