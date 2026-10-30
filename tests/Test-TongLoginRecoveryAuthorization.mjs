import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {stopRuntime,updateRuntimeProfile,initializeRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {pinRuntimeRelease} from '../scripts/TongRuntimeCandidate.mjs';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {verifyRuntimeApproval,readApprovedEnabledState,recordApprovedEnabledState,createProductionProfile,issueSimulationApproval,loadApprovedProfile} from '../scripts/TongProductionProfile.mjs';
const api=await import('../scripts/TongLoginRecovery.mjs').catch(()=>null);
assert.equal(typeof api?.withLoginRecovery,'function','missing scoped, revocable login recovery authorization');
const {root,profile,managerProfile}=await loginFixture();
const shell=process.argv[2]??'powershell.exe';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
await issueSimulationApproval(profile,'start',{expiresAt:new Date(Date.now()+1500).toISOString()});
await new Promise(ok=>setTimeout(ok,1600));
await assert.rejects(verifyRuntimeApproval(profile,'start'),/APPROVAL_DENIED/);
await assert.rejects(api.withLoginRecovery(root,'start',()=>{}),/APPROVAL_DENIED/);
await assert.rejects(api.issueSimulationLoginRecovery(createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64),agentdockEnabled:true})),/SIMULATION_ONLY/);
const grant=await api.issueSimulationLoginRecovery(profile);
assert.equal(grant.enabled,true);assert.equal(grant.expiresAt,undefined);
const stages=[];
assert.equal(await api.withLoginRecovery(root,'doctor',()=>42,{onStage:stage=>stages.push(stage)}),42);
for(const stage of ['grant_load','envelope_unseal','descriptor_validate','audit_validate','release_verify','handler'])assert.ok(stages.includes(stage));
await api.withLoginRecovery(root,'start',async()=>{
  for(const action of ['start','stop','enable-agentdock'])assert.equal((await verifyRuntimeApproval(profile,action)).grantId,grant.grantId);
  assert.equal((await verifyRuntimeApproval(managerProfile,'manager')).grantId,grant.grantId);
  assert.equal((await verifyRuntimeApproval(managerProfile,'manager')).agentdockEnabled,false);
  assert.equal((await readApprovedEnabledState(profile)).agentdockEnabled,true);
  for(const action of ['init','backup','restore','disable-agentdock','shell','codex'])await assert.rejects(verifyRuntimeApproval(profile,action),/APPROVAL_DENIED/);
  await assert.rejects(stopRuntime(root),/INVALID_RUN/,'recovery stop must name the expected run');
  await assert.rejects(updateRuntimeProfile(profile),/APPROVAL_DENIED/);
  await assert.rejects(pinRuntimeRelease(profile,root),/APPROVAL_DENIED/);
  await assert.rejects(recordApprovedEnabledState(profile),/APPROVAL_DENIED/);
  await assert.rejects(initializeRuntime({root,tongRoot:profile.codeRoot}),/APPROVAL_DENIED/);
});
await assert.rejects(verifyRuntimeApproval(profile,'start'),/APPROVAL_DENIED/,'ordinary approvals must not inherit the recovery grant');
process.env.TONG_LOGIN_RECOVERY='1';await assert.rejects(loadApprovedProfile(root,'start'),/APPROVAL_DENIED/);delete process.env.TONG_LOGIN_RECOVERY;
const script=`import {withLoginRecovery} from ${JSON.stringify(new URL('../scripts/TongLoginRecovery.mjs',import.meta.url).href)}; await withLoginRecovery(${JSON.stringify(root)},'preflight-login',g=>console.log(g.grantId));`;
const reboot=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(reboot.status,0,reboot.stderr);assert.equal(reboot.stdout.trim(),grant.grantId);
await assert.rejects(api.withLoginRecovery(root,'activate-production',()=>{}),/APPROVAL_DENIED/);
await assert.rejects(api.withLoginRecovery('D:\\Tong\\runtime','start',()=>{}),/APPROVAL_DENIED/,'development source cannot use a production grant');
const source=join(profile.codeRoot,'scripts','TongMcpGateway.mjs'),before=await readFile(source);
await writeFile(source,Buffer.concat([before,Buffer.from('\n// tamper')]));
await assert.rejects(api.withLoginRecovery(root,'start',()=>{}),/CANDIDATE_DENIED/);await writeFile(source,before);
const path=api.loginRecoveryPath(root),sealed=await readFile(path);
const damaged=JSON.parse(sealed);const ciphertext=Buffer.from(damaged.ciphertext,'base64');ciphertext[ciphertext.length-10]^=1;damaged.ciphertext=ciphertext.toString('base64');
await writeFile(path,JSON.stringify(damaged));await assert.rejects(api.withLoginRecovery(root,'start',()=>{}),/APPROVAL_DENIED/);assert.equal((await readFile(path,'utf8')),JSON.stringify(damaged));await writeFile(path,sealed);
await api.revokeSimulationLoginRecovery(root);
await assert.rejects(api.withLoginRecovery(root,'start',()=>{}),/APPROVAL_DENIED/);
// Execute the real readonly manager path through an isolated copy of the login
// wrapper. No production manager, live component or scheduled task is invoked.
const manager=fileURLToPath(new URL('../scripts/TongAgentDockRuntime.mjs',import.meta.url));
const runner=join(root,'login-status-test.ps1');
const runnerSource=(await readFile(new URL('../scripts/TongLoginRuntime.ps1',import.meta.url),'utf8'))
  .replaceAll('D:\\Tong\\runtime',root)
  .replaceAll('Local\\TongLoginRuntime-','Local\\TongLoginStatusTest-'+basename(root)+'-')
  .replace("$manager=Join-Path $runtime 'releases\\manager\\scripts\\TongAgentDockRuntime.mjs'","$manager='"+manager.replaceAll("'","''")+"'");
