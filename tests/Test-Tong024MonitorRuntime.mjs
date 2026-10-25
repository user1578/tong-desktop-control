import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {startupJobsState,processIdentity,sameProcess,runtimeProcessInventory} from '../scripts/TongRuntimeSecurity.mjs';
const root=process.env.TONG_024_MONITOR_ROOT;assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
const json=async p=>JSON.parse(await readFile(p,'utf8')),profile=await json(join(root,'profile.json'));
assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,root);
const pin=await verifyRuntimeCandidate(profile);assert.equal(pin.commit,process.env.TONG_024_MONITOR_CANDIDATE??'90e3bc872989e63a6efe5bcef214e0489d54e052');
assert.equal((await verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,pin.commit);
const runtime=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs'))),login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));
const action=process.argv[2];
if(action==='prepare'){
 const r=await json(join(root,'run/runtime.json')),g=await json(join(root,'run/guardian.json'));assert.equal(r.phase,'stopped');
 assert.ok(Object.values(await startupJobsState(r.runId)).every(n=>n===0));
 for(const expected of [g,r.supervisor,...r.children,...r.descendants])assert.equal(sameProcess(await processIdentity(expected.pid),expected),false);
 const inventory=await runtimeProcessInventory({roots:[root],runIds:[r.runId],mode:profile.mode});assert.equal(inventory.complete,true);assert.equal(inventory.matchingProcesses.length,0);
 const gate=join(root,'run/backup.freeze');let archived=null;
 try{assert.equal((await readFile(gate)).length,0);archived=join(root,'024-handoff','monitor-before-'+randomUUID()+'.freeze');await rename(gate,archived);}catch(error){if(error.code!=='ENOENT')throw error;}
 await login.issueSimulationLoginRecovery(profile);
 console.log(JSON.stringify({root,commit:pin.commit,priorStoppedRunId:r.runId,archivedGate:archived,runnerSource:join(profile.managerRoot,'scripts/TongLoginRuntime.ps1')}));
}else if(action==='stop'){
 const status=await runtime.runtimeStatus(root);
 if(status.supervisorAlive){assert.equal(status.phase,'ready');await login.withLoginRecovery(root,'stop-run',()=>runtime.stopRuntime(root,{expectedRunId:status.runId}));}
 const after=await runtime.runtimeStatus(root);assert.equal(after.supervisorAlive,false);assert.ok(Object.values(await startupJobsState(after.runId)).every(n=>n===0));
 console.log(JSON.stringify({stopped:true,runId:after.runId,phase:after.phase}));
}else if(action==='revoke'){await login.revokeSimulationLoginRecovery(root);console.log(JSON.stringify({revoked:true}));}
else if(action==='status'){const s=await runtime.runtimeStatus(root),health=await login.withLoginRecovery(root,'doctor',()=>runtime.runtimeDoctor(root)),after=await runtime.runtimeStatus(root);assert.equal(after.runId,s.runId);assert.equal(sameProcess(after.supervisor,s.supervisor),true);console.log(JSON.stringify({phase:after.phase,runId:after.runId,supervisorAlive:after.supervisorAlive,guardianAlive:after.guardianAlive,healthy:health.healthy}));}
else throw Error('ISOLATION_ACTION_DENIED');
