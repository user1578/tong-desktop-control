// Consistency of a fixed offline REVIEW packet, not an offline execution test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {win32 as path} from 'node:path';
import {createHash} from 'node:crypto';
const packet='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\offline-9850e1a\\offline-last-3f6dabd';
const read=async name=>JSON.parse(await readFile(path.join(packet,name),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const summary=await read('summary.json'),baseline=await read('baseline-files.json'),order=await read('install1-order.json');
assert.equal(summary.status,'NOT_READY');assert.equal(order.executable,false);assert.equal(order.productionWriteAuthorized,false);
assert.equal(summary.privatePacket.baselineSha256,'0919d91a7be189bfe974e1b363bdb56169998029f574fdc96c9edb2cc88c015f');
assert.equal(summary.privatePacket.installOrderSha256,'87d764207b27b0c025e2ed6006e77101afe7681b60a7bd0ec14852d19768714e');
assert.equal(sha(await readFile(path.join(packet,'baseline-files.json'))),summary.privatePacket.baselineSha256);
assert.equal(sha(await readFile(path.join(packet,'install1-order.json'))),summary.privatePacket.installOrderSha256);
assert.equal(sha(await readFile(path.join(packet,'profile1.json'))),summary.profile1Sha256);
for(const key of ['key','iv','ciphertext','external'])assert.equal(Object.hasOwn(baseline,key),false);
const records=new Map();
function member(group,name){assert.ok(Object.hasOwn(baseline.originalRoots,group));assert.ok(!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/'));assert.ok(name.split('/').every(p=>p&&p!=='.'&&p!=='..'));const base=baseline.originalRoots[group],target=path.resolve(base,name);assert.ok(target.toLowerCase().startsWith(base.toLowerCase()+'\\'));return group+'/'+name;}
for(const r of baseline.records){const key=member(r.group,r.name);assert.equal(records.has(key),false);assert.match(r.sha256,/^[a-f0-9]{64}$/);records.set(key,r.sha256);}
assert.equal(records.size,77485);assert.equal(new Set(baseline.records.map(r=>r.group)).size,14);
const forward=new Map(records),targets=new Set();let retired=0,writes=0;
for(const op of order.operations){const key=member(op.group,op.name);assert.equal(targets.has(key),false);targets.add(key);assert.notEqual(key,'control/backup.freeze');
 if(op.operation==='retain-outside-active-tree'){assert.equal(records.get(key),op.expectedOldSha256);forward.delete(key);retired++;}
 else{assert.match(op.sha256,/^[a-f0-9]{64}$/);assert.ok(path.isAbsolute(op.source));forward.set(key,op.sha256);writes++;}
}
assert.equal(writes,597);assert.equal(retired,26);assert.equal(forward.get('control/release-pin.json'),order.releaseDigest);assert.equal(forward.get('control/manager-pin.json'),order.releaseDigest);
assert.equal(forward.get('binding/profile.json'),summary.profile1Sha256);assert.equal(forward.get('monitor/TongLoginRuntime.ps1'),summary.formalOriginalRunnerSha256);
let unchangedBusiness=0;for(const [key,hash] of records){if(/^(secrets|policy|backend|config|oauth)\//.test(key)||key.startsWith('app/runtime/')){assert.equal(forward.get(key),hash,key);unchangedBusiness++;}}
assert.equal(forward.get('control/backup.freeze'),records.get('control/backup.freeze'));
const addedPaths=[...forward.keys()].filter(key=>!records.has(key));
console.log(JSON.stringify({reviewPacketConsistent:true,rollbackRecordCount:records.size,rollbackGroups:14,installWrites:writes,retireWithoutDelete:retired,addedPathsRequiringRollbackRetirement:addedPaths,unchangedBusinessRecords:unchangedBusiness,originalGateExcludedFromInstallWrites:true,actualOfflineInstallOrRollbackTested:false,productionWrite:false,largeMatrixRepeated:false}));
