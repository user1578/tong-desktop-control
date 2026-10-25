import assert from 'node:assert/strict';
import {readFile,writeFile,rename,lstat,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {validateProductionProfile,issueSimulationApproval} from '../scripts/TongProductionProfile.mjs';
import {processIdentity,sameProcess,startupJobsState,terminateOwnedProcess} from '../scripts/TongRuntimeSecurity.mjs';
import {recover024ColdFreeze as settle024Handoff} from '../scripts/Tong024ColdRecovery.mjs';

const root=process.env.TONG_024_COLD_ROOT;assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const profile=validateProductionProfile(await json(join(root,'profile.json')));
for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,'90e3bc872989e63a6efe5bcef214e0489d54e052');
const record=await json(join(root,'run/runtime.json')),guardian=await json(join(root,'run/guardian.json'));
assert.equal(record.phase,'stopped');assert.ok(Object.values(await startupJobsState(record.runId)).every(n=>n===0));
for(const expected of [guardian,record.supervisor,...record.children,...record.descendants])assert.equal(sameProcess(await processIdentity(expected.pid),expected),false);
const gate=join(root,'run/backup.freeze');let proof,folder; if(process.env.TONG_024_COLD_RESUME){folder=join(root,'024-handoff',process.env.TONG_024_COLD_RESUME);const snapshot=await json(join(folder,'snapshot.json'));proof={...snapshot.state,folder,snapshotSha256:sha(await readFile(join(folder,'snapshot.json')))};}else{await writeFile(gate,'',{flag:'wx'});
const moduleUrl=pathToFileURL(join(process.cwd(),'scripts/Tong024Handoff.mjs')).href;
const owner=spawn(process.execPath,['--input-type=module','-e',`import{open024Handoff}from${JSON.stringify(moduleUrl)};const lease=await open024Handoff(${JSON.stringify(profile)},{expectedSha256:${JSON.stringify(sha(''))}});console.log(JSON.stringify(lease.proof));process.exit(71);`],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';owner.stdout.on('data',b=>out+=b);owner.stderr.on('data',b=>err+=b);assert.equal(await new Promise(ok=>owner.once('close',ok)),71,err);
proof=JSON.parse(out);folder=proof.folder;
for(let n=0;n<100&&await processIdentity(proof.owner.pid);n++)await new Promise(ok=>setTimeout(ok,100));assert.equal(await processIdentity(proof.owner.pid),null);
await writeFile(join(folder,'gate.before-damage.json'),await readFile(gate),{flag:'wx'});}
const damage=Buffer.from('{"kind":"torn-gate","untrusted":"preserve all bytes');await writeFile(gate,damage);
const parameters={sessionId:proof.sessionId,snapshotSha256:proof.snapshotSha256,gateSha256:sha(damage),action:'cold'};
await assert.rejects(settle024Handoff(profile,{...parameters,snapshotSha256:'0'.repeat(64)}),/HANDOFF_SNAPSHOT_CHANGED/);
assert.equal(sha(await readFile(gate)),sha(damage));
await issueSimulationApproval(profile,'restore',{expiresAt:new Date(Date.now()+5000).toISOString()});await new Promise(ok=>setTimeout(ok,5500));let denied=false;try{await settle024Handoff(profile,parameters);}catch(error){assert.match(error.message,/HANDOFF_AUTH_OR_HEALTH_UNPROVEN/);denied=true;}
assert.equal(denied,true,'expired/missing historical restore approval must fail closed');assert.equal(sha(await readFile(gate)),sha(damage));
await issueSimulationApproval(profile,'restore',{expiresAt:new Date(Date.now()+1200000).toISOString()});
const sleeper=spawn(process.execPath,['-e','setInterval(()=>{},1000)',root],{windowsHide:true,stdio:'ignore'});const sleeperExited=new Promise(ok=>sleeper.once('close',ok));const identity=await processIdentity(sleeper.pid);
try{await assert.rejects(settle024Handoff(profile,parameters),/HANDOFF_FOREIGN_PROCESS_PRESENT/);assert.equal(sha(await readFile(gate)),sha(damage));}finally{await terminateOwnedProcess(identity);await sleeperExited;}
// Preserve both file objects. A byte-identical replacement is not the original.
const originalObject=join(folder,'gate.original-object'),replacement=join(folder,'gate.replacement-object');
await rename(gate,originalObject);await writeFile(gate,damage,{flag:'wx'});
await assert.rejects(settle024Handoff(profile,parameters),/HANDOFF_FILE_IDENTITY/);await rename(gate,replacement);await rename(originalObject,gate);
let settled;try{settled=await settle024Handoff(profile,parameters);}catch(error){console.error(JSON.stringify(error.evidence));throw error;}assert.equal(settled.phase,'cold-restored');assert.equal(settled.fileKey,proof.fileKey);assert.deepEqual(await readFile(gate),Buffer.alloc(0));
assert.deepEqual(await readFile(join(settled.evidence,'gate.original.bytes')),damage);
assert.equal((await json(join(settled.evidence,'approval.json'))).snapshotSha256,proof.snapshotSha256);
const outcome={passed:true,root,sessionId:proof.sessionId,folder,candidate:'90e3bc872989e63a6efe5bcef214e0489d54e052',coldEvidence:settled.evidence,gateFileKey:proof.fileKey,damagedBytesSha256:sha(damage),damagePreserved:true,snapshotMismatchDenied:true,nativeRestoreApprovalRequired:true,foreignNativeProcessDenied:true,replacementFileDenied:true,originalFreezeRestored:true,productionExecutionAllowed:false};
await writeFile(join(folder,'cold-acceptance.json'),JSON.stringify(outcome,null,2),{flag:'wx'});console.log(JSON.stringify(outcome));
