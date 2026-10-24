import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { executeRecovery, executeRollback } from '../../scripts/Tong024ProductionMaintenance.mjs';
import { resumeMaintenanceTransaction } from '../../scripts/TongMaintenanceTransaction.mjs';
import { maintenanceFreeze } from '../../scripts/TongLifecycleFreeze.mjs';
import { startRuntime,stopRuntime,updateRuntimeProfile } from '../../scripts/TongAgentDockRuntime.mjs';
import { createProductionStateBackup } from '../../scripts/TongProductionState.mjs';
const root=process.env.TONG_MAINTENANCE_TEST_ROOT;
if(!/^D:\\Tong\\state\\b23-maint-native-[a-f0-9]{32}$/.test(root??''))throw Error('NATIVE_FIXTURE_SCOPE');
const fx=JSON.parse(await readFile(join(root,'maintenance-native-fixture.json'),'utf8'));
if(fx.root!==root||fx.baselineProfile.mode!=='production-simulation')throw Error('NATIVE_FIXTURE_SCOPE');
const [action,transactionId]=process.argv.slice(2),fault=process.env.TONG_MAINTENANCE_TEST_FAULT;
let triggered=false;
const onCheckpoint=async event=>{
 if(fault==='concurrent-lifecycle'&&event.name==='prepared'){
  const child=spawn(process.execPath,[process.argv[1],'compete'],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',bytes=>out+=bytes);child.stderr.on('data',bytes=>err+=bytes);
  const code=await new Promise(ok=>child.once('close',ok));if(code!==0)throw Error('CONCURRENT_CHECK_FAILED:'+err);process.stdout.write(out);
  const proof=await maintenanceFreeze(root).proof();console.log(JSON.stringify({event:'injected_process_exit',name:fault,transactionId:event.transactionId,leaseHolderPid:proof.holderPid}));process.exit(71);
 }
 if(fault===event.name&&!triggered){triggered=true;const proof=await maintenanceFreeze(root).proof();console.log(JSON.stringify({event:'injected_process_exit',...event,leaseHolderPid:proof.holderPid}));process.exit(71);}
};
try{
 if(action==='compete'){
  const results=[];
  for(const [name,invoke,expected]of[['start',()=>startRuntime(root),'RUNTIME_BUSY'],['stop',()=>stopRuntime(root,{expectedRunId:fx.baselineRunId}),'RUNTIME_BUSY'],['profile',()=>updateRuntimeProfile(fx.baselineProfile,{releaseRoot:fx.releaseRoot}),'RUNTIME_BUSY'],['backup',()=>createProductionStateBackup(fx.baselineProfile,{backupRoot:join(root,'race-backup')}),'STATE_BUSY']]){
   try{await invoke();throw Error('CONCURRENT_OPERATION_ENTERED');}catch(error){if(error.message!==expected)throw error;results.push({operation:name,code:error.message});}
  }
  console.log(JSON.stringify({event:'native_concurrent_lifecycle_refused',results}));
 }else{
 const result=action==='run'?await executeRecovery(fx.baselineProfile,{candidateProfile:fx.candidateProfile,candidateCommit:fx.candidateCommit,releaseRoot:fx.releaseRoot,onCheckpoint,...(['startup-timeout','concurrent-lifecycle'].includes(fault)?{startupTimeoutMs:1}:{})}):action==='rollback'?(fault?await resumeMaintenanceTransaction(fx.baselineProfile,{transactionId,action:'rollback',onCheckpoint}):await executeRollback(fx.baselineProfile,{transactionId})):await resumeMaintenanceTransaction(fx.baselineProfile,{transactionId,action,onCheckpoint});
 console.log(JSON.stringify({event:'maintenance_worker_result',action,...result}));
 }
}catch(error){console.error(JSON.stringify({event:'maintenance_worker_error',action,code:error.message,startupFailure:error.startupFailure}));process.exitCode=1;}
