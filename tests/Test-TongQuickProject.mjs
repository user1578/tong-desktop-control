import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TongProjectAccess} from '../scripts/TongProjectAccess.mjs';
import {TongTrustedPolicy,TongTrustedCodexBroker} from '../scripts/TongTrustedCodexBroker.mjs';
import {prepareTrustedProject} from '../scripts/TongQuickProject.mjs';

// Test uses disposable *local* state and a fake Codex EXE. Never touches
// production Tong state or creates a real model turn.
const base=process.platform==='win32'?(process.env.RUNNER_TEMP || 'D:\\Tong\\state'):tmpdir();
const tmp=await mkdtemp(join(base,'tong-quick-trust-'));
try{
  const folder=join(tmp,'homework'),other=join(tmp,'outside'),state=join(tmp,'state');
  const existing=join(folder,'26ict','TravelGuard');
  const fresh=join(folder,'another-app');
  const external=join(other,'extra');
  for(const p of [existing,fresh,external,state])await mkdir(p,{recursive:true});
  const demo=join(tmp,'demo');
  const access=new TongProjectAccess({
    registryPath:join(state,'project-access.json'),
    agentAccessPath:join(state,'agent-execution.json'),demoRoot:demo,
  });
  const exe=join(tmp,'codex.exe');await writeFile(exe,'mock binary');
  const policy=new TongTrustedPolicy({
    policyPath:join(state,'trusted-codex.json'),taskStatePath:join(state,'tasks.json'),
  });
  await policy.enable(exe);
  // This project was already registered with read/write but had no Codex grant.
  await access.addProject({id:'travelguard',name:'TravelGuard',root:existing,permission:'write'});
  await access.grantAgentExecution('travelguard');
  const before=await prepareTrustedProject({projectPath:existing},{access,policy});
  assert.deepEqual({ready:before.ready,reason:before.reason},
    {ready:false,reason:'folder-needs-local-trust'});
  assert.equal((await policy.read()).projects.length,0);
  const trusted=await policy.trustRoot(folder,access,{gitCommit:true,gitPush:true});
  assert.equal(trusted.root,folder);
  assert.equal(trusted.capabilities.includes('git.push'),true);
  await assert.rejects(policy.trustRoot(folder,access),/already configured/);
  await assert.rejects(policy.trustRoot(tmp,access),/authorization state directory/);
  const enrolled=await prepareTrustedProject({projectPath:existing,projectId:'travelguard'},
    {access,policy});
  assert.equal(enrolled.ready,true);
  assert.equal(enrolled.projectId,'travelguard');
  assert.equal(enrolled.gitPush,true);
  assert.equal(enrolled.needsTaskConfirmation,false);
  assert.equal(enrolled.highImpactRequiresConfirmation,true);
  let grants=(await policy.read()).developmentGrants;
  assert.equal(grants.length,1);
  assert.equal(grants[0].originTrustGrantId,trusted.grantId);
  const id=grants[0].grantId;
  await prepareTrustedProject({projectPath:existing},{access,policy});
  assert.equal((await policy.read()).developmentGrants[0].grantId,id,
    'repeated task must reuse authorization');
  const broker=new TongTrustedCodexBroker({access,policy,adapterFactory:()=>({
    async listSessions(){return {sessions:[]}},
  })});
  assert.equal((await broker.preflight({projectId:'travelguard',projectRoot:existing}))
    .authorization.mode,'project-development');
  assert.equal((await broker.preflight({projectId:'travelguard',projectRoot:existing,
    workType:'high-impact'})).authorization.mode,'local-task-confirmation');
  const auto=await prepareTrustedProject({projectPath:fresh},{access,policy});
  assert.equal(auto.ready,true);
  assert.match(auto.projectId,/^another-app-[0-9a-f]{8}$/);
  assert.equal((await access.authorize('agent.execute',auto.projectId)),true);
  assert.equal((await policy.read()).developmentGrants.length,2);
  const untrusted=await prepareTrustedProject({projectPath:external},{access,policy});
  assert.equal(untrusted.ready,false);
  assert.equal((await access.listProjects()).some(p=>p.root===external),false);
  await assert.rejects(prepareTrustedProject({projectPath:existing,
    projectId:'not-travelguard'},{access,policy}),/does not match/);
  // A separate locally trusted second root covers other locations.
  const second=await policy.trustRoot(other,access);
  assert.equal(second.capabilities.includes('git.push'),false);
  const externalReady=await prepareTrustedProject({projectPath:external},{access,policy});
  assert.equal(externalReady.ready,true);
  assert.equal(externalReady.gitPush,false);
  assert.equal((await policy.read()).developmentGrants.length,3);
  await policy.untrustRoot(folder);
  grants=(await policy.read()).developmentGrants;
  assert.equal(grants.length,1);
  assert.equal(grants[0].projectId,externalReady.projectId);
  await assert.rejects(broker.preflight({projectId:'travelguard',projectRoot:existing}),/grant is missing/);
  assert.equal((await prepareTrustedProject({projectPath:existing},{access,policy})).ready,false);
  assert.equal((await broker.preflight({projectId:externalReady.projectId,projectRoot:external}))
    .authorization.mode,'project-development');
  await policy.untrustRoot(other);
  assert.equal((await policy.read()).developmentGrants.length,0);
  assert.equal((await policy.read()).trustedRoots.length,0);
  await assert.rejects(policy.untrustRoot(other),/not found/);
  await broker.close();
  console.log('PASS: one-time trusted root, auto-enroll existing/new projects, reuse native Codex grant, high-impact prompt, revoke, outside-root rejection.');
}finally{
  await rm(tmp,{recursive:true,force:true});
}
