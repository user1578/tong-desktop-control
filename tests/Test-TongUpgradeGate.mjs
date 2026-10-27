import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {maintenanceFixture} from './fixtures/Tong024MaintenanceFixture.mjs';
import {withMaintenanceFreeze} from '../scripts/TongLifecycleFreeze.mjs';
const fx=await maintenanceFixture(),gate=join(fx.root,'run','backup.freeze');
// Fixture created this original gate. Retain it as a named original, never
// remove production controls to simulate a clean upgrade.
await import('node:fs/promises').then(fs=>fs.rename(gate,gate+'.fixture-original'));
const receipt=join(fx.root,'upgrade-gate.json'),expectedSha256=createHash('sha256').update('').digest('hex');
await assert.rejects(withMaintenanceFreeze(fx.profile,{expectedSha256,upgradeReceipt:receipt,testCrashAfterReceipt:true},()=>{}),/LIFECYCLE_FREEZE_UNAVAILABLE/);
await assert.rejects(lstat(gate),{code:'ENOENT'});
const prepared=JSON.parse(await readFile(receipt,'utf8'));
assert.ok(prepared.pendingPath);await lstat(prepared.pendingPath);
await withMaintenanceFreeze(fx.profile,{expectedSha256,upgradeReceipt:receipt},async lease=>{
  assert.equal((await lease.proof()).exclusiveWriter,true);
  assert.equal(typeof lease.release,'function');
  assert.equal((await lease.release()).released,true);
});
await assert.rejects(lstat(gate),{code:'ENOENT'});
// A later rollback can safely create a new gate generation from the same snapshot.
await withMaintenanceFreeze(fx.profile,{expectedSha256,upgradeReceipt:receipt},async lease=>{await lease.release();});
console.log(JSON.stringify({passed:true,interruptedPreparationRecoverable:true,releaseUnderMutex:true,rollbackGeneration:true,productionModified:false}));
