import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TongCleanupAuthorization} from '../scripts/TongCleanupAuthorization.mjs';
import {assertProtectedPaths} from '../scripts/TongRuntimeSecurity.mjs';
// Read-only production prerequisite: no grants, ACLs, audit or runtime files
// are created. It catches the real deployment layout missed by isolated stores.
const expected='D:\\Tong\\runtime\\tong-policy\\disk-cleanup-grants.json';
const policy=new TongCleanupAuthorization('D:\\Tong\\app\\runtime');
assert.equal(policy.path.toLowerCase(),expected.toLowerCase(),'Production grants must not be kept in the sandbox-writable App metadata directory');
await assertProtectedPaths(['D:\\Tong\\runtime','D:\\Tong\\runtime\\tong-policy']);
const value=await policy.read();assert.equal(value.schemaVersion,1);assert.ok(Array.isArray(value.grants));
const control=fileURLToPath(new URL('../scripts/TongCleanupControl.mjs',import.meta.url));
const status=spawnSync(process.execPath,[control,'status'],{encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).schemaVersion,1);
const denied=spawnSync(process.execPath,[control,'grant-state'],{encoding:'utf8',windowsHide:true,timeout:30000});
assert.notEqual(denied.status,0);assert.match(denied.stderr,/Use the installed formal Manager entry/);assert.equal(denied.stdout,'');
console.log(JSON.stringify({passed:true,protectedProductionStore:true,statusReadOnly:true,developmentGrantDenied:true,aclModified:false,grantIssued:false}));
