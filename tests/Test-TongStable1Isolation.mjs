// One fixed, existing development fixture. Never accepts a production target.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,rename,lstat,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {validateProductionProfile} from '../scripts/TongProductionProfile.mjs';
import {assertProtectedPaths,processIdentity,sameProcess,startupJobsState,runtimeProcessInventory,safeEnvironment} from '../scripts/TongRuntimeSecurity.mjs';
import {assertPortUnused} from '../scripts/TongRuntimePort.mjs';

const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const release='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-37dc649';
const restored='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-candidate-37dc649';
const commit='37dc649c46ad0e267c3471f750b97227cf106310';
const evidence=join(root,'stable1-20261025');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const action=process.argv[2];
assert.ok(['prepare','start','status','doctor','stop','revoke'].includes(action));
assert.equal(process.argv.length,3);
const old=validateProductionProfile(await json(join(root,'profile.json')));
assert.equal(old.root,root);assert.equal(old.mode,'production-simulation');

if(action==='prepare'){
  const manifest=await verifyRelease({releaseRoot:release});assert.equal(manifest.commit,commit);
  assert.equal(sha(await readFile(join(release,'release-manifest.json'))),'164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0');
  for(const manager of [false,true])await verifyRuntimeCandidate(old,{manager,reviewedManagerProfile:{...old,agentdockEnabled:false}});
  await assertProtectedPaths([root,old.codeRoot,old.managerRoot,join(root,'run')]);
  const previous=await json(join(root,'run/runtime.json')),guardian=await json(join(root,'run/guardian.json'));
  assert.equal(previous.phase,'stopped');assert.ok(guardian.finishedAt);
  const jobs=await startupJobsState(previous.runId);assert.ok(Object.values(jobs).every(n=>n===0));
  for(const expected of [guardian,previous.supervisor,...previous.children,...previous.descendants]){
    const actual=await processIdentity(expected.pid);
    assert.ok(!actual||actual.exe&&/^\d+$/.test(actual.startTicks),'unknown process identity');
    assert.equal(sameProcess(actual,expected),false);
  }
  const inventory=await runtimeProcessInventory({roots:[root],runIds:[previous.runId],mode:old.mode});
  assert.equal(inventory.complete,true);assert.equal(inventory.matchingProcesses.length,0);
  for(const port of [old.gatewayPort,old.upstreamPort,old.agentdockPort])await assertPortUnused(port);
  // An existing freeze is an unconditional stop. This rehearsal never removes one.
  await assert.rejects(lstat(join(root,'run/backup.freeze')),{code:'ENOENT'});
  await mkdir(evidence);await copyFile(join(root,'profile.json'),join(evidence,'previous-profile.json'));
  const priorPin=await json(join(root,'run/release-pin.json'));
  assert.equal(priorPin.commit,'24431b263ab1bc6ec17cca48f82245f72f197d4c','only the reviewed stopped fixture may be repurposed');
  // Retain all old source bytes, including files absent from version 1.
  for(const [component,target] of [['app',old.codeRoot],['manager',old.managerRoot]]){
    for(const item of priorPin.sourceFiles){const from=join(target,item.path),to=join(evidence,'previous-'+component,item.path);await mkdir(dirname(to),{recursive:true});await rename(from,to);}
    for(const item of manifest.sourceFiles){const from=join(release,'code/source',item.path),to=join(target,item.path);await mkdir(dirname(to),{recursive:true});await copyFile(from,to);}
    for(const item of manifest.native)assert.equal(sha(await readFile(join(target,item.path))),item.sha256,'native mismatch');
    for(const [name,digest] of Object.entries(manifest.expectedDevspaceHashes)){
      const rel='node_modules/@waishnav/devspace/dist/'+name,to=join(target,rel),saved=join(evidence,'previous-'+component,rel);
      await mkdir(dirname(saved),{recursive:true});await copyFile(to,saved);await copyFile(join(restored,rel),to);assert.equal(sha(await readFile(to)),digest);
    }
  }
  await rename(join(root,'run'),join(evidence,'previous-run'));await mkdir(join(root,'run'));
  const bytes=await readFile(join(release,'release-manifest.json'));
  for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),bytes,{flag:'wx'});
  const profile=validateProductionProfile({...old,sourceDigest:manifest.files.find(x=>x.path==='code/source.tar').sha256,releaseDigest:sha(bytes)});
  await writeFile(join(root,'profile.json'),JSON.stringify(profile)+'\n');
  const bindings={};for(const manager of [false,true])bindings[manager?'manager':'app']=await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}});
  const login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));await login.issueSimulationLoginRecovery(profile);
  const result={preparedAt:new Date().toISOString(),root,release,commit,sourceFiles:manifest.sourceFiles.length,nativeFiles:manifest.native.length,bindings,priorStoppedRunId:previous.runId,priorJobs:jobs,sourceUnmodified:true,productionMutation:false,dependenciesReused:true,aclChanged:false};
  await writeFile(join(evidence,'prepare.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}else{
  const pin=await verifyRuntimeCandidate(old);assert.equal(pin.commit,commit);
  const login=await import(pathToFileURL(join(old.managerRoot,'scripts/TongLoginRecovery.mjs')));
  if(action==='revoke'){await login.revokeSimulationLoginRecovery(root);console.log(JSON.stringify({revoked:true,root}));}
  else{
    const status=await json(join(root,'run/runtime.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const command=action==='stop'?'stop-run':action;
    assert.ok(action!=='stop'||status?.runId,'run identity required');
    const args=[join(old.managerRoot,'scripts/TongAgentDockRuntime.mjs'),command,'--root',root,'--login-recovery','--error-json',...(action==='stop'?['--run-id',status.runId]:[])];
    const env=safeEnvironment(root),began=new Date().toISOString();
    const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    const timer=setTimeout(()=>child.kill(),180000);
    const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);
    let result;try{result=JSON.parse(out);}catch{result={unstructured:true};}
    const record={action,code,began,finishedAt:new Date().toISOString(),result,stderrSha256:sha(err),stderrBytes:Buffer.byteLength(err),root,commit};
    await writeFile(join(evidence,action+'-'+Date.now()+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(record));process.exitCode=code===0?0:1;
  }
}
