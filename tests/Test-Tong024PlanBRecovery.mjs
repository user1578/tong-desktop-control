import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rename, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {loginFixture, sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery, revokeSimulationLoginRecovery, withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret} from '../scripts/TongRuntimeSecurity.mjs';

// Real production 024 incident identity (read-only observed values).
const oldRunId='74cd4ad3-f21b-40ec-96f5-3f9015649e5d';
const failedRunId='d348ae39-27cf-4167-8e35-58de75421309';
const required=['runtime.json','guardian.json','request.json','abort.json','backup.freeze'];

async function newFixture(){
  const {root,profile}=await loginFixture({full:true,sharedDependencies:true});
  await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));
  await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
  await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
  await issueSimulationLoginRecovery(profile);
  return {root,profile};
}

// The exact legacy production records: schemaVersion 1 guardian WITHOUT the
// atomic `containment` field, a failed START request with NO launcher receipt,
// and a 0-byte leftover backup.freeze. None of these may be upgraded in place.
async function injectLegacyRecords(root){
  const guardian={schemaVersion:1,runId:oldRunId,pid:14116,exe:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    startTicks:'639282754410511510',nodePid:45836,jobAssigned:true,jobName:'Local\\TongRuntime-'+oldRunId,
    killOnJobClose:true,startedAt:'2026-10-22T14:17:42.654Z',finishedAt:'2026-10-23T01:51:05.356Z',
    nodeExitCode:1,nodeExitHex:'0x00000001',jobActiveBeforeCleanup:0,jobActiveAfterCleanup:0};
  assert.equal(guardian.containment,undefined,'legacy guardian must lack the atomic containment field');
  const runtime={schemaVersion:1,runId:oldRunId,phase:'abnormal_exit',profileMode:'production',codeRoot:'D:\\Tong\\app',
    supervisor:{pid:45836,parentPid:14116,exe:'D:\\node\\node.exe',startTicks:'639282754624971660',markerMatches:true},
    children:[],descendants:[],pids:[45836],exits:[],startedAt:'2026-10-22T14:17:54.816Z',finishedAt:'2026-10-23T01:51:05.356Z'};
  const request={runId:failedRunId,createdAt:'2026-10-23T10:55:13.368Z',recoveryGrantId:'357a8a67-428d-4192-ad5b-1fe7b642e385'};
  const abort={runId:failedRunId,requestedAt:'2026-10-23T10:55:28.390Z',reason:'START_ABORT'};
  await writeFile(join(root,'run','guardian.json'),JSON.stringify(guardian));
  await writeFile(join(root,'run','runtime.json'),JSON.stringify(runtime));
  await writeFile(join(root,'run','request.json'),JSON.stringify(request));
  await writeFile(join(root,'run','abort.json'),JSON.stringify(abort));
  await writeFile(join(root,'run','backup.freeze'),'');
  return {guardian,runtime,request,abort};
}

// Minimal controlled archival, mirroring the production-adapter core and the
// reviewed offline rehearsal: seal evidence, then retire the old control
// records under a continuous exclusive hold (backup.freeze moved last).
async function archive(root){
  const evidence=join(root,'legacy-evidence');await mkdir(join(evidence,'original'),{recursive:true});await mkdir(join(evidence,'retired'),{recursive:true});
  const original={};for(const name of required)original[name]=await readFile(join(root,'run',name));
  for(const [name,value] of Object.entries(original))await writeFile(join(evidence,'original',name),value);
  const manifest={schemaVersion:1,kind:'024-planb-archival',root,oldRunId,failedRunId,files:Object.entries(original).map(([name,value])=>({name,size:value.length,sha256:sha(value)}))};
  await writeFile(join(evidence,'snapshot.json'),JSON.stringify(manifest));
  for(const name of [...required.filter(n=>n!=='backup.freeze'),'backup.freeze'])await rename(join(root,'run',name),join(evidence,'retired',name));
  return {evidence,original};
}
async function rollback(root,evidence,original){
  const manifest=JSON.parse(await readFile(join(evidence,'snapshot.json'),'utf8'));
  for(const file of manifest.files)assert.equal(sha(await readFile(join(evidence,'original',file.name))),file.sha256,'evidence tampered');
  for(const name of ['backup.freeze',...required.filter(n=>n!=='backup.freeze')]){
    await rename(join(evidence,'retired',name),join(root,'run',name));
    assert.deepEqual(await readFile(join(root,'run',name)),original[name],'restored bytes differ: '+name);
  }
}

const assertStartRejects=async(root,pattern)=>await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:2000})),pattern);

// ---- Fixture A: the current stuck 024 site is safely rejected, not silently recovered ----
{
  const {root}=await newFixture();
  await injectLegacyRecords(root);
  // 1. Leftover backup.freeze alone blocks acquisition (34e2680 freeze = open(wx)).
  await assertStartRejects(root,/RUNTIME_BUSY/);
  // 2. With the freeze retired, the legacy guardian (no containment) and the
  //    failed request (no launcher receipt) are both rejected by the gate.
  await rename(join(root,'run','backup.freeze'),join(root,'run','backup.freeze.retired'));
  await assertStartRejects(root,/CLEANUP_REQUIRED/);
  // Never fabricate a new-protocol receipt for the old request. Receipts are
  // launcher.<runId>.json / guardian.<runId>.json; the legacy guardian.json is
  // a record, not a receipt.
  const receiptLike=n=>/^launcher\./.test(n)||/^guardian\.[a-f0-9]{8}-/.test(n);
  assert.equal((await readdir(join(root,'run'))).some(receiptLike),false,'no receipt may be invented for the legacy request');
  await revokeSimulationLoginRecovery(root);
  console.log(JSON.stringify({passed:true,phase:'gate-rejection',freezeBlocks:'RUNTIME_BUSY',gateBlocks:'CLEANUP_REQUIRED',legacyGuardianLacksContainment:true,noReceiptInvented:true}));
}

// ---- Fixture B: controlled archival can be rolled back to the exact 024 site ----
{
  const {root}=await newFixture();
  await injectLegacyRecords(root);
  const {evidence,original}=await archive(root);
  // Rollback restores the exact 024 control records (freeze first), byte-identical.
  await rollback(root,evidence,original);
  for(const name of required)assert.deepEqual(await readFile(join(root,'run',name)),original[name]);
  // After rollback the stuck site blocks again (leftover freeze is back, unmodified).
  await assertStartRejects(root,/RUNTIME_BUSY/);
  await revokeSimulationLoginRecovery(root);
  console.log(JSON.stringify({passed:true,phase:'archival-rollback',rollbackRestores024:true,postRollbackGateRejects:'RUNTIME_BUSY'}));
}

// ---- Fixture C: after archival the gate is cleared and startup proceeds ----
{
  const {root}=await newFixture();
  await injectLegacyRecords(root);
  await archive(root);
  // Old control records are gone; startup proceeds past the cleanup gate to a
  // later stage (START_TIMEOUT at 1ms), never CLEANUP_REQUIRED / RUNTIME_BUSY.
  await assert.rejects(withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:1})),/START_TIMEOUT/,'archived site must clear the cleanup gate');
  await revokeSimulationLoginRecovery(root);
  console.log(JSON.stringify({passed:true,phase:'archival-unblocks-start',archiveClearsGate:true,reached:'START_TIMEOUT',not:'CLEANUP_REQUIRED'}));
}
