import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { maintenanceFixture } from './fixtures/Tong024MaintenanceFixture.mjs';
let api;
try { api = await import('../scripts/TongLifecycleFreeze.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof api?.withMaintenanceFreeze, 'function', 'continuous native ownership of the existing freeze is required');
const fx = await maintenanceFixture(), path = join(fx.root, 'run', 'backup.freeze');
const original = await readFile(path), sha256 = createHash('sha256').update(original).digest('hex');
let holderPid;
await api.withMaintenanceFreeze(fx.profile, { expectedSha256: sha256 }, async lease => {
  const proof = await lease.proof(); holderPid = proof.holderPid;
  assert.equal(proof.sha256, sha256); assert.equal(proof.exclusiveWriter, true);
  const borrowed = await api.acquireRuntimeFreeze(fx.root);
  await api.releaseRuntimeFreeze(fx.root, borrowed);
  assert.deepEqual(await readFile(path), original, 'borrowed operations must not release or rewrite the gate');
  const worker = `import {open,rename} from 'node:fs/promises';const path=${JSON.stringify(path)};let refused=0;try{await open(path,'wx');}catch(e){if(e.code==='EEXIST')refused++;}try{await rename(path,path+'.unexpected');}catch(e){if(['EPERM','EACCES','EBUSY'].includes(e.code))refused++;}console.log(JSON.stringify({refused}));process.exitCode=refused===2?0:3;`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  await assert.rejects(api.withMaintenanceFreeze(fx.profile, { expectedSha256: sha256 }, async () => {}), /LIFECYCLE_REENTRANT_MAINTENANCE_DENIED/);
  assert.equal((await lease.proof()).holderPid, holderPid);
});
assert.deepEqual(await readFile(path), original, 'old freeze survives release and failures');
await assert.rejects(api.withMaintenanceFreeze(fx.profile, { expectedSha256: 'f'.repeat(64) }, async () => {}), /LIFECYCLE_FREEZE_CHANGED/);
await api.withMaintenanceFreeze(fx.profile, { expectedSha256: sha256 }, async lease => assert.equal((await lease.proof()).exclusiveWriter, true));
console.log(JSON.stringify({ passed: true, root: fx.root, holderPid, existingFreezeNeverMoved: true, nativeRenameDenied: true, competingStartDenied: true, nestedOperationsBorrowed: true, mismatchedFreezeDenied: true, productionExecutionAllowed: false }));
