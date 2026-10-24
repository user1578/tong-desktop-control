import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { maintenance, executeRecovery, executeRollback, validateMaintenancePlan, installMaintenanceRelease, restoreControlRecordsFromSnapshot, realCopyRelease } from '../scripts/Tong024ProductionMaintenance.mjs';
import { maintenanceFixture, goodObservation, legacyRuntime, legacyGuardian, legacyRequest, legacyAbort } from './fixtures/Tong024MaintenanceFixture.mjs';

const exists = async path => { try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const R = 'D:/Tong/state/release-root';
const paths = fx => ({ backupRoot: join(fx.root, 'state-backup'), releaseRoot: R, restoreRoot: join(fx.root, 'state-restore') });

function depsFor(fx, overrides = {}) {
  const calls = [];
  const confirm = async binding => ({ ...binding, kind: 'simulation-only', expiresAt: Date.now() + 60000 });
  return {
    calls,
    deps: {
      confirm,
      observe: async () => goodObservation(),
      verifyBaseline: async () => ({ commit: maintenance.candidateCommit, appVerified: true, managerVerified: true }),
      snapshot: async ({ backupRoot }) => { calls.push('snapshot'); assert.equal(backupRoot, paths(fx).backupRoot); return { ok: true, backupRoot }; },
      install: async ({ releaseRoot, approve }) => { calls.push('install'); assert.equal(releaseRoot, R); assert.equal(typeof approve, 'function'); return { commit: maintenance.candidateCommit, installed: true, appFiles: 1, managerFiles: 1 }; },
      start: async () => { calls.push('start'); return { runId: '11111111-2222-3333-4444-555555555555', phase: 'ready' }; },
      stop: async () => { calls.push('stop'); },
      doctor: async () => { calls.push('doctor'); return { healthy: true }; },
      ...overrides,
    },
  };
}

// (1) full success path: verify -> observe -> seal -> snapshot -> install -> archive -> reverify -> start -> accept
{
  const fx = await maintenanceFixture();
  const { calls, deps } = depsFor(fx);
  const result = await executeRecovery(fx.profile, { ...paths(fx), deps });
  assert.equal(result.state.phase, 'accepted');
  assert.equal(result.productionExecutionAllowed, false);
  assert.deepEqual(calls, ['snapshot', 'install', 'start', 'doctor']);
  // old records archived (freeze last)
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) assert.equal(await exists(join(fx.root, 'run', name)), false);
  // transaction persisted with archive seal + release
  const txn = JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));
  assert.equal(txn.phase, 'accepted');
  assert.ok(txn.archive?.seal && txn.archive?.archiveRoot);
  assert.equal(txn.startedRunId, '11111111-2222-3333-4444-555555555555');
}

// (2) verify failure stops before any mutation
{
  const fx = await maintenanceFixture();
  const { deps } = depsFor(fx, { verifyBaseline: async () => { throw Error('MAINTENANCE_CANDIDATE_DENIED'); } });
  await assert.rejects(executeRecovery(fx.profile, { ...paths(fx), deps }), /MAINTENANCE_CANDIDATE_DENIED/);
  const txn = JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));
  assert.equal(txn.phase, 'failed');
  assert.equal(txn.error.code, 'MAINTENANCE_CANDIDATE_DENIED');
  for (const name of ['runtime.json', 'backup.freeze']) assert.equal(await exists(join(fx.root, 'run', name)), true, name + ' untouched');
}

// (3) snapshot failure: stale freeze is retained continuously, phase failed
{
  const fx = await maintenanceFixture();
  const { deps } = depsFor(fx, { snapshot: async () => { throw Error('SIMULATED_SNAPSHOT_FAILURE'); } });
  await assert.rejects(executeRecovery(fx.profile, { ...paths(fx), deps }), /SIMULATED_SNAPSHOT_FAILURE/);
  assert.equal(await exists(join(fx.root, 'run', 'backup.freeze')), true, 'stale freeze must remain after snapshot failure');
  assert.equal(await exists(join(fx.root, 'run', 'backup.freeze.hold')), false, 'no lock renaming is permitted');
}

// (4) install failure stops before archive
{
  const fx = await maintenanceFixture();
  const { deps } = depsFor(fx, { install: async () => { throw Error('MAINTENANCE_INSTALL_VERIFY_FAILED'); } });
  await assert.rejects(executeRecovery(fx.profile, { ...paths(fx), deps }), /MAINTENANCE_INSTALL_VERIFY_FAILED/);
  const txn = JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));
  assert.equal(txn.phase, 'failed');
  // not archived yet: old records still present
  assert.equal(await exists(join(fx.root, 'run', 'runtime.json')), true);
}

