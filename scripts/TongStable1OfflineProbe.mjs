// Read-only native probe for the one fixed, previously protected fixture.
// Metadata helpers are reviewed development files, independent of Manager.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {processIdentity,sameProcess,runtimeProcessInventory,startupJobsState} from './TongRuntimeSecurity.mjs';
import {assertPortUnused} from './TongRuntimePort.mjs';
const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const me=await processIdentity(process.pid),parent=await processIdentity(me.parentPid,'TongStable1Offline.ps1');
assert.equal(parent.exe.toLowerCase(),'c:\\program files\\powershell\\7\\pwsh.exe');assert.equal(parent.markerMatches,true);
const ids=new Map(),runIds=new Set();
function collect(v){if(!v||typeof v!=='object')return;if(Number.isInteger(v.pid)&&v.exe&&/^\d+$/.test(v.startTicks))ids.set(v.pid+':'+v.startTicks,v);if(v.runId)runIds.add(v.runId);for(const x of Object.values(v))if(x&&typeof x==='object')collect(x);}
for(const name of await readdir(join(root,'run'))){if(name.endsWith('.json')){const v=JSON.parse(await readFile(join(root,'run',name)));collect(v);if(name==='runtime.json')assert.ok(['stopped','abnormal_exit'].includes(v.phase));}}
for(const id of ids.values()){const actual=await processIdentity(id.pid);assert.ok(!actual||actual.exe&&/^\d+$/.test(actual.startTicks),'OFFLINE_IDENTITY_UNKNOWN');assert.equal(sameProcess(actual,id),false);}
const jobs=[];for(const runId of runIds){assert.match(runId,/^[a-f0-9-]{36}$/);const state=await startupJobsState(runId);assert.ok(Object.values(state).every(n=>n===0));jobs.push({runId,...state});}
const inventory=await runtimeProcessInventory({roots:[root],runIds:[...runIds],mode:'production-simulation'});assert.equal(inventory.complete,true);
// Only the native-identified parent that actually invoked this metadata child
// is excluded. No other matching process, including another installer, is ignored.
assert.equal(inventory.matchingProcesses.filter(p=>!sameProcess(p,parent)).length,0);
// Bind topology to this fixed fixture rather than the potentially interrupted
// profile being restored. A truncated profile must not require its Manager.
for(const p of [17876,17877,18766])await assertPortUnused(p);
console.log(JSON.stringify({quiescent:true,identities:ids.size,jobs,inventoryComplete:true,controller:parent}));
