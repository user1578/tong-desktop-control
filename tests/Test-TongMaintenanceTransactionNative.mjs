import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { maintenanceNativeFixture,rebindMaintenanceNativeFixture } from './fixtures/TongMaintenanceNativeFixture.mjs';
import { processIdentity } from '../scripts/TongRuntimeSecurity.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let fx=process.env.TONG_MAINTENANCE_TEST_ROOT?JSON.parse(await readFile(join(process.env.TONG_MAINTENANCE_TEST_ROOT,'maintenance-native-fixture.json'),'utf8')):await maintenanceNativeFixture(process.env.TONG_MAINTENANCE_TEST_COMMIT);
if(process.env.TONG_MAINTENANCE_REBIND_COMMIT)fx=await rebindMaintenanceNativeFixture(fx.root,process.env.TONG_MAINTENANCE_REBIND_COMMIT);
assert.match(fx.root,/^D:\\Tong\\state\\b23-maint-native-[a-f0-9]{32}$/);
const evidence=join(fx.root,'transaction-native-evidence');await mkdir(evidence,{recursive:true});
const worker=fileURLToPath(new URL('./fixtures/TongMaintenanceTransactionWorker.mjs',import.meta.url));
async function command(label,action,id,fault){
 label=(process.env.TONG_MAINTENANCE_TEST_LABEL_PREFIX??'')+label;
 const env={...process.env,TONG_MAINTENANCE_TEST_ROOT:fx.root};delete env.PSMODULEPATH;delete env.TONG_MAINTENANCE_TEST_FAULT;if(fault)env.TONG_MAINTENANCE_TEST_FAULT=fault;
 const began=Date.now(),child=spawn(process.execPath,[worker,action,...(id?[id]:[])],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;process.stdout.write(data);});child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});
 const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});
 await writeFile(join(evidence,label+'.stdout.txt'),stdout,{flag:'wx'});await writeFile(join(evidence,label+'.stderr.txt'),stderr,{flag:'wx'});
 const result={label,code,signal:child.signalCode,durationMs:Date.now()-began,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};
 await writeFile(join(evidence,label+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
 const exitEvent=stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse).find(event=>event.event==='injected_process_exit');
 if(exitEvent){const deadline=Date.now()+10000;while(await processIdentity(exitEvent.leaseHolderPid)){assert.ok(Date.now()<deadline,'lease helper must close after controller exit');await new Promise(ok=>setTimeout(ok,100));}}
 return {code,stdout,stderr};
}
const state=()=>readFile(join(fx.root,'logs','maintenance-transaction.json'),'utf8').then(JSON.parse);
async function retain(id,label){const latest=await state();assert.equal(latest.phase,'rolled-back');assert.equal(latest.transactionId,id);await rename(join(fx.root,'logs','maintenance-transaction.json'),join(evidence,label+'.transaction.json'));}
if(process.env.TONG_MAINTENANCE_TEST_RETAIN){assert.match(process.env.TONG_MAINTENANCE_TEST_RETAIN,/^[a-z0-9-]+$/);const tx=await state();await retain(tx.transactionId,process.env.TONG_MAINTENANCE_TEST_RETAIN);}
const cases=process.env.TONG_MAINTENANCE_TEST_CASES!==undefined?process.env.TONG_MAINTENANCE_TEST_CASES.split(',').filter(Boolean):['write-installed','app-files','manager-files','app-pin','manager-pin','profile','permissions','controls','starting','started'];
for(const fault of cases){
 const result=await command(fault+'-interrupt','run',null,fault);assert.equal(result.code,71,result.stderr);
 const tx=await state();const rollback=await command(fault+'-rollback','rollback',tx.transactionId);assert.equal(rollback.code,0,rollback.stderr);assert.equal((await state()).phase,'rolled-back');
 await retain(tx.transactionId,fault);console.log(JSON.stringify({event:'native_stage_rollback_verified',fault,transactionId:tx.transactionId}));
}
if(!process.env.TONG_MAINTENANCE_TEST_CASES||process.env.TONG_MAINTENANCE_TEST_SUCCESS==='1'){
 const success=await command('success','run');assert.equal(success.code,0,success.stderr);const tx=await state();assert.equal(tx.phase,'accepted');
 const stopped=await command('success-stop','stop',tx.transactionId);assert.equal(stopped.code,0,stopped.stderr);
 const rollback=await command('success-rollback','rollback',tx.transactionId);assert.equal(rollback.code,0,rollback.stderr);await retain(tx.transactionId,'success');
 console.log(JSON.stringify({passed:true,root:fx.root,evidence,stages:cases,nativeStateBackup:true,fullVersionSnapshot:true,independentProcessRollback:true,nativeStartDoctorStop:true,productionExecutionAllowed:false}));
}
