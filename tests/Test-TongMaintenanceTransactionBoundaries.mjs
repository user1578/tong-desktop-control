import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {processIdentity,terminateOwnedProcess,sameProcess} from '../scripts/TongRuntimeSecurity.mjs';
import {withMaintenanceFreeze} from '../scripts/TongLifecycleFreeze.mjs';
import {restoreProductionStateBackup} from '../scripts/TongProductionState.mjs';
const root=process.env.TONG_MAINTENANCE_TEST_ROOT;
assert.match(root??'',/^D:\\Tong\\state\\b23-maint-native-[a-f0-9]{32}$/);
const fx=JSON.parse(await readFile(join(root,'maintenance-native-fixture.json'),'utf8')),evidence=join(root,'transaction-native-evidence');
const prefix=process.env.TONG_MAINTENANCE_TEST_LABEL_PREFIX??'';assert.match(prefix,/^[a-z0-9-]*$/);
const worker=fileURLToPath(new URL('./fixtures/TongMaintenanceTransactionWorker.mjs',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function command(label,action,id,fault){
 label=prefix+label;
 const env={...process.env};delete env.PSMODULEPATH;delete env.TONG_MAINTENANCE_TEST_FAULT;if(fault)env.TONG_MAINTENANCE_TEST_FAULT=fault;
 const began=Date.now(),child=spawn(process.execPath,[worker,action,...(id?[id]:[])],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',bytes=>{stdout+=bytes;process.stdout.write(bytes);});child.stderr.on('data',bytes=>{stderr+=bytes;process.stderr.write(bytes);});
 const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});
 await writeFile(join(evidence,label+'.stdout.txt'),stdout,{flag:'wx'});await writeFile(join(evidence,label+'.stderr.txt'),stderr,{flag:'wx'});
 const result={label,code,signal:child.signalCode,durationMs:Date.now()-began,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};await writeFile(join(evidence,label+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
 const injected=stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse).find(event=>event.event==='injected_process_exit');
 if(injected){const deadline=Date.now()+10000;while(await processIdentity(injected.leaseHolderPid)){assert.ok(Date.now()<deadline);await new Promise(ok=>setTimeout(ok,100));}}
 return {code,stdout,stderr};
}
const state=()=>readFile(join(root,'logs','maintenance-transaction.json'),'utf8').then(JSON.parse);
async function retain(label){const tx=await state();assert.equal(tx.phase,'rolled-back');await rename(join(root,'logs','maintenance-transaction.json'),join(evidence,prefix+label+'.transaction.json'));return tx;}
let tx;
if(process.env.TONG_MAINTENANCE_BOUNDARY_RESUME!=='1'){
if(process.env.TONG_MAINTENANCE_BOUNDARY_RESUME!=='native-crash'){
// Real competing entry points must respect the same original freeze. After the
// controller exits, a new matching native process must prevent any restoration.
assert.equal((await command('boundary-race','run',null,'concurrent-lifecycle')).code,71);
tx=await state();const sleeper=spawn(process.execPath,['-e','setInterval(()=>{},1000)',root],{windowsHide:true,stdio:'ignore'});
let identity;
try{
 identity=await processIdentity(sleeper.pid);assert.ok(identity);
 const before=await readFile(join(root,'logs','maintenance-transaction.json'));
 const refused=await command('boundary-new-identity','rollback',tx.transactionId);assert.equal(refused.code,1);assert.match(refused.stderr,/MAINTENANCE_PROCESS_PRESENT/);
 assert.deepEqual(await readFile(join(root,'logs','maintenance-transaction.json')),before);
}finally{if(identity){await terminateOwnedProcess(identity);assert.equal(sameProcess(await processIdentity(identity.pid),identity),false);}}
// Interrupt between the two pin writes, introduce an independently recorded
// edit, and verify refusal leaves it intact. Reuse this same sealed snapshot.
assert.equal((await command('boundary-pin','apply',tx.transactionId,'app-pin')).code,71);tx=await state();
const snapshot=JSON.parse(await readFile(join(root,'maintenance-transactions',tx.transactionId,'snapshot.json'),'utf8'));
const path=snapshot.entries.find(entry=>entry.path.startsWith(fx.baselineProfile.codeRoot+'\\')&&entry.path.endsWith('.mjs')).path;
const before=await readFile(path),changed=Buffer.from('EXTERNAL_TEST_EDIT:'+randomUUID());await writeFile(path,changed);await writeFile(join(evidence,prefix+'boundary-external-edit.bin'),changed,{flag:'wx'});
const refused=await command('boundary-external','rollback',tx.transactionId);assert.equal(refused.code,1);assert.match(refused.stderr,/MAINTENANCE_EXTERNAL_CHANGE/);assert.deepEqual(await readFile(path),changed);
await writeFile(path,before);
}else{tx=await state();assert.equal(tx.phase,'controls');assert.equal(tx.candidateRunId,undefined);assert.equal(tx.startIntentAt,undefined);}
// The original snapshot binds a 1ms real startup budget. Re-entry completes the
// remaining install and records the native failure without another full copy.
const failed=await command('boundary-startup-failure','apply',tx.transactionId);assert.equal(failed.code,1);assert.match(failed.stderr,/START_TIMEOUT/);tx=await state();
assert.equal(tx.startFailure.cleanupProven,true);
assert.equal((await command('boundary-reverse-interrupt','rollback',tx.transactionId,'rollback-installed')).code,71);
const requestPath=join(root,'run','request.json'),replacement=Buffer.from(JSON.stringify({runId:randomUUID(),createdAt:new Date().toISOString(),testOnly:true}));
await writeFile(requestPath,replacement,{flag:'wx'});
const replaced=await command('boundary-replacement-request','rollback',tx.transactionId);assert.equal(replaced.code,1);assert.match(replaced.stderr,/MAINTENANCE_REPLACEMENT_RUN_PRESENT/);assert.deepEqual(await readFile(requestPath),replacement);
await rename(requestPath,join(evidence,prefix+'boundary-external-request.json'));
assert.equal((await command('boundary-reverse-resume','rollback',tx.transactionId)).code,0);
}else{tx=await state();assert.equal(tx.phase,'rolled-back');}
const restored=await withMaintenanceFreeze(fx.baselineProfile,{expectedSha256:sha(await readFile(join(root,'run','backup.freeze')))},()=>restoreProductionStateBackup(fx.baselineProfile,{backupRoot:tx.backupRoot,restoreRoot:join(root,'state-restore-'+tx.transactionId)}));
assert.equal(restored.encryptedBackup,true);assert.equal(restored.executionDisabled,true);
await writeFile(join(evidence,prefix+'boundary-dpapi-restore.json'),JSON.stringify(restored,null,2)+'\n',{flag:'wx'});await retain('boundary-startup');
console.log(JSON.stringify({passed:true,root,continuedAfterRepair:process.env.TONG_MAINTENANCE_BOUNDARY_RESUME==='1',continuedAfterNativeCrash:process.env.TONG_MAINTENANCE_BOUNDARY_RESUME==='native-crash',nativeConcurrentStartStopBackupDenied:true,newNativeIdentityRefused:true,externalEditPreserved:true,reverseCrashResumed:true,nativeStartupFailureRolledBack:true,nativeDpapiDecryptionVerified:true,productionExecutionAllowed:false}));
