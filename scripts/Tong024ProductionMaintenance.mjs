import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, rename, open } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { verifyRuntimeCandidate, pinRuntimeRelease } from './TongRuntimeCandidate.mjs';
import { validateProductionProfile, verifyRuntimeApproval, PRODUCTION_ROOT } from './TongProductionProfile.mjs';
import { assertProtectedPaths } from './TongRuntimeSecurity.mjs';
import { assessLegacyRecovery, incident } from './Tong024LegacyRecovery.mjs';

// Formal production maintenance adapter for the 024 startup-recovery incident.
//
// The offline rehearsal (Tong024LegacyRecovery.mjs) deliberately refuses the
// production root and only exercises a simulation marker. This module is a
// separate, clearly bounded maintenance entry that wires the same incident
// evidence model and the proven archive/rollback ordering into the existing
// production machinery: candidate/release binding, native DPAPI approval
// receipts, protected-path ACL checks and the backup.freeze lifecycle mutex.
//
// It NEVER mints a permission. Production steps only verify an existing typed
// approval receipt (verifyRuntimeApproval); the human challenge is performed
// separately by TongProductionApproval.ps1 -Mode approve. The simulation mode
// used by the isolation tests is always labelled productionExecutionAllowed:
// false and cannot masquerade as a real user approval.

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export const maintenance = Object.freeze({
  kind: '024-startup-recovery-maintenance',
  baselineCommit: incident.baselineCommit,
  candidateCommit: '34e26801876d8b1a2fc874dddce72b0939924e87',
  oldRunId: incident.oldRunId,
  firstFailedRunId: incident.firstFailedRunId,
  failedRunId: incident.failedRunId,
  ports: [7676, 7677, 18765],
  // freeze is archived last and restored first so ordinary startup stays
  // blocked until every other control record is retained / re-sealed.
  requiredRecords: ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze'],
  optionalRecords: ['stop.json', 'login-recovery-budget.json', 'stale-reconciliation.json'],
  requiredApprovals: Object.freeze(['backup', 'manager', 'start', 'stop', 'restore']),
});

// ---- plan ----

export function validateMaintenancePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, errors: ['PLAN_MISSING'] };
  const { baselineCommit, candidateCommit, runIds, ports, window, profile } = plan;
  if (baselineCommit !== maintenance.baselineCommit) errors.push('PLAN_BASELINE_MISMATCH');
  if (candidateCommit !== maintenance.candidateCommit) errors.push('PLAN_CANDIDATE_MISMATCH');
  if (!runIds || runIds.oldRunId !== maintenance.oldRunId || runIds.firstFailedRunId !== maintenance.firstFailedRunId || runIds.failedRunId !== maintenance.failedRunId) errors.push('PLAN_RUN_ID_MISMATCH');
  if (!Array.isArray(ports) || ports.length !== maintenance.ports.length || maintenance.ports.some(port => !ports.includes(port))) errors.push('PLAN_PORT_MISMATCH');
  if (!window || !Number.isFinite(Date.parse(window.issuedAt ?? '')) || !Number.isFinite(Date.parse(window.expiresAt ?? ''))) errors.push('PLAN_WINDOW_UNBOUND');
  else {
    const issued = Date.parse(window.issuedAt), expires = Date.parse(window.expiresAt);
    if (expires <= issued || expires - issued > 3600000) errors.push('PLAN_WINDOW_UNBOUND');
  }
  let validProfile = null;
  try { validProfile = validateProductionProfile(profile); } catch { errors.push('PLAN_PROFILE_INVALID'); }
  if (errors.length) return { ok: false, errors, profile: validProfile };
  return { ok: true, plan: { ...plan, profile: validProfile }, profile: validProfile };
}

// ---- baseline verification (read-only, no approval required) ----

export async function verifyMaintenanceBaseline(profile, { managerProfile } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode === 'production' && valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_ROOT_DENIED');
  const app = await verifyRuntimeCandidate(valid);
  const manager = await verifyRuntimeCandidate(valid, { manager: true, reviewedManagerProfile: managerProfile ?? valid });
  return {
    mode: valid.mode,
    root: valid.root,
    commit: app.commit,
    sourceDigest: app.sourceDigest,
    releaseDigest: app.releaseDigest,
    appVerified: app.verified,
    managerVerified: manager.verified,
    node: app.node,
    productionExecutionAllowed: false,
  };
}

