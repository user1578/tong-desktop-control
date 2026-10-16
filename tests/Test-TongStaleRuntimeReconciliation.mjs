import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {reconcileStaleRuntime as reconcile,runtimeStatus} from '../scripts/TongAgentDockRuntime.mjs';
import {processIdentity} from '../scripts/TongRuntimeSecurity.mjs';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,withLoginRecovery} from '../scripts/TongLoginRecovery.mjs';

const {root,profile}=await loginFixture({ports:{gatewayPort:27886,upstreamPort:27887,agentdockPort:28776}});
await issueSimulationLoginRecovery(profile);
const reconcileStaleRuntime=root=>withLoginRecovery(root,'reconcile-stale',()=>reconcile(root));
const runId=randomUUID(),live=await processIdentity(process.pid);
const supervisor={...live,pid:2147483646,startTicks:'1'};
const record={schemaVersion:1,runId,phase:'ready',supervisor,children:[],descendants:[]};
const guardian={schemaVersion:1,runId,pid:process.pid,exe:live.exe,startTicks:live.startTicks,nodePid:supervisor.pid,jobAssigned:true};
const runtimePath=join(root,'run','runtime.json'),guardianPath=join(root,'run','guardian.json');
await writeFile(runtimePath,JSON.stringify(record));await writeFile(guardianPath,JSON.stringify(guardian));
assert.equal((await runtimeStatus(root)).phase,'stale_record');
await assert.rejects(reconcileStaleRuntime(root),/RECONCILIATION_DENIED/);
guardian.startTicks='1';await writeFile(guardianPath,JSON.stringify(guardian));
await assert.rejects(reconcileStaleRuntime(root),/RECONCILIATION_DENIED/,'a recycled/mismatched PID must not count as a dead process');
guardian.pid=2147483645;guardian.nodePid=supervisor.pid;await writeFile(guardianPath,JSON.stringify(guardian));
const occupied=createServer();occupied.listen(profile.gatewayPort,'127.0.0.1');await once(occupied,'listening');
try{await assert.rejects(reconcileStaleRuntime(root),/PORT_OCCUPIED/);}finally{await new Promise(ok=>occupied.close(ok));}
const originalRuntime=await readFile(runtimePath),originalGuardian=await readFile(guardianPath);
// A named Job with an unrecorded live member is not proven clean merely
// because every PID in the last snapshot has disappeared.
const guardianSource=await readFile(new URL('../scripts/TongRuntimeGuardian.ps1',import.meta.url),'utf8');
const jobCode=guardianSource.match(/Add-Type -TypeDefinition @'([\s\S]*?)'@/)[1];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const holderPath=join(root,'hold-job.ps1');
await writeFile(holderPath,`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
${jobCode}
'@
$job=[TongRuntimeJob]::Create(${quote('Local\\TongRuntime-'+runId)})
$child=Start-Process -FilePath ${quote(process.execPath)} -ArgumentList '-e "setInterval(()=>{},1000)"' -WindowStyle Hidden -PassThru
try{if(-not [TongRuntimeJob]::AssignProcessToJobObject($job,$child.Handle)){throw 'Fixture assignment failed'};[Console]::WriteLine('READY');$null=[Console]::ReadLine()}
finally{$null=[TongRuntimeJob]::CloseHandle($job)}
`);
const jobHolder=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoProfile','-NonInteractive','-File',holderPath],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let holderError='';jobHolder.stderr.on('data',data=>holderError+=data);
try{
  const [data]=await Promise.race([once(jobHolder.stdout,'data'),once(jobHolder,'exit').then(()=>{throw Error(holderError);})]);assert.match(data.toString(),/READY/);
  guardian.jobName='Local\\TongRuntime-'+runId;guardian.killOnJobClose=true;await writeFile(guardianPath,JSON.stringify(guardian));
  await assert.rejects(reconcileStaleRuntime(root),/CLEANUP_REQUIRED/);
}finally{const closed=once(jobHolder,'close');jobHolder.stdin.end();await closed;await writeFile(guardianPath,originalGuardian);}
const result=await reconcileStaleRuntime(root);
assert.equal(result.reconciled,true);assert.equal(result.originalRecordsPreserved,true);
assert.deepEqual(await readFile(runtimePath),originalRuntime);assert.deepEqual(await readFile(guardianPath),originalGuardian);
const proofPath=join(root,'run',`stale-reconciliation.${runId}.json`);
const proofBytes=await readFile(proofPath);
const proof=JSON.parse(proofBytes);
assert.equal(proof.kind,'guardian-lost');assert.equal(proof.jobActiveAfterCleanup,undefined);
assert.equal((await runtimeStatus(root)).phase,'abnormal_exit');
await writeFile(runtimePath,Buffer.concat([originalRuntime,Buffer.from(' ')]));
assert.equal((await runtimeStatus(root)).phase,'stale_record');
await assert.rejects(reconcileStaleRuntime(root),/RECONCILIATION_DENIED/);
await writeFile(runtimePath,originalRuntime);
assert.equal((await runtimeStatus(root)).phase,'abnormal_exit');
assert.equal((await reconcileStaleRuntime(root)).alreadyReconciled,true);
assert.deepEqual(await readFile(proofPath),proofBytes,'same-run reconciliation is idempotent and immutable');
// An old fixed-name proof remains readable and cannot block another run.
const legacyBytes=Buffer.from(JSON.stringify({schemaVersion:1,kind:'guardian-lost',runId:proof.runId,runtimeSha256:proof.runtimeSha256,guardianSha256:proof.guardianSha256,observedAt:proof.observedAt,identityCount:proof.identityCount}));
await writeFile(join(root,'run','stale-reconciliation.json'),legacyBytes);
assert.equal((await reconcileStaleRuntime(root)).alreadyReconciled,true,'legacy v1 and scoped v2 proofs agree without rewriting either');
delete guardian.jobName;delete guardian.killOnJobClose;
const secondId=randomUUID();record.runId=secondId;guardian.runId=secondId;
await writeFile(runtimePath,JSON.stringify(record));await writeFile(guardianPath,JSON.stringify(guardian));
assert.equal((await reconcileStaleRuntime(root)).reconciled,true);
assert.deepEqual(await readFile(proofPath),proofBytes);
assert.deepEqual(await readFile(join(root,'run','stale-reconciliation.json')),legacyBytes);
const secondProof=join(root,'run',`stale-reconciliation.${secondId}.json`);
const secondBytes=await readFile(secondProof);
await writeFile(secondProof,'{}');
await assert.rejects(reconcileStaleRuntime(root),/RECONCILIATION_DENIED|INVALID_STATE/);
await writeFile(secondProof,secondBytes);
await writeFile(join(root,'run','stale-reconciliation.json'),'{broken');
await assert.rejects(reconcileStaleRuntime(root),/RECONCILIATION_DENIED|INVALID_STATE/);
console.log(JSON.stringify({passed:true,root,liveGuardianRejected:true,occupiedPortRejected:true,recordsPreserved:true,tamperRejected:true}));
