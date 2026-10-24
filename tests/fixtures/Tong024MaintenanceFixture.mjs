import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createProductionSimulationProfile } from '../../scripts/TongProductionProfile.mjs';
import { incident } from '../../scripts/Tong024LegacyRecovery.mjs';

export const identity = pid => ({ pid, exe: 'D:\\node\\node.exe', startTicks: String(pid) });

export function legacyRuntime() {
  return { runId: incident.oldRunId, phase: 'abnormal_exit', supervisor: identity(11), children: [identity(12)], descendants: [] };
}
export function legacyGuardian() {
  return { ...identity(10), runId: incident.oldRunId, nodePid: 11, finishedAt: new Date().toISOString(), jobAssigned: true, killOnJobClose: true, jobName: 'Local\\TongRuntime-' + incident.oldRunId, jobActiveAfterCleanup: 0 };
}
export function legacyRequest() {
  return { runId: incident.failedRunId, createdAt: '2026-10-23T10:55:13.368Z' };
}
export function legacyAbort() {
  return { runId: incident.failedRunId, requestedAt: '2026-10-23T10:55:28.390Z', reason: 'START_ABORT' };
}
export function goodObservation(overrides = {}) {
  return {
    observedAt: new Date().toISOString(),
    lifecycleExclusive: true,
    monitorStopped: true,
    processInventoryComplete: true,
    matchingProcesses: [],
    identities: [10, 11, 12].map(pid => ({ ...identity(pid), state: 'gone' })),
    jobs: [incident.oldRunId, incident.firstFailedRunId, incident.failedRunId].flatMap(runId => ['runtime', 'owner', 'launcher', 'guardian'].map(role => ({ runId, role, active: 0 }))),
    ports: [7676, 7677, 18765].map(port => ({ port, free: true })),
    failedAttemptReceipts: 'absent-legacy',
    ...overrides,
  };
}

// A plain simulation root (no restricted ACL, no subprocess) that carries the
// legacy control records. profile.mode is production-simulation so the adapter
// treats it as a preserved (non-production) root; productionExecutionAllowed
// stays false throughout.
export async function maintenanceFixture({ withControlRecords = true } = {}) {
  const root = await mkdtemp('D:\\Tong\\state\\b23-maint-');
  const simulationId = basename(root);
  await writeFile(join(root, 'runtime-synthetic.json'), JSON.stringify({ scope: '024-maintenance-simulation' }));
  await mkdir(join(root, 'run'));
  if (withControlRecords) {
    const records = {
      'runtime.json': legacyRuntime(),
      'guardian.json': legacyGuardian(),
      'request.json': legacyRequest(),
      'abort.json': legacyAbort(),
    };
    for (const [name, value] of Object.entries(records)) await writeFile(join(root, 'run', name), Buffer.from(JSON.stringify(value)));
    await writeFile(join(root, 'run', 'backup.freeze'), Buffer.alloc(0));
  }
  const profile = createProductionSimulationProfile({ simulationId, sourceDigest: 'a'.repeat(64), releaseDigest: 'b'.repeat(64), agentdockEnabled: false });
  return { root, profile, simulationId };
}
