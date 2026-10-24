import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, copyFile, cp, rename, lstat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture, sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery, revokeSimulationLoginRecovery, withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret, safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';

const commit='34e26801876d8b1a2fc874dddce72b0939924e87';
const releaseRoot='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\planb-release-34e2680';
const manifest=await verifyRelease({releaseRoot});
assert.equal(manifest.commit,commit);
const sourceDigest=manifest.files.find(f=>f.path==='code/source.tar').sha256;
const releaseDigest=sha(await readFile(join(releaseRoot,'release-manifest.json')));

const oldRunId='74cd4ad3-f21b-40ec-96f5-3f9015649e5d';
const failedRunId='d348ae39-27cf-4167-8e35-58de75421309';
const required=['runtime.json','guardian.json','request.json','abort.json','backup.freeze'];

async function injectLegacy(root){
  const guardian={schemaVersion:1,runId:oldRunId,pid:14116,exe:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',startTicks:'639282754410511510',nodePid:45836,jobAssigned:true,jobName:'Local\\TongRuntime-'+oldRunId,killOnJobClose:true,startedAt:'2026-10-22T14:17:42.654Z',finishedAt:'2026-10-23T01:51:05.356Z',nodeExitCode:1,nodeExitHex:'0x00000001',jobActiveBeforeCleanup:0,jobActiveAfterCleanup:0};
  const runtime={schemaVersion:1,runId:oldRunId,phase:'abnormal_exit',profileMode:'production',codeRoot:'D:\\Tong\\app',supervisor:{pid:45836,parentPid:14116,exe:'D:\\node\\node.exe',startTicks:'639282754624971660',markerMatches:true},children:[],descendants:[],pids:[45836],exits:[],startedAt:'2026-10-22T14:17:54.816Z',finishedAt:'2026-10-23T01:51:05.356Z'};
  const request={runId:failedRunId,createdAt:'2026-10-23T10:55:13.368Z',recoveryGrantId:'357a8a67-428d-4192-ad5b-1fe7b642e385'};
  const abort={runId:failedRunId,requestedAt:'2026-10-23T10:55:28.390Z',reason:'START_ABORT'};
  await writeFile(join(root,'run','guardian.json'),JSON.stringify(guardian));
  await writeFile(join(root,'run','runtime.json'),JSON.stringify(runtime));
  await writeFile(join(root,'run','request.json'),JSON.stringify(request));
  await writeFile(join(root,'run','abort.json'),JSON.stringify(abort));
  await writeFile(join(root,'run','backup.freeze'),'');
  return {guardian,runtime,request,abort};
}
async function archive(root){
  const evidence=join(root,'legacy-evidence');await mkdir(join(evidence,'original'),{recursive:true});await mkdir(join(evidence,'retired'),{recursive:true});
  const original={};for(const name of required)original[name]=await readFile(join(root,'run',name));
  for(const [name,value] of Object.entries(original))await writeFile(join(evidence,'original',name),value);
  await writeFile(join(evidence,'snapshot.json'),JSON.stringify({schemaVersion:1,kind:'024-planb',root,oldRunId,failedRunId,files:Object.entries(original).map(([name,value])=>({name,size:value.length,sha256:sha(value)}))}));
  for(const name of [...required.filter(n=>n!=='backup.freeze'),'backup.freeze'])await rename(join(root,'run',name),join(evidence,'retired',name));
  return {evidence,original};
}
async function materialize(target){
  for(const f of manifest.sourceFiles){await mkdir(dirname(join(target,...f.path.split('/'))),{recursive:true});await copyFile(join(releaseRoot,'code','source',...f.path.split('/')),join(target,...f.path.split('/')));}
  for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty'])await cp(join(process.env.TONG_LOGIN_TEST_DEPENDENCIES,'node_modules',...name.split('/')),join(target,'node_modules',...name.split('/')),{recursive:true,force:true});
}

const {root, profile:initialProfile}=await loginFixture({full:true,sharedDependencies:true});
await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));
await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
await issueSimulationLoginRecovery(initialProfile);
await injectLegacy(root);
// 1. Old 024 site is safely rejected before any orchestration.
await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:2000})),/RUNTIME_BUSY/);
// 2. Sealed snapshot + controlled archival (freeze moved last).
const {evidence,original}=await archive(root);
// 3. Rollback restores the exact old control records (reversible, persistent disk state).
for(const name of ['backup.freeze',...required.filter(n=>n!=='backup.freeze')]){await rename(join(evidence,'retired',name),join(root,'run',name));assert.deepEqual(await readFile(join(root,'run',name)),original[name]);}
await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:2000})),/RUNTIME_BUSY/);
// 4. Re-archive (persistent snapshot is re-entrant from a fresh state).
const {evidence:evidence2}=await archive(root);
// 5. Full 34e2680 install (source + deps) + profile/dual-pin/auth binding.
await materialize(initialProfile.codeRoot);await materialize(initialProfile.managerRoot);
const profile={...initialProfile,sourceDigest,releaseDigest};
const pinBytes=await readFile(join(releaseRoot,'release-manifest.json'));
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));
await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});
await writeFile(join(profile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
await revokeSimulationLoginRecovery(root);
await issueSimulationLoginRecovery(profile);

const manager=join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs');
async function command(action,args=[]){
  const child=spawn(process.execPath,[manager,action,'--root',root,'--login-recovery','--error-json',...args],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const timer=setTimeout(()=>child.kill(),180000);const code=await new Promise((ok,rej)=>{child.once('error',rej);child.once('close',ok);});clearTimeout(timer);
  return {code,result:stdout.trim()?JSON.parse(stdout):null,stderr};
}
try{
  // 6. Start acceptance on the installed 34e2680.
  const started=await command('start');assert.equal(started.code,0,'start: '+started.stderr+JSON.stringify(started.result));
  const doctor=await command('doctor');assert.equal(doctor.code,0);assert.equal(doctor.result.healthy,true);
  assert.ok(doctor.result.health?.agentdock?.authenticatedMcp===true);
  assert.ok(doctor.result.health?.tong?.unauthenticatedRejected===true);
  const status=await command('status');assert.equal(status.result.phase,'ready');assert.equal(status.result.supervisorAlive,true);
  // 7. Safe stop; the freeze is transient (open('wx') + unlink), no residual gate.
  const stopped=await command('stop-run',['--run-id',status.result.runId]);assert.equal(stopped.code,0);
  await assert.rejects(lstat(join(root,'run','backup.freeze')),{code:'ENOENT'},'no residual freeze after ready+stop');
  console.log(JSON.stringify({passed:true,phase:'orchestrator',rejectBefore:'RUNTIME_BUSY',archived:true,rollbackRestores024:true,reArchived:true,installed:true,ready:true,doctorHealthy:true,agentdockAuth:true,gatewayAuthBoundary:true,stopped:true,noResidualFreeze:true,runId:status.result.runId}));
}finally{
  const st=await command('status');if(st.code===0&&st.result.supervisorAlive)await command('stop-run',['--run-id',st.result.runId]);
  await revokeSimulationLoginRecovery(root);
}
