import {readFile,writeFile,mkdir,copyFile,lstat,stat,rename,realpath} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {validateUpgradeBinding} from './TongUpgradeBinding.mjs';
import {withMaintenanceFreeze} from './TongLifecycleFreeze.mjs';

const BASE='D:\\Tong\\state\\p27-autonomy-candidate-20261017';
const [action,snapshot,releaseOverride,candidateOverride,commitOverride,baselineOverride,...extra]=process.argv.slice(2);
if([releaseOverride,candidateOverride,commitOverride].filter(value=>value!==undefined).length%3)throw Error('INCOMPLETE_RELEASE_BINDING');
for(const [value,prefix] of [[releaseOverride,'quick-trust-release-'],[candidateOverride,'quick-trust-candidate-']]){
 if(value!==undefined&&(dirname(value)!==BASE||!new RegExp('^'+prefix+'[a-f0-9]{7,40}$').test(relative(BASE,value))))throw Error('RELEASE_SCOPE_DENIED');
}
if(commitOverride!==undefined&&!/^[a-f0-9]{40}$/.test(commitOverride))throw Error('COMMIT_BINDING_DENIED');
if(baselineOverride!==undefined&&!/^[a-f0-9]{40}$/.test(baselineOverride))throw Error('BASELINE_BINDING_DENIED');
const RUNTIME='D:\\Tong\\runtime';
const TASK_RUNNER=join(RUNTIME,'login-management','TongLoginRuntime.ps1');
const ROOTS={app:'D:\\Tong\\app',manager:join(RUNTIME,'releases','manager')};
const ORIGINAL={app:baselineOverride??'a1b56b3666651c3648327f05e0ea4154284645c3',manager:baselineOverride??'a1b56b3666651c3648327f05e0ea4154284645c3'};
const NEW=commitOverride??'d9983bbc5fe1640f51d4a649ff0f018c9f458c6f';
const RELEASE=releaseOverride??join(BASE,'quick-trust-release-d9983bb');
const CANDIDATE=candidateOverride??join(BASE,'quick-trust-candidate-d9983bb');
const nodeManager=join(RUNTIME,'releases','manager','scripts');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const fail=message=>{throw Error(message)};
const data=(path)=>readFile(path);
const rootFor=which=>{if(!ROOTS[which])fail('INVALID_COMPONENT');return ROOTS[which];};
function checked(root,rel){
 if(typeof rel!=='string'||!rel||rel.startsWith('/')||rel.includes('\\')||rel.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')||/[<>|"*?\x00-\x1F]/.test(p)))fail('SOURCE_PATH_DENIED');
 const out=join(root,...rel.split('/')); const local=relative(root,out);
 if(!local||local==='..'||local.startsWith('..'+sep)||isAbsolute(local))fail('PATH_DENIED');
 return out;
}
async function regular(p){const s=await lstat(p);const actual=await realpath(p);if(!s.isFile()||s.nlink!==1||actual.toLowerCase()!==p.toLowerCase())fail('UNSAFE_ENTRY:'+p);return s;}
async function verified(p,entry){await regular(p);const b=await data(p);if(b.length!==entry.size||sha(b)!==entry.sha256)fail('HASH_MISMATCH:'+entry.path);return b;}
async function official(){
 const manifest=await read(join(RELEASE,'release-manifest.json'));
 if(manifest.commit!==NEW||!manifest.sourceFiles.some(file=>file.path==='scripts/TongQuickProject.mjs'))fail('UNEXPECTED_CANDIDATE');
 const {verifyRelease}=await import(pathToFileURL(join(CANDIDATE,'scripts','TongRuntimeRelease.mjs')).href);
 await verifyRelease({releaseRoot:RELEASE});
 const oldPins={app:await read(join(RUNTIME,'run','release-pin.json')),manager:await read(join(RUNTIME,'run','manager-pin.json'))};
 validateUpgradeBinding({oldApp:oldPins.app,oldManager:oldPins.manager,manifest,expectedOld:ORIGINAL.app,expectedNew:NEW});
 for(const key of Object.keys(oldPins)){
  if(oldPins[key].commit!==ORIGINAL[key]||JSON.stringify(oldPins[key].native)!==JSON.stringify(manifest.native)||JSON.stringify(oldPins[key].versions)!==JSON.stringify(manifest.versions))fail('BASELINE_MISMATCH:'+key);
  const previous=oldPins[key].expectedDevspaceHashes,next=manifest.expectedDevspaceHashes;
  if(Object.keys(previous??{}).sort().join(',')!=='pi-tools.js,server.js,workspaces.js'||Object.keys(next??{}).sort().join(',')!=='pi-tools.js,server.js,workspaces.js')fail('PATCH_SET_MISMATCH');
  // Different patch hash is expected when an MCP tool is added.
  for(const [file,hash] of Object.entries(previous)){
   const original=checked(rootFor(key),'node_modules/@waishnav/devspace/dist/'+file);
   if(sha(await data(original))!==hash)fail('OLD_PATCH_HASH_MISMATCH');
  }
  for(const [file,hash] of Object.entries(next)){
   const installed=checked(CANDIDATE,'node_modules/@waishnav/devspace/dist/'+file);
   if(sha(await data(installed))!==hash)fail('NEW_PATCH_HASH_MISMATCH');
  }
 }
 const profile=await read(join(RUNTIME,'profile.json'));
 if(profile.mode!=='production'||profile.root!==RUNTIME||profile.codeRoot!==ROOTS.app||profile.managerRoot!==ROOTS.manager||profile.agentdockEnabled!==true
   ||profile.sourceDigest!==oldPins.app.files.find(x=>x.path==='code/source.tar').sha256)fail('PROFILE_MISMATCH');
 const originalPinBytes=await data(join(RUNTIME,'run','release-pin.json'));
 if(sha(originalPinBytes)!==profile.releaseDigest)fail('BASELINE_PROFILE_DIGEST');
 const stagedPaths={app:CANDIDATE,manager:CANDIDATE};
 for(const key of Object.keys(ROOTS)){
  const old=oldPins[key],names=new Set(old.sourceFiles.map(f=>f.path));
  for(const f of old.sourceFiles)await verified(checked(rootFor(key),f.path),f);
  for(const f of manifest.sourceFiles){
    await verified(checked(stagedPaths[key],f.path),f);
    if(!names.has(f.path)){
      const dst=checked(rootFor(key),f.path);
      try{await lstat(dst);fail('NEW_SOURCE_COLLISION:'+key+':'+f.path)}catch(e){if(e.code!=='ENOENT')throw e}
    }
  }
 }
 const taskRunner='D:\\Tong\\runtime\\login-management\\TongLoginRuntime.ps1';
 const oldRunner=oldPins.manager.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 const newRunner=manifest.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 await verified(taskRunner,oldRunner);await verified(checked(stagedPaths.manager,newRunner.path),newRunner);
 return {manifest,oldPins,profile,stagedPaths,taskRunner};
}
async function existingSnapshot(root){
 if(typeof root!=='string'||!root.startsWith(BASE+'\\quick-trust-full-cutover-')||relative(BASE,root).startsWith('..')||relative(BASE,root).includes('\\'))fail('SNAPSHOT_SCOPE_DENIED');
 const evidence=await read(join(root,'snapshot.json'));
 if(evidence.schemaVersion!==1||evidence.newCommit!==NEW||evidence.oldApp!==ORIGINAL.app||evidence.oldManager!==ORIGINAL.manager)fail('SNAPSHOT_INVALID');
 return evidence;
}
async function makeSnapshot(verifiedState){
 const dir=join(BASE,'quick-trust-full-cutover-'+new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+randomUUID().slice(0,8));
 await mkdir(dir);
 for(const key of Object.keys(ROOTS)){
   for(const f of verifiedState.oldPins[key].sourceFiles){
     const bytes=await verified(checked(ROOTS[key],f.path),f);
     const target=checked(join(dir,'backup',key),f.path);
     await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
   }
 }
 for(const key of Object.keys(ROOTS))for(const [name,hash] of Object.entries(verifiedState.oldPins[key].expectedDevspaceHashes)){
   const original=checked(rootFor(key),'node_modules/@waishnav/devspace/dist/'+name);
   const output=checked(join(dir,'patched-backup',key),name);
   const bytes=await data(original);if(sha(bytes)!==hash)fail('OLD_PATCH_HASH_MISMATCH');
   await mkdir(dirname(output),{recursive:true});await writeFile(output,bytes,{flag:'wx'});
 }
 for(const [name,path] of [['profile.json',join(RUNTIME,'profile.json')],['release-pin.json',join(RUNTIME,'run','release-pin.json')],['manager-pin.json',join(RUNTIME,'run','manager-pin.json')],['login-runner.ps1',verifiedState.taskRunner]]){
  await copyFile(path,join(dir,name));
 }
 const evidence={schemaVersion:1,oldApp:ORIGINAL.app,oldManager:ORIGINAL.manager,newCommit:NEW,originalRunId:null,stage:'snapshotted',at:new Date().toISOString()};
 await writeFile(join(dir,'snapshot.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({ok:true,stage:'snapshotted',snapshot:dir,appFiles:verifiedState.oldPins.app.sourceFiles.length,managerFiles:verifiedState.oldPins.manager.sourceFiles.length}));
}
async function verifySnapshot(dir,{unused=true}={}){
 const state=await existingSnapshot(dir);
 if(unused&&state.stage!=='snapshotted')fail('SNAPSHOT_ALREADY_USED');
 for(const key of Object.keys(ROOTS)){
  const old=await read(join(dir,key==='app'?'release-pin.json':'manager-pin.json'));
  if(old.commit!==ORIGINAL[key])fail('OLD_SNAPSHOT_COMMIT_CHANGED');
  for(const f of old.sourceFiles)await verified(checked(join(dir,'backup',key),f.path),f);
  for(const [name,hash] of Object.entries(old.expectedDevspaceHashes)){
   const file=checked(join(dir,'patched-backup',key),name);
   if(sha(await data(file))!==hash)fail('OLD_PATCH_SNAPSHOT_CHANGED');
  }
 }
 for(const name of ['profile.json','release-pin.json','manager-pin.json','login-runner.ps1'])await regular(join(dir,name));
 const runner=await read(join(dir,'manager-pin.json'));
 const originalRunner=runner.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 await verified(join(dir,'login-runner.ps1'),originalRunner);
 return {ok:true,stage:state.stage,snapshot:dir,appFiles:(await read(join(dir,'release-pin.json'))).sourceFiles.length,managerFiles:runner.sourceFiles.length};
}
async function recordStage(dir,stage){
 const p=join(dir,'snapshot.json');const v=await existingSnapshot(dir);v.stage=stage;v.updatedAt=new Date().toISOString();await writeFile(p,JSON.stringify(v,null,2)+'\n');
}
async function assertStopped(){
 // Do not cache the old installed Manager in this controller: activation
 // imports the replacement Manager after its bytes have been installed.
 const {runtimeStatus}=await import('./TongAgentDockRuntime.mjs');
 const current=await runtimeStatus(RUNTIME);
 if(current.supervisorAlive||current.guardianAlive||!['stopped','abnormal_exit'].includes(current.phase)||!current.runId)fail('RUNTIME_NOT_STOPPED');
 const guardian=await read(join(RUNTIME,'run','guardian.json'));
 if(guardian.runId!==current.runId||!guardian.finishedAt||guardian.jobActiveAfterCleanup!==0)fail('GUARDIAN_CLEANUP_NOT_PROVEN');
 const probe=new URL('TongCutoverStoppedRunProbe.mjs',import.meta.url);
 const {fileURLToPath}=await import('node:url');
 const proof=await new Promise((ok,reject)=>execFile(process.execPath,[fileURLToPath(probe),current.runId],{windowsHide:true,timeout:30000,maxBuffer:16384},(error,out)=>{
   if(error){reject(Error('GUARDIAN_CLEANUP_NOT_PROVEN'));return;}
   try{ok(JSON.parse(out))}catch{reject(Error('INVALID_CLEANUP_PROOF'))}
 }));
 if(!proof.ok||proof.readOnly!==true||proof.expectedRunId!==current.runId||proof.matchingOwnedPids!==0||proof.jobActive!==0||proof.blockedPortCount!==0)fail('GUARDIAN_CLEANUP_NOT_PROVEN');
 return current;
}

async function backupPrivateState(dir){
 const state=await existingSnapshot(dir);
 if(state.stage!=='snapshotted')fail('SNAPSHOT_STAGE_DENIED');
 await assertStopped();
 const {assertProtectedPaths}=await import('./TongRuntimeSecurity.mjs');
 const groups=[
  ['app-runtime',join(ROOTS.app,'runtime')],
  ['policy',join(RUNTIME,'tong-policy')],
  ['backend-state',join(RUNTIME,'backend-state')],
  ['home',join(RUNTIME,'home')],
  ['secrets',join(RUNTIME,'secrets')],
  ['run',join(RUNTIME,'run')],
 ];
 const collected={};let totalBytes=0;
 async function archive(root,target,prefix=''){
  const info=await lstat(root);
  if(info.isSymbolicLink()||(await realpath(root)).toLowerCase()!==root.toLowerCase())fail('STATE_LINK_DENIED');
  if(info.isFile()){
   if(info.nlink!==1||info.size>32*1024*1024)fail('STATE_FILE_DENIED');
   const entry=checked(target,prefix);
   await mkdir(dirname(entry),{recursive:true});
   const raw=await data(root);
   await writeFile(entry,raw,{flag:'wx'});
   await assertProtectedPaths([entry]);
   if(sha(await data(entry))!==sha(raw))fail('STATE_HASH_DENIED');
   totalBytes+=raw.length;
   if(totalBytes>64*1024*1024)fail('STATE_SIZE_LIMIT');
   return [{path:prefix,size:raw.length,sha256:sha(raw)}];
  }
  if(!info.isDirectory())fail('STATE_ENTRY_DENIED');
  const names=await (await import('node:fs/promises')).readdir(root);
  const items=[];
  for(const name of names)items.push(...await archive(join(root,name),target,prefix?prefix+'/'+name:name));
  return items;
 }
 for(const [key,path] of groups){
  const files=await archive(path,join(dir,'private-state',key));
  collected[key]={files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),digest:sha(JSON.stringify(files))};
 }
 const evidence=join(dir,'private-state-evidence.json');
 await writeFile(evidence,JSON.stringify(collected,null,2)+'\n',{flag:'wx'});
 await assertProtectedPaths([dir,evidence]);
 await recordStage(dir,'state-backed-up');
 console.log(JSON.stringify({ok:true,stage:'state-backed-up',count:groups.length,totalBytes}));
}
async function install(dir){
 const evidence=await existingSnapshot(dir);
 if(evidence.stage!=='state-backed-up')fail('INSTALL_STAGE_DENIED');
 await assertStopped();
 const candidate=await read(join(RELEASE,'release-manifest.json'));
 for(const key of Object.keys(ROOTS)){
  const old=await read(join(dir,key==='app'?'release-pin.json':'manager-pin.json'));
  for(const f of old.sourceFiles)await verified(checked(join(dir,'backup',key),f.path),f);
  const names=new Set(old.sourceFiles.map(f=>f.path));
  // Prevalidate every candidate and reject collisions before any live copy.
  for(const f of candidate.sourceFiles){
   await verified(checked(CANDIDATE,f.path),f);
   if(!names.has(f.path)){
      try{await lstat(checked(ROOTS[key],f.path));fail('NEW_SOURCE_COLLISION')}catch(e){if(e.code!=='ENOENT')throw e}
   }
  }
 }
 await recordStage(dir,'installing');
 for(const key of Object.keys(ROOTS)){
  for(const f of candidate.sourceFiles){
    const src=checked(CANDIDATE,f.path),dst=checked(ROOTS[key],f.path);
    await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);
    await verified(dst,f);
  }
  for(const [name,hash] of Object.entries(candidate.expectedDevspaceHashes)){
   const rel='node_modules/@waishnav/devspace/dist/'+name;
   const source=checked(CANDIDATE,rel),destination=checked(ROOTS[key],rel);
   if(sha(await data(source))!==hash)fail('NEW_PATCH_HASH_MISMATCH');
   await copyFile(source,destination);
   if(sha(await data(destination))!==hash)fail('PATCH_INSTALL_DENIED');
  }
 }
 await recordStage(dir,'files-installed');
 console.log(JSON.stringify({ok:true,stage:'files-installed',snapshot:dir}));
}
async function installRunner(dir){
 await assertStopped();
 const e=await existingSnapshot(dir);
 if(!['files-installed','pins-installed'].includes(e.stage))fail('RUNNER_STAGE_DENIED');
 const m=await read(join(RELEASE,'release-manifest.json'));
 const runner=m.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 const source=checked(ROOTS.manager,runner.path);await verified(source,runner);
 const dest=TASK_RUNNER;
 await copyFile(source,dest);await verified(dest,runner);
 await recordStage(dir,'runner-installed');
 console.log(JSON.stringify({ok:true,stage:'runner-installed'}));
}
async function checkInstalled(){
 const m=await read(join(RELEASE,'release-manifest.json'));
 const profile=await read(join(RUNTIME,'profile.json'));
 const pinApp=await read(join(RUNTIME,'run','release-pin.json')),pinManager=await read(join(RUNTIME,'run','manager-pin.json'));
 if(pinApp.commit!==NEW||pinManager.commit!==NEW||profile.sourceDigest!==m.files.find(x=>x.path==='code/source.tar')?.sha256||profile.releaseDigest!==sha(await data(join(RELEASE,'release-manifest.json'))))fail('INSTALL_METADATA_MISMATCH');
 for(const key of Object.keys(ROOTS)){
   for(const f of m.sourceFiles)await verified(checked(ROOTS[key],f.path),f);
   for(const [name,hash] of Object.entries(m.expectedDevspaceHashes))
     if(sha(await data(checked(ROOTS[key],'node_modules/@waishnav/devspace/dist/'+name)))!==hash)fail('NEW_PATCH_NOT_INSTALLED');
 }
 const newRunner=m.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 await verified(TASK_RUNNER,newRunner);
 console.log(JSON.stringify({ok:true,stage:'installed-verified',app:pinApp.commit,manager:pinManager.commit}));
}
async function rollback(dir){
 const e=await existingSnapshot(dir);
 if(e.stage==='snapshotted'&&!baselineOverride)fail('NOT_MODIFIED');
 // This action intentionally cannot stop a service or rewrite a live running release.
 await assertStopped();
 const m=await read(join(RELEASE,'release-manifest.json'));
 for(const key of Object.keys(ROOTS)){
  const original=await read(join(dir,key==='app'?'release-pin.json':'manager-pin.json'));
  const names=new Set(original.sourceFiles.map(f=>f.path));
  for(const f of m.sourceFiles){
   if(!names.has(f.path)){
    const src=checked(ROOTS[key],f.path);
    try{await regular(src)}catch(e){if(e.code==='ENOENT')continue;throw e}
    const dest=checked(join(dir,'retired-new',key),f.path);await mkdir(dirname(dest),{recursive:true});await rename(src,dest);
   }
  }
  for(const f of original.sourceFiles){
   const source=checked(join(dir,'backup',key),f.path),dest=checked(ROOTS[key],f.path);
   await verified(source,f);await mkdir(dirname(dest),{recursive:true});await copyFile(source,dest);await verified(dest,f);
  }
  for(const [name,hash] of Object.entries(original.expectedDevspaceHashes)){
   const source=checked(join(dir,'patched-backup',key),name);
   const destination=checked(ROOTS[key],'node_modules/@waishnav/devspace/dist/'+name);
   if(sha(await data(source))!==hash)fail('OLD_PATCH_BACKUP_CHANGED');
   await copyFile(source,destination);
   if(sha(await data(destination))!==hash)fail('OLD_PATCH_RESTORE_DENIED');
  }
 }
 for(const [name,target]of [['release-pin.json',join(RUNTIME,'run','release-pin.json')],['manager-pin.json',join(RUNTIME,'run','manager-pin.json')],['profile.json',join(RUNTIME,'profile.json')],['login-runner.ps1',TASK_RUNNER]]){
  await copyFile(join(dir,name),target);
 }
 await recordStage(dir,'rolled-back-old-code');
 console.log(JSON.stringify({ok:true,stage:'rolled-back-old-code',snapshot:dir,oldApp:ORIGINAL.app,oldManager:ORIGINAL.manager,recoveryPermissionNeedsFreshHumanApproval:true}));
}
// Reuse the existing snapshot/install/rollback operations under the shared
// lifecycle gate. A failed controller leaves the gate present and startup
// blocked, instead of exposing partly installed code to a login retry.
async function upgradeProfiles(dir){
 const baseline=await read(join(dir,'profile.json'));
 const manifest=await read(join(RELEASE,'release-manifest.json'));
 const {createProductionProfile,verifyRuntimeApproval}=await import('./TongProductionProfile.mjs');
 const next=createProductionProfile({sourceDigest:manifest.files.find(f=>f.path==='code/source.tar').sha256,releaseDigest:sha(await data(join(RELEASE,'release-manifest.json'))),agentdockEnabled:true});
 await verifyRuntimeApproval(baseline,'restore');
 await verifyRuntimeApproval(next,'start');await verifyRuntimeApproval({...next,agentdockEnabled:false},'manager');
 return {baseline,next};
}
async function upgradeGate(dir,fn,{release=false}={}){
 await existingSnapshot(dir);const profiles=await upgradeProfiles(dir);
 await assertStopped();
 await withMaintenanceFreeze(profiles.next,{expectedSha256:sha(Buffer.alloc(0)),productionUpgrade:{baselineProfile:profiles.baseline},upgradeReceipt:join(dir,'upgrade-gate.json')},async lease=>{
  await lease.proof();await assertStopped();await fn(profiles);
  if(release)await lease.release();else await lease.proof();
 });
}
async function installAndActivate(dir){
 await verifySnapshot(dir);
 await upgradeGate(dir,async({next})=>{
  // This delta touches source, three known patches, runner, profile and pins.
  // Existing OAuth/DPAPI/databases and recovery envelopes stay in place.
  await recordStage(dir,'state-backed-up');
  await install(dir);
  const module=name=>pathToFileURL(join(ROOTS.manager,'scripts',name)).href;
  const {pinRuntimeRelease,verifyRuntimeCandidate}=await import(module('TongRuntimeCandidate.mjs'));
  const {updateRuntimeProfile}=await import(module('TongAgentDockRuntime.mjs'));
  await pinRuntimeRelease({...next,agentdockEnabled:false},RELEASE,{manager:true,replace:true});
  await updateRuntimeProfile(next,{releaseRoot:RELEASE});
  await verifyRuntimeCandidate(next);await verifyRuntimeCandidate(next,{manager:true,reviewedManagerProfile:{...next,agentdockEnabled:false}});
  await recordStage(dir,'pins-installed');await installRunner(dir);await checkInstalled();
 });
}
async function releaseUpgradeGate(dir){
 const state=await existingSnapshot(dir);
 if(!['runner-installed','rolled-back-old-code'].includes(state.stage))fail('UPGRADE_GATE_STAGE_DENIED');
 await upgradeGate(dir,async()=>{
  const latest=await existingSnapshot(dir);
  if(latest.stage==='runner-installed')await checkInstalled();
  else{
   if(latest.stage!=='rolled-back-old-code')fail('UPGRADE_GATE_STAGE_DENIED');
   const p=await read(join(RUNTIME,'profile.json'));
   const {verifyRuntimeCandidate}=await import(pathToFileURL(join(ROOTS.manager,'scripts/TongRuntimeCandidate.mjs')).href);
   await verifyRuntimeCandidate(p);await verifyRuntimeCandidate(p,{manager:true,reviewedManagerProfile:{...p,agentdockEnabled:false}});
  }
 },{release:true});
 console.log(JSON.stringify({ok:true,stage:'upgrade-gate-released'}));
}
try{
 if(extra.length)fail('UNEXPECTED_ARGUMENTS');
 if(action==='preflight'){
  const s=await official();console.log(JSON.stringify({ok:true,action,oldApp:s.oldPins.app.commit,oldManager:s.oldPins.manager.commit,newCommit:s.manifest.commit,
  appCount:s.manifest.sourceFiles.length,nativeCount:s.manifest.native.length,existingNewFiles:false}));
 }else if(action==='snapshot'){await makeSnapshot(await official());}
 else if(action==='verify-snapshot'){console.log(JSON.stringify(await verifySnapshot(snapshot)));}
 else if(action==='backup-state'){await backupPrivateState(snapshot);}
 else if(action==='install'){await install(snapshot);}
 else if(action==='install-runner'){await installRunner(snapshot);}
 else if(action==='verify-installed'){await checkInstalled();}
 else if(action==='install-activate'){await installAndActivate(snapshot);}
 else if(action==='release-upgrade-gate'){await releaseUpgradeGate(snapshot);}
 else if(action==='rollback-preflight'){
  const evidence=await verifySnapshot(snapshot,{unused:false});
  for(const pin of ['release-pin.json','manager-pin.json'])if(![ORIGINAL.app,NEW].includes((await read(join(RUNTIME,'run',pin))).commit))fail('ROLLBACK_CURRENT_VERSION_DENIED');
  console.log(JSON.stringify({...evidence,rollbackPrepared:true}));
 }
 else if(action==='rollback'){if(baselineOverride)await upgradeGate(snapshot,()=>rollback(snapshot));else await rollback(snapshot);}
 else fail('BAD_ACTION');
}catch(error){console.error(String(error?.code??error?.message??error).slice(0,230));process.exitCode=1}
