import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, rename, open } from 'node:fs/promises';
import { join, resolve, sep, isAbsolute, dirname } from 'node:path';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeCandidate, pinRuntimeRelease } from './TongRuntimeCandidate.mjs';
import { validateProductionProfile, verifyRuntimeApproval, productionProfileDigest, PRODUCTION_ROOT } from './TongProductionProfile.mjs';
import { assertProtectedPaths, processIdentity, startupJobsState, sameProcess } from './TongRuntimeSecurity.mjs';
import { assessLegacyRecovery, incident } from './Tong024LegacyRecovery.mjs';

// Draft maintenance adapter for the 024 startup-recovery incident. Production
// mutation is disabled pending the missing lease/restore integration below.
//
// The offline rehearsal (Tong024LegacyRecovery.mjs) deliberately refuses the
// production root and only exercises a simulation marker. This module is a
// separate maintenance entry with an incident evidence model and simulation
// archive/rollback ordering. Native primitives are not a complete production
// transaction; describeMaintenance explicitly reports the remaining blockers.
//
// It NEVER mints a permission. Production steps only verify an existing typed
// approval receipt (verifyRuntimeApproval); the human challenge is performed
// separately by TongProductionApproval.ps1 -Mode approve. The simulation mode
// used by the isolation tests is always labelled productionExecutionAllowed:
// false and cannot masquerade as a real user approval.

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };

// The reviewed startup/state APIs each acquire backup.freeze themselves. There
// is no supported continuous maintenance lease/handoff or code/pin restoration
// transaction yet. A successful simulation must never enable production I/O.
const executionBlockers = Object.freeze([
  'CONTINUOUS_LIFECYCLE_HANDOFF_UNSUPPORTED',
  'EXACT_34E2680_HAS_NO_MAINTENANCE_LEASE_HANDOFF',
  'SOURCE_NATIVE_PROFILE_PIN_PERMISSION_RESTORE_UNSUPPORTED',
  'NATIVE_PROCESS_AND_MONITOR_INVENTORY_NOT_CONNECTED',
]);
function denyProductionExecution(profile) {
  if (profile.mode === 'production') {
    const error = new Error('MAINTENANCE_NOT_READY');
    error.code = 'MAINTENANCE_NOT_READY';
    error.executionBlockers = [...executionBlockers];
    throw error;
  }
}

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
  denyProductionExecution(valid);
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
  const expectedJobs = [maintenance.oldRunId, maintenance.firstFailedRunId, maintenance.failedRunId].flatMap(runId => ['runtime', 'owner', 'launcher', 'guardian'].map(role => runId + ':' + role));
  if (!Array.isArray(observation.jobs) || observation.jobs.length !== expectedJobs.length || expectedJobs.some(key => observation.jobs.filter(job => job?.runId + ':' + job?.role === key && job.active === 0).length !== 1)) failures.push('JOB_PROOF_REQUIRED');
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
  denyProductionExecution(valid);
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
  // Post-archive proof: after the old control records (and their freeze) have
  // been archived, the site is validated as a quiescent new site rather than as
  // the old incident. It must NOT require the archived old freeze to still exist.
  async function startupProof() {
    const obs = await observeFresh();
    if (assessStartupSite(obs).length) fail('MAINTENANCE_PROOF_REQUIRED');
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
        await verifyArchive(); await startupProof(); await approve('restore'); await verifyArchive(); await startupProof();
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
  denyProductionExecution(valid);
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
      if (session.started) {
        if (typeof stop !== 'function') fail('MAINTENANCE_STOP_REQUIRED');
        await stop();
      }
      if (session.archive?.archive) { const result = await session.archive.archive.rollback(); session.phase = 'rolled-back'; record('rolled_back'); return result; }
      session.phase = 'rolled-back'; record('rolled_back', { note: 'no archive to restore' });
      return { phase: 'rolled-back' };
    },
  };
}

// ---- real production site observation (read-only) ----
// Builds the live-evidence structure that assessMaintenanceSite / assessStartupSite
// consume. Process identities, jobs and ports are queried through injectable
// primitives (defaulting to the real TongRuntimeSecurity / node:net), so the
// isolation tests can exercise the exact shape with fake primitives while the
// production driver uses the real native ones. monitorStopped fails closed:
// without an explicit check it reports false, which blocks the site.

function defaultPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: 750 });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    const refused = () => Object.assign(new Error('MAINTENANCE_PORT_PROBE_FAILED'), { code: 'MAINTENANCE_PORT_PROBE_FAILED' });
    socket.once('timeout', () => { socket.destroy(); reject(refused()); });
    socket.once('error', error => { socket.destroy(); error?.code === 'ECONNREFUSED' ? resolve(true) : reject(refused()); });
  });
}

