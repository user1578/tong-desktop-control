import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { maintenance, executeRecovery, executeRollback, observeProductionSite, assessStartupSite, restoreControlRecordsFromSnapshot, realCopyRelease, runProductionRecovery } from '../scripts/Tong024ProductionMaintenance.mjs';
import { maintenanceFixture, goodObservation } from './fixtures/Tong024MaintenanceFixture.mjs';

const confirm = async binding => ({ ...binding, kind: 'simulation-only', expiresAt: Date.now() + 60000 });
function options(fx, overrides = {}) {
  return { backupRoot: join(fx.root, 'state-backup'), releaseRoot: join(fx.root, 'release'), restoreRoot: join(fx.root, 'state-restore'), deps: {
    confirm, observe: async () => goodObservation(),
    verifyBaseline: async () => ({ commit: maintenance.candidateCommit, appVerified: true, managerVerified: true }),
    snapshot: async () => ({ encrypted: true }), install: async () => ({ installed: true }),
    start: async () => ({ runId: randomUUID(), phase: 'ready' }), doctor: async () => ({ healthy: true }),
    ...overrides,
  } };
}
const txn = async fx => JSON.parse(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'));

test('snapshot retains the stale freeze continuously', async () => {
  const fx = await maintenanceFixture();
  const before = await readFile(join(fx.root, 'run', 'backup.freeze'));
  await executeRecovery(fx.profile, options(fx, { snapshot: async () => {
    assert.deepEqual(await readFile(join(fx.root, 'run', 'backup.freeze')), before);
    throw Error('SNAPSHOT_SAFE_REFUSAL');
  } })).then(() => assert.fail('snapshot failure must propagate'), error => assert.match(error.message, /SNAPSHOT_SAFE_REFUSAL/));
  assert.deepEqual(await readFile(join(fx.root, 'run', 'backup.freeze')), before);
});

test('missing snapshot implementation cannot advance to installation', async () => {
  const fx = await maintenanceFixture(); let installs = 0;
  await assert.rejects(executeRecovery(fx.profile, options(fx, { snapshot: undefined, install: async () => { installs++; } })), /MAINTENANCE_SNAPSHOT_REQUIRED/);
  assert.equal(installs, 0);
});

test('backup evidence is persisted before installation', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(executeRecovery(fx.profile, options(fx, { install: async () => { throw Error('INSTALL_REFUSED'); } })), /INSTALL_REFUSED/);
  const state = await txn(fx);
  assert.equal(state.stateBackup.backupRoot, join(fx.root, 'state-backup'));
  assert.equal(state.stateBackup.restoreRoot, join(fx.root, 'state-restore'));
  assert.equal(state.stateBackup.evidence.encrypted, true);
});

test('state paths outside the runtime root are rejected before transaction creation', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(executeRecovery(fx.profile, { ...options(fx), backupRoot: 'D:\\Tong\\state\\sibling-backup' }), /STATE_PATH_DENIED/);
  await assert.rejects(readFile(join(fx.root, 'logs', 'maintenance-transaction.json')), { code: 'ENOENT' });
});

test('an invalid simulation marker cannot create a transaction on denial', async () => {
  const fx = await maintenanceFixture();
  await writeFile(join(fx.root, 'runtime-synthetic.json'), JSON.stringify({ scope: 'unrelated' }));
  await assert.rejects(executeRecovery(fx.profile, options(fx)), /MAINTENANCE_SIMULATION_ONLY/);
  await assert.rejects(readFile(join(fx.root, 'logs', 'maintenance-transaction.json')), { code: 'ENOENT' });
});