await writeFile(runner,runnerSource);
const recordPath=join(root,'run','runtime.json');
const record={phase:'stopped',runId:randomUUID(),recoveryGrantId:grant.grantId,privateCanary:'test-only-sensitive-runtime-detail'};
await writeFile(recordPath,JSON.stringify(record));
const readonlyPaths=[recordPath,path,api.loginRecoveryAuditPath(root),join(root,'profile.json')];
const snapshots=await Promise.all(readonlyPaths.map(file=>readFile(file)));
const status=spawnSync(shell,['-NoProfile','-NonInteractive','-File',runner,'-Mode','status'],{env,encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(status.status,0,status.stderr);
assert.deepEqual(JSON.parse(status.stdout),{tongPhase:'stopped',tongSupervisorAlive:false,runId:record.runId});
assert.equal(status.stderr,'');
assert.ok((await Promise.all(readonlyPaths.map(file=>readFile(file)))).every((bytes,index)=>bytes.equals(snapshots[index])),'status must not change runtime state, credentials, audit or profile');
for(const mode of ['start','stop','run']){
  const denied=spawnSync(shell,['-NoProfile','-NonInteractive','-File',runner,'-Mode',mode],{env,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.notEqual(denied.status,0);assert.match(denied.stderr,/APPROVAL_DENIED/);
}
for(const action of ['start','stop-run','reconcile-stale']){
  const denied=spawnSync(process.execPath,[manager,action,'--root',root,'--login-recovery','--run-id',record.runId],{env,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.notEqual(denied.status,0);assert.equal(denied.stdout,'');assert.match(denied.stderr,/APPROVAL_DENIED/);
}
const afterDenials=await Promise.all(readonlyPaths.map(file=>readFile(file)));
assert.ok(afterDenials.every((bytes,index)=>index===2||bytes.equals(snapshots[index])),'denied lifecycle operations must not change runtime state, credentials or profile');
assert.ok(afterDenials[2].subarray(0,snapshots[2].length).equals(snapshots[2]),'denials must retain existing audit evidence');
const denialEvents=afterDenials[2].subarray(snapshots[2].length).toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.deepEqual(denialEvents.map(entry=>[entry.event,entry.action]),[['denied','start'],['denied','stop-run'],['denied','reconcile-stale']]);
const revokedEnvelope=await readFile(path);await writeFile(path,sealed);
await assert.rejects(api.withLoginRecovery(root,'start',()=>{}),/APPROVAL_DENIED/,'replaying the old envelope must not undo revocation');await writeFile(path,revokedEnvelope);
const audit=await readFile(api.loginRecoveryAuditPath(root),'utf8');
assert.match(audit,/enabled/);assert.match(audit,/authorized/);assert.match(audit,/revoked/);
// The same helper's real PS7 code path may only issue simulation grants here.
const descriptor=await api.loginRecoveryDescriptor(root);
const helper=fileURLToPath(new URL('../scripts/TongProductionApproval.ps1',import.meta.url));
const renewal=spawnSync(shell,['-NoProfile','-NonInteractive','-File',helper,'-Mode','login-recovery-simulation'],{env,input:JSON.stringify({descriptor,enabled:true}),encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(renewal.status,0,renewal.stderr);
const renewed=JSON.parse(renewal.stdout);assert.notEqual(renewed.grantId,grant.grantId);
await assert.rejects(api.withLoginRecovery(root,'start',()=>{},{grantId:grant.grantId}),/APPROVAL_DENIED/);
const journalPath=api.loginRecoveryAuditPath(root),journal=await readFile(journalPath,'utf8');
const incomplete=journal.trim().split(/\r?\n/).filter(line=>{const entry=JSON.parse(line);return !(entry.grantId===renewed.grantId&&entry.event==='enabled'&&entry.phase==='committed');}).join('\n')+'\n';
await writeFile(journalPath,incomplete);await assert.rejects(api.withLoginRecovery(root,'status',()=>{}),/APPROVAL_DENIED/,'an interrupted enable must not become usable');await writeFile(journalPath,journal);
const formalRuntime=createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64),agentdockEnabled:true});
const formalManager=createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64),agentdockEnabled:false});
const forged={...descriptor,root:formalRuntime.root,runtimeProfile:formalRuntime,managerProfile:formalManager};
const blocked=spawnSync(shell,['-NoProfile','-NonInteractive','-File',helper,'-Mode','login-recovery-simulation'],{env,input:JSON.stringify({descriptor:forged,enabled:true}),encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(blocked.status,0,'the PS simulation entry must not mint a production grant');
for(const mode of ['approve-login-recovery','revoke-login-recovery']){
 const denied=spawnSync(shell,['-NoProfile','-NonInteractive','-File',helper,'-Mode',mode],{env,input:'APPROVE\n',encoding:'utf8',windowsHide:true,timeout:10000});assert.notEqual(denied.status,0,'redirected input/development helper cannot grant or revoke production recovery');
}
console.log(JSON.stringify({passed:true,root,separatePurpose:true,noTaskPrivilege:true,versionBound:true,tamperDenied:true,revocable:true,audited:true,revokedReadonlyStatus:true,revokedLifecycleDenied:true}));