export async function observeProductionSite(profile, { security, checkPort = defaultPortFree, checkMonitor } = {}) {
  const valid = validateProductionProfile(profile);
  const root = valid.root, run = join(root, 'run');
  const pid = security?.processIdentity ?? processIdentity;
  const jobsState = security?.startupJobsState ?? startupJobsState;
  const same = security?.sameProcess ?? sameProcess;
  // The enumerator must cover all incident IDs, roots and legacy entrypoints.
  // Missing or incomplete native observation is a refusal, never an empty list.
  const listProcesses = security?.listProcesses;
  if (typeof listProcesses !== 'function') fail('MAINTENANCE_PROCESS_INVENTORY_REQUIRED');
  if (typeof checkMonitor !== 'function') fail('MAINTENANCE_MONITOR_CHECK_REQUIRED');

  const record = async name => { try { return JSON.parse(await readFile(join(run, name), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const runtime = await record('runtime.json');
  const guardian = await record('guardian.json');
  const request = await record('request.json');
  const abort = await record('abort.json');

  const owned = [guardian, runtime?.supervisor, ...(runtime?.children ?? []), ...(runtime?.descendants ?? [])].filter(id => Number.isSafeInteger(id?.pid) && id.pid > 0);
  const identities = [], matchingProcesses = [];
  for (const id of owned) {
    const actual = await pid(id.pid, id.marker ?? maintenance.oldRunId);
    if (actual !== null && (!actual || actual.pid !== id.pid || !isAbsolute(actual.exe ?? '') || !/^\d+$/.test(actual.startTicks ?? ''))) fail('MAINTENANCE_PROCESS_IDENTITY_UNKNOWN');
    // PID + executable + creation time already identify the recorded process.
    // A missing/unreadable command marker cannot turn that process into 'gone'.
    const alive = same(actual, id);
    identities.push({ ...id, state: alive ? 'alive' : 'gone' });
    if (alive) matchingProcesses.push(actual);
  }
  const inventory = await listProcesses({ root, codeRoot: valid.codeRoot, managerRoot: valid.managerRoot, runIds: [maintenance.oldRunId, maintenance.firstFailedRunId, maintenance.failedRunId] });
  if (!Array.isArray(inventory)) fail('MAINTENANCE_PROCESS_INVENTORY_UNKNOWN');
  for (const extra of inventory) {
    if (!extra || !Number.isSafeInteger(extra.pid) || extra.pid <= 0 || typeof extra.exe !== 'string' || !extra.exe || !/^\d+$/.test(extra.startTicks ?? '')) fail('MAINTENANCE_PROCESS_INVENTORY_UNKNOWN');
    if (!matchingProcesses.some(actual => same(actual, extra))) { matchingProcesses.push(extra); identities.push({ ...extra, state: 'alive', unknown: true }); }
  }

  const jobs = [];
  for (const runId of [maintenance.oldRunId, maintenance.firstFailedRunId, maintenance.failedRunId]) {
    const state = await jobsState(runId);
    if (!state || typeof state !== 'object') fail('MAINTENANCE_JOB_UNKNOWN');
    for (const role of ['runtime', 'owner', 'launcher', 'guardian']) {
      if (!Number.isInteger(state[role]) || state[role] < 0) fail('MAINTENANCE_JOB_UNKNOWN');
      jobs.push({ runId, role, active: state[role] });
    }
  }

  const ports = [];
  for (const port of maintenance.ports) {
    const free = await checkPort(port);
    if (typeof free !== 'boolean') fail('MAINTENANCE_PORT_PROBE_FAILED');
    ports.push({ port, free });
  }

  const monitorStopped = await checkMonitor(root);
  if (typeof monitorStopped !== 'boolean') fail('MAINTENANCE_MONITOR_UNKNOWN');

  const launcherReceipt = !(await absent(join(run, 'launcher.' + maintenance.failedRunId + '.json')));
  const guardianReceipt = !(await absent(join(run, 'guardian.' + maintenance.failedRunId + '.json')));
  // Quiescence describes this instant. It cannot prevent a concurrent starter.
  const quiescent = matchingProcesses.length === 0 && jobs.every(job => job.active === 0);
  const lifecycleExclusive = false; // Observation does not hold a lifecycle lease.

  return {
    observedAt: new Date().toISOString(),
    lifecycleExclusive,
    quiescent,
    monitorStopped,
    processInventoryComplete: true,
    matchingProcesses,
    identities,
    jobs,
    ports,
    failedAttemptReceipts: (!launcherReceipt && !guardianReceipt) ? 'absent-legacy' : 'present-legacy',
    records: { runtimeRunId: runtime?.runId ?? null, guardianRunId: guardian?.runId ?? null, requestRunId: request?.runId ?? null, abortRunId: abort?.runId ?? null },
    productionExecutionAllowed: false,
    executionReadiness: 'NOT READY',
    executionBlockers: [...executionBlockers],
    executionOrderStatus: 'PROPOSED_NOT_EXECUTABLE',
  };
}

// ---- single production-recovery operation plan (data, no side effects) ----

export function describeMaintenance() {
  return {
    kind: maintenance.kind,
    executionReadiness: 'NOT READY',
    executionBlockers: [...executionBlockers],
    executionOrderStatus: 'BLOCKED_NOT_EXECUTABLE',
    startupHandoff: {
      candidateCommit: maintenance.candidateCommit,
      candidateProtocol: 'open-wx/unlink',
      supported: false,
      reason: 'Keeping backup.freeze blocks the exact candidate; renaming it admits every competing starter. The later in-process maintenance lease is absent from 34e2680.',
    },
    baselineCommit: maintenance.baselineCommit,
    candidateCommit: maintenance.candidateCommit,
    productionRoot: PRODUCTION_ROOT,
    oldRunId: maintenance.oldRunId,
    firstFailedRunId: maintenance.firstFailedRunId,
    failedRunId: maintenance.failedRunId,
    ports: [...maintenance.ports],
    controlRecords: [...maintenance.requiredRecords],
    optionalRecords: [...maintenance.optionalRecords],
    nativeAuthorization: [
      { action: 'backup', purpose: 'sealed state + control-record snapshot (createProductionStateBackup)' },
      { action: 'manager', purpose: 'App/Manager consistent version switch + old control-record archive' },
      { action: 'start', purpose: 'one controlled startup (startRuntime)' },
      { action: 'stop', purpose: 'failure stop (stopRuntime)' },
      { action: 'restore', purpose: 'controlled rollback (restoreProductionStateBackup + archive.rollback)' },
    ],
    executionOrder: [
      'verifyMaintenanceBaseline (App/Manager same-commit + native + Node/ABI)',
      'observeProductionSite -> assessMaintenanceSite (three runIds, jobs, ports, monitor)',
      'acquire backup.freeze lifecycle mutex; confirm runtime stopped',
      'snapshot: createProductionStateBackup + openControlRecordArchive.prepare (seal)',
      'native typed-challenge approve (backup -> manager -> start -> stop -> restore receipts)',
      'switchMaintenanceRelease (pinRuntimeRelease app + manager)',
      'archive: openControlRecordArchive.retire (freeze last)',
      'reverify: observeProductionSite -> assessStartupSite (no new records)',
      'start: startRuntime -> runtimeDoctor (ready, Gateway/MCP, login monitor healthy)',
      'on any failure: stopRuntime + archive.rollback (freeze first) + restoreProductionStateBackup',
    ],
    failStopConditions: [
      'assessMaintenanceSite/assessStartupSite returns any failure (live process, unknown process, non-empty Job, busy port, monitor not stopped, missing/forged receipt)',
      'verifyRuntimeApproval denies/missing/expired/wrong-bound for any action',
      'snapshot hash mismatch or third-party file change',
      'startup not ready / doctor unhealthy / CLEANUP_REQUIRED',
    ],
    rollback: 'freeze restored first, then control records, then code/config/binding; new candidate control records kept under their own runId; old runtime verified independently after restore',
    productionExecutionAllowed: false,
  };
}

// ---- production driver: binds the session to the real machinery ----

async function loadProfile(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) fail('MAINTENANCE_ROOT_REQUIRED');
  return validateProductionProfile(JSON.parse(await readFile(join(root, 'profile.json'), 'utf8')));
}

export async function productionMaintenanceEntry(profile, { security, checkPort, checkMonitor } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode !== 'production' || valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_PRODUCTION_ONLY');
  denyProductionExecution(valid);
  const observe = () => observeProductionSite(valid, { security, checkPort, checkMonitor });
  const authorize = action => verifyMaintenanceApproval(valid, action);
  const runtime = await import('./TongAgentDockRuntime.mjs');
  const start = () => runtime.startRuntime(valid.root);
  const stop = () => runtime.stopRuntime(valid.root);
  const doctor = () => runtime.runtimeDoctor(valid.root);
  return openMaintenanceSession({ profile: valid, observe, authorize, start, stop, doctor });
}

// Production authorization hook: verify an existing typed DPAPI receipt. Never mints.
export async function verifyMaintenanceApproval(profile, action) {
  if (!maintenance.requiredApprovals.includes(action)) fail('MAINTENANCE_APPROVAL_ACTION_DENIED');
  await verifyRuntimeApproval(validateProductionProfile(profile), action);
  return { kind: 'production-receipt', action, verifiedAt: new Date().toISOString() };
}

// ---- persistent maintenance transaction (#5/#6) ----

const TRANSACTION_FILE = 'maintenance-transaction.json';
const PHASES = new Set(['planned', 'verified', 'observed', 'sealed', 'snapshotted', 'installed', 'archived', 'reverified', 'started', 'accepted', 'failed', 'rolled-back']);

function transactionPath(root) { return join(root, 'logs', TRANSACTION_FILE); }

async function readTransaction(root) {
  try { return JSON.parse(await bytes(transactionPath(root))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeTransaction(root, txn) {
  const path = transactionPath(root);
  await mkdir(dirname(path), { recursive: true });
  await ordinary(dirname(path), true);
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(txn, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}

export function validateMaintenanceTransaction(txn, { baselineCommit, candidateCommit, profile } = {}) {
  const errors = [];
  if (!txn || typeof txn !== 'object') return { ok: false, errors: ['TRANSACTION_MISSING'] };
  if (txn.schemaVersion !== 1 || txn.kind !== maintenance.kind) errors.push('TRANSACTION_KIND_MISMATCH');
  if (baselineCommit && txn.plan?.baselineCommit !== baselineCommit) errors.push('TRANSACTION_BASELINE_MISMATCH');
  if (candidateCommit && txn.plan?.candidateCommit !== candidateCommit) errors.push('TRANSACTION_CANDIDATE_MISMATCH');
  if (!txn.transactionId || !/^[a-f0-9-]{36}$/.test(txn.transactionId)) errors.push('TRANSACTION_ID_INVALID');
  if (!Array.isArray(txn.journal)) errors.push('TRANSACTION_JOURNAL_MISSING');
  if (!Number.isFinite(Date.parse(txn.createdAt ?? ''))) errors.push('TRANSACTION_CREATED_INVALID');
  if (!PHASES.has(txn.phase)) errors.push('TRANSACTION_PHASE_INVALID');
  if (!/^[a-f0-9]{64}$/.test(txn.profileDigest ?? '')) errors.push('TRANSACTION_PROFILE_DIGEST_INVALID');
  if (!validateMaintenancePlan(txn.plan).ok) errors.push('TRANSACTION_PLAN_INVALID');
  if (profile && (txn.root !== profile.root || txn.profileDigest !== productionProfileDigest(profile) || productionProfileDigest(txn.plan.profile) !== productionProfileDigest(profile))) errors.push('TRANSACTION_PROFILE_MISMATCH');
  return errors.length ? { ok: false, errors } : { ok: true, txn };
}

async function openTransaction(profile, { transactionId, plan, backupRoot, releaseRoot, restoreRoot }) {
  const valid = validateProductionProfile(profile);
  if (!await absent(transactionPath(valid.root))) fail('MAINTENANCE_TRANSACTION_EXISTS');
  const txn = {
    schemaVersion: 1,
    kind: maintenance.kind,
    transactionId: transactionId ?? randomUUID(),
    root: valid.root,
    profileDigest: productionProfileDigest(valid),
    createdAt: new Date().toISOString(),
    phase: 'planned',
    plan,
    backupRoot, releaseRoot, restoreRoot,
    archive: null, stateBackup: null, release: null, startedRunId: null,
    error: null,
    journal: [],
  };
  txn.updatedAt = new Date().toISOString();
  const persist = () => writeTransaction(valid.root, txn);
  const setPhase = async phase => { if (!PHASES.has(phase)) fail('MAINTENANCE_PHASE_DENIED'); txn.phase = phase; txn.updatedAt = new Date().toISOString(); await persist(); return txn; };
  const record = async (event, detail = {}) => { txn.journal.push({ at: new Date().toISOString(), event, phase: txn.phase, ...detail }); txn.updatedAt = new Date().toISOString(); await persist(); return txn; };
  const markFailed = async error => { txn.phase = 'failed'; txn.error = { code: error?.code ?? error?.message ?? String(error), at: new Date().toISOString() }; txn.updatedAt = new Date().toISOString(); await persist(); return txn; };
  return { get state() { return txn; }, setPhase, record, markFailed, persist };
}

// ---- real source/native installation (#1) ----

async function copyVerified(source, target, expectedSha) {
  const bytes = await readFile(source);
  if (sha(bytes) !== expectedSha) fail('MAINTENANCE_SOURCE_HASH_MISMATCH');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (sha(await readFile(target)) !== expectedSha) fail('MAINTENANCE_INSTALL_VERIFY_FAILED');
}

export async function realCopyRelease(profile, releaseRoot, manifest) {
  const valid = validateProductionProfile(profile);
  denyProductionExecution(valid);
  await rootPolicy(valid).guard();
  const names = new Set();
  for (const entry of [...manifest.sourceFiles, ...manifest.native]) {
    if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') || entry.path.includes(':') || entry.path.split('/').some(p => !p || p === '.' || p === '..' || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)) || names.has(entry.path.toLowerCase())) fail('MAINTENANCE_PATH_DENIED');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) fail('MAINTENANCE_MANIFEST_INVALID');
    names.add(entry.path.toLowerCase());
  }
  const sourceDir = join(releaseRoot, 'code', 'source');
  const nativeDir = join(releaseRoot, 'native');
  // Preflight every input and existing destination ancestor before writing.
  // This simulation helper still has no production installation snapshot.
  for (const [base, entries] of [[sourceDir, manifest.sourceFiles], [nativeDir, manifest.native]]) for (const entry of entries) {
    const source = await bytes(join(base, ...entry.path.split('/')));
    if (source.length !== entry.size || sha(source) !== entry.sha256) fail('MAINTENANCE_SOURCE_HASH_MISMATCH');
    for (const target of [valid.codeRoot, valid.managerRoot]) {
      const destination = join(target, ...entry.path.split('/'));
      for (let path = destination; path !== valid.root; path = dirname(path)) {
        try { await ordinary(path, path !== destination); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  for (const target of [valid.codeRoot, valid.managerRoot]) {
    for (const entry of manifest.sourceFiles) await copyVerified(join(sourceDir, ...entry.path.split('/')), join(target, ...entry.path.split('/')), entry.sha256);
  }
  for (const target of [valid.codeRoot, valid.managerRoot]) {
    for (const entry of manifest.native) await copyVerified(join(nativeDir, ...entry.path.split('/')), join(target, ...entry.path.split('/')), entry.sha256);
  }
  return { appFiles: manifest.sourceFiles.length + manifest.native.length, managerFiles: manifest.sourceFiles.length + manifest.native.length };
}

export async function installMaintenanceRelease(profile, releaseRoot, { approve, manifest, copy } = {}) {
  const valid = validateProductionProfile(profile);
  denyProductionExecution(valid);
  await approve('manager');
  const m = manifest ?? await (await import('./TongRuntimeRelease.mjs')).verifyRelease({ releaseRoot });
  if (m.commit !== maintenance.candidateCommit) fail('MAINTENANCE_CANDIDATE_COMMIT_MISMATCH');
  const copied = await (copy ?? realCopyRelease)(valid, releaseRoot, m);
  await pinRuntimeRelease(valid, releaseRoot, { replace: true });
  await pinRuntimeRelease(valid, releaseRoot, { replace: true, manager: true });
  await verifyRuntimeCandidate(valid);
  await verifyRuntimeCandidate(valid, { manager: true });
  return { commit: m.commit, sourceDigest: m.sourceDigest ?? null, releaseDigest: m.releaseDigest ?? null, ...copied, installed: true, productionExecutionAllowed: false };
}

// Keep the stale freeze in place. Native state backup must reject STATE_BUSY
// until a supported continuous lease handoff exists; renaming this file is not
// a mutex and creates an unsafe ordinary-start window.

function maintenancePlanFor(profile) {
  const issuedAt = Date.now();
  return { baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, runIds: { oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId }, ports: [...maintenance.ports], window: { issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + 3600000).toISOString() }, profile };
}

// ---- complete single-entry production recovery (one controlled run) ----
// Sequences the full 024 maintenance window: verify -> observe -> snapshot ->
// switch -> archive -> reverify -> start -> accept. Every mutating step is gated
// by a real typed receipt (verifyRuntimeApproval). snapshot/switchRelease/
// state primitives are not yet connected through a continuous lifecycle lease.
// Injected simulation success cannot enable the production entry.

// ---- stateless control-record rollback from the sealed snapshot (#6) ----

export async function restoreControlRecordsFromSnapshot(root, archiveRoot, seal, { observe, approve }) {
  if (typeof root !== 'string' || !isAbsolute(root)) fail('MAINTENANCE_ROOT_REQUIRED');
  if (resolve(root).toLowerCase() === resolve(PRODUCTION_ROOT).toLowerCase()) fail('MAINTENANCE_NOT_READY');
  const stateRoot = resolve('D:\\Tong\\state');
  if (dirname(resolve(root)).toLowerCase() !== stateRoot.toLowerCase() || !/^b23-[a-zA-Z0-9_-]+$/.test(resolve(root).slice(stateRoot.length + 1))) fail('MAINTENANCE_SIMULATION_ONLY');
  if (typeof archiveRoot !== 'string' || !isAbsolute(archiveRoot)) fail('MAINTENANCE_ARCHIVE_REQUIRED');
  if (dirname(resolve(archiveRoot)).toLowerCase() !== resolve(root).toLowerCase() || !/^maintenance-evidence-[a-f0-9-]{36}$/.test(resolve(archiveRoot).slice(resolve(root).length + 1))) fail('MAINTENANCE_PATH_DENIED');
  await ordinary(root, true);
  if (JSON.parse(await bytes(join(root, 'runtime-synthetic.json'))).scope !== simulationMarker) fail('MAINTENANCE_SIMULATION_ONLY');
  await ordinary(join(root, 'run'), true); await ordinary(archiveRoot, true);
  await ordinary(join(archiveRoot, 'original'), true); await ordinary(join(archiveRoot, 'retired'), true);
  if (typeof observe !== 'function') fail('MAINTENANCE_OBSERVER_REQUIRED');
  if (typeof approve !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED');
  const snapshotBytes = await bytes(join(archiveRoot, 'snapshot.json'));
  if (sha(snapshotBytes) !== seal) fail('MAINTENANCE_SNAPSHOT_CHANGED');
  const snapshot = JSON.parse(snapshotBytes);
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== maintenance.kind || snapshot.root !== root || snapshot.baselineCommit !== maintenance.baselineCommit || snapshot.candidateCommit !== maintenance.candidateCommit || snapshot.oldRunId !== maintenance.oldRunId || snapshot.firstFailedRunId !== maintenance.firstFailedRunId || snapshot.failedRunId !== maintenance.failedRunId || !Array.isArray(snapshot.files)) fail('MAINTENANCE_SNAPSHOT_INVALID');
  const names = snapshot.files.map(file => file.name);
  if (new Set(names).size !== names.length || maintenance.requiredRecords.some(name => !names.includes(name)) || names.some(name => ![...maintenance.requiredRecords, ...maintenance.optionalRecords].includes(name))) fail('MAINTENANCE_SNAPSHOT_INVALID');
  const moved = [];
  for (const file of snapshot.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) fail('MAINTENANCE_SNAPSHOT_INVALID');
    const original = await bytes(join(archiveRoot, 'original', file.name));
    if (original.length !== file.size || sha(original) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED');
    const retiredPath = join(archiveRoot, 'retired', file.name);
    try { if (sha(await bytes(retiredPath)) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED'); moved.push(file.name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const checkDestinations = async () => {
    for (const file of snapshot.files) {
      const path = join(root, 'run', file.name);
      if (await absent(path)) { if (!moved.includes(file.name)) fail('MAINTENANCE_CONFLICT'); }
      else if (sha(await bytes(path)) !== file.sha256) fail('MAINTENANCE_CONFLICT');
    }
  };
  await checkDestinations();
  const observation = await observe();
  if (assessStartupSite(observation).length) fail('MAINTENANCE_PROOF_REQUIRED');
  await approve('restore');
  await checkDestinations();
  if (assessStartupSite(await observe()).length) fail('MAINTENANCE_PROOF_REQUIRED');
  // Restore the freeze first, then the remaining records, only where archived.
  const order = ['backup.freeze', ...snapshot.files.map(file => file.name).filter(name => name !== 'backup.freeze')];
  for (const name of order) {
    if (!moved.includes(name)) continue;
    const path = join(root, 'run', name);
    if (!await absent(path)) continue; // A previously restored, hash-checked file.
    const file = snapshot.files.find(file => file.name === name), original = await bytes(join(archiveRoot, 'original', name));
    if (sha(original) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED');
    await writeFile(path, original, { flag: 'wx' });
  }
  return { phase: 'rolled-back', restored: moved, productionExecutionAllowed: false };
}

// ---- core transaction-based recovery sequence (mode-agnostic, testable) ----

async function loadRecords(root) {
  const records = { baselineCommit: maintenance.baselineCommit };
  for (const key of ['runtime', 'guardian', 'request', 'abort']) {
    try { records[key] = JSON.parse(await readFile(join(root, 'run', key + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') records[key] = null; else throw error; }
  }
  return records;
}

function validateStateTargets(profile, backupRoot, restoreRoot) {
  const inside = (parent, child) => resolve(child).toLowerCase().startsWith(resolve(parent).toLowerCase() + sep);
  for (const path of [backupRoot, restoreRoot]) {
    if (typeof path !== 'string' || !isAbsolute(path) || !inside(profile.root, path) || [profile.codeRoot, join(profile.root, 'run'), join(profile.root, 'tong-policy'), join(profile.root, 'logs'), join(profile.root, 'secrets')].some(denied => resolve(path).toLowerCase() === resolve(denied).toLowerCase() || inside(denied, path) || inside(path, denied))) fail('STATE_PATH_DENIED');
  }
  if (resolve(backupRoot).toLowerCase() === resolve(restoreRoot).toLowerCase() || inside(backupRoot, restoreRoot) || inside(restoreRoot, backupRoot)) fail('STATE_PATH_DENIED');
}

export async function executeRecovery(profile, { backupRoot, releaseRoot, restoreRoot, transactionId, candidateProfile, candidateCommit, startupTimeoutMs, onCheckpoint, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  denyProductionExecution(valid);
  if(candidateProfile) {
    const {runMaintenanceTransaction}=await import('./TongMaintenanceTransaction.mjs');
    return runMaintenanceTransaction({baselineProfile:valid,candidateProfile,candidateCommit,releaseRoot,transactionId,startupTimeoutMs},{onCheckpoint});
  }
  for (const [flag, value] of [['backup', backupRoot], ['release', releaseRoot], ['restore', restoreRoot]]) if (typeof value !== 'string' || !isAbsolute(value)) fail('MAINTENANCE_' + flag.toUpperCase() + '_ROOT_REQUIRED');
  validateStateTargets(valid, backupRoot, restoreRoot);
  await rootPolicy(valid).guard();
  const plan = maintenancePlanFor(valid);
  if (!validateMaintenancePlan(plan).ok) fail('MAINTENANCE_PLAN_REJECTED');

  const observe = deps.observe ?? (() => observeProductionSite(valid));
  const authorize = deps.authorize;
  const confirm = deps.confirm;
  const verifyBaseline = deps.verifyBaseline ?? (() => verifyMaintenanceBaseline(valid));
  const start = deps.start;
  const stop = deps.stop;
  const doctor = deps.doctor;
  const snapshot = deps.snapshot;
  const install = deps.install;
  const approveAction = async action => {
    if (valid.mode === 'production') { if (typeof authorize !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED'); return authorize(action); }
    if (typeof confirm !== 'function') fail('MAINTENANCE_CONFIRMER_REQUIRED');
    const binding = { action, root: valid.root, mode: valid.mode };
    const receipt = await confirm(binding);
    if (receipt?.kind !== 'simulation-only' || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now() || receipt.expiresAt > Date.now() + 300000 || Object.entries(binding).some(([key, value]) => receipt[key] !== value)) fail('MAINTENANCE_APPROVAL_REQUIRED');
    return receipt;
  };

  const txn = await openTransaction(valid, { transactionId, plan, backupRoot, releaseRoot, restoreRoot });
  let archive = null;

  try {
    await verifyBaseline(valid); await txn.setPhase('verified');

    const observation = await observe();
    if (assessMaintenanceSite({ ...(await loadRecords(valid.root)), observation }).length) fail('MAINTENANCE_SITE_UNSAFE');
    await txn.setPhase('observed');

    archive = await openControlRecordArchive({ profile: valid, observe, authorize, confirm });
    const prepared = await archive.prepare();
    txn.state.archive = { seal: prepared.seal, archiveRoot: prepared.archiveRoot, phase: prepared.phase };
    await txn.setPhase('sealed');

    if (typeof snapshot !== 'function') fail('MAINTENANCE_SNAPSHOT_REQUIRED');
    const backupEvidence = await snapshot({ backupRoot, restoreRoot });
    if (!backupEvidence || typeof backupEvidence !== 'object') fail('MAINTENANCE_SNAPSHOT_REQUIRED');
    txn.state.stateBackup = { backupRoot, restoreRoot, evidence: backupEvidence };
    await txn.setPhase('snapshotted');

    // Persist the intent before the first write: a crash/throw inside install
    // must not be mistaken for 'nothing installed' by a later process.
    txn.state.installAttempted = true; await txn.persist();
    const installEvidence = install ? await install({ releaseRoot, approve: approveAction }) : await installMaintenanceRelease(valid, releaseRoot, { approve: approveAction });
    txn.state.release = { releaseRoot, ...(installEvidence ?? {}) };
    await txn.setPhase('installed');

    await archive.retire();
    await txn.setPhase('archived');

    const after = await observe();
    if (assessStartupSite(after).length) fail('MAINTENANCE_SITE_UNSAFE');
    for (const name of ['runtime.json', 'guardian.json', 'request.json', 'abort.json', 'backup.freeze']) if (!await absent(join(valid.root, 'run', name))) fail('MAINTENANCE_NEW_CONTROL_RECORD');
    for (const role of ['launcher', 'guardian']) if (!await absent(join(valid.root, 'run', role + '.' + maintenance.failedRunId + '.json'))) fail('MAINTENANCE_NEW_CONTROL_RECORD');
    await txn.setPhase('reverified');

    if (typeof start !== 'function') fail('MAINTENANCE_START_REQUIRED');
    const started = await start();
    txn.state.startedRunId = started?.runId ?? null;
    await txn.setPhase('started');
    await txn.record('started', { runId: started?.runId ?? null });

    if (typeof doctor !== 'function') fail('MAINTENANCE_DOCTOR_REQUIRED');
    const health = await doctor();
    if (health?.healthy !== true) fail('MAINTENANCE_HEALTH_FAILED');
    await txn.setPhase('accepted');

    return { state: txn.state, productionExecutionAllowed: false };
  } catch (error) {
    await txn.markFailed(error);
    throw error;
  }
}

// ---- transaction-resuming rollback (#6) ----

export async function executeRollback(profile, { transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  denyProductionExecution(valid);
  const persisted=await readTransaction(valid.root);
  if(persisted?.kind==='tong-version-maintenance-v1') {
    const {resumeMaintenanceTransaction}=await import('./TongMaintenanceTransaction.mjs');
    return resumeMaintenanceTransaction(valid,{transactionId,action:'rollback'});
  }
  await rootPolicy(valid).guard();
  const txn = await readTransaction(valid.root);
  if (!txn) fail('MAINTENANCE_TRANSACTION_MISSING');
  if (transactionId && txn.transactionId !== transactionId) fail('MAINTENANCE_TRANSACTION_ID_MISMATCH');
  let check;
  try { check = validateMaintenanceTransaction(txn, { baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, profile: valid }); validateStateTargets(valid, txn.backupRoot, txn.restoreRoot); }
  catch { fail('MAINTENANCE_TRANSACTION_INVALID'); }
  if (!check.ok) fail('MAINTENANCE_TRANSACTION_INVALID');
  if (txn.installAttempted || txn.release || ['installed', 'archived', 'reverified', 'started', 'accepted'].includes(txn.phase)) fail('MAINTENANCE_RELEASE_RESTORE_UNSUPPORTED');
  if (txn.phase === 'rolled-back') return { state: txn, productionExecutionAllowed: false };

  const observe = deps.observe ?? (() => observeProductionSite(valid));
  const confirm = deps.confirm;
  const stop = deps.stop;

  // 1. stop the candidate run if it was started (even if a later phase failed)
  if (txn.startedRunId || ['started', 'accepted'].includes(txn.phase)) {
    if (typeof stop !== 'function') fail('MAINTENANCE_STOP_REQUIRED');
    await stop({ expectedRunId: txn.startedRunId });
  }
  // 2. restore archived control records from the sealed snapshot (freeze first)
  if (txn.archive?.archiveRoot && txn.archive?.seal) {
    await restoreControlRecordsFromSnapshot(valid.root, txn.archive.archiveRoot, txn.archive.seal, { observe, approve: async action => {
      if (typeof confirm !== 'function') fail('MAINTENANCE_CONFIRMER_REQUIRED');
      const binding = { action, root: valid.root, archiveRoot: txn.archive.archiveRoot, seal: txn.archive.seal, oldRunId: maintenance.oldRunId, failedRunId: maintenance.failedRunId };
      const receipt = await confirm(binding);
      if (receipt?.kind !== 'simulation-only' || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now() || receipt.expiresAt > Date.now() + 300000 || Object.entries(binding).some(([key, value]) => receipt[key] !== value)) fail('MAINTENANCE_APPROVAL_REQUIRED');
    } });
  }
  // This path only restores sealed control records before installation. The
  // state API stages sanitized data; it is not a code/pin/permission rollback.
  const fresh = await readTransaction(valid.root);
  fresh.phase = 'rolled-back'; fresh.updatedAt = new Date().toISOString();
  await writeTransaction(valid.root, fresh);
  return { state: fresh, productionExecutionAllowed: false };
}

export async function runProductionRecovery(profile, { backupRoot, releaseRoot, restoreRoot, transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode !== 'production' || valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_PRODUCTION_ONLY');
  denyProductionExecution(valid);
  return executeRecovery(valid, { backupRoot, releaseRoot, restoreRoot, transactionId, deps: { ...(await productionDeps(valid)), ...deps } });
}

export async function rollbackProductionRecovery(profile, { transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode !== 'production' || valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_PRODUCTION_ONLY');
  denyProductionExecution(valid);
  return executeRollback(valid, { transactionId, deps: { ...(await productionDeps(valid)), ...deps } });
}

async function productionDeps(profile) {
  const runtime = await import('./TongAgentDockRuntime.mjs');
  return {
    observe: () => observeProductionSite(profile),
    authorize: action => verifyMaintenanceApproval(profile, action),
    start: () => runtime.startRuntime(profile.root),
    stop: () => runtime.stopRuntime(profile.root),
    doctor: () => runtime.runtimeDoctor(profile.root),
  };
}

// ---- CLI entry ----
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [command, ...args] = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  try {
    if (command === 'describe') {
      console.log(JSON.stringify(describeMaintenance(), null, 2));
    } else if (command === 'observe') {
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      const observation = await observeProductionSite(profile);
      console.log(JSON.stringify(observation, null, 2));
    } else if (command === 'verify') {
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      console.log(JSON.stringify(await verifyMaintenanceBaseline(profile), null, 2));
    } else if (command === 'run') {
      // Reject the fixed production target before even loading its profile.
      // No CLI flag or simulated authorization can enable Plan B execution.
      if (resolve(option('--root') ?? PRODUCTION_ROOT).toLowerCase() === resolve(PRODUCTION_ROOT).toLowerCase()) denyProductionExecution({ mode: 'production' });
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      const result = await runProductionRecovery(profile, { backupRoot: option('--backup-root'), releaseRoot: option('--release-root'), restoreRoot: option('--restore-root') });
      console.log(JSON.stringify({ ok: true, state: result.state }, null, 2));
    } else if (command === 'rollback') {
      if (resolve(option('--root') ?? PRODUCTION_ROOT).toLowerCase() === resolve(PRODUCTION_ROOT).toLowerCase()) denyProductionExecution({ mode: 'production' });
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      const result = await rollbackProductionRecovery(profile, { transactionId: option('--transaction-id') });
      console.log(JSON.stringify({ ok: true, state: result.state }, null, 2));
    } else {
      fail('MAINTENANCE_BAD_COMMAND');
    }
  } catch (error) {
    if (args.includes('--error-json') && error?.code === 'MAINTENANCE_NOT_READY') {
      console.error(JSON.stringify({ error: error.code, executionReadiness: 'NOT READY', executionBlockers: error.executionBlockers }));
    } else console.error(String(error?.code ?? error?.message ?? error));
    process.exitCode = 1;
  }
}
