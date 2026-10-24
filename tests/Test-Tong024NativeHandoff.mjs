import assert from 'node:assert/strict';
import {writeFile,readFile,readdir,lstat,rename,access,symlink,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {processIdentity,terminateOwnedProcess} from '../scripts/TongRuntimeSecurity.mjs';
import {productionProfileDigest} from '../scripts/TongProductionProfile.mjs';
const api = await import('../scripts/Tong024Handoff.mjs').catch(() => ({}));
assert.equal(typeof api.open024Handoff, 'function', 'cross-process native handoff is required');
assert.equal(typeof api.borrow024Handoff, 'function', 'native caller verification is required');
const {root,profile}=await loginFixture();
await assert.rejects(api.open024Handoff({mode:'production'}),/MAINTENANCE_NOT_READY/);
await assert.rejects(api.recover024Freeze({mode:'production'},{}),/MAINTENANCE_NOT_READY/);
const gate=join(root,'run/backup.freeze'), original=Buffer.alloc(0),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await writeFile(gate,original,{flag:'wx'});
const moduleUrl=new URL('../scripts/Tong024Handoff.mjs',import.meta.url).href;
function makeWorker(p){return `import {borrow024Handoff} from ${JSON.stringify(moduleUrl)};import {writeFile,access} from 'node:fs/promises';import{spawn}from'node:child_process';import {join}from'node:path';const profile=${JSON.stringify(p)};const i=process.argv.indexOf('--handoff-id');const held=await borrow024Handoff(profile.root,{profile,sessionId:process.argv[i+1],action:'probe'});const other=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(`import{borrow024Handoff}from${JSON.stringify(moduleUrl)};try{await borrow024Handoff(${JSON.stringify(p.root)},{profile:${JSON.stringify(p)},sessionId:process.argv[1],action:'probe'});process.exitCode=3;}catch(e){process.exitCode=e.message==='HANDOFF_CALLER_DENIED'?0:4;}`)},process.argv[i+1]],{windowsHide:true,stdio:'ignore'});if(await new Promise(ok=>other.once('close',ok))!==0)throw Error('DESCENDANT_WAS_AUTHORIZED');await writeFile(join(profile.root,'probe-'+process.pid+'.json'),JSON.stringify({...held.proof,descendantDenied:true}),{flag:'wx'});await held.close();try{await access(join(profile.root,'probe-hold'));setInterval(()=>{},1000);}catch{}`;}
const worker=makeWorker(profile);
await writeFile(join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs'),worker);
let lease;
try{
 lease=await api.open024Handoff(profile,{expectedSha256:sha(original)});
 console.log(JSON.stringify({event:'native_hold',root,proof:lease.proof}));
 await assert.rejects(rename(gate,join(root,'must-not-rename')));
 await assert.rejects(api.borrow024Handoff(root,{profile,sessionId:lease.sessionId,action:'probe'}),/HANDOFF_CALLER_DENIED/);
 const attempt=spawn(process.execPath,['--input-type=module','-e',`import{open}from'node:fs/promises';try{await open(${JSON.stringify(gate)},'wx');process.exitCode=3;}catch(e){process.exitCode=e.code==='EEXIST'?0:4;}`],{windowsHide:true,stdio:'ignore'});
 assert.equal(await new Promise(ok=>attempt.once('close',ok)),0);
 await lease.launch('probe');
 let native;for(let n=0;n<60;n++){native=await lease.prove();if(native.exited)break;await new Promise(ok=>setTimeout(ok,100));}
 assert.equal(native.exited,true);assert.equal(native.exitCode,0,JSON.stringify(lease.diagnostics()));
 const files=(await readdir(root)).filter(name=>/^probe-\d+\.json$/.test(name));assert.equal(files.length,1);
 const proof=JSON.parse(await readFile(join(root,files[0]),'utf8'));assert.equal(proof.verified,true);assert.equal(proof.jobName,'Local\\Tong024Handoff-'+lease.sessionId);
 await lease.restoreFreeze();lease=null;
 assert.deepEqual(await readFile(gate),original);assert.equal((await lstat(gate)).size,0);
 console.log(JSON.stringify({passed:true,root,primitiveOnly:true,unrelatedCallerDenied:true,ordinaryWxDenied:true,nativeAuthorizedChild:true,descendantDenied:proof.descendantDenied,originalFreezeRestored:true}));
}finally{if(lease)await lease.close();}

async function waitFile(path){for(let n=0;n<100;n++){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(ok=>setTimeout(ok,100));}throw Error('NATIVE_PROBE_TIMEOUT');}
async function inspect(r,sessionId){const child=spawn(join(process.env.ProgramFiles,'PowerShell/7/pwsh.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',new URL('../scripts/Tong024Handoff.ps1',import.meta.url).pathname.slice(1),'-Mode','inspect'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(JSON.stringify({root:r,sessionId})+'\n');assert.equal(await new Promise(ok=>child.once('close',ok)),0,err);return JSON.parse(out);}
// Abrupt native holder death: kernel Job cleanup, persistent refusal, no reuse.
await writeFile(join(root,'probe-hold'),'hold',{flag:'wx'});
lease=await api.open024Handoff(profile,{expectedSha256:sha(original)});
const launched=await lease.launch('probe');await waitFile(join(root,'probe-'+launched.client.pid+'.json'));
// Exercise the raw native API, not the JS wrapper's hard-coded process.pid.
for(const role of ['manager','launcher','unknown']){
 const raw=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',new URL('../scripts/Tong024Handoff.ps1',import.meta.url).pathname.slice(1),'-Mode','proof'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';raw.stdout.resume();raw.stderr.on('data',b=>stderr+=b);
 raw.stdin.end(JSON.stringify({root,sessionId:lease.sessionId,profileDigest:productionProfileDigest(profile),pid:launched.client.pid,role,action:'probe'})+'\n');
 assert.equal(await new Promise(ok=>raw.once('close',ok)),2);assert.equal(JSON.parse(stderr).error,'HANDOFF_CALLER_DENIED');
}
console.log(JSON.stringify({passed:true,phase:'raw-pid-forgery',authorizedPid:launched.client.pid,rolesDenied:['manager','launcher','unknown'],root}));
assert.equal((await inspect(root,lease.sessionId)).active>0,true);
assert.equal((await terminateOwnedProcess(lease.proof.owner)).matched,true);
const holderExitCode=await lease.close();
assert.equal((await inspect(root,lease.sessionId)).active,0);
assert.equal(await processIdentity(launched.client.pid),null);
await assert.rejects(api.borrow024Handoff(root,{profile,sessionId:lease.sessionId,action:'probe'}),/HANDOFF_CALLER_DENIED/);
await assert.rejects(api.open024Handoff(profile,{expectedSha256:sha(await readFile(gate))}),/HANDOFF_RECOVERY_REQUIRED/);
await assert.rejects(api.recover024Freeze(profile,{sessionId:lease.sessionId,snapshotSha256:lease.proof.snapshotSha256,gateSha256:sha(await readFile(gate))}),/HANDOFF_RECOVERY_OWNER_PRESENT/);
console.log(JSON.stringify({passed:true,phase:'holder-crash',root,sessionId:lease.sessionId,holderExitCode,helperGone:true,clientGone:true,nativeJobActive:0,gateRetained:true,independentRecoveryRequired:true}));lease=null;

// Abrupt controller death: EOF must close the native holder and its Job.
const next=await loginFixture();await writeFile(join(next.root,'run/backup.freeze'),'');await writeFile(join(next.root,'probe-hold'),'hold');await writeFile(join(next.profile.managerRoot,'scripts/TongAgentDockRuntime.mjs'),makeWorker(next.profile));
const controller=spawn(process.execPath,['--input-type=module','-e',`import{open024Handoff}from${JSON.stringify(moduleUrl)};const lease=await open024Handoff(${JSON.stringify(next.profile)},{expectedSha256:${JSON.stringify(sha(original))}});const child=await lease.launch('probe');console.log(JSON.stringify({sessionId:lease.sessionId,owner:lease.proof.owner,client:child.client,folder:lease.proof.folder}));setInterval(()=>{},1000);`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',controllerError='';controller.stderr.on('data',b=>controllerError+=b);const controlClosed=new Promise(ok=>controller.once('close',ok));
const ready=new Promise((ok,reject)=>{controller.stdout.on('data',b=>{output+=b;if(output.includes('\n'))ok(JSON.parse(output.trim()));});controller.once('close',()=>reject(Error('CONTROLLER_REFUSED:'+controllerError)));});
const identities=await ready;await waitFile(join(next.root,'probe-'+identities.client.pid+'.json'));
controller.kill();const controllerCode=await controlClosed;
for(let n=0;n<50&&await processIdentity(identities.owner.pid);n++)await new Promise(ok=>setTimeout(ok,100));
assert.equal(await processIdentity(identities.owner.pid),null);assert.equal(await processIdentity(identities.client.pid),null);assert.equal((await inspect(next.root,identities.sessionId)).active,0);
assert.equal((await lstat(join(next.root,'run/backup.freeze'))).isFile(),true);
assert.ok((await lstat(join(identities.folder,'snapshot.json'))).isFile());
console.log(JSON.stringify({passed:true,phase:'controller-crash',root:next.root,sessionId:identities.sessionId,controllerCode,controllerSignal:controller.signalCode,nativeJobActive:0,gateRetained:true,snapshotLocatorRetained:true,primitiveOnly:true}));
const snapshotBefore=sha(await readFile(join(identities.folder,'snapshot.json')));
await writeFile(join(identities.folder,'gate-before-truncation.json'),await readFile(join(next.root,'run/backup.freeze')),{flag:'wx'});
// Kill the real native restorer at each flushed boundary, then resume using
// the same independent sealed snapshot. No synthetic success/failure booleans.
for(const boundary of ['recovery-prepared','freeze-written']){
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',new URL('../scripts/Tong024Handoff.ps1',import.meta.url).pathname.slice(1),'-Mode','recover'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let buffer='',reached=false,stderr='';child.stdin.on('error',()=>{});child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);if(event.phase===boundary){reached=true;child.kill();}else child.stdin.write('continue\n');}});
 child.stdin.write(JSON.stringify({root:next.root,mode:next.profile.mode,profileDigest:productionProfileDigest(next.profile),sessionId:identities.sessionId,snapshotSha256:snapshotBefore,gateSha256:sha(await readFile(join(next.root,'run/backup.freeze')))})+'\n');
 const code=await new Promise(ok=>child.once('close',ok));assert.equal(reached,true,stderr);assert.notEqual(code,0);console.log(JSON.stringify({passed:true,phase:'recovery-interrupt',boundary,code,signal:child.signalCode,root:next.root}));
}
const recovery=spawn(process.execPath,['--input-type=module','-e',`import{recover024Freeze}from${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await recover024Freeze(${JSON.stringify(next.profile)},{sessionId:${JSON.stringify(identities.sessionId)},snapshotSha256:${JSON.stringify(snapshotBefore)},gateSha256:${JSON.stringify(sha(await readFile(join(next.root,'run/backup.freeze'))))}})));`],{windowsHide:true,stdio:['ignore','pipe','pipe']});let recoveryOut='',recoveryErr='';recovery.stdout.on('data',b=>recoveryOut+=b);recovery.stderr.on('data',b=>recoveryErr+=b);
assert.equal(await new Promise(ok=>recovery.once('close',ok)),0,recoveryErr);assert.equal(JSON.parse(recoveryOut).phase,'freeze-restored');assert.deepEqual(await readFile(join(next.root,'run/backup.freeze')),original);
console.log(JSON.stringify({passed:true,phase:'independent-freeze-recovery',root:next.root,sessionId:identities.sessionId,workerCode:0,originalFreezeSha256:sha(original),primitiveOnly:true}));
const alias='D:\\Tong\\state\\b23-path-link-'+randomUUID();await symlink(next.root,alias,'junction');
for(const mode of ['host','recover']){
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',new URL('../scripts/Tong024Handoff.ps1',import.meta.url).pathname.slice(1),'-Mode',mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stdout.resume();child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify({mode:'production-simulation',root:alias,sessionId:identities.sessionId,managerRoot:join(alias,'releases/manager'),nodeExe:process.execPath})+'\n');assert.equal(await new Promise(ok=>child.once('close',ok)),2);assert.equal(JSON.parse(stderr).error,'HANDOFF_PATH_DENIED');
}
assert.deepEqual(await readFile(join(next.root,'run/backup.freeze')),original);console.log(JSON.stringify({passed:true,phase:'raw-native-reparse-denied',modes:['host','recover'],alias,target:next.root,gateUnchanged:true}));
await writeFile(join(next.root,'run/backup.freeze'),'{"kind":');
await assert.rejects(api.borrow024Handoff(next.root,{profile:next.profile,sessionId:identities.sessionId,action:'probe'}),/HANDOFF_CALLER_DENIED/);
await assert.rejects(api.open024Handoff(next.profile,{expectedSha256:sha(await readFile(join(next.root,'run/backup.freeze')))}),/HANDOFF_RECOVERY_REQUIRED/);
assert.equal(sha(await readFile(join(identities.folder,'snapshot.json'))),snapshotBefore);
console.log(JSON.stringify({passed:true,phase:'truncated-gate',root:next.root,rejected:true,separateSnapshotUnchanged:true}));
const linked=await loginFixture(),redirect=join(linked.root,'redirected-snapshots');await mkdir(redirect);await writeFile(join(linked.root,'run/backup.freeze'),'');await symlink(redirect,join(linked.root,'024-handoff'),'junction');
await assert.rejects(api.open024Handoff(linked.profile,{expectedSha256:sha(original)}),/HANDOFF_PATH_DENIED/);
const direct=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',new URL('../scripts/Tong024Handoff.ps1',import.meta.url).pathname.slice(1),'-Mode','host'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let directError='';direct.stdout.resume();direct.stderr.on('data',b=>directError+=b);direct.stdin.end(JSON.stringify({mode:'production-simulation',root:linked.root,sessionId:randomUUID(),managerRoot:linked.profile.managerRoot,nodeExe:process.execPath,controller:await processIdentity(process.pid),expectedSha256:sha(original),profileDigest:productionProfileDigest(linked.profile),releaseDigest:linked.profile.releaseDigest})+'\n');assert.equal(await new Promise(ok=>direct.once('close',ok)),2);assert.equal(JSON.parse(directError).error,'HANDOFF_PATH_DENIED');assert.deepEqual(await readdir(redirect),[]);assert.deepEqual(await readFile(join(linked.root,'run/backup.freeze')),original);console.log(JSON.stringify({passed:true,phase:'session-junction-denied',root:linked.root,rawHostDenied:true,wrapperDenied:true,redirectUnwritten:true}));
