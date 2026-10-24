import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductionProfile } from '../scripts/TongProductionProfile.mjs';
import { maintenance, validateMaintenancePlan, assessMaintenanceSite, openControlRecordArchive, verifyMaintenanceApproval } from '../scripts/Tong024ProductionMaintenance.mjs';
import { maintenanceFixture, goodObservation, legacyRuntime, legacyGuardian, legacyRequest, legacyAbort } from './fixtures/Tong024MaintenanceFixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

// (1) 024d5b0 baseline vs 34e2680 candidate binding
assert.equal(maintenance.baselineCommit, '024d5b0920d9ad8f1a2baf2e55640a5666ad4739');
assert.equal(maintenance.candidateCommit, '34e26801876d8b1a2fc874dddce72b0939924e87');
const base = await maintenanceFixture();
const goodPlan = {
  baselineCommit: maintenance.baselineCommit,
  candidateCommit: maintenance.candidateCommit,
  runIds: { oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId },
  ports: [...maintenance.ports],
  window: { issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() },
  profile: base.profile,
};
assert.equal(validateMaintenancePlan(goodPlan).ok, true);
for (const mutate of [
  p => { p.baselineCommit = '0'.repeat(40); },
  p => { p.candidateCommit = '1'.repeat(40); },
  p => { p.runIds.failedRunId = '00000000-0000-0000-0000-000000000000'; },
  p => { p.ports = [1, 2, 3]; },
  p => { p.window.expiresAt = p.window.issuedAt; },
]) {
  const copy = structuredClone(goodPlan); mutate(copy);
  const r = validateMaintenancePlan(copy);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
}

// (2) committed App/Manager archive + native dependency hash binding
const binding = JSON.parse(await readFile(join(project, 'artifacts/024-recovery/committed-candidate-binding.json'), 'utf8'));
assert.equal(binding.passed, true);
assert.equal(binding.commit, maintenance.candidateCommit);
assert.equal(binding.sourceFiles, 299);
assert.equal(binding.nativeFiles, 23);
assert.equal(binding.appManagerSameCommit, true);
assert.equal(binding.realCommittedArchive, true);
assert.equal(binding.productionExecutionAllowed, false);
assert.match(binding.sourceDigest, /^[a-f0-9]{64}$/);
assert.match(binding.releaseDigest, /^[a-f0-9]{64}$/);
assert.equal(binding.committedRuntimeStopped, true);
assert.equal(binding.fullDependencyInstall, false);

// (3) three runIds identity + honest missing-receipt handling
const evidence = {
  baselineCommit: maintenance.baselineCommit,
  runtime: legacyRuntime(),
  guardian: legacyGuardian(),
  request: legacyRequest(),
  abort: legacyAbort(),
  observation: goodObservation(),
};
assert.deepEqual(assessMaintenanceSite(evidence), []);
for (const mutate of [
  e => { e.guardian.runId = e.request.runId; }, // old guardian terminal is NOT the failed request's guardian
  e => { e.abort.runId = e.runtime.runId; },
  e => { e.request.runId = e.runtime.runId; },
  e => { e.observation.failedAttemptReceipts = 'unknown'; }, // missing receipt recorded, never invented
  e => { e.observation.failedAttemptReceipts = 'present'; },
]) {
  const copy = structuredClone(evidence); mutate(copy);
  assert.ok(assessMaintenanceSite(copy).length, 'must refuse');
}

// (10) isolation boundary: production and non-maintenance roots refused
const productionProfile = createProductionProfile({ sourceDigest: 'a'.repeat(64), releaseDigest: 'b'.repeat(64), agentdockEnabled: false });
await assert.rejects(
  openControlRecordArchive({ profile: productionProfile, observe: async () => goodObservation() }),
  /MAINTENANCE_AUTHORIZER_REQUIRED/,
  'production archive must require a native authorizer before any access'
);
await assert.rejects(verifyMaintenanceApproval(base.profile, 'bogus-action'), /MAINTENANCE_APPROVAL_ACTION_DENIED/);
const wrong = await maintenanceFixture();
await writeFile(join(wrong.root, 'runtime-synthetic.json'), JSON.stringify({ scope: 'not-maintenance' }));
const archWrong = await openControlRecordArchive({ profile: wrong.profile, observe: async () => goodObservation(), confirm: async b => ({ ...b, kind: 'simulation-only', expiresAt: Date.now() + 60000 }) });
await assert.rejects(archWrong.prepare(), /MAINTENANCE_SIMULATION_ONLY/);

console.log(JSON.stringify({ passed: true, baselineBound: true, candidateBound: true, committedArchiveVerified: true, runIdsHonest: true, receiptAbsenceRecorded: true, productionBoundaryRefused: true, nonMaintenanceRootRefused: true }));
