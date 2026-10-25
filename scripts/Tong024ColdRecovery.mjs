import {spawn} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateProductionProfile,productionProfileDigest,verifyRuntimeApproval} from './TongProductionProfile.mjs';
import {assertProtectedPaths} from './TongRuntimeSecurity.mjs';

const helper=fileURLToPath(new URL('Tong024ColdRecovery.ps1',import.meta.url));
const fail=code=>new Error(code);
// An offline gate repair only; never stops/adopts a running tree or installs files.
// Both this entry and the native helper independently reject production.
export async function recover024ColdFreeze(input,{sessionId,snapshotSha256,gateSha256,onCheckpoint}={}){
 if(input?.mode!=='production-simulation')throw fail('MAINTENANCE_NOT_READY');
 const profile=validateProductionProfile(input),root=profile.root;
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(sessionId??'')||![snapshotSha256,gateSha256].every(s=>/^[a-f0-9]{64}$/.test(s??''))||onCheckpoint!==undefined&&typeof onCheckpoint!=='function')throw fail('HANDOFF_BINDING_DENIED');
 const folder=join(root,'024-handoff',sessionId);
 for(const path of [root,join(root,'run'),folder,join(folder,'snapshot.json'),join(folder,'original.freeze')]){
  const st=await lstat(path);if(st.isSymbolicLink()||st.isFile()&&st.nlink!==1||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())throw fail('HANDOFF_PATH_DENIED');
 }
 await assertProtectedPaths([root,join(root,'run'),folder]);
 const env={...process.env};delete env.PSMODULEPATH;
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',helper],{windowsHide:true,env,stdio:['pipe','pipe','pipe']});
 let buffer='',stderr='',proof,error,chain=Promise.resolve();child.stdin.on('error',()=>{});
 child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill();});
 child.stdout.on('data',b=>{buffer+=b;if(buffer.length>65536){child.kill();return;}let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);chain=chain.then(async()=>{const value=JSON.parse(line);if(value.checkpoint){if(onCheckpoint)await onCheckpoint(value);child.stdin.write('continue\n');}else proof=value;}).catch(e=>{error=e;child.kill();});}});
 child.stdin.write(JSON.stringify({root,mode:profile.mode,profile,profileDigest:productionProfileDigest(profile),sessionId,snapshotSha256,gateSha256})+'\n');
 const timer=setTimeout(()=>child.kill(),45000);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);await chain;
 if(error)throw error;
 if(code!==0){let detail;try{detail=JSON.parse(stderr);}catch{}const error=fail(/^HANDOFF_[A-Z_]+$/.test(detail?.error??'')?detail.error:'HANDOFF_NATIVE_REFUSED');error.evidence=detail;throw error;}
 if(proof?.sessionId!==sessionId||!['cold-restored','already-restored'].includes(proof.phase))throw fail('HANDOFF_NATIVE_REFUSED');return proof;
}
// Native DPAPI approval is verified in a fresh process. No receipt/token output.
 if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]==='--authorize'){
 const timeout=setTimeout(()=>process.exit(2),15000);timeout.unref();
 try{const chunks=[];for await(const b of process.stdin)chunks.push(b);const profile=validateProductionProfile(JSON.parse(Buffer.concat(chunks)));
  if(profile.mode!=='production-simulation')throw fail('MAINTENANCE_NOT_READY');await verifyRuntimeApproval(profile,'restore');console.log(JSON.stringify({root:profile.root,profileDigest:productionProfileDigest(profile),action:'restore',verified:true}));
 }catch{process.exitCode=2;}finally{clearTimeout(timeout);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]==='--recover'){
 try{const chunks=[];for await(const b of process.stdin)chunks.push(b);const {profile,...binding}=JSON.parse(Buffer.concat(chunks));console.log(JSON.stringify({workerPid:process.pid,...await recover024ColdFreeze(profile,binding)}));}
 catch(error){console.error(JSON.stringify({error:error.message,evidence:error.evidence}));process.exitCode=2;}
}
