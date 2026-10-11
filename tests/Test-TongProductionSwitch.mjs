import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, cp, readdir, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as runtime from '../scripts/TongAgentDockRuntime.mjs';
import * as release from '../scripts/TongRuntimeRelease.mjs';
import { createProductionSimulationProfile, issueSimulationApproval, initializeProductionRoot, productionProfileDigest } from '../scripts/TongProductionProfile.mjs';
import { createProductionStateBackup, restoreProductionStateBackup, verifyProductionStateBackup, applyRestoredProductionState } from '../scripts/TongProductionState.mjs';
import { readSecret, processIdentity, sameProcess, terminateOwnedProcess } from '../scripts/TongRuntimeSecurity.mjs';
import { TongProjectAccess } from '../scripts/TongProjectAccess.mjs';
import { reserveAgentDockOperation } from '../scripts/TongAgentDockOperations.mjs';
import { STATE_ROOT, GIT, PYTHON, OLD_COMMIT, CANDIDATE_COMMIT, sha, fileHash, json, save, delay, localCommand, deployVerifiedRelease, issueOAuth, toolCall, scopedCommand, sqliteEvidence, holdOAuthWal, inspectRedactedLogs } from './fixtures/TongProductionSwitchSupport.mjs';

// Switching code without the preserved-state hook, exact release verifier,
// opt-in backend receipt or DPAPI state restore must fail this contract test.
if(!process.argv.includes('--state-only'))for(const name of ['initializeProductionRuntime','updateRuntimeProfile','startRuntime','stopRuntime','runtimeStatus','runtimeDoctor']) assert.equal(typeof runtime[name],'function','missing production simulation runtime API: '+name);
for(const name of ['buildRelease','restoreRelease','verifyRelease'])assert.equal(typeof release[name],'function','missing exact release API: '+name);
if(process.argv.includes('--contracts')) console.log('PASS: B2.3 switch API contracts; no listener or runtime started.');
else if(process.env.TONG_PRODUCTION_SWITCH_E2E!=='1'&&!process.argv.includes('--state-only'))console.log('SKIP: opt-in protected production topology switch simulation.');
else {
  const live=!process.argv.includes('--state-only');
  const artifactRoot=process.env.TONG_B23_RELEASE_FIXTURE??join(STATE_ROOT,'b23-release-fgKPTn');
  const oldRelease=join(artifactRoot,'release-58786f6'),candidateRelease=process.env.TONG_B23_CANDIDATE_RELEASE??join(artifactRoot,'release-9589698');
  const managerRelease=process.env.TONG_B23_MANAGER_RELEASE??candidateRelease;
  const oldManifest=await release.verifyRelease({releaseRoot:oldRelease,pythonExecutable:PYTHON});assert.equal(oldManifest.commit,OLD_COMMIT);
  const candidateManifest=await release.verifyRelease({releaseRoot:candidateRelease,pythonExecutable:PYTHON});
  const managerManifest=await release.verifyRelease({releaseRoot:managerRelease,pythonExecutable:PYTHON});
  assert.ok(candidateManifest.commit===CANDIDATE_COMMIT||candidateManifest.sourceFiles.some(f=>f.path==='scripts/TongProductionProfile.mjs'),'candidate must have the approved baseline and runtime changes');
  if(live)assert.ok(managerManifest.sourceFiles.some(f=>f.path==='scripts/TongProductionProfile.mjs')&&managerManifest.sourceFiles.some(f=>f.path==='scripts/TongProductionState.mjs'),'live switch requires an exact released B2.3 manager');
  const simulationId='b23-switch-'+randomUUID().replaceAll('-','').slice(0,12);
  const profileFor=async (releaseRoot,manifest,agentdockEnabled=false)=>createProductionSimulationProfile({simulationId,sourceDigest:manifest.files.find(f=>f.path==='code/source.tar').sha256,releaseDigest:await fileHash(join(releaseRoot,'release-manifest.json')),agentdockEnabled});
  const oldProfile=await profileFor(oldRelease,oldManifest),offProfile=await profileFor(candidateRelease,candidateManifest),onProfile=await profileFor(candidateRelease,candidateManifest,true);
  const managerProfile=await profileFor(managerRelease,managerManifest);
  const profile=oldProfile,root=profile.root,records=[],checks={},outputs={};let activeProfile=oldProfile,oauth,connection,wal,agentToken,passed=false;
  const receiptExpiry=new Date(Date.now()+3600000).toISOString();
  async function approve(p,actions) {for(const action of actions)await issueSimulationApproval(p,action,{expiresAt:receiptExpiry});}
  // Approval is issued before the initializer may inspect or create its root.
  await approve(oldProfile,['init','start','stop','backup','restore']);
  if(live)await approve(managerProfile,['manager']);
  if(live)await runtime.initializeProductionRuntime(oldProfile,{releaseRoot:oldRelease,managerReleaseRoot:managerRelease});else await initializeProductionRoot(oldProfile);
  await mkdir(join(root,'releases'),{recursive:true});
  await mkdir(join(root,'state-backups'),{recursive:true});
  await mkdir(join(root,'state-restores'),{recursive:true});
  const cache=join(root,'releases','npm-cache');
  await cp(join(artifactRoot,'npm-cache'),cache,{recursive:true,force:false,errorOnExist:true});
  const oldStage=join(root,'releases','old'),candidateStage=join(root,'releases','candidate');
  const restoreOptions={pythonExecutable:PYTHON,npmCli:'D:\\node\\node_modules\\npm\\bin\\npm-cli.js',npmCacheRoot:cache};
  const oldRestore=await release.restoreRelease({releaseRoot:oldRelease,candidateRoot:oldStage,...restoreOptions});
  const candidateRestore=await release.restoreRelease({releaseRoot:candidateRelease,candidateRoot:candidateStage,...restoreOptions});
  checks.exactOldRelease=oldRestore.commit===OLD_COMMIT&&oldRestore.sqliteNativeLoaded&&oldRestore.patchChecked;
  checks.exactCandidateRelease=candidateRestore.sqliteNativeLoaded&&candidateRestore.patchChecked;
  await deployVerifiedRelease(oldRelease,oldStage,profile.codeRoot,release.verifyRelease);
  if(live) {
    const managerStage=managerRelease===candidateRelease?candidateStage:join(root,'releases','manager-stage');
    if(managerRelease!==candidateRelease)await release.restoreRelease({releaseRoot:managerRelease,candidateRoot:managerStage,...restoreOptions});
    await deployVerifiedRelease(managerRelease,managerStage,profile.managerRoot,release.verifyRelease);
    checks.releasedManager={commit:managerManifest.commit,root:profile.managerRoot};
  }
  for(const path of [profile.runtimeDir,profile.configDir,profile.oauthStateDir,join(root,'workspace','project'),join(root,'workspace','outside')])await mkdir(path,{recursive:true});
  const project=join(root,'workspace','project'),outside=join(root,'workspace','outside'),policyPath=join(root,'tong-policy','agentdock-access.json');
  await writeFile(join(project,'calculator.py'),'def add(a, b):\n    return a - b\n');
  await writeFile(join(project,'test_calculator.py'),'from calculator import add\ndef test_add():\n    assert add(2, 3) == 5\n');
  await writeFile(join(outside,'canary.txt'),'B23_OUTSIDE_CANARY\n');
  await localCommand(GIT,['init','--quiet',project],project);
  await localCommand(GIT,['-C',project,'add','calculator.py','test_calculator.py'],project);
  await localCommand(GIT,['-C',project,'-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','--quiet','-m','synthetic baseline'],project);
  const access=new TongProjectAccess({registryPath:join(profile.runtimeDir,'project-access.json'),agentAccessPath:join(profile.runtimeDir,'agent-execution.json'),demoRoot:profile.demoRoot,scanRoots:[]});
  await access.addProject({id:'b23-synthetic',name:'B2.3 synthetic',root:project,permission:'write'});
  await save(join(profile.runtimeDir,'agent-execution.json'),{schemaVersion:1,projects:['b23-synthetic']});
  const trusted={schemaVersion:1,enabled:false,executable:null,projects:['b23-synthetic'],approvals:[],generation:4};
  await save(join(profile.runtimeDir,'trusted-codex.json'),trusted);
  await writeFile(join(profile.runtimeDir,'trusted-codex.json.stop'),'B23_SYNTHETIC_TRUSTED_DISABLED\n');
  const stopHash=await fileHash(join(profile.runtimeDir,'trusted-codex.json.stop'));
  const historicalTaskId=randomUUID();
  await save(join(profile.runtimeDir,'agent-tasks.json'),{schemaVersion:1,tasks:[{taskId:historicalTaskId,projectId:'b23-synthetic',agent:'codex',status:'success',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),logs:[],codexSessionId:null,pendingApproval:false}]});
  const config={host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}};
  await save(join(profile.configDir,'config.json'),config);
  await writeFile(join(profile.configDir,'auth.json'),JSON.stringify({schemaVersion:1,syntheticOnly:true,ownerTokenSource:'CurrentUser-DPAPI'}));
  await save(join(profile.originalTongRoot,'config','tong.config.json'),{schemaVersion:1,syntheticOnly:true,workspaceRoot:profile.demoRoot,scanRoots:[]});
  const tongConfigHash=await fileHash(join(profile.originalTongRoot,'config','tong.config.json'));
  const configHash=await fileHash(join(profile.configDir,'config.json')),authHash=await fileHash(join(profile.configDir,'auth.json'));
  const commandProfile=async path=>({path,sha256:await fileHash(path)});
  const policy={schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[{projectId:'b23-synthetic',root:project,scope:'synthetic',tools:['read_file','list_dir','search_text'],commands:{python:await commandProfile(PYTHON),git:await commandProfile(GIT),pytestEntry:'test_calculator.py',gitDiffPaths:['calculator.py']}}],approvals:[]};
  await save(policyPath,policy);
  const oldKey=randomUUID(),newKey=randomUUID(),taskId='b23-switch-task';
  await reserveAgentDockOperation(policyPath,{projects:[]},'tong_agentdock_command',{projectId:'b23-synthetic',taskId,approvalId:'b23-old',idempotencyKey:oldKey,operation:'git_status'});
  const backupRoot=join(root,'state-backups','before-switch'),restoreRoot=join(root,'state-restores','rollback');
  try {
    if(!live) {
      const {openDatabase}=await import(pathToFileURL(join(profile.codeRoot,'node_modules/@waishnav/devspace/dist/db/client.js')).href);
      const database=openDatabase(profile.oauthStateDir);database.close();
      const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
      try {
        await delay(300);
        await assert.rejects(createProductionStateBackup(profile,{backupRoot:join(root,'state-backups','initial-stopped')}),/STATE_CRYPTO_UNAVAILABLE/);
        checks.initialStoppedUnclassifiedNodeRefused=true;
      } finally {unrelated.kill();await new Promise(ok=>unrelated.once('close',ok));}
      await save(join(root,'run','runtime.json'),{runId:'synthetic-stopped-unit-fixture',phase:'stopped',children:[],descendants:[]});
      await save(join(root,'run','guardian.json'),{runId:'synthetic-stopped-unit-fixture',finishedAt:new Date().toISOString(),jobActiveAfterCleanup:1});
      await assert.rejects(createProductionStateBackup(profile,{backupRoot}),/STATE_RUNTIME_NOT_STOPPED/);
      await save(join(root,'run','guardian.json'),{runId:'synthetic-stopped-unit-fixture',finishedAt:new Date().toISOString(),jobActiveAfterCleanup:0});
    } else {
      const oldRun=await runtime.startRuntime(root);assert.equal(oldRun.phase,'ready');assert.ok(!oldRun.children.some(c=>c.role==='agentdock'));
      assert.equal((await runtime.runtimeDoctor(root)).healthy,true);
      oauth=await issueOAuth(profile.publicOrigin,await readSecret(root,'oauth-owner'));
      connection=await oauth.connect(14);checks.oldAuthenticated14Tools=connection.tools;
      const projects=await toolCall(connection.client,'tong_list_projects',{},records,oauth);assert.ok(projects.structuredContent.projects.some(p=>p.id==='b23-synthetic'&&p.root===project));
      assert.ok((await toolCall(connection.client,'tong_agent_list',{},records,oauth)).structuredContent.tasks.some(t=>t.taskId===historicalTaskId&&t.status==='success'));
      const denied=await toolCall(connection.client,'tong_agent_start',{projectId:'b23-synthetic',agent:'codex',task:'Synthetic disabled trusted execution check',scope:'calculator.py',idempotencyKey:randomUUID()},records,oauth);assert.equal(denied.isError,true);
      checks.oldTrustedDisabled=true;
      wal=holdOAuthWal(profile.codeRoot,join(profile.oauthStateDir,'devspace.sqlite'));
      await oauth.refresh();checks.oldRefresh=true;
      await connection.client.close();connection=undefined;
      await runtime.stopRuntime(root);
      // A last readonly connection cannot checkpoint the pending WAL. Close
      // its shared-memory handle before native FileShare.Read snapshot locks.
      wal.close();wal=undefined;
      assert.ok((await lstat(join(profile.oauthStateDir,'devspace.sqlite-wal'))).size>0);
    }
    const before=sqliteEvidence(profile.codeRoot,join(profile.oauthStateDir,'devspace.sqlite'));
    // Snapshot queued/running records as evidence after the old runtime stopped.
    const tasks=await json(join(profile.runtimeDir,'agent-tasks.json'));
    tasks.tasks.push(...['queued','running'].map(status=>({taskId:randomUUID(),projectId:'b23-synthetic',agent:'codex',status,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),logs:[],codexSessionId:'synthetic-session',pendingApproval:true})));
    await save(join(profile.runtimeDir,'agent-tasks.json'),tasks);
    await unlink(join(profile.runtimeDir,'trusted-codex.json'));
    await unlink(join(profile.runtimeDir,'agent-execution.json'));
    const snapshot=await createProductionStateBackup(profile,{backupRoot});checks.encryptedStateSnapshot=snapshot.encrypted;
    assert.ok(!snapshot.files.some(f=>['runtime/trusted-codex.json','runtime/agent-execution.json'].includes(f.logical)));
    await save(join(profile.runtimeDir,'trusted-codex.json'),{...trusted,enabled:true,approvals:[{syntheticOnly:true}]});
    await save(join(profile.runtimeDir,'agent-execution.json'),{schemaVersion:1,projects:['b23-synthetic']});
    if(live)assert.ok(snapshot.files.some(file=>file.logical==='oauth/devspace.sqlite-wal'));checks.nativeOAuthWalSnapshot=live;
    for(const file of snapshot.files) {const bytes=await readFile(join(backupRoot,file.encryptedFile));assert.ok(!bytes.includes(Buffer.from('B23_SYNTHETIC_TRUSTED_DISABLED')));if(oauth)oauth.assertRedacted(bytes);}
    await verifyProductionStateBackup(profile,{backupRoot});
    const encryptedPath=join(backupRoot,snapshot.files[0].encryptedFile),encryptedBytes=await readFile(encryptedPath);await writeFile(encryptedPath,'tamper');await assert.rejects(verifyProductionStateBackup(profile,{backupRoot}),/STATE_HASH_MISMATCH/);await writeFile(encryptedPath,encryptedBytes);checks.encryptedTamperRejected=true;
    if(live) {
      await approve(offProfile,['start','stop']);
      await deployVerifiedRelease(candidateRelease,candidateStage,profile.codeRoot,release.verifyRelease);
      await runtime.updateRuntimeProfile(offProfile,{releaseRoot:candidateRelease,managerReleaseRoot:managerRelease});activeProfile=offProfile;
      const offRun=await runtime.startRuntime(root);assert.ok(!offRun.children.some(c=>c.role==='agentdock'));
      connection=await oauth.connect(14);checks.candidateDefaultOff14=connection.tools;
      await oauth.refresh();checks.oauthPreservedAtCandidateOff=true;
      const list=await toolCall(connection.client,'tong_list_projects',{},records,oauth);assert.ok(list.structuredContent.projects.some(p=>p.id==='b23-synthetic'&&p.root===project));
      assert.ok((await toolCall(connection.client,'tong_agent_list',{},records,oauth)).structuredContent.tasks.some(t=>t.taskId===historicalTaskId&&t.status==='success'));
      await connection.client.close();connection=undefined;await runtime.stopRuntime(root);
      await approve(onProfile,['start','stop','enable-agentdock']);
      await runtime.updateRuntimeProfile(onProfile,{releaseRoot:candidateRelease,managerReleaseRoot:managerRelease});activeProfile=onProfile;
      const onRun=await runtime.startRuntime(root);assert.ok(onRun.children.some(c=>c.role==='agentdock'));
      connection=await oauth.connect(21);checks.enabled21Tools=connection.tools;
      assert.ok((await toolCall(connection.client,'tong_agent_list',{},records,oauth)).structuredContent.tasks.some(t=>t.taskId===historicalTaskId&&t.status==='success'));
      assert.equal((await runtime.runtimeDoctor(root)).healthy,true);
      const common={projectId:'b23-synthetic',taskId},write={...common,approvalId:'b23-local-write'},command={...common,approvalId:'b23-local-command'};
      const denied=await toolCall(connection.client,'tong_agentdock_file_edit',{...write,action:'replace',path:'calculator.py',old:'a - b',new:'a + b'},records,oauth);assert.equal(denied.structuredContent.code,'APPROVAL_DENIED');
      policy.approvals=[{...write,capability:'project.write',operations:['replace'],paths:['calculator.py'],expiresAt:receiptExpiry},{...command,capability:'command.execute',operations:['pytest','git_status','git_diff'],paths:['test_calculator.py','calculator.py','.'],expiresAt:receiptExpiry}];await save(policyPath,policy);
      const edit={...write,action:'replace',path:'calculator.py',old:'a - b',new:'a + b',idempotencyKey:newKey};
      assert.equal((await toolCall(connection.client,'tong_agentdock_file_edit',edit,records,oauth)).structuredContent.verified,true);
      assert.equal((await toolCall(connection.client,'tong_agentdock_file_edit',edit,records,oauth)).structuredContent.code,'REPLAY_DENIED');
      outputs.pytest=await scopedCommand(connection.client,{...command,operation:'pytest'},records,oauth);assert.equal(outputs.pytest.exitCode,0);assert.ok(outputs.pytest.stdout.includes('1 passed'));
      outputs.gitStatus=await scopedCommand(connection.client,{...command,operation:'git_status'},records,oauth);assert.equal(outputs.gitStatus.exitCode,0);assert.ok(outputs.gitStatus.stdout.includes('calculator.py'));
      outputs.gitDiff=await scopedCommand(connection.client,{...command,operation:'git_diff'},records,oauth);assert.equal(outputs.gitDiff.exitCode,0);assert.ok(outputs.gitDiff.stdout.includes('+    return a + b'));
      assert.equal((await toolCall(connection.client,'tong_agentdock_read_file',{projectId:'b23-synthetic',path:'../outside/canary.txt'},records,oauth)).isError,true);
      assert.equal(await readFile(join(outside,'canary.txt'),'utf8'),'B23_OUTSIDE_CANARY\n');checks.scopedEditPytestGit=true;
      await oauth.refresh();checks.oauthPreservedAtCandidateOn=true;
      agentToken=await readSecret(root,'agentdock');
      await connection.client.close();connection=undefined;
      const owned=onRun.children.find(c=>c.role==='devspace');assert.ok(sameProcess(await processIdentity(owned.pid),owned));
      await save(join(root,'logs','planned-fault.json'),{schemaVersion:1,planned:true,kind:'terminate-owned-devspace',runId:onRun.runId,identity:owned,requestedAt:new Date().toISOString()});
      await terminateOwnedProcess(owned);
      let fault;
      for(let n=0;n<300;n++){fault=await runtime.runtimeStatus(root);const guardian=await json(join(root,'run','guardian.json'));if(!fault.supervisorAlive&&guardian.runId===onRun.runId&&guardian.finishedAt&&guardian.jobActiveAfterCleanup===0)break;await delay(100);}
      assert.equal(fault.phase,'abnormal_exit');assert.ok(fault.exits.some(e=>e.role==='devspace'&&e.exitCode!==0));
      await runtime.stopRuntime(root);const guardian=await json(join(root,'run','guardian.json'));assert.equal(guardian.jobActiveAfterCleanup,0);checks.plannedFaultJobCleanup={nodeExitCode:guardian.nodeExitCode,jobActiveAfterCleanup:0,exits:fault.exits};
      for(const identity of onRun.children)assert.equal(sameProcess(await processIdentity(identity.pid),identity),false);
    } else await reserveAgentDockOperation(policyPath,{projects:[]},'tong_agentdock_command',{projectId:'b23-synthetic',taskId,approvalId:'b23-new',idempotencyKey:newKey,operation:'git_status'});
    const latest=sqliteEvidence(profile.codeRoot,join(profile.oauthStateDir,'devspace.sqlite'));
    const restored=await restoreProductionStateBackup(oldProfile,{backupRoot,restoreRoot});
    assert.equal(restored.executionDisabled,true);assert.equal(restored.autoDispatch,false);assert.ok(restored.latestJournalRecords>=2);
    assert.equal((await json(join(restored.runtimeDir,'trusted-codex.json'))).enabled,false);
    assert.equal((await json(join(restored.runtimeDir,'agent-execution.json'))).projects.length,0);
    assert.ok((await json(join(restored.runtimeDir,'project-access.json'))).projects.every(p=>p.status==='disabled'));
    const restoredTasks=await json(join(restored.runtimeDir,'agent-tasks.json'));assert.ok(restoredTasks.tasks.filter(t=>['queued','running'].includes(t.restoreOriginalStatus)).every(t=>t.status==='failed'&&!t.pendingApproval&&t.codexSessionId===null));
    assert.deepEqual(sqliteEvidence(profile.codeRoot,join(restored.oauthStateDir,'devspace.sqlite')),latest);
    assert.equal(await fileHash(join(restored.runtimeDir,'trusted-codex.json.stop')),stopHash);
    for(const key of [oldKey,newKey])await assert.rejects(reserveAgentDockOperation(join(restored.policyDir,'agentdock-access.json'),{projects:[]},'tong_agentdock_command',{projectId:'b23-synthetic',taskId,approvalId:'unused',idempotencyKey:key,operation:'git_status'}),e=>e.code==='REPLAY_DENIED');
    await applyRestoredProductionState(oldProfile,{restoreRoot});
    checks.rollbackGrantsDisabled=true;checks.oldAndNewestJournalReplayDenied=true;checks.rollbackTaskReconciliation=true;checks.latestOAuthPreserved=true;
    await deployVerifiedRelease(oldRelease,oldStage,profile.codeRoot,release.verifyRelease,live?{previousReleaseRoot:candidateRelease}:{});
    if(live) {
      await approve(oldProfile,['start','stop','disable-agentdock']);await runtime.updateRuntimeProfile(oldProfile,{releaseRoot:oldRelease,managerReleaseRoot:managerRelease});activeProfile=oldProfile;
      const rolled=await runtime.startRuntime(root);assert.ok(!rolled.children.some(c=>c.role==='agentdock'));
      await oauth.refresh();connection=await oauth.connect(14);checks.rollbackOldAuthenticated14Tools=connection.tools;
      const projects=await toolCall(connection.client,'tong_list_projects',{},records,oauth);assert.ok(projects.structuredContent.projects.some(p=>p.id==='demo'&&p.root===profile.demoRoot));assert.ok(projects.structuredContent.projects.some(p=>p.id==='b23-synthetic'&&p.status==='disabled'&&!p.effectiveCapabilities.includes('agent.execute')));
      const taskList=(await toolCall(connection.client,'tong_agent_list',{},records,oauth)).structuredContent.tasks;
      assert.ok(taskList.some(t=>t.taskId===historicalTaskId&&t.status==='success'));
      assert.ok(restoredTasks.tasks.filter(t=>['queued','running'].includes(t.restoreOriginalStatus)).every(t=>taskList.some(actual=>actual.taskId===t.taskId&&actual.status==='failed'&&!actual.codexSessionId)));
      checks.originalTaskStatePathUsable=true;
      const denied=await toolCall(connection.client,'tong_agent_start',{projectId:'b23-synthetic',agent:'codex',task:'Synthetic rollback must remain denied',scope:'calculator.py',idempotencyKey:randomUUID()},records,oauth);assert.equal(denied.isError,true);
      await connection.client.close();connection=undefined;await runtime.stopRuntime(root);checks.rollbackOldUsable=true;
      await inspectRedactedLogs(profile,oauth,agentToken);checks.credentialsAbsentFromLogs=true;
    }
    assert.equal(await fileHash(join(profile.configDir,'config.json')),configHash);assert.equal(await fileHash(join(profile.configDir,'auth.json')),authHash);
    assert.equal(await fileHash(join(profile.originalTongRoot,'config','tong.config.json')),tongConfigHash);
    assert.equal(await fileHash(join(profile.runtimeDir,'trusted-codex.json.stop')),stopHash);
    checks.preservedExactLegacyPaths=true;checks.configAuthTrustedStopUnchanged=true;
    passed=true;
    const result={schemaVersion:1,passed,live,syntheticOnly:true,root,oldCommit:OLD_COMMIT,candidateCommit:candidateManifest.commit,profileDigests:{old:productionProfileDigest(oldProfile),candidateOff:productionProfileDigest(offProfile),candidateOn:productionProfileDigest(onProfile)},checks,outputs,records,oauth:oauth?.evidence(),sqliteBefore:before,sqliteLatest:latest,backupRoot,restoreRoot};
    if(oauth)oauth.assertRedacted(result);await save(join(root,'logs','switch-result.json'),result);
    console.log(JSON.stringify({passed,live,root,oldCommit:OLD_COMMIT,candidateCommit:candidateManifest.commit,checks}));
  } finally {
    await connection?.client.close().catch(()=>{});
    if(live){const status=await runtime.runtimeStatus(root);if(status.supervisorAlive)await runtime.stopRuntime(root);}
    wal?.close();
    const finalStatus=live?await runtime.runtimeStatus(root):await json(join(root,'run','runtime.json')).catch(()=>({phase:'no-runtime-record'}));
    await save(join(root,'logs','switch-final.json'),{schemaVersion:1,passed,live,root,activeProfileDigest:productionProfileDigest(activeProfile),phase:finalStatus.phase,supervisorAlive:finalStatus.supervisorAlive,finishedAt:new Date().toISOString()});
  }
}