test('a second invocation cannot rewrite an existing transaction', async () => {
  const fx = await maintenanceFixture();
  const opt = options(fx, { verifyBaseline: async () => { throw Error('INITIAL_REFUSAL'); } });
  await assert.rejects(executeRecovery(fx.profile, opt), /INITIAL_REFUSAL/);
  const before = await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'));
  await assert.rejects(executeRecovery(fx.profile, opt), /MAINTENANCE_TRANSACTION_EXISTS/);
  assert.deepEqual(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json')), before);
  await writeFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'null');
  await assert.rejects(executeRecovery(fx.profile, opt), /MAINTENANCE_TRANSACTION_EXISTS/);
  assert.equal(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'), 'utf8'), 'null');
});

test('rollback rejects a transaction rebound to another root', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(executeRecovery(fx.profile, options(fx, { verifyBaseline: async () => { throw Error('PRECHECK'); } })), /PRECHECK/);
  const state = await txn(fx); state.root = 'D:\\Tong\\state\\elsewhere';
  await writeFile(join(fx.root, 'logs', 'maintenance-transaction.json'), JSON.stringify(state));
  await assert.rejects(executeRollback(fx.profile, { deps: { observe: async () => goodObservation(), confirm } }), /MAINTENANCE_TRANSACTION_INVALID/);
});

test('partial installation cannot be reported as rolled back without a release restore', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(executeRecovery(fx.profile, options(fx, { install: async () => {
    await writeFile(join(fx.root, 'partial-install'), 'retained'); throw Error('PARTIAL_INSTALL');
  } })), /PARTIAL_INSTALL/);
  await assert.rejects(executeRollback(fx.profile, { deps: { observe: async () => goodObservation(), confirm } }), /MAINTENANCE_RELEASE_RESTORE_UNSUPPORTED/);
  assert.equal((await txn(fx)).phase, 'failed');
  assert.equal(await readFile(join(fx.root, 'partial-install'), 'utf8'), 'retained');
});

test('empty Job inventory cannot prove a safe startup site', () => {
  assert.ok(assessStartupSite(goodObservation({ jobs: [] })).includes('JOB_PROOF_REQUIRED'));
});

test('process inventory cannot default to empty success', async () => {
  const fx = await maintenanceFixture();
  const security = { processIdentity: async () => null, startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }) };
  await assert.rejects(observeProductionSite(fx.profile, { security, checkPort: async () => true, checkMonitor: async () => true }), /MAINTENANCE_PROCESS_INVENTORY_REQUIRED/);
});

test('the recorded live identity is unsafe even when its command marker is unreadable', async () => {
  const fx = await maintenanceFixture();
  const security = { processIdentity: async pid => ({ pid, exe: 'D:\\node\\node.exe', startTicks: String(pid), markerMatches: false }), startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }), listProcesses: async () => [] };
  const obs = await observeProductionSite(fx.profile, { security, checkPort: async () => true, checkMonitor: async () => true });
  assert.equal(obs.matchingProcesses.length, 3);
  assert.equal(obs.lifecycleExclusive, false);
});

test('quiescence is never represented as a held lifecycle lease', async () => {
  const fx = await maintenanceFixture();
  const security = { processIdentity: async () => null, startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }), listProcesses: async () => [] };
  const obs = await observeProductionSite(fx.profile, { security, checkPort: async () => true, checkMonitor: async () => true });
  assert.equal(obs.lifecycleExclusive, false);
});

test('unreadable live identity metadata cannot prove disappearance', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(observeProductionSite(fx.profile, { security: { processIdentity: async pid => ({ pid, exe: '', startTicks: '' }), startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }), listProcesses: async () => [] }, checkPort: async () => true, checkMonitor: async () => true }), /MAINTENANCE_PROCESS_IDENTITY_UNKNOWN/);
});

test('a matching inventoried process with a recycled recorded PID is still unsafe', async () => {
  const fx = await maintenanceFixture();
  const obs = await observeProductionSite(fx.profile, { security: { processIdentity: async () => null, startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }), listProcesses: async () => [{ pid: 10, exe: 'D:\\node\\node.exe', startTicks: '999999' }] }, checkPort: async () => true, checkMonitor: async () => true });
  assert.equal(obs.matchingProcesses.length, 1);
});

