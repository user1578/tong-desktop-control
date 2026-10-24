import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maintenance, observeProductionSite, assessMaintenanceSite, describeMaintenance, productionMaintenanceEntry, runProductionRecovery, rollbackProductionRecovery } from '../scripts/Tong024ProductionMaintenance.mjs';
import { createProductionProfile } from '../scripts/TongProductionProfile.mjs';
import { maintenanceFixture, legacyRuntime, legacyGuardian, legacyRequest, legacyAbort } from './fixtures/Tong024MaintenanceFixture.mjs';

const goneSecurity = {
  processIdentity: async () => null,
  startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }),
  sameProcess: (a, b) => !!a && a.pid === b?.pid && a.exe?.toLowerCase() === b?.exe?.toLowerCase() && a.startTicks === b?.startTicks,
};
const portFree = async () => true;
const monitorStopped = async () => true;
const evidence = () => ({ baselineCommit: maintenance.baselineCommit, runtime: legacyRuntime(), guardian: legacyGuardian(), request: legacyRequest(), abort: legacyAbort() });

// (1) real-format observation of a quiescent site is accepted
{
  const fx = await maintenanceFixture();
  const obs = await observeProductionSite(fx.profile, { security: goneSecurity, checkPort: portFree, checkMonitor: monitorStopped });
  assert.equal(obs.lifecycleExclusive, true, 'backup.freeze must be observed as the held lifecycle mutex');
  assert.equal(obs.monitorStopped, true);
  assert.equal(obs.processInventoryComplete, true);
  assert.equal(obs.matchingProcesses.length, 0);
  assert.equal(obs.failedAttemptReceipts, 'absent-legacy');
  assert.equal(obs.jobs.length, 12);
  assert.equal(obs.ports.length, 3);
  assert.equal(obs.productionExecutionAllowed, false);
  assert.deepEqual(assessMaintenanceSite({ ...evidence(), observation: obs }), []);
}

// (2) live process identity -> matchingProcesses non-empty -> refused
{
  const fx = await maintenanceFixture();
  const g = legacyGuardian();
  const live = {
    processIdentity: async pid => (pid === g.pid ? { ...g, markerMatches: true } : null),
    startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }),
    sameProcess: (a, b) => !!a && a.pid === b?.pid && a.exe?.toLowerCase() === b?.exe?.toLowerCase() && a.startTicks === b?.startTicks,
  };
  const obs = await observeProductionSite(fx.profile, { security: live, checkPort: portFree, checkMonitor: monitorStopped });
  assert.ok(obs.matchingProcesses.length > 0);
  assert.ok(assessMaintenanceSite({ ...evidence(), observation: obs }).length);
}

// (3) non-empty Job -> refused
{
  const fx = await maintenanceFixture();
  const busyJob = { ...goneSecurity, startupJobsState: async runId => (runId === maintenance.oldRunId ? { owner: 0, launcher: 0, guardian: 0, runtime: 1 } : { owner: 0, launcher: 0, guardian: 0, runtime: 0 }) };
  const obs = await observeProductionSite(fx.profile, { security: busyJob, checkPort: portFree, checkMonitor: monitorStopped });
  assert.ok(assessMaintenanceSite({ ...evidence(), observation: obs }).length);
}

// (4) busy port -> refused
{
  const fx = await maintenanceFixture();
  const busyPort = async port => port !== 7676;
  const obs = await observeProductionSite(fx.profile, { security: goneSecurity, checkPort: busyPort, checkMonitor: monitorStopped });
  assert.ok(assessMaintenanceSite({ ...evidence(), observation: obs }).length);
}

// (5) present legacy receipt is recorded honestly (never invented/erased)
{
  const fx = await maintenanceFixture();
  await writeFile(join(fx.root, 'run', 'launcher.' + maintenance.failedRunId + '.json'), '{}');
  const obs = await observeProductionSite(fx.profile, { security: goneSecurity, checkPort: portFree, checkMonitor: monitorStopped });
  assert.equal(obs.failedAttemptReceipts, 'present-legacy');
  assert.ok(assessMaintenanceSite({ ...evidence(), observation: obs }).length);
}

// (6) describeMaintenance binds the exact SHAs and the five native authorization actions
{
  const plan = describeMaintenance();
  assert.equal(plan.baselineCommit, '024d5b0920d9ad8f1a2baf2e55640a5666ad4739');
  assert.equal(plan.candidateCommit, '34e26801876d8b1a2fc874dddce72b0939924e87');
  assert.equal(plan.productionRoot, 'D:\\Tong\\runtime');
  assert.deepEqual(plan.nativeAuthorization.map(a => a.action), ['backup', 'manager', 'start', 'stop', 'restore']);
  assert.equal(plan.productionExecutionAllowed, false);
  assert.ok(plan.executionOrder.length >= 8);
  assert.ok(plan.failStopConditions.length >= 3);
}

// (7) production entry fails closed on a non-production profile
{
  const fx = await maintenanceFixture();
  await assert.rejects(productionMaintenanceEntry(fx.profile), /MAINTENANCE_PRODUCTION_ONLY/);
}

// (8) complete single-entry recovery gates fail closed before any native access
{
  const prod = createProductionProfile({ sourceDigest: 'a'.repeat(64), releaseDigest: 'b'.repeat(64), agentdockEnabled: false });
  const fx = await maintenanceFixture();
  await assert.rejects(runProductionRecovery(fx.profile, { backupRoot: 'D:\\Tong\\state\\b', releaseRoot: 'D:\\Tong\\state\\r', restoreRoot: 'D:\\Tong\\state\\s' }), /MAINTENANCE_PRODUCTION_ONLY/);
  await assert.rejects(runProductionRecovery(prod, {}), /MAINTENANCE_BACKUP_ROOT_REQUIRED/);
  await assert.rejects(runProductionRecovery(prod, { backupRoot: 'D:\\Tong\\state\\b' }), /MAINTENANCE_RELEASE_ROOT_REQUIRED/);
  await assert.rejects(runProductionRecovery(prod, { backupRoot: 'D:\\Tong\\state\\b', releaseRoot: 'D:\\Tong\\state\\r' }), /MAINTENANCE_RESTORE_ROOT_REQUIRED/);
  await assert.rejects(rollbackProductionRecovery(prod, {}), /MAINTENANCE_BACKUP_ROOT_REQUIRED/);
}

console.log(JSON.stringify({ passed: true, observerQuiescentAccepted: true, liveProcessRefused: true, busyJobRefused: true, busyPortRefused: true, presentReceiptRecorded: true, planBound: true, productionEntryFailClosed: true, completeEntryFailClosed: true, productionExecutionAllowed: false }));
