import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const api=await import('../scripts/Tong024ColdRecovery.mjs');
assert.equal(typeof api.recover024ColdFreeze,'function','independent offline cold recovery entry required');
await assert.rejects(api.recover024ColdFreeze({mode:'production'},{}),/MAINTENANCE_NOT_READY/);
assert.equal((await import('../scripts/Tong024Handoff.mjs')).settle024Handoff,undefined,'unverified commit adoption is not delivered');
for(const [input,expected] of [[{root:'D:\\Tong\\runtime',mode:'production'},'MAINTENANCE_NOT_READY'],[{root:'D:\\Tong\\state\\b23-uncreated-cross-root-test',mode:'production-simulation',profile:{root:'D:\\Tong\\state\\b23-other-grant',mode:'production-simulation'}},'HANDOFF_BINDING_DENIED']]){
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/Tong024ColdRecovery.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);child.stdout.resume();const closed=new Promise(ok=>child.once('close',ok));child.stdin.end(JSON.stringify(input)+'\n');assert.equal(await closed,2);assert.equal(JSON.parse(err).error,expected);
}
console.log(JSON.stringify({passed:true,productionWriteGateClosed:true,directNativeProductionDenied:true,crossRootGrantDeniedBeforeIO:true}));
