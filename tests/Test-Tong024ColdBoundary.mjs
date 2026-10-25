import assert from 'node:assert/strict';
import {readFile,writeFile,rename,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {open024Handoff,recover024Freeze} from '../scripts/Tong024Handoff.mjs';
import {recover024ColdFreeze} from '../scripts/Tong024ColdRecovery.mjs';
import {processIdentity,terminateOwnedProcess} from '../scripts/TongRuntimeSecurity.mjs';
import {validateProductionProfile,issueSimulationApproval} from '../scripts/TongProductionProfile.mjs';

const script=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
async function stdin(){const chunks=[];for await(const b of process.stdin)chunks.push(b);return JSON.parse(Buffer.concat(chunks));}
if(process.argv[2]==='--owner'){
 const {profile,crash}=await stdin();const lease=await open024Handoff(profile,{expectedSha256:sha('')});
 if(crash){console.log(JSON.stringify(lease.proof));process.exit(71);}
 await lease.close();console.log(JSON.stringify(lease.proof));setInterval(()=>{},1000);
}else{
 const root=process.env.TONG_024_COLD_ROOT;assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
 const profile=validateProductionProfile(await json(join(root,'profile.json'))),gate=join(root,'run/backup.freeze');
 const previous=process.env.TONG_024_COLD_PREVIOUS;assert.match(previous??'',/^[a-f0-9-]{36}$/);
 const priorFolder=join(root,'024-handoff',previous),prior={sessionId:previous,snapshotSha256:sha(await readFile(join(priorFolder,'snapshot.json'))),gateSha256:sha('')};
 await issueSimulationApproval(profile,'restore',{expiresAt:new Date(Date.now()+1200000).toISOString()});
 assert.equal((await recover024ColdFreeze(profile,prior)).phase,'already-restored');
 function owner(crash){
  const child=spawn(process.execPath,[script,'--owner'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stderr.on('data',b=>err+=b);
  const closed=new Promise(ok=>child.once('close',ok));
  const proof=new Promise((ok,reject)=>{child.stdout.on('data',b=>{out+=b;if(out.includes('\n')){try{ok(JSON.parse(out.split('\n')[0]));}catch(e){reject(e);}}});child.once('close',code=>{if(!out)reject(Error('OWNER_FAILED:'+code+':'+err));});});
  child.stdin.end(JSON.stringify({profile,crash}));return {child,closed,proof};
 }
 const next=owner(false),nextProof=await next.proof,nextIdentity=await processIdentity(next.child.pid);
 await assert.rejects(recover024ColdFreeze(profile,{...prior,gateSha256:sha(await readFile(gate))}),/HANDOFF_SESSION_REPLAY/);
 await terminateOwnedProcess(nextIdentity);await next.closed;
 await recover024Freeze(profile,{sessionId:nextProof.sessionId,snapshotSha256:nextProof.snapshotSha256,gateSha256:sha(await readFile(gate))});
 assert.equal((await recover024ColdFreeze(profile,prior)).phase,'already-restored');
 const crashing=owner(true),proof=await crashing.proof;assert.equal(await crashing.closed,71);
 for(let n=0;n<100&&await processIdentity(proof.owner.pid);n++)await new Promise(ok=>setTimeout(ok,100));assert.equal(await processIdentity(proof.owner.pid),null);
 const folder=proof.folder,damage=Buffer.from('incomplete-native-gate-boundary');
 await writeFile(join(folder,'gate.before-damage.json'),await readFile(gate),{flag:'wx'});await writeFile(gate,damage);
 const binding={sessionId:proof.sessionId,snapshotSha256:proof.snapshotSha256,gateSha256:sha(damage)};
 const occupied=createServer();await new Promise((ok,reject)=>{occupied.once('error',reject);occupied.listen(profile.gatewayPort,'127.0.0.1',ok);});
 try{await assert.rejects(recover024ColdFreeze(profile,binding),/HANDOFF_PORT_BUSY/);}finally{await new Promise(ok=>occupied.close(ok));}
 await assert.rejects(recover024ColdFreeze(profile,{...binding,onCheckpoint:async e=>{if(e.checkpoint==='cold-sealed'){await issueSimulationApproval(profile,'restore',{expiresAt:new Date(Date.now()+5000).toISOString()});await new Promise(ok=>setTimeout(ok,5500));}}}),/HANDOFF_AUTH_OR_HEALTH_UNPROVEN/);
 assert.equal(sha(await readFile(gate)),sha(damage));await issueSimulationApproval(profile,'restore',{expiresAt:new Date(Date.now()+1200000).toISOString()});
 const prevented=[];
 await assert.rejects(recover024ColdFreeze(profile,{...binding,onCheckpoint:async e=>{
  if(e.checkpoint!=='cold-sealed')return;
  const cold=(await readdir(folder)).filter(n=>n.startsWith('cold-'));const latest=(await Promise.all(cold.map(async n=>({n,at:(await stat(join(folder,n))).birthtimeMs})))).sort((a,b)=>b.at-a.at)[0].n;
  for(const target of [join(folder,'snapshot.json'),join(folder,'original.freeze'),join(folder,latest,'gate.original.bytes'),join(folder,latest,'approval.json')]){
   const before=await readFile(target);await assert.rejects(writeFile(target,'tamper'));assert.equal(sha(await readFile(target)),sha(before));
   await assert.rejects(rename(target,target+'.moved'));prevented.push(target);
  }
  await terminateOwnedProcess(e.worker);
 }}),/HANDOFF_NATIVE_REFUSED/);
 assert.equal(sha(await readFile(gate)),sha(damage));assert.equal(prevented.length,4);
 await assert.rejects(recover024ColdFreeze(profile,{...binding,onCheckpoint:async e=>{if(e.checkpoint==='cold-written')await terminateOwnedProcess(e.worker);}}),/HANDOFF_NATIVE_REFUSED/);
 assert.equal(sha(await readFile(gate)),sha(''));
 const worker=spawn(process.execPath,[fileURLToPath(new URL('../scripts/Tong024ColdRecovery.mjs',import.meta.url)),'--recover'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';worker.stdout.on('data',b=>out+=b);worker.stderr.on('data',b=>err+=b);const workerExit=new Promise(ok=>worker.once('close',ok));worker.stdin.end(JSON.stringify({profile,...binding,gateSha256:sha('')}));assert.equal(await workerExit,0,err);
 const restored=JSON.parse(out);assert.equal(restored.phase,'cold-restored');assert.equal(restored.workerPid,worker.pid);assert.notEqual(worker.pid,process.pid);
 const rawEvidence=[];for(const entry of await readdir(folder)){if(entry.startsWith('cold-')){const path=join(folder,entry,'gate.original.bytes');if(sha(await readFile(path))===sha(damage))rawEvidence.push(path);}}
 assert.equal(rawEvidence.length,3);
 const receiptPath=join(folder,'restored.json'),receipt=await readFile(receiptPath);await writeFile(join(folder,'restored.before-tamper.json'),receipt,{flag:'wx'});await writeFile(receiptPath,'{');
 await assert.rejects(recover024ColdFreeze(profile,{...binding,gateSha256:sha('')}),/HANDOFF_NATIVE_REFUSED/);assert.equal(sha(await readFile(gate)),sha(''));await writeFile(receiptPath,receipt);
 assert.equal((await recover024ColdFreeze(profile,{...binding,gateSha256:sha('')})).phase,'already-restored');
 const result={passed:true,root,sessionId:proof.sessionId,oldSessionReplayDenied:true,liveSuccessorControllerDenied:true,nativeListenerDenied:true,authorizationExpiredAfterSealDenied:true,sealedFilesWriteAndRenameDenied:prevented.length*2,coldSealedWorkerKilled:true,coldWrittenWorkerKilled:true,independentNodeWorker:restored.workerPid,rawDamageEvidence:rawEvidence,truncatedReceiptDenied:true,originalFileKey:proof.fileKey,productionExecutionAllowed:false};
 await writeFile(join(folder,'cold-boundary-acceptance.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}
