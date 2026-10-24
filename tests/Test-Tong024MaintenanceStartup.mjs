import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maintenance, openMaintenanceSession } from '../scripts/Tong024ProductionMaintenance.mjs';
import { maintenanceFixture, goodObservation } from './fixtures/Tong024MaintenanceFixture.mjs';

const confirm = async binding => ({ ...binding, kind: 'simulation-only', expiresAt: Date.now() + 60000 });
const verifyBaseline = async () => ({ commit: 'c'.repeat(40), appVerified: true, managerVerified: true, sourceDigest: 'a'.repeat(64), releaseDigest: 'b'.repeat(64), node: null, productionExecutionAllowed: false });
function planFor(profile) {
  return {
    baselineCommit: maintenance.baselineCommit,
    candidateCommit: maintenance.candidateCommit,
    runIds: { oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId },
    ports: [...maintenance.ports],
    window: { issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() },
    profile,
  };
}

// (8) controlled startup + simulated ready/doctor/Gateway/MCP/login-monitor acceptance
{
  const fx = await maintenanceFixture();
  let started = 0;
  const session = await openMaintenanceSession({
    profile: fx.profile,
    observe: async () => goodObservation(),
    confirm,
    verifyBaseline,
    start: async () => { started++; return { runId: '11111111-2222-3333-4444-555555555555', phase: 'ready', children: [{ role: 'agentdock' }, { role: 'devspace' }, { role: 'gateway' }] }; },
    doctor: async () => ({ healthy: true, phase: 'ready', health: { discovery: true, unauthenticatedRejected: true } }),
    stop: async () => {},
  });
  await session.plan(planFor(fx.profile));
  await session.verify();
  await session.observe();
  await session.archive();
  await session.reverify();
  const startResult = await session.start();
  assert.equal(startResult.phase, 'ready');
  const accepted = await session.accept();
  assert.equal(accepted.healthy, true);
  assert.equal(session.state.phase, 'accepted');
  assert.equal(started, 1);
  assert.deepEqual(session.state.journal.map(e => e.event), ['planned', 'verified', 'observed', 'archived', 'reverified', 'start_requested', 'accepted']);
  assert.equal(session.state.productionExecutionAllowed, false);
}

// (9) acceptance failure → safe stop + rollback
{
  const fx = await maintenanceFixture();
  let stopped = 0;
  const session = await openMaintenanceSession({
    profile: fx.profile,
    observe: async () => goodObservation(),
    confirm,
    verifyBaseline,
    start: async () => ({ runId: '66666666-7777-8888-9999-000000000000', phase: 'ready' }),
    doctor: async () => ({ healthy: false, phase: 'ready' }),
    stop: async () => { stopped++; },
  });
  await session.plan(planFor(fx.profile));
  await session.verify();
  await session.observe();
  await session.archive();
  await session.reverify();
  await session.start();
  await assert.rejects(session.accept(), /MAINTENANCE_HEALTH_FAILED/);
  assert.equal(session.state.phase, 'failed');
  const rolled = await session.rollback();
  assert.equal(rolled.phase, 'rolled-back');
  assert.equal(stopped, 1);
  for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) await readFile(join(fx.root, 'run', name));
}

console.log(JSON.stringify({ passed: true, controlledStartAccepted: true, readyDoctorSimulated: true, acceptanceFailureRolledBack: true, stopBeforeRollback: true, journalOrdered: true, productionExecutionAllowed: false }));