test('native observation errors and uncertain ports propagate as refusal', async () => {
  const fx = await maintenanceFixture();
  const security = { processIdentity: async () => null, startupJobsState: async () => ({ owner: 0, launcher: 0, guardian: 0, runtime: 0 }), listProcesses: async () => [] };
  await assert.rejects(observeProductionSite(fx.profile, { security: { ...security, processIdentity: async () => { throw Error('NATIVE_QUERY_DENIED'); } }, checkPort: async () => true, checkMonitor: async () => true }), /NATIVE_QUERY_DENIED/);
  await assert.rejects(observeProductionSite(fx.profile, { security: { ...security, startupJobsState: async () => { throw Error('JOB_QUERY_DENIED'); } }, checkPort: async () => true, checkMonitor: async () => true }), /JOB_QUERY_DENIED/);
  await assert.rejects(observeProductionSite(fx.profile, { security, checkPort: async () => undefined, checkMonitor: async () => true }), /MAINTENANCE_PORT_PROBE_FAILED/);
});

test('pre-install rollback is independently reloadable, with simulated observation explicitly labelled', async () => {
  const fx = await maintenanceFixture();
  await assert.rejects(executeRecovery(fx.profile, options(fx, { snapshot: async () => { throw Error('SNAPSHOT_INTERRUPTED'); } })), /SNAPSHOT_INTERRUPTED/);
  const worker = `import {executeRollback} from ${JSON.stringify(new URL('../scripts/Tong024ProductionMaintenance.mjs', import.meta.url).href)};import {goodObservation} from ${JSON.stringify(new URL('./fixtures/Tong024MaintenanceFixture.mjs', import.meta.url).href)};const result=await executeRollback(${JSON.stringify(fx.profile)},{deps:{observe:async()=>goodObservation(),confirm:async binding=>({...binding,kind:'simulation-only',expiresAt:Date.now()+60000})}});console.log(JSON.stringify({phase:result.state.phase,simulationOnly:true}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { phase: 'rolled-back', simulationOnly: true });
  assert.equal((await txn(fx)).phase, 'rolled-back');
});

test('crash inside installation leaves a durable intent for a new rollback process', async () => {
  const fx = await maintenanceFixture();
  const opt = options(fx);
  const worker = `import {executeRecovery} from ${JSON.stringify(new URL('../scripts/Tong024ProductionMaintenance.mjs', import.meta.url).href)};import {goodObservation} from ${JSON.stringify(new URL('./fixtures/Tong024MaintenanceFixture.mjs', import.meta.url).href)};await executeRecovery(${JSON.stringify(fx.profile)},{backupRoot:${JSON.stringify(opt.backupRoot)},releaseRoot:${JSON.stringify(opt.releaseRoot)},restoreRoot:${JSON.stringify(opt.restoreRoot)},deps:{observe:async()=>goodObservation(),confirm:async binding=>({...binding,kind:'simulation-only',expiresAt:Date.now()+60000}),verifyBaseline:async()=>({}),snapshot:async()=>({encrypted:true}),install:async()=>process.exit(37)}});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 37, child.stderr);
  const before = await readFile(join(fx.root, 'logs', 'maintenance-transaction.json'));
  assert.equal((await txn(fx)).installAttempted, true);
  await assert.rejects(executeRollback(fx.profile), /MAINTENANCE_RELEASE_RESTORE_UNSUPPORTED/);
  assert.deepEqual(await readFile(join(fx.root, 'logs', 'maintenance-transaction.json')), before);
});

test('stateless restore preflights every conflict before restoring freeze', async () => {
  const fx = await maintenanceFixture({ withControlRecords: false });
  const archive = join(fx.root, 'maintenance-evidence-' + randomUUID());
  await mkdir(join(archive, 'original'), { recursive: true }); await mkdir(join(archive, 'retired'));
  const digest = b => createHash('sha256').update(b).digest('hex');
  const files = [];
  for (const name of maintenance.requiredRecords) {
    const data = Buffer.from(name);
    for (const folder of ['original', 'retired']) await writeFile(join(archive, folder, name), data);
    files.push({ name, size: data.length, sha256: digest(data) });
  }
  const snapshot = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: maintenance.kind, root: fx.root, baselineCommit: maintenance.baselineCommit, candidateCommit: maintenance.candidateCommit, oldRunId: maintenance.oldRunId, firstFailedRunId: maintenance.firstFailedRunId, failedRunId: maintenance.failedRunId, files }));
  await writeFile(join(archive, 'snapshot.json'), snapshot);
  await writeFile(join(fx.root, 'run', 'runtime.json'), 'third-party');
  await assert.rejects(restoreControlRecordsFromSnapshot(fx.root, archive, digest(snapshot), { observe: async () => goodObservation(), approve: confirm }), /MAINTENANCE_CONFLICT/);
  await assert.rejects(readFile(join(fx.root, 'run', 'backup.freeze')), { code: 'ENOENT' });
});

