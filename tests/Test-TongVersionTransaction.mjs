import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
let api;
try { api=await import('../scripts/TongMaintenanceTransaction.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
assert.equal(typeof api?.runMaintenanceTransaction,'function','a persistent source/native/profile/pin transaction is required');
assert.equal(typeof api?.resumeMaintenanceTransaction,'function');
// Install the filesystem tripwire before importing any production entry. A
// missing future gate cannot turn this regression into real production I/O.
const worker=`import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {registerHooks} from 'node:module';const source=Object.keys(fs).filter(n=>n!=='default').map(n=>'export const '+n+'=()=>{throw Error("PRODUCTION_IO_ATTEMPT")};').join('');registerHooks({resolve(s,c,next){return s==='node:fs/promises'?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});const api=await import(${JSON.stringify(new URL('../scripts/TongMaintenanceTransaction.mjs',import.meta.url).href)});const {createProductionProfile}=await import(${JSON.stringify(new URL('../scripts/TongProductionProfile.mjs',import.meta.url).href)});const profile=createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64)});await assert.rejects(api.runMaintenanceTransaction({baselineProfile:profile,candidateProfile:profile}),/MAINTENANCE_NOT_READY/);await assert.rejects(api.resumeMaintenanceTransaction(profile,{}),/MAINTENANCE_NOT_READY/);`;
const result=spawnSync(process.execPath,['--input-type=module','-e',worker],{windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
console.log(JSON.stringify({passed:true,productionDeniedBeforeIO:true}));
