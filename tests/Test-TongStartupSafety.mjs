import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {loginFixture} from './fixtures/TongLoginRecoveryFixture.mjs';
import {issueSimulationLoginRecovery,withLoginRecovery,revokeSimulationLoginRecovery} from '../scripts/TongLoginRecovery.mjs';
import {startRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {protectSecret,processIdentity,sameProcess,terminateOwnedProcess,startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
process.env.TONG_LOGIN_TEST_DEPENDENCIES??=fileURLToPath(new URL('../',import.meta.url));
const {root,profile:original}=await loginFixture({full:true,sharedDependencies:true,ports:{gatewayPort:29615,upstreamPort:29616,agentdockPort:29617}});
const manifest=JSON.parse(await readFile(join(root,'run','manager-pin.json'),'utf8')),marker=join(root,'unassigned-node.json');
const replacements={
 'scripts/TongRuntimeGuardian.ps1':source=>source.replace("    $script:tongStartup['node']=$nodeIdentity","    [IO.File]::WriteAllText('"+marker+"',($nodeIdentity|ConvertTo-Json -Compress))\n    throw 'TEST_POST_BOUND_FAILURE'\n    $script:tongStartup['node']=$nodeIdentity"),
 'scripts/TongAgentDockRuntime.mjs':source=>source.replace('async function supervise(root,runId){','async function supervise(root,runId){await new Promise(()=>setInterval(()=>{},1000));'),
};
for(const [name,replace] of Object.entries(replacements)){
 const old=await readFile(join(original.managerRoot,name),'utf8'),bytes=Buffer.from(replace(old));assert.notEqual(bytes.toString(),old);
 for(const target of [original.codeRoot,original.managerRoot])await writeFile(join(target,name),bytes);
 Object.assign(manifest.sourceFiles.find(f=>f.path===name),{size:bytes.length,sha256:sha(bytes)});
}
const pin=Buffer.from(JSON.stringify(manifest)),profile={...original,releaseDigest:sha(pin)};
for(const file of ['manager-pin.json','release-pin.json'])await writeFile(join(root,'run',file),pin);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));await protectSecret(root,'agentdock','a'.repeat(64));await protectSecret(root,'oauth-owner','b'.repeat(64));
await issueSimulationLoginRecovery(profile);let identity,result;
try{
 let failure;try{await withLoginRecovery(root,'start',()=>startRuntime(root,{startupTimeoutMs:120000}));}catch(error){failure=error;}
 await writeFile(join(root,'observed-manager-failure.json'),JSON.stringify({error:failure?.message,startupFailure:failure?.startupFailure}));
 assert.ok(failure);const created=JSON.parse(await readFile(marker,'utf8'));identity=await processIdentity(created.pid);
 const nodeStillAlive=sameProcess(identity,created),jobs=await startupJobsState(JSON.parse(await readFile(join(root,'run','request.json'),'utf8')).runId);
 const lockReleased=await readFile(join(root,'run','backup.freeze')).then(()=>false,error=>{if(error.code==='ENOENT')return true;throw error;});
 result={root,error:failure.message,startupFailure:failure.startupFailure,nodeStillAlive,lockReleased,jobs,ownedNodeCleanup:false};
}finally{
 if(!identity){const value=await readFile(marker,'utf8').then(JSON.parse).catch(()=>null);if(value){const current=await processIdentity(value.pid);if(sameProcess(current,value))identity=current;}}
 if(identity){await terminateOwnedProcess(identity);if(result)result.ownedNodeCleanup=!sameProcess(await processIdentity(identity.pid),identity);}
 await revokeSimulationLoginRecovery(root);
}
console.log(JSON.stringify(result));
assert.equal(result.error,'START_FAILED');assert.equal(result.nodeStillAlive,false);assert.equal(result.lockReleased,true,'only the fully bound runtime tree can produce complete cleanup proof');assert.equal(result.startupFailure.cleanup.proven,true);assert.equal(result.startupFailure.origin.code,'TEST_POST_BOUND_FAILURE');assert.equal(result.startupFailure.origin.role,'guardian');assert.equal(result.startupFailure.origin.exitCode,2);
assert.equal(result.startupFailure.origin.nodeExitCode,1);assert.equal(result.startupFailure.origin.preflightExitCode,0);
