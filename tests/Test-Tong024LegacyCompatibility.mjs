import assert from 'node:assert/strict';
import {readFile,writeFile,rename,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,revokeSimulationLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {incident} from '../scripts/Tong024LegacyRecovery.mjs';
const {root,profile}=await loginFixture();
await symlink(new URL('../node_modules',import.meta.url),join(root,'node_modules'),'junction');
await issueSimulationLoginRecovery(profile);
const fake=pid=>({pid,exe:process.execPath,startTicks:'1',markerMatches:true});
const runtime={schemaVersion:1,runId:incident.oldRunId,phase:'abnormal_exit',supervisor:fake(2147483646),children:[],descendants:[]};
const guardian={...fake(2147483647),runId:incident.oldRunId,nodePid:runtime.supervisor.pid,finishedAt:new Date().toISOString(),jobAssigned:true,killOnJobClose:true,jobName:'Local\\TongRuntime-'+incident.oldRunId,jobActiveAfterCleanup:0};
for(const [name,value] of Object.entries({'runtime.json':runtime,'guardian.json':guardian}))await writeFile(join(root,'run',name),JSON.stringify(value));
async function start(){
 const manager=join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs');
 const child=spawn(process.execPath,[manager,'start','--root',root,'--login-recovery','--error-json'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);
 const timer=setTimeout(()=>child.kill(),90000);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);
 assert.equal(code,1,err);const failure=JSON.parse(out);assert.equal(failure.error,'CLEANUP_REQUIRED');assert.equal(failure.startupFailure.cleanup.proven,false);
 await readFile(join(root,'run','backup.freeze'));assert.deepEqual(JSON.parse(await readFile(join(root,'run','runtime.json'),'utf8')),runtime);assert.deepEqual(JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8')),guardian);
}
try{
 await start();await assert.rejects(readFile(join(root,'run','request.json')),{code:'ENOENT'});
 // Only this synthetic lock created above is retained to exercise the second
 // scenario. This is not the production lock or a recovery authorization.
 await rename(join(root,'run','backup.freeze'),join(root,'old-only-freeze.evidence'));
 const request={runId:incident.failedRunId,createdAt:'2026-10-23T10:55:13.368Z'};
 const abort={runId:incident.failedRunId,requestedAt:'2026-10-23T10:55:28.390Z',reason:'START_ABORT'};
 await writeFile(join(root,'run','request.json'),JSON.stringify(request));await writeFile(join(root,'run','abort.json'),JSON.stringify(abort));
 await start();assert.deepEqual(JSON.parse(await readFile(join(root,'run','request.json'),'utf8')),request);assert.deepEqual(JSON.parse(await readFile(join(root,'run','abort.json'),'utf8')),abort);
 console.log(JSON.stringify({passed:true,root,oldRunNotAutomaticallyUpgraded:true,failedAttemptNotCoveredByOldGuardian:true,lockRetained:true,requestPreserved:true,normalStartupDoesNotInvokeLegacyRecovery:true}));
}finally{await revokeSimulationLoginRecovery(root);}
