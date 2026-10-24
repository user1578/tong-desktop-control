import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessMaintenanceSite, assessStartupSite, openControlRecordArchive } from '../scripts/Tong024ProductionMaintenance.mjs';
import { maintenanceFixture, goodObservation, legacyRuntime, legacyGuardian, legacyRequest, legacyAbort } from './fixtures/Tong024MaintenanceFixture.mjs';

const approve = async binding => ({ ...binding, kind: 'simulation-only', expiresAt: Date.now() + 60000 });

// (4) live process / unknown process / non-empty job / busy port stop the maintenance
{
  const clean = goodObservation();
  assert.deepEqual(assessStartupSite(clean), []);
  const cases = [
    o => { o.matchingProcesses = [{ pid: 44, exe: 'D:\\node\\node.exe', startTicks: '44' }]; },
    o => { o.jobs[0].active = 1; },
    o => { o.ports[0].free = false; },
    o => { o.monitorStopped = false; },
    o => { o.lifecycleExclusive = false; },
    o => { o.processInventoryComplete = false; },
    o => { o.observedAt = '2000-01-01T00:00:00Z'; },
  ];
  for (const mutate of cases) {
    const o = goodObservation(); mutate(o);
    assert.ok(assessStartupSite(o).length, 'clean-site must refuse');
  }
  const legacyEvidence = { baselineCommit: '024d5b0920d9ad8f1a2baf2e55640a5666ad4739', runtime: legacyRuntime(), guardian: legacyGuardian(), request: legacyRequest(), abort: legacyAbort(), observation: goodObservation() };
  assert.deepEqual(assessMaintenanceSite(legacyEvidence), []);
  for (const mutate of [
    e => { e.observation.identities[0].state = 'alive'; },
    e => { e.observation.jobs.pop(); },
    e => { e.observation.ports.pop(); },
    e => { e.observation.matchingProcesses = [{ pid: 33, exe: 'D:\\node\\node.exe', startTicks: '33' }]; },
  ]) {
    const copy = structuredClone(legacyEvidence); mutate(copy);
    assert.ok(assessMaintenanceSite(copy).length, 'legacy-site must refuse');
  }
}

// (5) native authorization: not-complete / denied / expired / wrong-binding
{
  const denied = await maintenanceFixture();
  const a1 = await openControlRecordArchive({ profile: denied.profile, observe: async () => goodObservation(), confirm: async () => null });
  await a1.prepare();
  await assert.rejects(a1.retire(), /MAINTENANCE_APPROVAL_REQUIRED/);
  assert.equal(a1.phase, 'prepared');
  for (const name of ['runtime.json', 'backup.freeze']) await readFile(join(denied.root, 'run', name));
}
{
  const expired = await maintenanceFixture();
  const a2 = await openControlRecordArchive({ profile: expired.profile, observe: async () => goodObservation(), confirm: async b => ({ ...b, kind: 'simulation-only', expiresAt: Date.now() - 1 }) });
  await a2.prepare();
  await assert.rejects(a2.retire(), /MAINTENANCE_APPROVAL_REQUIRED/);
}
{
  const rebound = await maintenanceFixture();
  const a3 = await openControlRecordArchive({ profile: rebound.profile, observe: async () => goodObservation(), confirm: async b => ({ ...b, root: 'D:\\Tong\\state\\elsewhere', kind: 'simulation-only', expiresAt: Date.now() + 60000 }) });
  await a3.prepare();
  await assert.rejects(a3.retire(), /MAINTENANCE_APPROVAL_REQUIRED/);
}

// (6) sealed snapshot, tamper rejection, restore
{
  const tampered = await maintenanceFixture();
  const a = await openControlRecordArchive({ profile: tampered.profile, observe: async () => goodObservation(), confirm: approve });
  const plan = await a.prepare();
  assert.equal(plan.productionExecutionAllowed, false);
  await writeFile(join(plan.archiveRoot, 'original', 'request.json'), 'changed');
  await assert.rejects(a.retire(), /MAINTENANCE_SNAPSHOT_CHANGED/);
}
{
  const good = await maintenanceFixture();
  const a = await openControlRecordArchive({ profile: good.profile, observe: async () => goodObservation(), confirm: approve });
  const plan = await a.prepare();
  assert.equal((await a.retire()).phase, 'retired');
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) {
    await assert.rejects(readFile(join(good.root, 'run', name)), { code: 'ENOENT' });
  }
  assert.equal((await a.rollback()).phase, 'rolled-back');
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) await readFile(join(good.root, 'run', name));
}

// (7) install interruption / partial archive / partial rollback / external change
{
  let moves = 0;
  const inter = await maintenanceFixture();
  const a = await openControlRecordArchive({ profile: inter.profile, observe: async () => goodObservation(), confirm: approve, beforeMove: async () => { if (++moves === 3) throw Error('SIMULATED_MOVE_FAILURE'); } });
  await a.prepare();
  await assert.rejects(a.retire(), /SIMULATED_MOVE_FAILURE/);
  assert.equal(a.phase, 'failed');
  await a.rollback();
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) await readFile(join(inter.root, 'run', name));
}
{
  const changed = await maintenanceFixture();
  const a = await openControlRecordArchive({ profile: changed.profile, observe: async () => goodObservation(), confirm: approve });
  await a.prepare();
  await writeFile(join(changed.root, 'run', 'request.json'), 'changed');
  await assert.rejects(a.retire(), /MAINTENANCE_CONFLICT/);
}
{
  let restores = 0;
  const rback = await maintenanceFixture();
  const a = await openControlRecordArchive({ profile: rback.profile, observe: async () => goodObservation(), confirm: approve, beforeRestore: async () => { if (++restores === 2) throw Error('SIMULATED_RESTORE_FAILURE'); } });
  await a.prepare();
  await a.retire();
  await assert.rejects(a.rollback(), /SIMULATED_RESTORE_FAILURE/);
  assert.equal(a.phase, 'rollback-failed');
  await a.rollback();
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) await readFile(join(rback.root, 'run', name));
}

console.log(JSON.stringify({ passed: true, unsafeSiteRefused: true, authorizationDeniedExpiredReboundRefused: true, snapshotTamperRefused: true, archiveRestoreVerified: true, interruptionRollback: true, partialRollbackRetry: true, externalChangeConflict: true, productionExecutionAllowed: false }));