test('raw release copy rejects traversal before writing a target', async () => {
  const fx = await maintenanceFixture();
  const release = join(fx.root, 'release'); await mkdir(join(release, 'code', 'source'), { recursive: true });
  const data = Buffer.from('path escape'); await writeFile(join(release, 'code', 'escape'), data);
  await assert.rejects(realCopyRelease(fx.profile, release, { sourceFiles: [{ path: '../escape', sha256: createHash('sha256').update(data).digest('hex'), size: data.length }], native: [] }), /MAINTENANCE_PATH_DENIED/);
  await assert.rejects(readFile(join(fx.root, 'escape')), { code: 'ENOENT' });
});

test('raw release copy refuses a junction target before overwriting its destination', async () => {
  const fx = await maintenanceFixture(), elsewhere = await maintenanceFixture();
  const release = join(fx.root, 'release'); await mkdir(join(release, 'code', 'source'), { recursive: true });
  const data = Buffer.from('candidate'); await writeFile(join(release, 'code', 'source', 'existing.txt'), data);
  await writeFile(join(elsewhere.root, 'existing.txt'), 'retain');
  await symlink(elsewhere.root, fx.profile.codeRoot, 'junction');
  await assert.rejects(realCopyRelease(fx.profile, release, { sourceFiles: [{ path: 'existing.txt', sha256: createHash('sha256').update(data).digest('hex'), size: data.length }], native: [] }), /MAINTENANCE_PATH_DENIED/);
  assert.equal(await readFile(join(elsewhere.root, 'existing.txt'), 'utf8'), 'retain');
});

test('production recovery is disabled before touching any production file', async () => {
  // Even a future removal of the production gate must never turn this test
  // into production I/O. The worker replaces every fs/promises import before
  // loading the adapter and its dependencies; any attempted access fails.
  const worker = `import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {registerHooks} from 'node:module';const source=Object.keys(fs).filter(name=>name!=='default').map(name=>'export const '+name+'=()=>{throw Error("PRODUCTION_IO_ATTEMPT")};').join('');registerHooks({resolve(specifier,context,next){return specifier==='node:fs/promises'?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);}});const api=await import(${JSON.stringify(new URL('../scripts/Tong024ProductionMaintenance.mjs', import.meta.url).href)});const {createProductionProfile}=await import(${JSON.stringify(new URL('../scripts/TongProductionProfile.mjs', import.meta.url).href)});const profile=createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64)});for(const operation of [()=>api.runProductionRecovery(profile,{}),()=>api.executeRecovery(profile,{}),()=>api.executeRollback(profile),()=>api.rollbackProductionRecovery(profile),()=>api.openMaintenanceSession({profile}),()=>api.openControlRecordArchive({profile}),()=>api.productionMaintenanceEntry(profile),()=>api.installMaintenanceRelease(profile,'D:/Tong/state/release'),()=>api.realCopyRelease(profile,'D:/Tong/state/release',{}),()=>api.switchMaintenanceRelease(profile,'D:/Tong/state/release',{approve:async()=>{}}),()=>api.restoreControlRecordsFromSnapshot(profile.root,profile.root,'x',{})])await assert.rejects(operation(),/MAINTENANCE_NOT_READY/);console.log(JSON.stringify({productionIOBlocked:true,mutatingEntrypoints:11}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).mutatingEntrypoints, 11);
});