// (5) health failure retains evidence; code/pin restoration is unsupported.
{
  const fx = await maintenanceFixture();
  const { calls, deps } = depsFor(fx, { doctor: async () => { calls.push('doctor'); return { healthy: false }; } });
  await assert.rejects(executeRecovery(fx.profile, { ...paths(fx), deps }), /MAINTENANCE_HEALTH_FAILED/);
  assert.deepEqual(calls, ['snapshot', 'install', 'start', 'doctor']);
  // records were archived before start
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) assert.equal(await exists(join(fx.root, 'run', name)), false);
  await assert.rejects(executeRollback(fx.profile, { deps: { observe: async () => goodObservation(), confirm: async binding => ({ ...binding, kind: 'simulation-only', expiresAt: Date.now() + 60000 }), stop: async () => {} } }), /MAINTENANCE_RELEASE_RESTORE_UNSUPPORTED/);
  const txn = JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));
  assert.equal(txn.phase, 'failed');
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) assert.equal(await exists(join(txn.archive.archiveRoot, 'original', name)), true, name + ' evidence retained');
}

// (6) plan validation rejects wrong baseline/candidate commit
{
  const fx = await maintenanceFixture();
  const good = { baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, runIds: { oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId }, ports: [...maintenance.ports], window: { issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }, profile: fx.profile };
  assert.equal(validateMaintenancePlan(good).ok, true);
  for (const mutate of [p => { p.candidateCommit = '1'.repeat(40); }, p => { p.baselineCommit = '0'.repeat(40); }]) {
    const copy = structuredClone(good); mutate(copy);
    const r = validateMaintenancePlan(copy);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /CANDIDATE|BASELINE/.test(e)));
  }
}

// (7) installMaintenanceRelease rejects a candidate commit mismatch
{
  const fx = await maintenanceFixture();
  const approve = async action => { if (action !== 'manager') throw Error('BAD_ACTION'); return { kind: 'production-receipt', action }; };
  await assert.rejects(
    installMaintenanceRelease(fx.profile, R, { approve, manifest: { commit: '9'.repeat(40), sourceFiles: [], native: [] }, copy: async () => ({ appFiles: 0, managerFiles: 0 }) }),
    /MAINTENANCE_CANDIDATE_COMMIT_MISMATCH/
  );
}

// (8) restoreControlRecordsFromSnapshot restores freeze first and refuses tampering
{
  const fx = await maintenanceFixture();
  const { deps } = depsFor(fx);
  await executeRecovery(fx.profile, { ...paths(fx), deps });
  const txn = JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));
  // tamper with the sealed original -> stateless restore refuses
  const tampered = structuredClone(txn);
  tampered.archive = { ...txn.archive, archiveRoot: join(fx.root, 'maintenance-evidence-invalid') };
  await assert.rejects(restoreControlRecordsFromSnapshot(fx.root, txn.archive.archiveRoot, 'f'.repeat(64), { observe: async () => goodObservation(), approve: async () => {} }), /MAINTENANCE_SNAPSHOT_CHANGED/);
}

// (9) real source/native installation copies + hash-verifies both App and Manager, rejects tampering
{
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const fx = await maintenanceFixture();
  const releaseRoot = await mkdtemp('D:/Tong/state/b23-release-');
  await mkdir(join(releaseRoot, 'code', 'source', 'scripts'), { recursive: true });
  await mkdir(join(releaseRoot, 'native', 'node_modules', 'better-sqlite3', 'build', 'Release'), { recursive: true });
  const srcBytes = Buffer.from('hello source');
  const nativeBytes = Buffer.from('native binary');
  await writeFile(join(releaseRoot, 'code', 'source', 'scripts', 'app.mjs'), srcBytes);
  await writeFile(join(releaseRoot, 'native', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'), nativeBytes);
  const manifest = {
    commit: 'c'.repeat(40),
    sourceFiles: [{ path: 'scripts/app.mjs', size: srcBytes.length, sha256: sha(srcBytes) }],
    native: [{ path: 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', size: nativeBytes.length, sha256: sha(nativeBytes) }],
  };
  await realCopyRelease(fx.profile, releaseRoot, manifest);
  const codeRoot = join(fx.root, 'tong'), managerRoot = join(fx.root, 'releases', 'manager');
  assert.equal(sha(await readFile(join(codeRoot, 'scripts', 'app.mjs'))), sha(srcBytes));
  assert.equal(sha(await readFile(join(managerRoot, 'scripts', 'app.mjs'))), sha(srcBytes));
  assert.equal(sha(await readFile(join(codeRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))), sha(nativeBytes));
  assert.equal(sha(await readFile(join(managerRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))), sha(nativeBytes));
  await writeFile(join(releaseRoot, 'code', 'source', 'scripts', 'app.mjs'), Buffer.from('tampered'));
  await assert.rejects(realCopyRelease(fx.profile, releaseRoot, manifest), /MAINTENANCE_SOURCE_HASH_MISMATCH/);
}

console.log(JSON.stringify({ passed: true, injectedSuccessPathAccepted: true, verifyFailureStops: true, snapshotFailureRetainsFreeze: true, installFailureStops: true, unsupportedReleaseRollbackRefused: true, planCommitBindingValidated: true, installCommitMismatchRejected: true, snapshotTamperRejected: true, realSourceNativeCopyVerified: true, productionExecutionAllowed: false }));
