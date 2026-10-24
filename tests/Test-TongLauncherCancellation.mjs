import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {processIdentity,startupJobsState,sameProcess,protectSecret} from '../scripts/TongRuntimeSecurity.mjs';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,withLoginRecovery,revokeSimulationLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {childLifecycle} from './fixtures/ChildLifecycle.mjs';
const scripts=new URL('../scripts/',import.meta.url);
const launch=(await readFile(new URL('TongRuntimeLaunch.ps1',scripts),'utf8')).replaceAll('\r\n','\n');
const create="$childId=[TongStartupPreflight]::StartGuardian(('Local\\TongGuardian-'+$RunId),$guardianShell,$arguments,$Root,$adoptionBudget)";
const abort="[IO.File]::WriteAllText((Join-Path $Root 'run\\abort.json'),(@{runId=$RunId}|ConvertTo-Json -Compress))";
const roots=[];
console.log(JSON.stringify({event:'cancellation_test_host',pid:process.pid,exe:process.execPath,node:process.version,stage:'cases'}));
for(const mode of ['before_create','after_create','lost_stdout']){
  console.log(JSON.stringify({event:'cancellation_test_stage',mode,stage:'begin'}));
  const root=await mkdtemp('D:\\Tong\\state\\launcher-race-test-');roots.push(root);
  await mkdir(join(root,'run'));await mkdir(join(root,'logs'));await mkdir(join(root,'scripts'));
  const runId=randomUUID();await writeFile(join(root,'run','request.json'),JSON.stringify({runId,startupDeadline:Date.now()+30000}));
  const supervisor=join(root,'supervisor.mjs');await writeFile(supervisor,"setTimeout(()=>process.exit(23),500);");
  for(const name of ['TongRuntimeGuardian.ps1','TongStartupProtocol.ps1'])await copyFile(new URL(name,scripts),join(root,'scripts',name));
  if(mode==='after_create'){
    const path=join(root,'scripts/TongRuntimeGuardian.ps1'),source=await readFile(path,'utf8');
    const adoption='[TongStartupPreflight]::AdoptGuardian($OwnerJobName)';
    assert.ok(source.includes(adoption));
    await writeFile(path,source.replace(adoption,adoption+"\n        $until=[DateTime]::UtcNow.AddSeconds(5);while(-not (Test-Path (Join-Path $Root 'run\\abort.json')) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 25}"));
  }
  let variant=launch;
  if(mode==='before_create')variant=variant.replace("    Assert-TongStartupActive\n    Set-TongStartupStage 'create_guardian'",`    ${abort}\n    Assert-TongStartupActive\n    Set-TongStartupStage 'create_guardian'`);
  if(mode==='after_create')variant=variant.replace(create,create+'\n    '+abort);
  if(mode==='lost_stdout')variant=variant.replace('[pscustomobject]@{pid=$childId} | ConvertTo-Json -Compress',"# Test-only copy drops stdout; durable ownership receipt remains.");
  assert.ok(variant!==launch,'test must alter its private copy');
  const path=join(root,'scripts','TongRuntimeLaunch.ps1');await writeFile(path,variant);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
  const child=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-File',path,'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',supervisor],{encoding:'utf8',env,windowsHide:true,timeout:35000});
  assert.equal(child.status,mode==='before_create'?2:0,child.stderr);
  const receipt=JSON.parse(await readFile(join(root,'run',`launcher.${runId}.json`),'utf8'));
  assert.equal(receipt.runId,runId);assert.equal(receipt.preflightClean,true);assert.ok(receipt.finishedAt);
  assert.equal(receipt.guardianCreated,mode!=='before_create');
  if(mode==='before_create')assert.equal(receipt.code,'START_ABORT');
  else{
    assert.ok(receipt.guardian?.pid,'created Guardian must have a durable identity');
    for(let n=0;n<100;n++){
      if(!sameProcess(await processIdentity(receipt.guardian.pid),receipt.guardian))break;
      if(n===99)throw Error('Guardian survived cancellation/completion');await new Promise(ok=>setTimeout(ok,50));
    }
  }
  assert.deepEqual(await startupJobsState(runId),{owner:0,launcher:0,guardian:0,runtime:0});
  if(mode==='after_create')await assert.rejects(readFile(join(root,'run','guardian.json')),{code:'ENOENT'},'cancel before Guardian initialization must not create its runtime Job');
  if(mode==='lost_stdout')assert.equal(child.stdout.trim(),'');
  console.log(JSON.stringify({event:'cancellation_test_stage',mode,stage:'complete',runId,root}));
}
console.log(JSON.stringify({event:'cancellation_test_stage',mode:'manager',stage:'fixture'}));
// Exercise the final Manager predicate against actual CIM identities, real
// pinned scripts, protected test state and kernel Job queries, not API doubles.
const {root,profile}=await loginFixture({ports:{gatewayPort:29216,upstreamPort:29217,agentdockPort:29215}});
await protectSecret(root,'agentdock','a'.repeat(64));await protectSecret(root,'oauth-owner','b'.repeat(64));
await issueSimulationLoginRecovery(profile);
try{
  console.log(JSON.stringify({event:'cancellation_test_stage',mode:'manager',stage:'start'}));
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:1})),error=>error.message==='START_TIMEOUT'&&error.startupFailure.cleanup.proven===true);
  await assert.rejects(readFile(join(root,'run','backup.freeze')),{code:'ENOENT'});
  const request=JSON.parse(await readFile(join(root,'run','request.json'),'utf8'));
  const receipt=JSON.parse(await readFile(join(root,'run',`launcher.${request.runId}.json`),'utf8'));
  assert.equal(receipt.guardianCreated,false);assert.equal(receipt.preflightClean,true);
  assert.deepEqual(await startupJobsState(request.runId),{owner:0,launcher:0,guardian:0,runtime:0});
}finally{await revokeSimulationLoginRecovery(root);}
// Model the historical host-loss boundary, without pretending TerminateProcess
// reproduces an unknown fast-fail. The pause exists only in a sealed private
// Manager copy; the shipped Manager gets no test hook or authorization bypass.
const death=await loginFixture();
await symlink(new URL('../node_modules',import.meta.url),join(death.root,'node_modules'),'junction');
const managerPath=join(death.profile.managerRoot,'scripts/TongAgentDockRuntime.mjs');
const managerSource=await readFile(managerPath,'utf8');
const paused=Buffer.from(managerSource.replace("    await checkpoint('binary_hash');","    await checkpoint('binary_hash');\n    console.log('READY');await new Promise(()=>setInterval(()=>{},1000));"));
assert.notEqual(paused.toString(),managerSource);
const deathPin=JSON.parse(await readFile(join(death.root,'run/manager-pin.json'),'utf8'));
Object.assign(deathPin.sourceFiles.find(file=>file.path==='scripts/TongAgentDockRuntime.mjs'),{size:paused.length,sha256:sha(paused)});
for(const target of [death.profile.codeRoot,death.profile.managerRoot])await writeFile(join(target,'scripts/TongAgentDockRuntime.mjs'),paused);
const deathBytes=Buffer.from(JSON.stringify(deathPin)),deathProfile={...death.profile,releaseDigest:sha(deathBytes)};
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(death.root,'run',name),deathBytes);
await writeFile(join(death.root,'profile.json'),JSON.stringify(deathProfile));await issueSimulationLoginRecovery(deathProfile);
const host=spawn(process.execPath,[managerPath,'start','--root',death.root,'--login-recovery','--error-json'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const hostLife=childLifecycle(host,{timeoutMs:15000});let hostIdentity,hostExit;
try{
  await hostLife.ready();hostIdentity=await processIdentity(host.pid);assert.ok(hostIdentity);
  await readFile(join(death.root,'run/backup.freeze'));
  await assert.rejects(readFile(join(death.root,'run/request.json')),{code:'ENOENT'});
  host.kill();hostExit=await hostLife.close();assert.notEqual(hostExit.code,0);
  assert.equal(sameProcess(await processIdentity(host.pid),hostIdentity),false);
  await readFile(join(death.root,'run/backup.freeze'));
  await assert.rejects(readFile(join(death.root,'run/guardian.json')),{code:'ENOENT'});
  await assert.rejects(withLoginRecovery(death.root,'start',()=>startRuntime(death.root)),/RUNTIME_BUSY/);
}finally{if(host.exitCode===null)host.kill();await hostLife.close();await revokeSimulationLoginRecovery(death.root);}
console.log(JSON.stringify({passed:true,beforeCreate:true,afterCreate:true,lostStdout:true,noLateGuardian:true,jobsEmpty:true,actualManagerProof:true,roots,managerRoot:root,hostLoss:{root:death.root,identity:hostIdentity,exit:hostExit,stage:'binary_hash',lockRetained:true,requestNeverPublished:true,historicalFastFailReproduced:false}}));
