import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, readdir, lstat, realpath, rename, open } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { connect } from 'node:net';
import {pathToFileURL} from 'node:url';
import { validateProductionProfile, productionProfileDigest, verifyRuntimeApproval, runtimeApprovalPath, runtimeApprovalStore, readApprovedEnabledState, loadApprovedProfile } from './TongProductionProfile.mjs';
import { verifyRuntimeCandidate } from './TongRuntimeCandidate.mjs';
import { verifyRelease } from './TongRuntimeRelease.mjs';
import { assertProtectedPaths, runtimeProcessInventory, startupJobsState, sameProcess } from './TongRuntimeSecurity.mjs';
import { createProductionStateBackup, verifyProductionStateBackup } from './TongProductionState.mjs';
import { withMaintenanceFreeze, maintenanceFreeze } from './TongLifecycleFreeze.mjs';
import { runtimeStatus } from './TongAgentDockRuntime.mjs';
import { loginRecoveryPath } from './TongLoginRecovery.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const fail = code => { throw new Error(code); };
const transactionPath = root => join(root, 'logs', 'maintenance-transaction.json');
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const actions = ['backup', 'restore', 'start', 'stop', 'manager'];
const actionsFor=profile=>[...actions,profile.agentdockEnabled?'enable-agentdock':'disable-agentdock'];
const installedRuntime=profile=>import(pathToFileURL(join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs')).href);
function scoped(input) {
  // Scope is checked before even reading profile.json, logs, locks or receipts.
  if (input?.mode !== 'production-simulation') fail('MAINTENANCE_NOT_READY');
  return validateProductionProfile(input);
}
const managerProfile = profile => validateProductionProfile({ ...profile, agentdockEnabled: false });
function member(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.split('/').some(p => !p || p === '.' || p === '..' || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p))) fail('MAINTENANCE_PATH_DENIED');
  const path = resolve(root, ...name.split('/'));
  if (!path.startsWith(resolve(root) + sep)) fail('MAINTENANCE_PATH_DENIED');
  return path;
}
async function ordinary(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) fail('MAINTENANCE_PATH_DENIED');
}
async function data(path) { await ordinary(path); return readFile(path); }
async function maybe(path) { try { return await data(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
const fingerprint = value => value === null ? null : sha(value);
async function ensureDirectory(root, path) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== resolve(path)) fail('MAINTENANCE_PATH_DENIED');
  let current = root; await ordinary(current, true);
  for (const name of rel.split(sep).filter(Boolean)) {
    current = join(current, name);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await ordinary(current, true);
  }
}
async function atomic(path, value) {
  await ordinary(dirname(path), true);
  const temporary = path + '.' + randomUUID() + '.tmp', held = await open(temporary, 'wx');
  try { await held.writeFile(value); await held.sync(); } finally { await held.close(); }
  await rename(temporary, path);
}
async function persist(root, state) { state.updatedAt = new Date().toISOString(); await atomic(transactionPath(root), JSON.stringify(state, null, 2) + '\n'); }
function indexPath(profile, action) { return join(runtimeApprovalStore(profile.root), 'simulation-' + sha(profile.root) + '.' + action + '.current.dpapi.json'); }
function profileFor(profile, action) { return action === 'manager' ? managerProfile(profile) : profile; }
async function permissions(profile) {
  for (const action of actionsFor(profile)) await verifyRuntimeApproval(profileFor(profile, action), action);
  await readApprovedEnabledState(profile);
}
async function quiescent(profile, runIds = [], known = []) {
  const record = JSON.parse((await maybe(join(profile.root, 'run', 'runtime.json'))) ?? 'null');
  const guardian = JSON.parse((await maybe(join(profile.root, 'run', 'guardian.json'))) ?? 'null');
  const request = JSON.parse((await maybe(join(profile.root, 'run', 'request.json'))) ?? 'null');
  const identities = [...known, guardian, record?.supervisor, ...(record?.children ?? []), ...(record?.descendants ?? [])].filter(value => value?.pid);
  const recordedIds=[];
  for(const name of await readdir(join(profile.root,'run'))){
    if(name==='backup.freeze'||name==='release-pin.json'||name==='manager-pin.json')continue;
    if(!/^[a-zA-Z0-9_.-]+\.json$/.test(name))fail('MAINTENANCE_CONTROL_UNKNOWN');
    const value=JSON.parse(await data(join(profile.root,'run',name)));
    if(value?.runId)recordedIds.push(value.runId);
    const receipt=/^(?:launcher|guardian)\.([a-f0-9-]+)\.json$/.exec(name);
    if(receipt){if(receipt[1]!==value?.runId)fail('MAINTENANCE_RUN_ID_UNKNOWN');recordedIds.push(receipt[1]);}
  }
  const ids = [...new Set([...runIds,...recordedIds, record?.runId, guardian?.runId, request?.runId].filter(Boolean))];
  if (ids.some(id => !idPattern.test(id))) fail('MAINTENANCE_RUN_ID_UNKNOWN');
  const inventory = await runtimeProcessInventory({ roots: [profile.root, profile.codeRoot, profile.managerRoot], runIds: ids, pids: identities.map(id => id.pid),mode:profile.mode });
  if (inventory.complete !== true || !Array.isArray(inventory.identities) || !Array.isArray(inventory.matchingProcesses)) fail('MAINTENANCE_INVENTORY_UNKNOWN');
  if (identities.some(expected => inventory.identities.some(actual => sameProcess(actual, expected))) || inventory.matchingProcesses.some(actual => actual.pid !== process.pid)) fail('MAINTENANCE_PROCESS_PRESENT');
  const jobs = [];
  for (const runId of ids) {
    const state = await startupJobsState(runId);
    if (['owner', 'launcher', 'guardian', 'runtime'].some(role => state[role] !== 0)) fail('MAINTENANCE_JOB_NOT_EMPTY');
    jobs.push({ runId, ...state });
  }
  const ports = [];
  for (const port of [profile.gatewayPort, profile.upstreamPort, profile.agentdockPort]) {
    await new Promise((accept, reject) => {
      const socket = connect({ host: '127.0.0.1', port, timeout: 1000 });
      socket.once('connect', () => { socket.destroy(); reject(new Error('MAINTENANCE_PORT_BUSY')); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('MAINTENANCE_PORT_UNKNOWN')); });
      socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? accept() : reject(new Error('MAINTENANCE_PORT_UNKNOWN')); });
    }); ports.push({ port, free: true });
  }
  return { checkedAt: new Date().toISOString(), identities: identities.length, jobs, ports, inventoryComplete: true };
}
async function leaseProof(root) {
  const lease = maintenanceFreeze(root); if (!lease) fail('MAINTENANCE_LEASE_REQUIRED'); return lease.proof();
}
async function checkpoint(root, state, name, onCheckpoint) {
  state.phase = name; await persist(root, state); const proof=await leaseProof(root);
  if (onCheckpoint) await onCheckpoint({ name, transactionId: state.transactionId, index: state.index, leaseHolderPid:proof.holderPid });
}
async function verifyManifest(root, state) {
  if (!idPattern.test(state?.transactionId ?? '') || state.kind !== 'tong-version-maintenance-v1' || state.root !== root) fail('MAINTENANCE_TRANSACTION_INVALID');
  const folder = join(root, 'maintenance-transactions', state.transactionId);
  const encoded = await data(join(folder, 'snapshot.json'));
  if (sha(encoded) !== state.seal) fail('MAINTENANCE_SNAPSHOT_CHANGED');
  const manifest = JSON.parse(encoded), old = scoped(manifest.baselineProfile), next = scoped(manifest.candidateProfile);
  if (old.root !== root || next.root !== root || manifest.transactionId !== state.transactionId || !Array.isArray(manifest.entries) || !Array.isArray(manifest.operations)) fail('MAINTENANCE_TRANSACTION_INVALID');
  if(state.freezeSha256!==manifest.freezeSha256||!Number.isSafeInteger(state.index)||state.index<0||state.index>manifest.operations.length||state.pending&&(!Number.isSafeInteger(state.pending.index)||state.pending.index<0||state.pending.index>=manifest.operations.length||typeof state.pending.reverse!=='boolean'||(state.pending.reverse?state.pending.index!==state.index&&state.pending.index!==state.index-1:state.pending.index!==state.index)))fail('MAINTENANCE_TRANSACTION_INVALID');
  const permitted = new Set();
  for (const [component, target] of [['app', old.codeRoot], ['manager', old.managerRoot]]) {
    for (const entry of [...manifest.oldPin.sourceFiles, ...manifest.oldPin.native, ...manifest.newPin.sourceFiles, ...manifest.newPin.native]) permitted.add(member(target, entry.path));
  }
  for (const name of manifest.controlNames) { if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === 'backup.freeze') fail('MAINTENANCE_PATH_DENIED'); permitted.add(join(root, 'run', name)); }
  permitted.add(join(root, 'profile.json')); permitted.add(join(root, 'run', 'release-pin.json')); permitted.add(join(root, 'run', 'manager-pin.json'));
  for (const profile of [old, next]) {
    for (const action of actionsFor(profile)) { permitted.add(runtimeApprovalPath(profileFor(profile, action), action)); permitted.add(indexPath(profile, action)); }
    permitted.add(join(runtimeApprovalStore(root), productionProfileDigest(profile) + '.enabled.dpapi.json'));
  }
  permitted.add(loginRecoveryPath(root));
  const paths = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    if (!permitted.has(entry.path) || paths.has(entry.path) || entry.id !== String(index) || !/^[a-f0-9]{64}$/.test(entry.beforeSha256)) fail('MAINTENANCE_TRANSACTION_INVALID');
    paths.add(entry.path);
    if (sha(await data(join(folder, 'preimage', entry.id))) !== entry.beforeSha256) fail('MAINTENANCE_SNAPSHOT_CHANGED');
  }
  const operated=new Set();
  for (const operation of manifest.operations){
    if (!permitted.has(operation.path)||operated.has(operation.path)||operation.beforeSha256 !== null && !/^[a-f0-9]{64}$/.test(operation.beforeSha256) || operation.afterSha256 !== null && (!/^[a-f0-9]{64}$/.test(operation.afterSha256)||sha(Buffer.from(operation.desired??'','base64'))!==operation.afterSha256)) fail('MAINTENANCE_TRANSACTION_INVALID');
    const before=manifest.entries.find(entry=>entry.path===operation.path);
    if(operation.beforeSha256!==(before?.beforeSha256??null)||operation.beforeId!==(before?.id??null))fail('MAINTENANCE_TRANSACTION_INVALID');
    operated.add(operation.path);
  }
  return { folder, manifest, old, next };
}
async function prepare(input, onCheckpoint) {
  const { baselineProfile: old, candidateProfile: next, releaseRoot, candidateCommit } = input;
  if (old.root !== next.root || old.codeRoot !== next.codeRoot || old.managerRoot !== next.managerRoot || old.agentdockEnabled !== next.agentdockEnabled || old.gatewayPort !== next.gatewayPort || old.upstreamPort !== next.upstreamPort || old.agentdockPort !== next.agentdockPort) fail('MAINTENANCE_TOPOLOGY_CHANGED');
  if (await maybe(transactionPath(old.root))) fail('MAINTENANCE_TRANSACTION_EXISTS');
  await assertProtectedPaths([old.root, join(old.root, 'run'), old.codeRoot, old.managerRoot]);
  await permissions(old); await permissions(next);
  await verifyRuntimeCandidate(old); await verifyRuntimeCandidate(old, { manager: true, reviewedManagerProfile: managerProfile(old) });
  const oldPin = JSON.parse(await data(join(old.root, 'run', 'release-pin.json'))), newPin = await verifyRelease({ releaseRoot });
  const pinBytes = await data(join(releaseRoot, 'release-manifest.json'));
  if (newPin.commit !== candidateCommit || !/^[a-f0-9]{40}$/.test(candidateCommit ?? '') || sha(pinBytes) !== next.releaseDigest || newPin.files.find(file => file.path === 'code/source.tar')?.sha256 !== next.sourceDigest) fail('MAINTENANCE_CANDIDATE_BINDING_DENIED');
  const observation = await quiescent(old);
  const transactionId = input.transactionId ?? randomUUID(), folder = join(old.root, 'maintenance-transactions', transactionId);
  if (!idPattern.test(transactionId)) fail('MAINTENANCE_TRANSACTION_INVALID');
  await ensureDirectory(old.root, dirname(folder)); await mkdir(folder); await mkdir(join(folder, 'preimage')); await mkdir(join(folder, 'retired'));
  const entries = [], operations = [], seen = new Map();
  const save = async path => {
    if (seen.has(path)) return seen.get(path);
    const bytes = await maybe(path); if (bytes === null) return null;
    const entry = { id: String(entries.length), path, size: bytes.length, beforeSha256: sha(bytes) };
    const handle = await open(join(folder, 'preimage', entry.id), 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    entries.push(entry); seen.set(path, entry); return entry;
  };
  const add = async (path, desired, stage) => {
    const entry = await save(path), afterSha256 = fingerprint(desired);
    if ((entry?.beforeSha256 ?? null) === afterSha256) return;
    operations.push({ path, beforeSha256: entry?.beforeSha256 ?? null, beforeId: entry?.id ?? null, afterSha256, stage, ...(desired === null ? {} : { desired: desired.toString('base64') }) });
  };
  for (const [component, target] of [['app', old.codeRoot], ['manager', old.managerRoot]]) {
    const oldFiles = new Map([...oldPin.sourceFiles, ...oldPin.native].map(file => [file.path, file]));
    const nextFiles = new Set();
    for (const file of oldFiles.values()) { const entry = await save(member(target, file.path)); if (entry?.beforeSha256 !== file.sha256 || entry.size !== file.size) fail('MAINTENANCE_BASELINE_CHANGED'); }
    for (const [base, list] of [[join(releaseRoot, 'code', 'source'), newPin.sourceFiles], [join(releaseRoot, 'native'), newPin.native]]) for (const file of list) {
      if (nextFiles.has(file.path.toLowerCase())) fail('MAINTENANCE_PATH_DENIED'); nextFiles.add(file.path.toLowerCase());
      const path = member(target, file.path), bytes = await data(member(base, file.path));
      if (sha(bytes) !== file.sha256 || bytes.length !== file.size) fail('MAINTENANCE_RELEASE_CHANGED');
      if (!oldFiles.has(file.path) && await maybe(path) !== null) fail('MAINTENANCE_NEW_FILE_CONFLICT');
      await add(path, bytes, component + '-files');
    }
    for (const file of oldFiles.values()) if (!nextFiles.has(file.path.toLowerCase())) await add(member(target, file.path), null, component + '-files');
  }
  await add(join(old.root, 'run', 'release-pin.json'), pinBytes, 'app-pin');
  await add(join(old.root, 'run', 'manager-pin.json'), pinBytes, 'manager-pin');
  await add(join(old.root, 'profile.json'), Buffer.from(JSON.stringify(next, null, 2) + '\n'), 'profile');
  for (const profile of [old, next]) for (const action of actionsFor(profile)) await save(runtimeApprovalPath(profileFor(profile, action), action));
  for (const profile of [old, next]) await save(join(runtimeApprovalStore(old.root), productionProfileDigest(profile) + '.enabled.dpapi.json'));
  await save(loginRecoveryPath(old.root));
  for (const action of actionsFor(next)) await add(indexPath(next, action), await data(runtimeApprovalPath(profileFor(next, action), action)), 'permissions');
  const controlNames = [];
  for (const name of (await readdir(join(old.root, 'run'))).sort()) {
    if (['backup.freeze', 'release-pin.json', 'manager-pin.json'].includes(name)) continue;
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) fail('MAINTENANCE_CONTROL_UNKNOWN');
    await add(join(old.root, 'run', name), null, 'controls'); controlNames.push(name);
  }
  const freezeSha256 = sha(await data(join(old.root, 'run', 'backup.freeze')));
  const manifest = { schemaVersion: 1, transactionId, baselineProfile: old, candidateProfile: next, oldPin, newPin, candidateCommit, releaseRoot, entries, operations, controlNames, freezeSha256, observation, ...(input.startupTimeoutMs!==undefined?{startupTimeoutMs:input.startupTimeoutMs}:{}) };
  const encoded = Buffer.from(JSON.stringify(manifest));
  await atomic(join(folder, 'snapshot.json'), encoded);
  const state = { kind: 'tong-version-maintenance-v1', transactionId, root: old.root, seal: sha(encoded), freezeSha256, phase: 'prepared', index: 0, pending: null, startedRunId: null, createdAt: new Date().toISOString() };
  await persist(old.root, state); await checkpoint(old.root, state, 'prepared', onCheckpoint);
  return state;
}
async function applyOperation(root, folder, operation, index, state, reverse = false, onCheckpoint) {
  await leaseProof(root);
  const expected = reverse ? operation.afterSha256 : operation.beforeSha256, desired = reverse ? operation.beforeSha256 : operation.afterSha256;
  const current = fingerprint(await maybe(operation.path));
  if (current === desired && state.pending?.index === index && state.pending.reverse === reverse) return;
  if (current !== expected) fail('MAINTENANCE_EXTERNAL_CHANGE');
  state.pending = { index, reverse }; await persist(root, state);
  if(onCheckpoint)await onCheckpoint({name:reverse?'rollback-intent':'write-intent',index,transactionId:state.transactionId});
  if (desired === null) {
    if (current !== null) {
      const destination = join(folder, 'retired', (reverse ? 'candidate-' : 'old-') + index);
      if (await maybe(destination)) fail('MAINTENANCE_ARCHIVE_CONFLICT');
      await rename(operation.path, destination);
    }
  } else {
    const bytes = reverse ? await data(join(folder, 'preimage', operation.beforeId)) : Buffer.from(operation.desired, 'base64');
    if (sha(bytes) !== desired) fail('MAINTENANCE_SNAPSHOT_CHANGED');
    if (operation.path.startsWith(root + sep)) await ensureDirectory(root, dirname(operation.path));
    await atomic(operation.path, bytes);
    if (sha(await data(operation.path)) !== desired) fail('MAINTENANCE_WRITE_VERIFY_FAILED');
  }
  if(onCheckpoint)await onCheckpoint({name:reverse?'rollback-installed':'write-installed',index,transactionId:state.transactionId});
}
async function assertLedger(state, manifest, { candidateControls = false } = {}) {
  const byPath = new Map(manifest.operations.map((op, index) => [op.path, { op, index }]));
  for (const entry of manifest.entries) {
    const operation = byPath.get(entry.path), current = fingerprint(await maybe(entry.path));
    if (!operation) { if (current !== entry.beforeSha256) fail('MAINTENANCE_EXTERNAL_CHANGE'); continue; }
    const { op, index } = operation;
    if(candidateControls&&op.stage==='controls')continue;
    const allowed = state.pending?.index === index ? [op.beforeSha256, op.afterSha256] : index < state.index ? [op.afterSha256] : [op.beforeSha256];
    if (!allowed.includes(current)) fail('MAINTENANCE_EXTERNAL_CHANGE');
  }
  for (const [index, op] of manifest.operations.entries()) if (op.beforeSha256 === null) {
    const current = fingerprint(await maybe(op.path));
    if (!(state.pending?.index === index ? [null, op.afterSha256] : index < state.index ? [op.afterSha256] : [null]).includes(current)) fail('MAINTENANCE_EXTERNAL_CHANGE');
  }
}
async function apply(root, state, onCheckpoint) {
  const { folder, manifest, old, next } = await verifyManifest(root, state);
  if (state.phase === 'rolled-back' || state.phase === 'rolling-back') fail('MAINTENANCE_DIRECTION_DENIED');
  if (!state.backupRoot) {
    state.backupRoot = join(root, 'state-backups', state.transactionId); await ensureDirectory(root, dirname(state.backupRoot)); await persist(root, state);
  }
  if (!state.backupVerified) {
    if (await maybe(join(state.backupRoot, 'state-manifest.json'))) await verifyProductionStateBackup(old, { backupRoot: state.backupRoot });
    else await createProductionStateBackup(old, { backupRoot: state.backupRoot });
    state.backupVerified = true; await checkpoint(root, state, 'state-backup', onCheckpoint);
  }
  await assertLedger(state, manifest, {candidateControls:!!state.candidateRunId});
  while (state.index < manifest.operations.length) {
    const index = state.index, operation = manifest.operations[index];
    await applyOperation(root, folder, operation, index, state, false, onCheckpoint);
    state.index++; state.pending = null;
    await checkpoint(root, state, operation.stage, onCheckpoint);
  }
  await verifyRuntimeCandidate(next); await verifyRuntimeCandidate(next, { manager: true, reviewedManagerProfile: managerProfile(next) });
  await permissions(next);
  if (!state.startedRunId) {
    if(state.candidateRunId)fail('MAINTENANCE_START_INCOMPLETE_ROLLBACK_REQUIRED');
    await quiescent(next, manifest.observation.jobs.map(job => job.runId));
    state.startIntentAt=new Date().toISOString();await checkpoint(root, state, 'starting', onCheckpoint);
    const runtime=await installedRuntime(next);
    let started;try{started = await runtime.startRuntime(root,{startupTimeoutMs:manifest.startupTimeoutMs,onRequest:async({runId})=>{
      state.candidateRunId=runId;state.requestSha256=sha(await data(join(root,'run','request.json')));await persist(root,state);
    }});}catch(error){state.startFailure={code:/^[A-Z_]+$/.test(error.message)?error.message:'START_FAILED',cleanupProven:error.startupFailure?.cleanup?.proven===true,...(error.startupFailure?{evidence:error.startupFailure}:{})};await persist(root,state);throw error;} state.startedRunId = started.runId;
    await checkpoint(root, state, 'started', onCheckpoint);
  }
  if(sha(await data(join(root,'run','request.json')))!==state.requestSha256)fail('MAINTENANCE_REPLACEMENT_RUN_PRESENT');
  const runtime=await installedRuntime(next),doctor = await runtime.runtimeDoctor(root),status=await runtime.runtimeStatus(root); if (doctor.healthy !== true||status.runId!==state.startedRunId||!status.supervisorAlive) fail('MAINTENANCE_HEALTH_FAILED');
  await checkpoint(root, state, 'accepted', onCheckpoint);
  return { transactionId: state.transactionId, phase: state.phase, startedRunId: state.startedRunId, doctorHealthy: true, snapshotSeal: state.seal, backupRoot: state.backupRoot, productionExecutionAllowed: false };
}
async function stopCandidate(root, state, manifest) {
  const request = JSON.parse((await maybe(join(root, 'run', 'request.json'))) ?? 'null');
  const oldRequest = manifest.entries.find(entry => entry.path === join(root, 'run', 'request.json'));
  const requestIsOld = oldRequest && fingerprint(await maybe(join(root, 'run', 'request.json'))) === oldRequest.beforeSha256;
  const candidateId = state.candidateRunId ?? state.startedRunId;
  if (candidateId && !idPattern.test(candidateId)) fail('MAINTENANCE_NEW_RUN_UNKNOWN');
  if(candidateId&&!requestIsOld&&(request?.runId!==candidateId||sha(await data(join(root,'run','request.json')))!==state.requestSha256))fail('MAINTENANCE_REPLACEMENT_RUN_PRESENT');
  const status = await runtimeStatus(root);
  if (status.supervisorAlive) {
    if (!candidateId || status.runId !== candidateId) fail('MAINTENANCE_REPLACEMENT_RUN_PRESENT');
    await (await installedRuntime(manifest.candidateProfile)).stopRuntime(root, { expectedRunId: candidateId });
    state.candidateStopped=true;await persist(root,state);
  }
  if(candidateId&&!state.startedRunId&&!state.candidateStopped&&state.startFailure?.cleanupProven!==true)fail('MAINTENANCE_STARTUP_CLEANUP_UNPROVEN');
  await quiescent(manifest.candidateProfile, [...manifest.observation.jobs.map(job => job.runId), candidateId].filter(Boolean));
  if (!state.candidateControls) {
    const controls = [];
    for (const name of await readdir(join(root, 'run'))) {
      if (['backup.freeze', 'release-pin.json', 'manager-pin.json'].includes(name)) continue;
      const path = join(root, 'run', name), value = await data(path), old = manifest.entries.find(entry => entry.path === path);
      if (old && sha(value) === old.beforeSha256) continue;
      if (!candidateId || !/^[a-zA-Z0-9_.-]+$/.test(name) || JSON.parse(value).runId !== candidateId) fail('MAINTENANCE_NEW_CONTROL_UNKNOWN');
      controls.push({ name, sha256: sha(value) });
    }
    state.candidateControls = controls; await persist(root, state);
  }
  const folder = join(root, 'maintenance-transactions', state.transactionId);
  for (const file of state.candidateControls) {
    const source = join(root, 'run', file.name), target = join(folder, 'retired', 'control-' + file.name), current = await maybe(source);
    if (current === null) { if (fingerprint(await maybe(target)) !== file.sha256) fail('MAINTENANCE_EXTERNAL_CHANGE'); continue; }
    const old = manifest.entries.find(entry => entry.path === source);
    if (state.phase === 'rolling-back' && old && sha(current) === old.beforeSha256) continue;
    if (sha(current) !== file.sha256 || await maybe(target) !== null) fail('MAINTENANCE_EXTERNAL_CHANGE');
    await rename(source, target);
  }
}
async function verifyRestored(root,state,manifest,old) {
  await quiescent(old,manifest.observation.jobs.map(job=>job.runId));
  for (const entry of manifest.entries) if (fingerprint(await maybe(entry.path)) !== entry.beforeSha256) fail('MAINTENANCE_RESTORE_VERIFY_FAILED');
  for (const op of manifest.operations) if (op.beforeSha256 === null && await maybe(op.path) !== null) fail('MAINTENANCE_RESTORE_VERIFY_FAILED');
  await verifyRuntimeCandidate(old); await verifyRuntimeCandidate(old, { manager: true, reviewedManagerProfile: managerProfile(old) });
  await permissions(old); if(state.backupVerified)await verifyProductionStateBackup(old, { backupRoot: state.backupRoot });
  for (const action of actionsFor(old)) if (productionProfileDigest(await loadApprovedProfile(root, action)) !== productionProfileDigest(profileFor(old, action))) fail('MAINTENANCE_PERMISSION_RESTORE_FAILED');
}
async function rollback(root, state, onCheckpoint) {
  const { folder, manifest, old } = await verifyManifest(root, state);
  if (state.phase === 'rolled-back') {await verifyRestored(root,state,manifest,old);return { transactionId: state.transactionId, phase: state.phase, verified: true, productionExecutionAllowed: false };}
  await assertLedger(state,manifest,{candidateControls:!!state.candidateRunId});
  await stopCandidate(root, state, manifest);
  // Candidate records have their own archive. Never overlay them with old data.
  await assertLedger(state, manifest);
  await checkpoint(root, state, 'rolling-back', onCheckpoint);
  while (state.index > 0 || state.pending) {
    const index = state.pending?.index ?? state.index - 1, operation = manifest.operations[index];
    const current = fingerprint(await maybe(operation.path));
    if (current !== operation.beforeSha256) await applyOperation(root, folder, operation, index, state, true, onCheckpoint);
    state.index = index; state.pending = null; await persist(root, state);
    if (onCheckpoint) await onCheckpoint({ name: 'rollback-file', index, transactionId: state.transactionId });
  }
  await verifyRestored(root,state,manifest,old);
  await checkpoint(root, state, 'rolled-back', onCheckpoint);
  return { transactionId: state.transactionId, phase: state.phase, verified: true, snapshotSeal: state.seal, restoredFiles: manifest.entries.length, productionExecutionAllowed: false };
}
export async function runMaintenanceTransaction(input, { onCheckpoint } = {}) {
  const old = scoped(input?.baselineProfile), next = scoped(input?.candidateProfile);
  const freezeSha256 = sha(await data(join(old.root, 'run', 'backup.freeze')));
  return withMaintenanceFreeze(old, { expectedSha256: freezeSha256 }, async () => {
    const state = await prepare({ ...input, baselineProfile: old, candidateProfile: next }, onCheckpoint);
    return apply(old.root, state, onCheckpoint);
  });
}
export async function resumeMaintenanceTransaction(input, { transactionId, action = 'rollback', onCheckpoint } = {}) {
  const profile = scoped(input), root = profile.root;
  const state = JSON.parse(await data(transactionPath(root)));
  if (state.transactionId !== transactionId || !idPattern.test(transactionId ?? '')) fail('MAINTENANCE_TRANSACTION_ID_MISMATCH');
  const { manifest } = await verifyManifest(root, state);
  if (productionProfileDigest(profile) !== productionProfileDigest(manifest.baselineProfile)) fail('MAINTENANCE_PROFILE_MISMATCH');
  return withMaintenanceFreeze(profile, { expectedSha256: state.freezeSha256 }, async () => {
    if (action === 'apply') return apply(root, state, onCheckpoint);
    if (action === 'rollback') return rollback(root, state, onCheckpoint);
    if (action === 'stop') {
      const status = await runtimeStatus(root); if (status.runId !== state.startedRunId) fail('MAINTENANCE_REPLACEMENT_RUN_PRESENT');
      await (await installedRuntime(manifest.candidateProfile)).stopRuntime(root, { expectedRunId: state.startedRunId });
      return { phase: 'candidate-stopped', transactionId, productionExecutionAllowed: false };
    }
    fail('MAINTENANCE_ACTION_DENIED');
  });
}
