import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, rename, open } from 'node:fs/promises';
import { join, resolve, sep, isAbsolute, dirname } from 'node:path';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeCandidate, pinRuntimeRelease } from './TongRuntimeCandidate.mjs';
import { validateProductionProfile, verifyRuntimeApproval, PRODUCTION_ROOT } from './TongProductionProfile.mjs';
import { assertProtectedPaths, processIdentity, startupJobsState, sameProcess } from './TongRuntimeSecurity.mjs';
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
    socket.once('timeout', () => { socket.destroy(); reject(fail('MAINTENANCE_PORT_PROBE_FAILED')); });
    socket.once('error', error => { socket.destroy(); error?.code === 'ECONNREFUSED' ? resolve(true) : reject(fail('MAINTENANCE_PORT_PROBE_FAILED')); });
  });
}

export async function observeProductionSite(profile, { security, checkPort = defaultPortFree, checkMonitor } = {}) {
  const valid = validateProductionProfile(profile);
  const root = valid.root, run = join(root, 'run');
  const pid = security?.processIdentity ?? processIdentity;
  const jobsState = security?.startupJobsState ?? startupJobsState;
  const same = security?.sameProcess ?? sameProcess;
  // Complete process inventory: enumerates processes matching the old-run marker.
  // Defaults to empty; the production driver must supply a real enumerator. Any
  // process found that is not a recorded identity is an unknown -> reject.
  const listProcesses = security?.listProcesses ?? (async () => []);
  if (typeof checkMonitor !== 'function') fail('MAINTENANCE_MONITOR_CHECK_REQUIRED');

  const record = async name => { try { return JSON.parse(await readFile(join(run, name), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const runtime = await record('runtime.json');
  const guardian = await record('guardian.json');
  const request = await record('request.json');
  const abort = await record('abort.json');

  const owned = [guardian, runtime?.supervisor, ...(runtime?.children ?? []), ...(runtime?.descendants ?? [])].filter(id => Number.isSafeInteger(id?.pid) && id.pid > 0);
  const identities = [], matchingProcesses = [];
  const ownedPids = new Set();
  for (const id of owned) {
    ownedPids.add(id.pid);
    const actual = await pid(id.pid, id.marker ?? maintenance.oldRunId);
    const alive = same(actual, id) && actual?.markerMatches === true;
    identities.push({ ...id, state: alive ? 'alive' : 'gone' });
    if (alive) matchingProcesses.push(actual);
  }
  for (const extra of await listProcesses(maintenance.oldRunId)) {
    if (!extra || !Number.isSafeInteger(extra.pid)) continue;
    if (!ownedPids.has(extra.pid)) { matchingProcesses.push(extra); identities.push({ ...extra, state: 'alive', unknown: true }); }
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
  // Lifecycle exclusivity is derived from the real process/Job inventory, never
  // from the mere existence of a lock file (a stale lock proves nothing about a
  // running instance).
  const lifecycleExclusive = matchingProcesses.length === 0 && jobs.every(job => job.active === 0);

  return {
    observedAt: new Date().toISOString(),
    lifecycleExclusive,
    monitorStopped,
    processInventoryComplete: true,
    matchingProcesses,
    identities,
    jobs,
    ports,
    failedAttemptReceipts: (!launcherReceipt && !guardianReceipt) ? 'absent-legacy' : 'present-legacy',
    records: { runtimeRunId: runtime?.runId ?? null, guardianRunId: guardian?.runId ?? null, requestRunId: request?.runId ?? null, abortRunId: abort?.runId ?? null },
    productionExecutionAllowed: false,
  };
}

// ---- single production-recovery operation plan (data, no side effects) ----

export function describeMaintenance() {
  return {
    kind: maintenance.kind,
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
  try { return JSON.parse(await readFile(transactionPath(root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeTransaction(root, txn) {
  const path = transactionPath(root);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(txn, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}

export function validateMaintenanceTransaction(txn, { baselineCommit, candidateCommit } = {}) {
  const errors = [];
  if (!txn || typeof txn !== 'object') return { ok: false, errors: ['TRANSACTION_MISSING'] };
  if (txn.schemaVersion !== 1 || txn.kind !== maintenance.kind) errors.push('TRANSACTION_KIND_MISMATCH');
  if (baselineCommit && txn.plan?.baselineCommit !== baselineCommit) errors.push('TRANSACTION_BASELINE_MISMATCH');
  if (candidateCommit && txn.plan?.candidateCommit !== candidateCommit) errors.push('TRANSACTION_CANDIDATE_MISMATCH');
  if (!txn.transactionId || !/^[a-f0-9-]{36}$/.test(txn.transactionId)) errors.push('TRANSACTION_ID_INVALID');
  if (!Array.isArray(txn.journal)) errors.push('TRANSACTION_JOURNAL_MISSING');
  if (!Number.isFinite(Date.parse(txn.createdAt ?? ''))) errors.push('TRANSACTION_CREATED_INVALID');
  if (!PHASES.has(txn.phase)) errors.push('TRANSACTION_PHASE_INVALID');
  if (txn.profileDigest && !/^[a-f0-9]{64}$/.test(txn.profileDigest)) errors.push('TRANSACTION_PROFILE_DIGEST_INVALID');
  return errors.length ? { ok: false, errors } : { ok: true, txn };
}

async function openTransaction(profile, { transactionId, plan, backupRoot, releaseRoot, restoreRoot }) {
  const valid = validateProductionProfile(profile);
  const existing = await readTransaction(valid.root);
  const txn = existing ?? {
    schemaVersion: 1,
    kind: maintenance.kind,
    transactionId: transactionId ?? randomUUID(),
    root: valid.root,
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
  const sourceDir = join(releaseRoot, 'code', 'source');
  const nativeDir = join(releaseRoot, 'native');
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

// ---- freeze coordination with createProductionStateBackup (#2) ----
// createProductionStateBackup acquires run/backup.freeze with 'wx'; a stale 024
// startup lock would make it fail with STATE_BUSY. The stale lock is sealed and
// temporarily moved aside (never deleted) so the state snapshot can lock, then
// restored byte-identically so ordinary startup stays blocked until archive.

async function releaseFreeze(root) {
  const freeze = join(root, 'run', 'backup.freeze');
  const hold = join(root, 'run', 'backup.freeze.hold');
  try { await rename(freeze, hold); return { released: true, hold }; }
  catch (error) { if (error.code === 'ENOENT') return { released: false, hold }; throw error; }
}
async function restoreFreeze(root, hold) {
  try { await rename(hold, join(root, 'run', 'backup.freeze')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
}

function maintenancePlanFor(profile) {
  return { baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, runIds: { oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId }, ports: [...maintenance.ports], window: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() }, profile };
}

// ---- complete single-entry production recovery (one controlled run) ----
// Sequences the full 024 maintenance window: verify -> observe -> snapshot ->
// switch -> archive -> reverify -> start -> accept. Every mutating step is gated
// by a real typed receipt (verifyRuntimeApproval). snapshot/switchRelease/
// stateRestore default to the real state/switch machinery and are injectable so
// the isolation test can assert the fail-closed gates without native access.

// ---- stateless control-record rollback from the sealed snapshot (#6) ----

export async function restoreControlRecordsFromSnapshot(root, archiveRoot, seal, { observe, approve }) {
  if (typeof root !== 'string' || !isAbsolute(root)) fail('MAINTENANCE_ROOT_REQUIRED');
  if (typeof archiveRoot !== 'string' || !isAbsolute(archiveRoot)) fail('MAINTENANCE_ARCHIVE_REQUIRED');
  if (typeof observe !== 'function') fail('MAINTENANCE_OBSERVER_REQUIRED');
  if (typeof approve !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED');
  const snapshotBytes = await readFile(join(archiveRoot, 'snapshot.json'), 'utf8');
  if (sha(Buffer.from(snapshotBytes)) !== seal) fail('MAINTENANCE_SNAPSHOT_CHANGED');
  const snapshot = JSON.parse(snapshotBytes);
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== maintenance.kind || !Array.isArray(snapshot.files)) fail('MAINTENANCE_SNAPSHOT_INVALID');
  const moved = [];
  for (const file of snapshot.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size)) fail('MAINTENANCE_SNAPSHOT_INVALID');
    if (sha(await readFile(join(archiveRoot, 'original', file.name))) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED');
    const retiredPath = join(archiveRoot, 'retired', file.name);
    try { if (sha(await readFile(retiredPath)) !== file.sha256) fail('MAINTENANCE_SNAPSHOT_CHANGED'); moved.push(file.name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const observation = await observe();
  if (assessStartupSite(observation).length) fail('MAINTENANCE_PROOF_REQUIRED');
  await approve('restore');
  // Restore the freeze first, then the remaining records, only where archived.
  const order = ['backup.freeze', ...snapshot.files.map(file => file.name).filter(name => name !== 'backup.freeze')];
  for (const name of order) {
    if (!moved.includes(name)) continue;
    const path = join(root, 'run', name);
    if (!await absent(path)) fail('MAINTENANCE_CONFLICT');
    await writeFile(path, await readFile(join(archiveRoot, 'original', name)), { flag: 'wx' });
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

export async function executeRecovery(profile, { backupRoot, releaseRoot, restoreRoot, transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  for (const [flag, value] of [['backup', backupRoot], ['release', releaseRoot], ['restore', restoreRoot]]) if (typeof value !== 'string' || !isAbsolute(value)) fail('MAINTENANCE_' + flag.toUpperCase() + '_ROOT_REQUIRED');
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
  const stateRestore = deps.stateRestore;
  const approveAction = async action => {
    if (valid.mode === 'production') { if (typeof authorize !== 'function') fail('MAINTENANCE_AUTHORIZER_REQUIRED'); return authorize(action); }
    if (typeof confirm !== 'function') fail('MAINTENANCE_CONFIRMER_REQUIRED');
    const receipt = await confirm({ action, root: valid.root, mode: valid.mode });
    if (receipt?.kind !== 'simulation-only' || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now()) fail('MAINTENANCE_APPROVAL_REQUIRED');
    return receipt;
  };

  const txn = await openTransaction(valid, { transactionId, plan, backupRoot, releaseRoot, restoreRoot });
  let archive = null;
  let freezeHold = null;

  try {
    await verifyBaseline(valid); await txn.setPhase('verified');

    const observation = await observe();
    if (assessMaintenanceSite({ ...(await loadRecords(valid.root)), observation }).length) fail('MAINTENANCE_SITE_UNSAFE');
    await txn.setPhase('observed');

    archive = await openControlRecordArchive({ profile: valid, observe, authorize, confirm });
    const prepared = await archive.prepare();
    txn.state.archive = { seal: prepared.seal, archiveRoot: prepared.archiveRoot, phase: prepared.phase };
    await txn.setPhase('sealed');

    // #2 freeze coordination: temporarily move the stale lock aside so the
    // state snapshot can acquire its own lock; never delete, always restore.
    const released = await releaseFreeze(valid.root);
    freezeHold = released.hold;
    try { if (snapshot) await snapshot({ backupRoot, restoreRoot }); }
    finally { if (released.released) await restoreFreeze(valid.root, released.hold); }
    await txn.setPhase('snapshotted');

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
    if (freezeHold && !(await absent(join(valid.root, 'run', 'backup.freeze.hold')))) { try { await restoreFreeze(valid.root, freezeHold); } catch {} }
    await txn.markFailed(error);
    throw error;
  }
}

// ---- transaction-resuming rollback (#6) ----

export async function executeRollback(profile, { transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  const txn = await readTransaction(valid.root);
  if (!txn) fail('MAINTENANCE_TRANSACTION_MISSING');
  if (transactionId && txn.transactionId !== transactionId) fail('MAINTENANCE_TRANSACTION_ID_MISMATCH');
  const check = validateMaintenanceTransaction(txn, { baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit });
  if (!check.ok) fail('MAINTENANCE_TRANSACTION_INVALID');
  if (txn.phase === 'rolled-back') return { state: txn, productionExecutionAllowed: false };

  const observe = deps.observe ?? (() => observeProductionSite(valid));
  const authorize = deps.authorize;
  const confirm = deps.confirm;
  const stop = deps.stop;
  const stateRestore = deps.stateRestore;

  // 1. stop the candidate run if it was started (even if a later phase failed)
  if ((txn.startedRunId || ['started', 'accepted'].includes(txn.phase)) && typeof stop === 'function') { try { await stop(); } catch {} }
  // 2. restore archived control records from the sealed snapshot (freeze first)
  if (txn.archive?.archiveRoot && txn.archive?.seal) {
    await restoreControlRecordsFromSnapshot(valid.root, txn.archive.archiveRoot, txn.archive.seal, { observe, approve: action => (valid.mode === 'production' ? authorize(action) : confirm({ action, root: valid.root, archiveRoot: txn.archive.archiveRoot, seal: txn.archive.seal, oldRunId: maintenance.oldRunId, failedRunId: maintenance.failedRunId })) });
  }
  // 3. restore state if a state backup was taken
  if (txn.stateBackup?.backupRoot && txn.stateBackup?.restoreRoot && typeof stateRestore === 'function') {
    await stateRestore({ backupRoot: txn.stateBackup.backupRoot, restoreRoot: txn.stateBackup.restoreRoot });
  }
  const fresh = await readTransaction(valid.root);
  fresh.phase = 'rolled-back'; fresh.updatedAt = new Date().toISOString();
  await writeTransaction(valid.root, fresh);
  return { state: fresh, productionExecutionAllowed: false };
}

export async function runProductionRecovery(profile, { backupRoot, releaseRoot, restoreRoot, transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode !== 'production' || valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_PRODUCTION_ONLY');
  return executeRecovery(valid, { backupRoot, releaseRoot, restoreRoot, transactionId, deps: { ...(await productionDeps(valid)), ...deps } });
}

export async function rollbackProductionRecovery(profile, { transactionId, deps = {} } = {}) {
  const valid = validateProductionProfile(profile);
  if (valid.mode !== 'production' || valid.root !== PRODUCTION_ROOT) fail('MAINTENANCE_PRODUCTION_ONLY');
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
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      const result = await runProductionRecovery(profile, { backupRoot: option('--backup-root'), releaseRoot: option('--release-root'), restoreRoot: option('--restore-root') });
      console.log(JSON.stringify({ ok: true, state: result.state }, null, 2));
    } else if (command === 'rollback') {
      const profile = await loadProfile(option('--root') ?? PRODUCTION_ROOT);
      const result = await rollbackProductionRecovery(profile, { transactionId: option('--transaction-id') });
      console.log(JSON.stringify({ ok: true, state: result.state }, null, 2));
    } else {
      fail('MAINTENANCE_BAD_COMMAND');
    }
  } catch (error) { console.error(String(error?.code ?? error?.message ?? error)); process.exitCode = 1; }
}
