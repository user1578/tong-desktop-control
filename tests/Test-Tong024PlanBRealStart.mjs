import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, copyFile, cp} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture, sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery, revokeSimulationLoginRecovery, withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {protectSecret, safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';

const commit='34e26801876d8b1a2fc874dddce72b0939924e87';
const releaseRoot='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\planb-release-34e2680';
// Re-verify the exact release inside the test (manifest integrity + archive hashes + commit).
const verified=await verifyRelease({releaseRoot});
assert.equal(verified.commit,commit,'release commit must be exactly 34e2680');
assert.equal(verified.sourceFiles.length,299);
assert.equal(verified.native.length,23);
const manifest=verified;
const sourceDigest='d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9';
const releaseDigest='160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062';
assert.equal(manifest.files.find(f=>f.path==='code/source.tar').sha256,sourceDigest);

async function materialize(target){
  // Real 299-file source tree (scripts, docs, tests, package.json, ...).
  for(const f of manifest.sourceFiles){
    await mkdir(dirname(join(target,...f.path.split('/'))),{recursive:true});
    await copyFile(join(releaseRoot,'code','source',...f.path.split('/')),join(target,...f.path.split('/')));
  }
  // The four runtime dependencies, copied as real files (not junctions) so the
  // manifest's native/devspace/versions checks and the runtime's imports both pass.
  const deps=process.env.TONG_LOGIN_TEST_DEPENDENCIES;
  for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty']){
    await cp(join(deps,'node_modules',...name.split('/')),join(target,'node_modules',...name.split('/')),{recursive:true,force:true});
  }
}

const {root, profile:initialProfile}=await loginFixture({full:true,sharedDependencies:true});
await materialize(initialProfile.codeRoot);
await materialize(initialProfile.managerRoot);
const profile={...initialProfile,sourceDigest,releaseDigest};
const pinBytes=await readFile(join(releaseRoot,'release-manifest.json'));
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));
await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));
await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});
await writeFile(join(profile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
await issueSimulationLoginRecovery(profile);
// Explicit dual-component binding: App and Manager each independently verified.
await withLoginRecovery(root,'start',async()=>{
  assert.equal((await verifyRuntimeCandidate(profile)).commit,commit,'App candidate binding');
  assert.equal((await verifyRuntimeCandidate(profile,{manager:true})).commit,commit,'Manager candidate binding');
});

const manager=join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs');
async function command(action,args=[]){
  const began=Date.now();
  const child=spawn(process.execPath,['--report-on-fatalerror','--report-exclude-env','--report-exclude-network','--report-directory='+root,manager,action,'--root',root,'--login-recovery','--error-json',...args],{cwd:root,env:safeEnvironment(root),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const timeout=setTimeout(()=>child.kill(),180000);
  const code=await new Promise((ok,rej)=>{child.once('error',rej);child.once('close',ok);});clearTimeout(timeout);
  return {code,result:stdout.trim()?JSON.parse(stdout):null,stderr};
}

try{
  const started=await command('start');
  assert.equal(started.code,0,'start failed: '+started.stderr+JSON.stringify(started.result));
  const doctor=await command('doctor');
  assert.equal(doctor.code,0);assert.equal(doctor.result.healthy,true,'doctor not healthy: '+JSON.stringify(doctor.result));
  assert.ok(doctor.result.health?.agentdock?.authenticatedMcp===true,'agentdock authenticated MCP missing');
  assert.ok(doctor.result.health?.tong?.unauthenticatedRejected===true,'gateway unauthenticated-reject missing');
  const status=await command('status');
  assert.equal(status.code,0);assert.equal(status.result.phase,'ready');assert.equal(status.result.supervisorAlive,true);
  const runId=status.result.runId;
  const stopped=await command('stop-run',['--run-id',runId]);
  assert.equal(stopped.code,0,'stop failed: '+stopped.stderr+JSON.stringify(stopped.result));
  console.log(JSON.stringify({passed:true,phase:'real-release-start',commit:manifest.commit,sourceFiles:manifest.sourceFiles.length,native:manifest.native.length,sourceDigest,releaseDigest,ready:true,doctorHealthy:true,agentdockAuth:true,gatewayAuthBoundary:true,stopped:true,runId}));
}finally{
  const status=await command('status');if(status.code===0&&status.result.supervisorAlive)await command('stop-run',['--run-id',status.result.runId]);
  await revokeSimulationLoginRecovery(root);
}
