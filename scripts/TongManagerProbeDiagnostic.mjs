import {openSync,closeSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

const stages=new Set(['entry','grant_load','envelope_paths','envelope_unseal','descriptor_validate','audit_paths','audit_load','audit_validate','release_verify','operation_audit','handler','doctor_layout','doctor_status','binary_hash','agentdock_health','tong_health','security_inspect','result_ready','output_written']);
// Caller first verifies root/logs using the existing protected-path checks.
// One tiny replaceable record per Runner, not one file per 10-second probe.
// Runner copies matching failure metadata to its retained incident log.
export function createManagerProbeDiagnostic(root,invocationId,action){
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(invocationId??'')||action!=='doctor')throw Error('INVALID_DIAGNOSTIC');
  const path=join(root,'logs','login-manager-probe.json'),temporary=path+'.'+invocationId+'.tmp';
  return stage=>{
    let created=false,fd;
    try{
      fd=openSync(temporary,'wx');created=true;
      writeFileSync(fd,JSON.stringify({schemaVersion:1,invocationId,action,pid:process.pid,parentPid:process.ppid,at:new Date().toISOString(),stage:stages.has(stage)?stage:'unspecified',rss:process.memoryUsage().rss})+'\n');
      closeSync(fd);fd=undefined;renameSync(temporary,path);created=false;
    }catch{ /* Diagnostics cannot change lifecycle or authorization outcomes. */ }
    finally{
      if(fd!==undefined){try{closeSync(fd);}catch{}}
      if(created){try{unlinkSync(temporary);}catch{ /* Only this call's newly created tiny scratch file. */ }}
    }
  };
}
