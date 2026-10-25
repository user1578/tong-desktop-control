// Only the existing fixed simulation. Installed version-2 code is unchanged.
import assert from 'node:assert/strict';
import {readFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const two='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';
const profile=JSON.parse(await readFile(join(root,'profile.json'),'utf8'));
assert.equal(profile.root,root);assert.equal(profile.mode,'production-simulation');
for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,two);
const runtime=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs')));
const login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));
const action=process.argv[2];
if(action==='reset-first-trial'||action==='reset-handoff-trial'){
 const exec=(exe,args,options)=>new Promise((resolve,reject)=>{const child=execFile(exe,args,options,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));child.stdin.end();});
 const controller=fileURLToPath(new URL('../scripts/TongStable1Offline.ps1',import.meta.url));
 const snapshot=join(root,'offline-9850e1a/isolation-52b84969-c847-4f78-9699-d57c5d46842a');
 // The existing external Host likewise uses a child-only private TEMP. Do not
 // let Add-Type use the restricted interactive user's global TEMP directory.
 const childEnv={...process.env,TEMP:join(root,'offline-9850e1a/state-only-024-f807148c-9d99-4c03-8cef-61cd9a1b6cd2/temp'),TMP:join(root,'offline-9850e1a/state-only-024-f807148c-9d99-4c03-8cef-61cd9a1b6cd2/temp')};
 await exec('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',controller,'-Mode','InspectIsolation','-Snapshot',snapshot],{windowsHide:true,timeout:90000,env:childEnv});
 const gate=join(root,'run/backup.freeze'),original=join(root,action==='reset-first-trial'?'offline-9850e1a/state-only-024-f807148c-9d99-4c03-8cef-61cd9a1b6cd2/gate-before-only-trial.freeze':'offline-9850e1a/state-only-024-5645db31-cf60-43df-881b-affad6c7573e/original/backup.freeze');
 await assert.rejects(stat(gate),{code:'ENOENT'});assert.equal((await stat(original,{bigint:true})).ino,(65536n<<32n)+3281504n);
 await rename(original,gate);
 const {stdout}=await exec('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',controller,'-Mode','RestoreIsolation','-Snapshot',snapshot,'-ExpectedSeal','b1d1921e283fb6d261718fe5c474ef0c41c0f0b19ba756fc52ec6571117e16da'],{windowsHide:true,timeout:120000,env:childEnv});
 const restored=JSON.parse(stdout);assert.equal(restored.allOriginalBytesVerified,true);console.log(JSON.stringify({reset:action,restored}));
}else if(action==='grant'){await login.issueSimulationLoginRecovery(profile);console.log(JSON.stringify({simulationGrantIssued:true}));}
else if(action==='revoke'){await login.revokeSimulationLoginRecovery(root);console.log(JSON.stringify({simulationGrantRevoked:true}));}
else if(action==='start'||action==='blocked-start'){
 let error;try{await login.withLoginRecovery(root,'start',()=>runtime.startRuntime(root));}catch(e){error=e;}
 if(action==='blocked-start'){assert.ok(error);assert.ok(['RUNTIME_BUSY','CLEANUP_REQUIRED'].includes(error.message));console.log(JSON.stringify({error:error.message}));}
 else{if(error)throw error;const state=await runtime.runtimeStatus(root);assert.equal(state.phase,'ready');console.log(JSON.stringify({phase:state.phase,runId:state.runId}));}
}else if(action==='status'){
 const state=await runtime.runtimeStatus(root),doctor=await login.withLoginRecovery(root,'doctor',()=>runtime.runtimeDoctor(root));
 console.log(JSON.stringify({phase:state.phase,runId:state.runId,healthy:doctor.healthy,supervisorAlive:state.supervisorAlive,guardianAlive:state.guardianAlive}));
}else if(action==='stop'){
 const before=await runtime.runtimeStatus(root);if(before.supervisorAlive)await login.withLoginRecovery(root,'stop-run',()=>runtime.stopRuntime(root,{expectedRunId:before.runId}));
 const after=await runtime.runtimeStatus(root);assert.equal(after.supervisorAlive,false);assert.ok(Object.values(await startupJobsState(after.runId)).every(n=>n===0));console.log(JSON.stringify({stopped:true,runId:after.runId,phase:after.phase}));
}else throw Error('FIXED_SIMULATION_ACTION_ONLY');
