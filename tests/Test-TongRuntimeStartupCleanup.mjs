import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loginFixture,sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {createProductionSimulationProfile} from '../scripts/TongProductionProfile.mjs';
import {issueSimulationLoginRecovery,withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret,processIdentity} from '../scripts/TongRuntimeSecurity.mjs';
import {spawnSync} from 'node:child_process';

const {root,profile:initial}=await loginFixture({ports:{gatewayPort:27876,upstreamPort:27877,agentdockPort:28766}});
// Replace only the synthetic Supervisor entry: actual manager/Guardian/launch
// code and sealed version checks remain real. Supervisor exits before persist.
const original=new URL('../scripts/TongAgentDockRuntime.mjs',import.meta.url);
const wrapper=Buffer.from(`if(process.argv[2]==='supervise')process.exit(23);process.argv[1]=${JSON.stringify(original.pathname.slice(1))};await import(${JSON.stringify(original.href)});`);
const pin=JSON.parse(await readFile(join(root,'run','manager-pin.json'),'utf8'));
const file=pin.sourceFiles.find(f=>f.path==='scripts/TongAgentDockRuntime.mjs');file.sha256=sha(wrapper);file.size=wrapper.length;
for(const target of [initial.codeRoot,initial.managerRoot])await writeFile(join(target,file.path),wrapper);
const bytes=JSON.stringify(pin),profile=createProductionSimulationProfile({simulationId:initial.simulationId,gatewayPort:initial.gatewayPort,upstreamPort:initial.upstreamPort,agentdockPort:initial.agentdockPort,sourceDigest:initial.sourceDigest,releaseDigest:sha(bytes),agentdockEnabled:true});
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),bytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));
await protectSecret(root,'agentdock','a'.repeat(64));await protectSecret(root,'oauth-owner','b'.repeat(64));
await issueSimulationLoginRecovery(profile);
for(let attempt=0;attempt<3;attempt++){
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root)),/START_FAILED/);
  await assert.rejects(readFile(join(root,'run','backup.freeze')),{code:'ENOENT'},'a proven empty Job must release the lifecycle lock');
  const guardian=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));
  assert.ok(guardian.finishedAt);assert.equal(guardian.nodeExitCode,23);assert.equal(guardian.jobActiveAfterCleanup,0);
  const terminal=JSON.parse(await readFile(join(root,'run','runtime.json'),'utf8'));
  assert.equal(terminal.runId,guardian.runId);assert.equal(terminal.phase,'abnormal_exit');
  if(attempt===0){
    // Model a PID recycled by the next login monitor. The completed named Job
    // is empty, and the current process has a different creation identity.
    const recycled={...await processIdentity(process.pid),startTicks:'1'};
    await writeFile(join(root,'run','runtime.json'),JSON.stringify({schemaVersion:1,runId:guardian.runId,phase:'abnormal_exit',supervisor:{pid:guardian.nodePid,exe:process.execPath,startTicks:'1'},children:[],descendants:[recycled]}));
  }
}
// The real breakaway refusal is exercised by Test-TongRuntimeGuardian. At the
// manager boundary use a pinned, no-spawn launcher acknowledgement, since
// Node/libuv may itself arrange breakaway from a calling test Job.
const launchFile=pin.sourceFiles.find(f=>f.path==='scripts/TongRuntimeLaunch.ps1'),originalLaunch=await readFile(join(initial.managerRoot,launchFile.path));
const originalPin=JSON.stringify(pin);
const noChild=Buffer.from(`param($Root,$RunId,$NodeExe,$Supervisor,$RecoveryGrantId)
. (Join-Path $PSScriptRoot 'TongStartupProtocol.ps1')
Initialize-TongStartup 'launcher'
try{throw 'SUPERVISOR_START_FAILED'}catch{Complete-TongStartupFailure $_}
[pscustomobject]@{runId=$RunId;guardianCreated=$false}|ConvertTo-Json -Compress
exit 2
`);
launchFile.sha256=sha(noChild);launchFile.size=noChild.length;
for(const target of [initial.codeRoot,initial.managerRoot])await writeFile(join(target,launchFile.path),noChild);
const refusedPin=JSON.stringify(pin),refusedProfile={...profile,releaseDigest:sha(refusedPin)};
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),refusedPin);
await writeFile(join(root,'profile.json'),JSON.stringify(refusedProfile));await issueSimulationLoginRecovery(refusedProfile);
for(let attempt=0;attempt<2;attempt++){
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root)),/SUPERVISOR_START_FAILED/);
  await assert.rejects(readFile(join(root,'run','backup.freeze')),{code:'ENOENT'});
}
for(const target of [initial.codeRoot,initial.managerRoot])await writeFile(join(target,launchFile.path),originalLaunch);
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),originalPin);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));await issueSimulationLoginRecovery(profile);
await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root)),/START_FAILED/);
await assert.rejects(readFile(join(root,'run','backup.freeze')),{code:'ENOENT'});
// An actual CLI failure must retain the original cause alongside the cleanup
// refusal. The private launcher exits without publishing either acknowledgement.
const lost=Buffer.from('param($Root,$RunId,$NodeExe,$Supervisor,$RecoveryGrantId)\nexit 2\n');
launchFile.sha256=sha(lost);launchFile.size=lost.length;
for(const target of [initial.codeRoot,initial.managerRoot])await writeFile(join(target,launchFile.path),lost);
const lostPin=JSON.stringify(pin),lostProfile={...profile,releaseDigest:sha(lostPin)};
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),lostPin);
await writeFile(join(root,'profile.json'),JSON.stringify(lostProfile));await issueSimulationLoginRecovery(lostProfile);
const cli=spawnSync(process.execPath,[join(initial.managerRoot,'scripts','TongAgentDockRuntime.mjs'),'start','--root',root,'--login-recovery','--error-json'],{encoding:'utf8',windowsHide:true,timeout:90000});
assert.equal(cli.status,1,cli.stderr);
const failure=JSON.parse(cli.stdout);assert.equal(failure.error,'CLEANUP_REQUIRED');
assert.equal(failure.startupFailure.code,'SUPERVISOR_START_FAILED');assert.equal(failure.startupFailure.stage,'launcher_start');
assert.equal(failure.startupFailure.cleanup.proven,false);await readFile(join(root,'run','backup.freeze'));
const requested=JSON.parse(await readFile(join(root,'run','request.json'),'utf8'));
assert.equal(failure.startupFailure.runId,requested.runId);
assert.notEqual(JSON.parse(await readFile(join(root,'run','runtime.json'),'utf8')).runId,requested.runId,'old terminal state must not prove this failed launch');
console.log(JSON.stringify({passed:true,root,earlySupervisorExit:true,missingAndPreviousRuntimeRecords:true,emptyJobLockReleased:true,retryNotWedged:true,noChildRefusalLockReleased:true,lostReceiptLockRetained:true,cliOriginalFailure:true}));
