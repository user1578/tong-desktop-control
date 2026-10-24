import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateProductionProfile, productionProfileDigest, issueSimulationApproval, verifyRuntimeApproval } from '../scripts/TongProductionProfile.mjs';
import { verifyRelease } from '../scripts/TongRuntimeRelease.mjs';
import { verifyRuntimeCandidate } from '../scripts/TongRuntimeCandidate.mjs';
import { processIdentity, startupJobsState, sameProcess, safeEnvironment } from '../scripts/TongRuntimeSecurity.mjs';
import { createProductionStateBackup, verifyProductionStateBackup } from '../scripts/TongProductionState.mjs';
import { startRuntime, stopRuntime, runtimeDoctor, runtimeStatus } from '../scripts/TongAgentDockRuntime.mjs';
import { issueSimulationLoginRecovery, revokeSimulationLoginRecovery, withLoginRecovery } from '../scripts/TongLoginRecovery.mjs';
import { maintenance } from '../scripts/Tong024ProductionMaintenance.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const root = process.env.TONG_024_NATIVE_ROOT;
if (!root || !/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/.test(root)) throw Error('EXPLICIT_NATIVE_FIXTURE_REQUIRED');
const profile = validateProductionProfile(JSON.parse(await readFile(join(root, 'profile.json'), 'utf8')));
assert.equal(profile.mode, 'production-simulation'); assert.equal(profile.root, root);
assert.equal(profile.agentdockEnabled, true);
const continuedEvidence = process.env.TONG_024_NATIVE_EVIDENCE;
let evidence;
if (continuedEvidence) {
  if (!new RegExp('^native-review-[a-f0-9-]{36}$').test(continuedEvidence)) throw Error('NATIVE_EVIDENCE_SCOPE');
  evidence = join(root, continuedEvidence);
  const ready = JSON.parse(await readFile(join(evidence, 'ready-runtime.json'), 'utf8'));
  const doctor = JSON.parse(await readFile(join(evidence, 'doctor.json'), 'utf8'));
  const status = await runtimeStatus(root);
  assert.equal(status.runId, ready.runId); assert.equal(status.phase, 'ready'); assert.equal(status.supervisorAlive, true);
  assert.equal(doctor.healthy, true); assert.equal(ready.sourceCommit, maintenance.candidateCommit);
  console.log(JSON.stringify({ event: 'continue_verified_native_run', root, evidence, runId: ready.runId, priorEvidence: 'native-integration stdout and encrypted-backup manifest retained' }));
} else {
const prior = JSON.parse(await readFile(join(root, 'run', 'runtime.json'), 'utf8'));
const guardian = JSON.parse(await readFile(join(root, 'run', 'guardian.json'), 'utf8'));
assert.ok(['stopped', 'abnormal_exit'].includes(prior.phase));
assert.equal(guardian.runId, prior.runId); assert.ok(guardian.finishedAt); assert.equal(guardian.jobActiveAfterCleanup, 0);
assert.deepEqual(await startupJobsState(prior.runId), { owner: 0, launcher: 0, guardian: 0, runtime: 0 });
for (const identity of [guardian, prior.supervisor, ...prior.children, ...prior.descendants]) assert.equal(sameProcess(await processIdentity(identity.pid), identity), false);
const self = await processIdentity(process.pid);
assert.equal(self.pid, process.pid); assert.equal(self.exe.toLowerCase(), process.execPath.toLowerCase()); assert.match(self.startTicks, /^\d+$/);
const releaseRoot = join(root, 'candidate-release');
const manifest = await verifyRelease({ releaseRoot });
assert.equal(manifest.commit, maintenance.candidateCommit); assert.equal(manifest.native.length, 23);
const app = await verifyRuntimeCandidate(profile);
const manager = await verifyRuntimeCandidate(profile, { manager: true, reviewedManagerProfile: profile });
assert.equal(app.commit, maintenance.candidateCommit); assert.equal(manager.commit, app.commit);

evidence = join(root, 'native-review-' + randomUUID()); await mkdir(evidence);
console.log(JSON.stringify({ event: 'native_fixture_verified', root, evidence, priorRunId: prior.runId, processIdentity: true, startupJobsState: true, verifyRelease: true, sourceFiles: manifest.sourceFiles.length, nativeFiles: manifest.native.length, sourceDigest: profile.sourceDigest, releaseDigest: profile.releaseDigest }));
for (const action of ['start', 'backup', 'restore']) {
  await issueSimulationApproval(profile, action);
  const approval = await verifyRuntimeApproval(profile, action);
  assert.equal(approval.mode, 'production-simulation'); assert.equal(approval.profileDigest, productionProfileDigest(profile));
}
await assert.rejects(verifyRuntimeApproval({ ...profile, releaseDigest: 'f'.repeat(64) }, 'backup'), /APPROVAL_DENIED/);
const freeze = join(root, 'run', 'backup.freeze'), freezeBytes = Buffer.from('isolated-native-maintenance-freeze-' + randomUUID());
await writeFile(freeze, freezeBytes, { flag: 'wx' });
await assert.rejects(createProductionStateBackup(profile, { backupRoot: join(root, 'native-busy-' + randomUUID()) }), /STATE_BUSY/);
assert.deepEqual(await readFile(freeze), freezeBytes);
await rename(freeze, join(evidence, 'refused-freeze.original')); // Only the checked, stopped simulation root.
const backupRoot = join(root, 'native-backup-' + randomUUID());
const backup = await createProductionStateBackup(profile, { backupRoot });
assert.equal(backup.encrypted, true); assert.equal(backup.scope, 'CurrentUser');
const verified = await verifyProductionStateBackup(profile, { backupRoot });
assert.deepEqual(verified, backup);
console.log(JSON.stringify({ event: 'native_backup_verified', backupRoot, files: backup.files.length, manifestSha256: digest(await readFile(join(backupRoot, 'state-manifest.json'))), dpapiApprovalVerified: true, mismatchedApprovalDenied: true, heldFreezeRefused: true, freezePreserved: true }));
}
const freeze = join(root, 'run', 'backup.freeze');
await issueSimulationLoginRecovery(profile);
let current;
try {
  current = continuedEvidence ? JSON.parse(await readFile(join(evidence, 'ready-runtime.json'), 'utf8')) : await withLoginRecovery(root, 'start', () => startRuntime(root));
  assert.equal(current.phase, 'ready'); assert.equal(current.sourceCommit, maintenance.candidateCommit); assert.equal(current.managerCommit, maintenance.candidateCommit);
  const doctor = continuedEvidence ? JSON.parse(await readFile(join(evidence, 'doctor.json'), 'utf8')) : await withLoginRecovery(root, 'doctor', () => runtimeDoctor(root));
  assert.equal(doctor.healthy, true);
  if (!continuedEvidence) {
    await writeFile(join(evidence, 'ready-runtime.json'), JSON.stringify(current, null, 2), { flag: 'wx' });
    await writeFile(join(evidence, 'doctor.json'), JSON.stringify(doctor, null, 2), { flag: 'wx' });
  }
  const stopped = await withLoginRecovery(root, 'stop-run', () => stopRuntime(root, { expectedRunId: current.runId }));
  assert.equal(stopped.phase, 'stopped');
  const terminal = JSON.parse(await readFile(join(root, 'run', 'guardian.json'), 'utf8'));
  assert.equal(terminal.runId, current.runId); assert.equal(terminal.jobActiveAfterCleanup, 0); assert.ok(terminal.finishedAt);
  assert.deepEqual(await startupJobsState(current.runId), { owner: 0, launcher: 0, guardian: 0, runtime: 0 });
  for (const identity of [terminal, current.supervisor, ...current.children]) assert.equal(sameProcess(await processIdentity(identity.pid), identity), false);
  console.log(JSON.stringify({ event: 'native_start_doctor_stop_verified', runId: current.runId, phase: stopped.phase, healthy: doctor.healthy, roles: current.children.map(child => child.role), jobsEmpty: true, originalIdentitiesGone: true }));
  current = null;

  // A separate Windows process exercises real launcher timeout/cleanup. No
  // injected process/Job/approval/start/doctor success booleans are involved.
  const project = fileURLToPath(new URL('../', import.meta.url));
  const worker = `import {withLoginRecovery} from ${JSON.stringify(new URL('../scripts/TongLoginRecovery.mjs', import.meta.url).href)};import {startRuntime} from ${JSON.stringify(new URL('../scripts/TongAgentDockRuntime.mjs', import.meta.url).href)};try{await withLoginRecovery(${JSON.stringify(root)},'start',()=>startRuntime(${JSON.stringify(root)},{startupTimeoutMs:1}));process.exitCode=3;}catch(error){console.log(JSON.stringify({code:error.message}));process.exitCode=error.message==='START_TIMEOUT'?0:2;}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { cwd: resolve(project), env: safeEnvironment(root), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  child.once('error', error => stderr += String(error));
  const code = await new Promise(resolve => child.once('close', resolve));
  await writeFile(join(evidence, 'timeout-worker.stdout.log'), stdout, { flag: 'wx' });
  await writeFile(join(evidence, 'timeout-worker.stderr.log'), stderr, { flag: 'wx' });
  await writeFile(join(evidence, 'timeout-worker.exit.json'), JSON.stringify({ code, signal: child.signalCode, stdoutSha256: digest(stdout), stderrSha256: digest(stderr) }), { flag: 'wx' });
  assert.equal(code, 0, stderr + stdout);
  const request = JSON.parse(await readFile(join(root, 'run', 'request.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(join(root, 'run', 'launcher.' + request.runId + '.json'), 'utf8'));
  assert.equal(receipt.guardianCreated, false); assert.equal(receipt.preflightClean, true); assert.ok(receipt.finishedAt);
  assert.deepEqual(await startupJobsState(request.runId), { owner: 0, launcher: 0, guardian: 0, runtime: 0 });
  await assert.rejects(readFile(freeze), { code: 'ENOENT' });
  console.log(JSON.stringify({ passed: true, root, evidence, fullRuntimeSuccess: true, independentNativeStartupFailureCleaned: true, failureRunId: request.runId, maintenanceTransactionRollback: 'NOT VERIFIED - continuous lease and release restore unsupported', productionExecutionAllowed: false }));
} finally {
  const status = await runtimeStatus(root);
  if (status.supervisorAlive) await withLoginRecovery(root, 'stop-run', () => stopRuntime(root, { expectedRunId: status.runId }));
  await revokeSimulationLoginRecovery(root);
}
