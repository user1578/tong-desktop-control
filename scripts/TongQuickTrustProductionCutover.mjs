import {readFile,writeFile,mkdir,lstat,realpath,copyFile,rename,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRelease} from './TongRuntimeRelease.mjs';

const OLD='a1b56b3666651c3648327f05e0ea4154284645c3';
const NEXT='0a2da3c61a71da65191640bd18e4711992430667';
const BASE='D:\\Tong\\state\\p27-autonomy-candidate-20261017';
const RELEASE=join(BASE,'quick-trust-release-0a2da3c');
const CANDIDATE=join(BASE,'quick-trust-candidate-0a2da3c');
const SNAPSHOT=join(BASE,'quick-trust-snapshot-0a2da3c');
const APP='D:\\Tong\\app';
const RUNTIME='D:\\Tong\\runtime';
const MANAGER=join(RUNTIME,'releases','manager');
const fail=message=>{throw Error('QT_CUTOVER_'+message)};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
function scope(root,item){
  if(typeof item!=='string'||!item||item.includes('\\')||item.startsWith('/')||
     item.split('/').some(x=>!x||x==='.'||x==='..'||/[<>:"|?*\0-\x1f]/.test(x)))fail('PATH_DENIED');
  const target=resolve(root,...item.split('/'));
  const rel=relative(root,target);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))fail('PATH_DENIED');
  return target;
}
async function regular(path) {
  const meta=await lstat(path);
  if(!meta.isFile()||meta.nlink!==1||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())
    fail('UNSAFE_FILE');
  return meta;
}
async function verify(path,entry) {
  const meta=await regular(path),bytes=await readFile(path);
  if(meta.size!==entry.size||digest(bytes)!==entry.sha256)fail('HASH_MISMATCH');
  return bytes;
}
async function sameFile(a,b){
  const aa=await regular(a),bb=await regular(b);
  return aa.size===bb.size && digest(await readFile(a))===digest(await readFile(b));
}
async function preflight() {
  const manifest=await verifyRelease({releaseRoot:RELEASE});
  if(manifest.commit!==NEXT||manifest.sourceFiles.length!==260||
      manifest.node?.executable.toLowerCase()!=='d:\\node\\node.exe')fail('INVALID_RELEASE');
  const restored=await read(join(CANDIDATE,'release-restore-evidence.json'));
  if(restored.sourceFilesVerified!==260||restored.patchChecked!==true||
     restored.sqliteNativeLoaded!==true||restored.releaseRoot!==RELEASE)fail('RESTORE_NOT_VERIFIED');
  const appPin=await read(join(RUNTIME,'run','release-pin.json'));
  const managerPin=await read(join(RUNTIME,'run','manager-pin.json'));
  const profile=await read(join(RUNTIME,'profile.json'));
  if(appPin.commit!==OLD||managerPin.commit!==OLD||
     profile.codeRoot!==APP||profile.managerRoot!==MANAGER||
     profile.sourceDigest!==appPin.files.find(x=>x.path==='code/source.tar')?.sha256)
    fail('PRODUCTION_NOT_EXPECTED');
  // Both components remain integrity-pinned; this upgrade modifies APP only.
  for(const f of appPin.sourceFiles)await verify(scope(APP,f.path),f);
  for(const f of managerPin.sourceFiles)await verify(scope(MANAGER,f.path),f);
  const oldNames=new Set(appPin.sourceFiles.map(x=>x.path));
  for(const f of manifest.sourceFiles){
    await verify(scope(CANDIDATE,f.path),f);
    if(!oldNames.has(f.path)){
      try{await lstat(scope(APP,f.path));fail('NEW_FILE_COLLISION')}
      catch(e){if(e.code!=='ENOENT')throw e}
    }
  }
  const oldNative=appPin.native, currentNative=manifest.native;
  if(JSON.stringify(oldNative)!==JSON.stringify(currentNative))fail('NATIVE_DIFFERS');
  return {manifest,appPin,managerPin,profile};
}
async function saved(){
  const meta=await read(join(SNAPSHOT,'snapshot.json'));
  if(meta.schemaVersion!==1||meta.oldCommit!==OLD||meta.newCommit!==NEXT||
     !['snapshotted','state-backed-up','files-installing','files-installed','activated','rolled-back'].includes(meta.stage))
      fail('SNAPSHOT_INVALID');
  return meta;
}
async function updateStage(stage) {
  const state=await saved();
  const next={...state,stage,updatedAt:new Date().toISOString()};
  const file=join(SNAPSHOT,'snapshot.json');
  await writeFile(file,JSON.stringify(next,null,2)+'\n');
}
async function snapshot(){
  const baseline=await preflight();
  try{await lstat(SNAPSHOT);fail('SNAPSHOT_ALREADY_EXISTS')}catch(e){if(e.code!=='ENOENT')throw e}
  await mkdir(SNAPSHOT);
  const files=baseline.appPin.sourceFiles;
  for(const f of files){
    const target=scope(join(SNAPSHOT,'old-app'),f.path);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,await verify(scope(APP,f.path),f),{flag:'wx'});
  }
  const extra={
    'release-pin.json':join(RUNTIME,'run','release-pin.json'),
    'manager-pin.json':join(RUNTIME,'run','manager-pin.json'),
    'profile.json':join(RUNTIME,'profile.json'),
  };
  for(const [name,path] of Object.entries(extra))await copyFile(path,join(SNAPSHOT,name));
  await writeFile(join(SNAPSHOT,'snapshot.json'),JSON.stringify({
    schemaVersion:1,oldCommit:OLD,newCommit:NEXT,stage:'snapshotted',
    sourceFileCount:files.length,createdAt:new Date().toISOString(),
  },null,2)+'\n',{flag:'wx'});
  return {status:'source-snapshot-created',path:SNAPSHOT,sourceFiles:files.length};
}
async function stopped(){
  const {runtimeStatus}=await import(pathToFileURL(join(MANAGER,'scripts','TongAgentDockRuntime.mjs')).href);
  const actual=await runtimeStatus(RUNTIME);
  if(actual.phase!=='stopped'||actual.supervisorAlive||actual.guardianAlive||!actual.runId)
    fail('RUNTIME_NOT_STOPPED');
  const guardian=await read(join(RUNTIME,'run','guardian.json'));
  if(guardian.runId!==actual.runId||!guardian.finishedAt||guardian.jobActiveAfterCleanup!==0)
    fail('JOB_STILL_ACTIVE');
  return actual;
}
const STATE=[
  ['app-runtime',join(APP,'runtime')],
  ['policy',join(RUNTIME,'tong-policy')],
  ['backend-state',join(RUNTIME,'backend-state')],
  ['home',join(RUNTIME,'home')],
  ['secrets',join(RUNTIME,'secrets')],
  ['run',join(RUNTIME,'run')],
];
async function backupTree(source,target){
  const result=[];
  async function scan(current,prefix=''){
    const meta=await lstat(current);
    if(meta.isSymbolicLink()||(await realpath(current)).toLowerCase()!==resolve(current).toLowerCase())fail('BACKUP_REPARSE_DENIED');
    if(meta.isFile()){
      if(meta.nlink!==1||meta.size>32*1024*1024)fail('BACKUP_FILE_DENIED');
      const rel=prefix.replace(/\\/g,'/');
      const output=scope(target,rel);
      await mkdir(dirname(output),{recursive:true});
      const bytes=await readFile(current);
      await writeFile(output,bytes,{flag:'wx'});
      const hash=digest(bytes);
      if(digest(await readFile(output))!==hash)fail('BACKUP_HASH_MISMATCH');
      result.push({relative:rel,bytes:bytes.length,sha256:hash});
      return;
    }
    if(!meta.isDirectory())fail('BACKUP_SPECIAL_FILE');
    for(const name of await readdir(current))await scan(join(current,name),prefix?prefix+'/'+name:name);
  }
  await scan(source);
  return result;
}
async function backupState(){
  await stopped();
  const meta=await saved();
  if(meta.stage!=='snapshotted')fail('SNAPSHOT_STAGE');
  const results={};
  let bytes=0;
  for(const [name,source] of STATE){
    const records=await backupTree(source,join(SNAPSHOT,'state',name));
    bytes+=records.reduce((n,x)=>n+x.bytes,0);
    if(bytes>100*1024*1024)fail('BACKUP_SIZE_LIMIT');
    results[name]={files:records.length,bytes,sha256:digest(JSON.stringify(records))};
  }
  await writeFile(join(SNAPSHOT,'state-backup-summary.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
  await updateStage('state-backed-up');
  return {status:'state-snapshotted',paths:STATE.length,totalMB:Math.round(bytes/1048576*100)/100};
}
async function installFiles(){
  await stopped();
  const meta=await saved();
  if(meta.stage!=='state-backed-up')fail('SNAPSHOT_STAGE');
  const source=await read(join(SNAPSHOT,'release-pin.json'));
  const current=await read(join(RUNTIME,'run','release-pin.json'));
  if(source.commit!==OLD||current.commit!==OLD)fail('BASELINE_CHANGED');
  for(const f of source.sourceFiles){
    await verify(scope(join(SNAPSHOT,'old-app'),f.path),f);
    await verify(scope(APP,f.path),f);
  }
  const candidate=(await verifyRelease({releaseRoot:RELEASE})).sourceFiles;
  const oldNames=new Set(source.sourceFiles.map(f=>f.path));
  for(const f of candidate){
    await verify(scope(CANDIDATE,f.path),f);
    if(!oldNames.has(f.path)){
      try{await lstat(scope(APP,f.path));fail('NEW_FILE_COLLISION')}
      catch(e){if(e.code!=='ENOENT')throw e}
    }
  }
  await updateStage('files-installing');
  for(const f of candidate){
    const src=scope(CANDIDATE,f.path),dst=scope(APP,f.path);
    await mkdir(dirname(dst),{recursive:true});
    await copyFile(src,dst);
    await verify(dst,f);
  }
  await updateStage('files-installed');
  return {status:'files-installed-not-activated',files:candidate.length,
    requiresOfficialActivate:true};
}
async function activated(){
  const current=await saved();
  if(current.stage!=='files-installed')fail('INVALID_STAGE');
  const manifest=await verifyRelease({releaseRoot:RELEASE});
  const pin=await read(join(RUNTIME,'run','release-pin.json'));
  const profile=await read(join(RUNTIME,'profile.json'));
  const bytes=await readFile(join(RELEASE,'release-manifest.json'));
  if(pin.commit!==NEXT||profile.sourceDigest!==
     manifest.files.find(x=>x.path==='code/source.tar')?.sha256 ||
     profile.releaseDigest!==digest(bytes))fail('PRODUCTION_PIN_NOT_ACTIVATED');
  for(const f of manifest.sourceFiles)await verify(scope(APP,f.path),f);
  const managerPin=await read(join(RUNTIME,'run','manager-pin.json'));
  if(managerPin.commit!==OLD)fail('MANAGER_CHANGED');
  await updateStage('activated');
  return {status:'verified-activated',app:pin.commit,manager:managerPin.commit};
}
async function rollback(){
  await stopped();
  const state=await saved();
  if(!['files-installing','files-installed','activated'].includes(state.stage))
    fail('ROLLBACK_STAGE');
  const oldPin=await read(join(SNAPSHOT,'release-pin.json'));
  const current=await read(join(RUNTIME,'run','release-pin.json'));
  if(![OLD,NEXT].includes(current.commit))fail('UNRECOGNIZED_PIN');
  const manifest=await read(join(RELEASE,'release-manifest.json'));
  const oldNames=new Set(oldPin.sourceFiles.map(f=>f.path));
  for(const f of manifest.sourceFiles){
    if(oldNames.has(f.path))continue;
    const target=scope(APP,f.path);
    try{
      await regular(target);
      const retired=scope(join(SNAPSHOT,'retired-new'),f.path);
      await mkdir(dirname(retired),{recursive:true});
      await rename(target,retired);
    }catch(e){if(e.code!=='ENOENT')throw e}
  }
  for(const f of oldPin.sourceFiles){
    const src=scope(join(SNAPSHOT,'old-app'),f.path),dst=scope(APP,f.path);
    await verify(src,f);await mkdir(dirname(dst),{recursive:true});
    await copyFile(src,dst);await verify(dst,f);
  }
  for(const [name,target] of [
    ['release-pin.json',join(RUNTIME,'run','release-pin.json')],
    ['profile.json',join(RUNTIME,'profile.json')],
  ])await copyFile(join(SNAPSHOT,name),target);
  await updateStage('rolled-back');
  return {status:'rolled-back-code-and-pin',releaseCommit:OLD,
    note:'Recheck sealed recovery authorization before restarting.'};
}
const action=process.argv[2];
if(process.argv.length!==3||!['preflight','snapshot','backup-state','install-files','confirm-activated','rollback'].includes(action))
  throw Error('USAGE: preflight|snapshot|backup-state|install-files|confirm-activated|rollback');
try{
  const result=action==='preflight'?await preflight():action==='snapshot'?await snapshot():
    action==='backup-state'?await backupState():action==='install-files'?await installFiles():
    action==='confirm-activated'?await activated():await rollback();
  const summary=result?.manifest?{status:'preflight-passed',old:OLD,new:NEXT,
    sourceFiles:result.manifest.sourceFiles.length,managerUnchanged:true}:result;
  console.log(JSON.stringify(summary));
}catch(e){console.error(String(e.message??e).slice(0,170));process.exitCode=1}