// ---- App/Manager consistent version switch (delegates to existing machinery) ----

export async function switchMaintenanceRelease(profile, releaseRoot, { approve }) {
  const valid = validateProductionProfile(profile);
  await approve('manager');
  const app = await pinRuntimeRelease(valid, releaseRoot, { replace: true });
  const manager = await pinRuntimeRelease(valid, releaseRoot, { replace: true, manager: true });
  return { appCommit: app.commit, managerCommit: manager.commit, switched: true };
}

// ---- site evidence assessment ----

export function assessMaintenanceSite({ baselineCommit, runtime, guardian, request, abort, observation }) {
  const failures = assessLegacyRecovery({ baselineCommit, runtime, guardian, request, abort, observation });
  if (observation && !Array.isArray(observation.ports)) failures.push('PORT_INVENTORY_MISSING');
  if (observation && maintenance.ports.some(port => !observation.ports?.some(p => p.port === port && p.free === true))) failures.push('PORT_PROOF_REQUIRED');
  if (observation && observation.failedAttemptReceipts !== 'absent-legacy') failures.push('LEGACY_RECEIPT_OBSERVATION_REQUIRED');
  return failures;
}

// Clean startup site after the old control records are archived: the old
// identity no longer applies, but the site must still be quiescent before the
// one controlled startup. This is distinct from assessLegacyRecovery, which
// requires the old runtime/guardian/request/abort records to still exist.
export function assessStartupSite(observation) {
  const failures = [];
  if (!observation || typeof observation !== 'object') return ['OBSERVATION_MISSING'];
  const age = Date.now() - Date.parse(observation.observedAt ?? '');
  if (!Number.isFinite(age) || age < -5000 || age > 30000) failures.push('LIVE_OBSERVATION_REQUIRED');
  if (observation.lifecycleExclusive !== true) failures.push('LIFECYCLE_EXCLUSIVE_REQUIRED');
  if (observation.monitorStopped !== true) failures.push('MONITOR_STOPPED_REQUIRED');
  if (observation.processInventoryComplete !== true) failures.push('PROCESS_INVENTORY_REQUIRED');
  if (!Array.isArray(observation.matchingProcesses) || observation.matchingProcesses.length) failures.push('UNKNOWN_PROCESS_PRESENT');
  if (!Array.isArray(observation.jobs) || observation.jobs.some(job => job.active !== 0)) failures.push('JOB_PROOF_REQUIRED');
  if (!Array.isArray(observation.ports) || maintenance.ports.some(port => !observation.ports.some(p => p.port === port && p.free === true))) failures.push('PORT_PROOF_REQUIRED');
  return failures;
}

// ---- production-aware control-record archive/rollback ----

const simulationMarker = '024-maintenance-simulation';

async function ordinary(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) fail('MAINTENANCE_PATH_DENIED');
  return info;
}
async function bytes(path) { await ordinary(path); return readFile(path); }
async function absent(path) { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }

