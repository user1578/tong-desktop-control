import {readFile,writeFile,mkdir,copyFile,lstat,stat,rename,realpath} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const BASE='D:\\Tong\\state\\p27-autonomy-candidate-20261017';
const RUNTIME='D:\\Tong\\runtime';
const ROOTS={app:'D:\\Tong\\app',manager:join(RUNTIME,'releases','manager')};
const ORIGINAL={app:'3442cbb938dea887a55bf13a72a5213ae4c5dbe5',manager:'1eac7502a9cf89be7daf63d59843ad9f49b61877'};
const NEW='bb234ec794c1d8180586781c92601f2eae95e750';
const RELEASE=join(BASE,'release');
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
 if(manifest.commit!==NEW||manifest.sourceFiles.length!==177)fail('UNEXPECTED_CANDIDATE');
 const {verifyRelease}=await import(pathToFileURL(join(BASE,'staged-manager','scripts','TongRuntimeRelease.mjs')).href);
 await verifyRelease({releaseRoot:RELEASE});
 const oldPins={app:await read(join(RUNTIME,'run','release-pin.json')),manager:await read(join(RUNTIME,'run','manager-pin.json'))};
 for(const key of Object.keys(oldPins)){if(oldPins[key].commit!==ORIGINAL[key]||JSON.stringify(oldPins[key].native)!==JSON.stringify(manifest.native)||JSON.stringify(oldPins[key].versions)!==JSON.stringify(manifest.versions)||JSON.stringify(oldPins[key].expectedDevspaceHashes)!==JSON.stringify(manifest.expectedDevspaceHashes))fail('BASELINE_MISMATCH:'+key)}
 const profile=await read(join(RUNTIME,'profile.json'));
 if(profile.mode!=='production'||profile.root!==RUNTIME||profile.codeRoot!==ROOTS.app||profile.managerRoot!==ROOTS.manager||profile.agentdockEnabled!==true
   ||profile.sourceDigest!==oldPins.app.files.find(x=>x.path==='code/source.tar').sha256)fail('PROFILE_MISMATCH');
 const originalPinBytes=await data(join(RUNTIME,'run','release-pin.json'));
 if(sha(originalPinBytes)!==profile.releaseDigest)fail('BASELINE_PROFILE_DIGEST');
 const stagedPaths={app:join(BASE,'staged-app'),manager:join(BASE,'staged-manager')};
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
 if(typeof root!=='string'||!root.startsWith(BASE+'\\production-cutover-')||relative(BASE,root).startsWith('..')||relative(BASE,root).includes('\\'))fail('SNAPSHOT_SCOPE_DENIED');
 const evidence=await read(join(root,'snapshot.json'));
 if(evidence.schemaVersion!==1||evidence.newCommit!==NEW||evidence.oldApp!==ORIGINAL.app||evidence.oldManager!==ORIGINAL.manager)fail('SNAPSHOT_INVALID');
 return evidence;
}
async function makeSnapshot(verifiedState){
 const dir=join(BASE,'production-cutover-'+new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+randomUUID().slice(0,8));
 await mkdir(dir);
 for(const key of Object.keys(ROOTS)){
   for(const f of verifiedState.oldPins[key].sourceFiles){
     const bytes=await verified(checked(ROOTS[key],f.path),f);
     const target=checked(join(dir,'backup',key),f.path);
     await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
   }
 }
 for(const [name,path] of [['profile.json',join(RUNTIME,'profile.json')],['release-pin.json',join(RUNTIME,'run','release-pin.json')],['manager-pin.json',join(RUNTIME,'run','manager-pin.json')],['login-runner.ps1',verifiedState.taskRunner]]){
  await copyFile(path,join(dir,name));
 }
 const evidence={schemaVersion:1,oldApp:ORIGINAL.app,oldManager:ORIGINAL.manager,newCommit:NEW,originalRunId:null,stage:'snapshotted',at:new Date().toISOString()};
 await writeFile(join(dir,'snapshot.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({ok:true,stage:'snapshotted',snapshot:dir,appFiles:verifiedState.oldPins.app.sourceFiles.length,managerFiles:verifiedState.oldPins.manager.sourceFiles.length}));
}
async function recordStage(dir,stage){
 const p=join(dir,'snapshot.json');const v=await existingSnapshot(dir);v.stage=stage;v.updatedAt=new Date().toISOString();await writeFile(p,JSON.stringify(v,null,2)+'\n');
}
async function assertStopped(){
 const {runtimeStatus}=await import(pathToFileURL(join(ROOTS.manager,'scripts','TongAgentDockRuntime.mjs')).href);
 const current=await runtimeStatus(RUNTIME);
 if(current.supervisorAlive||current.guardianAlive||current.phase!=='stopped'||!current.runId)fail('RUNTIME_NOT_STOPPED');
 const guardian=await read(join(RUNTIME,'run','guardian.json'));
 if(guardian.runId!==current.runId||!guardian.finishedAt||guardian.jobActiveAfterCleanup!==0)fail('GUARDIAN_CLEANUP_NOT_PROVEN');
 return current;
}
async function install(dir){
 const evidence=await existingSnapshot(dir);
 if(evidence.stage!=='snapshotted')fail('INSTALL_STAGE_DENIED');
 await assertStopped();
 const candidate=await read(join(RELEASE,'release-manifest.json'));
 for(const key of Object.keys(ROOTS)){
  const old=await read(join(dir,key==='app'?'release-pin.json':'manager-pin.json'));
  for(const f of old.sourceFiles)await verified(checked(join(dir,'backup',key),f.path),f);
  const names=new Set(old.sourceFiles.map(f=>f.path));
  // Prevalidate every candidate and reject collisions before any live copy.
  for(const f of candidate.sourceFiles){
   await verified(checked(join(BASE,key==='app'?'staged-app':'staged-manager'),f.path),f);
   if(!names.has(f.path)){
      try{await lstat(checked(ROOTS[key],f.path));fail('NEW_SOURCE_COLLISION')}catch(e){if(e.code!=='ENOENT')throw e}
   }
  }
 }
 await recordStage(dir,'installing');
 for(const key of Object.keys(ROOTS)){
  for(const f of candidate.sourceFiles){
    const src=checked(join(BASE,key==='app'?'staged-app':'staged-manager'),f.path),dst=checked(ROOTS[key],f.path);
    await mkdir(dirname(dst),{recursive:true});await copyFile(src,dst);
    await verified(dst,f);
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
 const dest='D:\\Tong\\runtime\\login-management\\TongLoginRuntime.ps1';
 await copyFile(source,dest);await verified(dest,runner);
 await recordStage(dir,'runner-installed');
 console.log(JSON.stringify({ok:true,stage:'runner-installed'}));
}
async function checkInstalled(){
 const m=await read(join(RELEASE,'release-manifest.json'));
 const profile=await read(join(RUNTIME,'profile.json'));
 const pinApp=await read(join(RUNTIME,'run','release-pin.json')),pinManager=await read(join(RUNTIME,'run','manager-pin.json'));
 if(pinApp.commit!==NEW||pinManager.commit!==NEW||profile.sourceDigest!==m.files.find(x=>x.path==='code/source.tar')?.sha256||profile.releaseDigest!==sha(await data(join(RELEASE,'release-manifest.json'))))fail('INSTALL_METADATA_MISMATCH');
 for(const key of Object.keys(ROOTS))for(const f of m.sourceFiles)await verified(checked(ROOTS[key],f.path),f);
 const newRunner=m.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
 await verified('D:\\Tong\\runtime\\login-management\\TongLoginRuntime.ps1',newRunner);
 console.log(JSON.stringify({ok:true,stage:'installed-verified',app:pinApp.commit,manager:pinManager.commit}));
}
async function rollback(dir){
 const e=await existingSnapshot(dir);
 if(e.stage==='snapshotted')fail('NOT_MODIFIED');
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
 }
 for(const [name,target]of [['release-pin.json',join(RUNTIME,'run','release-pin.json')],['manager-pin.json',join(RUNTIME,'run','manager-pin.json')],['profile.json',join(RUNTIME,'profile.json')],['login-runner.ps1','D:\\Tong\\runtime\\login-management\\TongLoginRuntime.ps1']]){
  await copyFile(join(dir,name),target);
 }
 await recordStage(dir,'rolled-back-old-code');
 console.log(JSON.stringify({ok:true,stage:'rolled-back-old-code',snapshot:dir,oldApp:ORIGINAL.app,oldManager:ORIGINAL.manager,recoveryPermissionNeedsFreshHumanApproval:true}));
}
const [action,snapshot,...extra]=process.argv.slice(2);
try{
 if(extra.length)fail('UNEXPECTED_ARGUMENTS');
 if(action==='preflight'){
  const s=await official();console.log(JSON.stringify({ok:true,action,oldApp:s.oldPins.app.commit,oldManager:s.oldPins.manager.commit,newCommit:s.manifest.commit,
  appCount:s.manifest.sourceFiles.length,nativeCount:s.manifest.native.length,existingNewFiles:false}));
 }else if(action==='snapshot'){await makeSnapshot(await official());}
 else if(action==='install'){await install(snapshot);}
 else if(action==='install-runner'){await installRunner(snapshot);}
 else if(action==='verify-installed'){await checkInstalled();}
 else if(action==='rollback'){await rollback(snapshot);}
 else fail('BAD_ACTION');
}catch(error){console.error(String(error?.code??error?.message??error).slice(0,230));process.exitCode=1}
