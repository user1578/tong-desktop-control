import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {maintenanceNativeFixture} from './fixtures/TongMaintenanceNativeFixture.mjs';
import {processIdentity} from '../scripts/TongRuntimeSecurity.mjs';
import {runMaintenanceTransaction,resumeMaintenanceTransaction} from '../scripts/TongMaintenanceTransaction.mjs';
import {maintenanceFreeze} from '../scripts/TongLifecycleFreeze.mjs';

// Reuse only the existing sealed installer/restorer, never its startup path.
// Handoff/ready is tested separately by Test-Tong024HandoffRelease.mjs.
const [action,argument,stage]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
if(action==='install'||action==='rollback'){
 assert.match(argument??'',/^D:\\Tong\\state\\b23-maint-native-[a-f0-9]{32}$/);
 const fx=JSON.parse(await readFile(join(argument,'024-handoff-install-fixture.json'),'utf8'));
 assert.equal(fx.root,argument);assert.equal(fx.baselineProfile.mode,'production-simulation');
 const statePath=join(argument,'logs/maintenance-transaction.json');
 if(action==='install')await runMaintenanceTransaction(fx,{onCheckpoint:async event=>{if(event.name===stage){const proof=await maintenanceFreeze(argument).proof();console.log(JSON.stringify({event:'actual_install_interrupted',stage,transactionId:event.transactionId,holderPid:proof.holderPid}));process.exit(71);}}});
 else{const tx=JSON.parse(await readFile(statePath,'utf8'));const result=await resumeMaintenanceTransaction(fx.baselineProfile,{transactionId:tx.transactionId});assert.equal(result.verified,true);console.log(JSON.stringify({event:'independent_restore',workerPid:process.pid,...result}));}
}else{
 assert.equal(action,'run');
 const release=JSON.parse(await readFile(argument,'utf8'));
 process.env.TONG_MAINTENANCE_BASELINE_COMMIT='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';
 const fx=await maintenanceNativeFixture(release.candidate,{baselineReleaseRoot:'D:\\Tong\\state\\b23-maint-native-ab2ecf441a184dcaa798023010f3e70f\\baseline-release',candidateReleaseRoot:release.releaseRoot});
 await writeFile(join(fx.root,'024-handoff-install-fixture.json'),JSON.stringify(fx),{flag:'wx'});
 const evidence=join(fx.root,'024-install-rollback-evidence');await mkdir(evidence);
 const script=fileURLToPath(import.meta.url),results=[];
 async function worker(action,stage){const child=spawn(process.execPath,[script,action,fx.root,...(stage?[stage]:[])],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});const result={action,stage,code,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};const label=(stage??results.at(-1)?.stage)+'-'+action;await writeFile(join(evidence,label+'.stdout.log'),stdout,{flag:'wx'});await writeFile(join(evidence,label+'.stderr.log'),stderr,{flag:'wx'});results.push(result);console.log(JSON.stringify({...result,stdout,stderr}));return {code,events:stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)};}
 for(const stage of ['write-installed','app-files','manager-files','app-pin','manager-pin','profile','permissions','controls']){
  const interrupted=await worker('install',stage);assert.equal(interrupted.code,71);
  const event=interrupted.events.find(e=>e.event==='actual_install_interrupted');assert.ok(event);
  for(let n=0;n<100&&await processIdentity(event.holderPid);n++)await new Promise(ok=>setTimeout(ok,100));assert.equal(await processIdentity(event.holderPid),null);
  assert.equal((await worker('rollback')).code,0);
  const path=join(fx.root,'logs/maintenance-transaction.json'),tx=JSON.parse(await readFile(path,'utf8'));assert.equal(tx.phase,'rolled-back');
  await rename(path,join(evidence,stage+'.transaction.json'));
 }
 const outcome={passed:true,root:fx.root,evidence,baselineCommit:process.env.TONG_MAINTENANCE_BASELINE_COMMIT,candidate:release.candidate,results,fullSourceNativeProfilePinsPermissionsControlsHashVerified:true,independentProcessRestore:true,allNative:true,installerRestorerComponentsOnly:true,handoffCrashRecoveryIntegrated:false,productionExecutionAllowed:false};
 await writeFile(join(evidence,'outcome.json'),JSON.stringify(outcome,null,2),{flag:'wx'});console.log(JSON.stringify(outcome));
}