function rootPolicy(profile) {
  const valid = validateProductionProfile(profile);
  if (valid.mode === 'production') {
    if (valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_ROOT_DENIED');
    return { production: true, root: valid.root, guard: async () => { await assertProtectedPaths([valid.root, join(valid.root, 'run')]); } };
  }
  const state = resolve('D:\\Tong\\state');
  const root = resolve(valid.root);
  if (root === state || !root.toLowerCase().startsWith(state.toLowerCase() + sep)) fail('MAINTENANCE_SIMULATION_ONLY');
  return { production: false, root, guard: async () => {
    const marker = JSON.parse(await bytes(join(root, 'runtime-synthetic.json')));
    if (marker.scope !== simulationMarker) fail('MAINTENANCE_SIMULATION_ONLY');
    await ordinary(join(root, 'run'), true);
  } };
}

// Shared, deterministic archive/rollback core. Only the root policy and the
// authorization hook differ between production and simulation; the
// ordering/conflict/tamper semantics are identical and were already proven by
// the offline rehearsal.
export async function openControlRecordArchive({ profile, observe, authorize, confirm, beforeMove = async () => {}, beforeRestore = async () => {} }) {
  const policy = rootPolicy(profile);
  const root = policy.root;
  if (typeof observe !== 'function') fail('MAINTENANCE_OBSERVER_REQUIRED');
  if (policy.production) { if (typeof authorize !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED'); }
  else if (typeof confirm !== 'function') fail('MAINTENANCE_CONFIRMER_REQUIRED');

  let phase = 'new', archiveRoot, seal, original, manifest, sequence = 0;
  const moved = new Set();

  async function checkArchive() { await policy.guard(); await ordinary(archiveRoot, true); await ordinary(join(archiveRoot, 'original'), true); await ordinary(join(archiveRoot, 'retired'), true); }
  async function lease(action) {
    await policy.guard();
    const handle = await open(join(root, 'run', 'maintenance.lock'), 'wx');
    try { return await action(); } finally { await handle.close(); await policy.guard(); await rename(join(root, 'run', 'maintenance.lock'), join(root, 'run', 'maintenance-' + randomUUID() + '.closed')); }
  }
  async function journal(event) { await checkArchive(); await writeFile(join(archiveRoot, String(++sequence).padStart(3, '0') + '-' + event + '.json'), JSON.stringify({ kind: maintenance.kind, event, phase, seal, production: policy.production }), { flag: 'wx' }); }
  async function observeFresh() { const o = await observe(); if (!o || typeof o !== 'object') fail('MAINTENANCE_OBSERVATION_INVALID'); return o; }
  async function proof() {
    const obs = await observeFresh();
    const evidence = { baselineCommit: maintenance.baselineCommit, ...Object.fromEntries(['runtime', 'guardian', 'request', 'abort'].map(key => [key, JSON.parse(original[key + '.json'])])), observation: obs };
    if (assessMaintenanceSite(evidence).length) fail('MAINTENANCE_PROOF_REQUIRED');
    for (const role of ['launcher', 'guardian']) if (!await absent(join(root, 'run', role + '.' + maintenance.failedRunId + '.json'))) fail('MAINTENANCE_CONFLICT');
    return obs;
  }
  async function approve(action) {
    if (policy.production) { await verifyRuntimeApproval(validateProductionProfile(profile), action); return { kind: 'production-receipt', action }; }
    const binding = { action, root, archiveRoot, seal, oldRunId: maintenance.oldRunId, failedRunId: maintenance.failedRunId };
    const receipt = await confirm(binding);
    if (receipt?.kind !== 'simulation-only' || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now() || receipt.expiresAt > Date.now() + 300000 || Object.entries(binding).some(([key, value]) => receipt[key] !== value)) fail('MAINTENANCE_APPROVAL_REQUIRED');
    return receipt;
  }
  async function verifyArchive() {
    await checkArchive();
    if (sha(await bytes(join(archiveRoot, 'snapshot.json'))) !== seal) fail('MAINTENANCE_SNAPSHOT_CHANGED');
    for (const file of manifest.files) if (sha(await bytes(join(archiveRoot, 'original', file.name))) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED');
  }

  return {
    get phase() { return phase; },
    async prepare() {
      return lease(async () => {
        if (phase !== 'new') fail('MAINTENANCE_STAGE_DENIED');
        await policy.guard();
        original = {};
        for (const name of maintenance.requiredRecords) original[name] = await bytes(join(root, 'run', name));
        for (const name of maintenance.optionalRecords) if (!await absent(join(root, 'run', name))) original[name] = await bytes(join(root, 'run', name));
        await proof();
        archiveRoot = join(root, 'maintenance-evidence-' + randomUUID());
        await mkdir(archiveRoot); await mkdir(join(archiveRoot, 'original')); await mkdir(join(archiveRoot, 'retired'));
        for (const [name, value] of Object.entries(original)) await writeFile(join(archiveRoot, 'original', name), value, { flag: 'wx' });
        manifest = { schemaVersion: 1, kind: maintenance.kind, root, baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId, files: Object.entries(original).map(([name, value]) => ({ name, size: value.length, sha256: sha(value) })) };
        const encoded = Buffer.from(JSON.stringify(manifest));
        seal = sha(encoded);
        await writeFile(join(archiveRoot, 'snapshot.json'), encoded, { flag: 'wx' });
        phase = 'prepared';
        await journal('prepared');
        return { phase, seal, archiveRoot, productionExecutionAllowed: false };
      });
    },
    async retire() {
      return lease(async () => {
        if (phase !== 'prepared') fail('MAINTENANCE_STAGE_DENIED');
        await verifyArchive(); await proof(); await approve('manager'); await verifyArchive(); await proof();
        for (const [name, value] of Object.entries(original)) if (sha(await bytes(join(root, 'run', name))) !== sha(value)) fail('MAINTENANCE_CONFLICT');
        phase = 'retiring'; await journal('retiring');
        try {
          for (const name of [...Object.keys(original).filter(name => name !== 'backup.freeze'), 'backup.freeze']) {
            await beforeMove(name); await policy.guard(); await checkArchive();
            if (sha(await bytes(join(root, 'run', name))) !== sha(original[name])) fail('MAINTENANCE_CONFLICT');
            await rename(join(root, 'run', name), join(archiveRoot, 'retired', name)); moved.add(name);
          }
          phase = 'retired'; await journal('retired');
          return { phase, productionExecutionAllowed: false };
        } catch (error) { phase = 'failed'; await journal('failed'); throw error; }
      });
    },
    async rollback() {
      return lease(async () => {
        if (!['retired', 'failed', 'rollback-failed'].includes(phase)) fail('MAINTENANCE_STAGE_DENIED');
        await verifyArchive(); await proof(); await approve('restore'); await verifyArchive(); await proof();
        for (const [name, value] of Object.entries(original)) {
          const path = join(root, 'run', name);
          if (moved.has(name)) { if (!await absent(path) || sha(await bytes(join(archiveRoot, 'retired', name))) !== sha(value)) fail('MAINTENANCE_CONFLICT'); }
          else if (sha(await bytes(path)) !== sha(value)) fail('MAINTENANCE_CONFLICT');
        }
        phase = 'rolling-back';
        try {
          await journal('rolling-back');
          for (const name of ['backup.freeze', ...Object.keys(original).filter(name => name !== 'backup.freeze')]) if (moved.has(name)) {
            await beforeRestore(name); await policy.guard(); await checkArchive();
            if (!await absent(join(root, 'run', name))) fail('MAINTENANCE_CONFLICT');
            await writeFile(join(root, 'run', name), original[name], { flag: 'wx' }); moved.delete(name);
          }
          phase = 'rolled-back'; await journal('rolled-back');
          return { phase, productionExecutionAllowed: false };
        } catch (error) { phase = 'rollback-failed'; try { await journal('rollback-failed'); } catch {} throw error; }
      });
    },
  };
}

// ---- session orchestrator ----

export async function openMaintenanceSession({ profile, managerProfile, observe, authorize, confirm, start, stop, doctor, verifyBaseline }) {
  const valid = validateProductionProfile(profile);
  const production = valid.mode === 'production';
  if (production && valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_ROOT_DENIED');
  const session = { production, mode: valid.mode, root: valid.root, phase: 'new', journal: [], started: false, productionExecutionAllowed: false };
  const record = (event, detail = {}) => { session.journal.push({ at: new Date().toISOString(), event, phase: session.phase, ...detail }); };
  const requirePhase = (...allowed) => { if (!allowed.includes(session.phase)) fail('MAINTENANCE_STAGE_DENIED'); };
  const approve = async action => {
    if (production) { if (typeof authorize !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED'); await authorize(action); return { kind: 'production-receipt', action }; }
    if (typeof confirm !== 'function') fail('MAINTENANCE_CONFIRMER_REQUIRED');
    const receipt = await confirm({ action, root: valid.root, mode: valid.mode });
    if (receipt?.kind !== 'simulation-only' || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now() || receipt.expiresAt > Date.now() + 300000) fail('MAINTENANCE_APPROVAL_REQUIRED');
    return receipt;
  };

  return {
    get state() { return { phase: session.phase, journal: [...session.journal], productionExecutionAllowed: session.productionExecutionAllowed }; },

    async plan(plan) {
      requirePhase('new');
      const result = validateMaintenancePlan(plan);
      if (!result.ok) { record('plan_rejected', { errors: result.errors }); fail('MAINTENANCE_PLAN_REJECTED'); }
      session.plan = result.plan; session.phase = 'planned'; record('planned', { baselineCommit: plan.baselineCommit, candidateCommit: plan.candidateCommit });
      return session.state;
    },

    async verify() {
      requirePhase('planned');
      const baseline = await (verifyBaseline ?? verifyMaintenanceBaseline)(valid, { managerProfile });
      session.baseline = baseline; session.phase = 'verified'; record('verified', { commit: baseline.commit, appVerified: baseline.appVerified, managerVerified: baseline.managerVerified });
      return baseline;
    },

    async observe() {
      requirePhase('verified');
      if (typeof observe !== 'function') fail('MAINTENANCE_OBSERVER_REQUIRED');
      const records = { baselineCommit: maintenance.baselineCommit };
      for (const key of ['runtime', 'guardian', 'request', 'abort']) {
        try { records[key] = JSON.parse(await bytes(join(valid.root, 'run', key + '.json'))); } catch (error) { if (error.code === 'ENOENT') records[key] = null; else throw error; }
      }
      const observation = await observe();
      const failures = assessMaintenanceSite({ ...records, observation });
      if (failures.length) { record('observe_rejected', { failures }); fail('MAINTENANCE_SITE_UNSAFE'); }
      session.observation = observation; session.phase = 'observed'; record('observed');
      return { failures, observation };
    },

    async archive() {
      requirePhase('observed');
      const archive = await openControlRecordArchive({ profile: valid, observe, authorize, confirm });
      const prepared = await archive.prepare();
      const retired = await archive.retire();
      session.archive = { ...prepared, ...retired, archive };
      session.phase = 'archived'; record('archived', { archiveRoot: prepared.archiveRoot, seal: prepared.seal });
      return retired;
    },

    async reverify() {
      requirePhase('archived');
      const observation = await observe();
      const failures = assessStartupSite(observation);
      // No new control records may have appeared while the archive was held.
      for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) if (!await absent(join(valid.root, 'run', name))) failures.push('NEW_CONTROL_RECORD_PRESENT');
      for (const role of ['launcher', 'guardian']) if (!await absent(join(valid.root, 'run', role + '.' + maintenance.failedRunId + '.json'))) failures.push('NEW_CONTROL_RECORD_PRESENT');
      if (failures.length) { record('reverify_rejected', { failures }); fail('MAINTENANCE_SITE_UNSAFE'); }
      session.phase = 'reverified'; record('reverified');
      return { failures, observation };
    },

    async start() {
      requirePhase('reverified');
      await approve('start');
      if (typeof start !== 'function') fail('MAINTENANCE_START_REQUIRED');
      const result = await start();
      session.started = true; session.phase = 'starting'; record('start_requested', { runId: result?.runId ?? null });
      return result;
    },

    async accept() {
      requirePhase('starting');
      if (typeof doctor !== 'function') fail('MAINTENANCE_DOCTOR_REQUIRED');
      const health = await doctor();
      if (health?.healthy !== true) { record('accept_failed', { health }); session.phase = 'failed'; fail('MAINTENANCE_HEALTH_FAILED'); }
      session.phase = 'accepted'; record('accepted', { healthy: true });
      return { healthy: true, health };
    },

    async rollback() {
      requirePhase('archived', 'reverified', 'starting', 'failed');
      if (session.started && typeof stop === 'function') { try { await stop(); } catch { /* already stopped */ } }
      if (session.archive?.archive) { const result = await session.archive.archive.rollback(); session.phase = 'rolled-back'; record('rolled_back'); return result; }
      session.phase = 'rolled-back'; record('rolled_back', { note: 'no archive to restore' });
      return { phase: 'rolled-back' };
    },
  };
}

// Production authorization hook: verify an existing typed DPAPI receipt. Never mints.
export async function verifyMaintenanceApproval(profile, action) {
  if (!maintenance.requiredApprovals.includes(action)) fail('MAINTENANCE_APPROVAL_ACTION_DENIED');
  await verifyRuntimeApproval(validateProductionProfile(profile), action);
  return { kind: 'production-receipt', action, verifiedAt: new Date().toISOString() };
}
