import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { verifyRelease } from '../scripts/TongRuntimeRelease.mjs';
import { createProductionSimulationProfile } from '../scripts/TongProductionProfile.mjs';
import { withMaintenanceFreeze } from '../scripts/TongLifecycleFreeze.mjs';
import { processIdentity } from '../scripts/TongRuntimeSecurity.mjs';

// This is a native counterexample, NOT an archive/install executor. Each child
// runs the exact pinned candidate's freeze function against ordinary Windows
// files. No backend, simulated inventory or production path is written.
const releaseRoot = 'D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\planb-release-34e2680';
const manifest = await verifyRelease({ releaseRoot });
assert.equal(manifest.commit, '34e26801876d8b1a2fc874dddce72b0939924e87');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await readFile(join(releaseRoot, 'release-manifest.json'))), '160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062');
assert.equal(manifest.files.find(file => file.path === 'code/source.tar').sha256, 'd38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9');
const source = await readFile(join(releaseRoot, 'code/source/scripts/TongAgentDockRuntime.mjs'));
assert.equal(sha(source), manifest.sourceFiles.find(file => file.path === 'scripts/TongAgentDockRuntime.mjs').sha256);
assert.equal(sha(source), '3b7ab8ab21914f16a1f83633468df02b5424a567e23a6064c103a59118ce0694');
const freezeSource = source.toString().split('\n').find(line => line.startsWith('async function freeze(root)'));
assert.ok(freezeSource?.includes("open(join(root,'run','backup.freeze'),'wx')"));
assert.ok(!source.includes(Buffer.from('TongLifecycleFreeze')));

const profile = createProductionSimulationProfile({ simulationId: 'b23-planb-handoff-' + randomUUID(), sourceDigest: 'a'.repeat(64), releaseDigest: 'b'.repeat(64) });
const root = profile.root, run = join(root, 'run'), evidence = join(root, 'counterexample');
await mkdir(root); await mkdir(run); await mkdir(evidence);
const oldRunId = '74cd4ad3-f21b-40ec-96f5-3f9015649e5d', failedRunId = 'd348ae39-27cf-4167-8e35-58de75421309';
const original = {
  'runtime.json': Buffer.from(JSON.stringify({ schemaVersion: 1, runId: oldRunId, phase: 'abnormal_exit', profileMode: 'production', supervisor: { pid: 45836, exe: 'D:\\node\\node.exe', startTicks: '639282754624971660' }, children: [], descendants: [] })),
  'guardian.json': Buffer.from(JSON.stringify({ schemaVersion: 1, runId: oldRunId, pid: 14116, nodePid: 45836, jobAssigned: true, jobName: 'Local\\TongRuntime-' + oldRunId, killOnJobClose: true, finishedAt: '2026-10-23T01:51:05.356Z', jobActiveAfterCleanup: 0 })),
  'request.json': Buffer.from(JSON.stringify({ runId: failedRunId, createdAt: '2026-10-23T10:55:13.368Z' })),
  'abort.json': Buffer.from(JSON.stringify({ runId: failedRunId, requestedAt: '2026-10-23T10:55:28.390Z', reason: 'START_ABORT' })),
  'backup.freeze': Buffer.alloc(0),
};
for (const [name, bytes] of Object.entries(original)) await writeFile(join(run, name), bytes, { flag: 'wx' });
await writeFile(join(evidence, 'snapshot.json'), JSON.stringify(Object.entries(original).map(([name, bytes]) => ({ name, sha256: sha(bytes) }))), { flag: 'wx' });

const exitCodes = [];
async function contender() {
  const worker = `import {open} from 'node:fs/promises';import {join} from 'node:path';const fail=code=>new Error(code);${freezeSource}
    try { const handle=await freeze(process.argv[1]); process.send({acquired:true,pid:process.pid});
      process.once('message',async()=>{await handle.close();process.disconnect();});
    } catch(error) {process.send({acquired:false,error:error.message});process.disconnect();}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker, root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let errorText = ''; child.stderr.on('data', chunk => { errorText += chunk; }); child.stdout.resume();
  const timer = setTimeout(() => child.kill(), 10000);
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { clearTimeout(timer); exitCodes.push(code); resolve(code); }); });
  const [result] = await Promise.race([once(child, 'message'), closed.then(() => { throw Error('CONTENDER_EXITED_BEFORE_RESULT:' + errorText); })]);
  return { result, async close() { if (result.acquired && child.connected) child.send('close', () => {}); assert.equal(await closed, 0, errorText); } };
}
async function assertBusy() { const child = await contender(); assert.deepEqual(child.result, { acquired: false, error: 'RUNTIME_BUSY' }); await child.close(); }

await assertBusy(); // The original stale artifact rejects exclusive creation.
await withMaintenanceFreeze(profile, { expectedSha256: sha(original['backup.freeze']) }, async lease => {
  await lease.proof();
  await assert.rejects(rename(join(run, 'backup.freeze'), join(evidence, 'must-not-move')), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
  await assertBusy(); // Exact 34e2680 cannot borrow the later branch's lease.
});
assert.equal(sha(await readFile(join(run, 'backup.freeze'))), sha(original['backup.freeze']));

// Reproduce archive()'s order with an explicit synchronization barrier. The
// competitor is admitted before any installation or authorized startup; luck
// or scheduler timing cannot hide the interval.
for (const name of Object.keys(original)) await rename(join(run, name), join(evidence, name));
const winner = await contender();
try {
  assert.equal(winner.result.acquired, true);
  assert.equal((await processIdentity(winner.result.pid))?.pid, winner.result.pid);
  await assertBusy(); // The authorized starter loses to the competing holder.
} finally { await winner.close(); }
await rename(join(run, 'backup.freeze'), join(evidence, 'competitor.freeze'));
for (const name of ['backup.freeze', ...Object.keys(original).filter(name => name !== 'backup.freeze')]) await rename(join(evidence, name), join(run, name));
for (const [name, bytes] of Object.entries(original)) assert.deepEqual(await readFile(join(run, name)), bytes);
assert.equal((await lstat(join(run, 'backup.freeze'))).size, 0); // Retained, never deleted.
console.log(JSON.stringify({ passed: true, root, commit: manifest.commit, candidateRuntimeSha256: sha(source), nativeGatePrimitiveOnly: true, heldLeaseBlocksCandidateGate: true, heldLeaseBlocksArchive: true, competitorAcquiredAfterArchive: true, secondGateContenderRejected: true, recordsRestoredByteIdentical: true, continuousHandoffProven: false, readiness: 'NOT READY', childExitCodes: exitCodes }));
