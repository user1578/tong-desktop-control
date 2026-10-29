import {readdir,lstat,readFile,unlink,rmdir,appendFile,statfs,open,writeFile} from 'node:fs/promises';
import {join,dirname,basename,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {cleanupGuards as g} from './TongManagedCleanup.mjs';
import {cleanupProtectedName,cleanupCacheFile} from './TongCleanupProtection.mjs';
import {cleanupHandleDelete,cleanupHandleRead,cleanupHandleList} from './TongCleanupNative.mjs';

const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink].join(':');
const hash=b=>createHash('sha256').update(b).digest('hex');
const validRel=p=>typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..'||x.includes(':'));
const portable=(root,p)=>relative(root,p).replaceAll('\\','/');
async function gitProtected(target){
 let root=dirname(target);
 for(;;){
  try{
   await lstat(join(root,'.git'));
   const output=await new Promise((accept,reject)=>{
    const child=spawn(process.platform==='win32'?'C:\\Program Files\\Git\\bin\\git.exe':'git',['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',root,'ls-files','--cached','--others','--exclude-standard','-z','--',portable(root,target)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
    let result=Buffer.alloc(0);const timer=setTimeout(()=>child.kill(),10000);
    child.stdout.on('data',b=>{result=Buffer.concat([result,b]);if(result.length>4*1024**2)child.kill();});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?accept(result.toString('utf8')):reject(Error('Git metadata unavailable'));});
   }).catch(()=>g.fail('CLEANUP_GIT_STATE_UNKNOWN'));
   return new Set(output.split('\0').filter(Boolean).map(p=>resolve(root,...p.split('/'))).map(p=>p.toLowerCase()));
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=dirname(root);if(parent===root)break;root=parent;
 }
 return new Set();
}
function assertSelectionTarget(root,target,exact){
 if(exact){if(g.blockPath(root)||g.blockPath(target))g.fail('CLEANUP_PROTECTED_PATH');}
 else g.assertTarget(root,target);
}
async function parallel(items,fn){
 let next=0,failure;
 await Promise.all(Array.from({length:Math.min(8,items.length)},async()=>{while(next<items.length&&!failure){try{await fn(items[next++]);}catch(e){failure??=e;}}}));
 if(failure)throw failure;
}
export async function cleanupFreeBytes(path){try{const s=await statfs(path,{bigint:true});return String(s.bavail*s.bsize);}catch{return null;}}
export async function cleanupInventory(target,{dependency=false,exact=false,progress=async()=>{},check=async()=>{}}={}){
 const files=[],directories=[],protectedItems=[];let bytes=0,seen=0;
 const git=await gitProtected(target),rootInfo=await g.plain(target);
 if(rootInfo.isFile()){
  if(cleanupProtectedName(basename(target),{dependency})||git.has(target.toLowerCase()))protectedItems.push({path:basename(target),reason:'hard-protection'});
  else{files.push({path:'',size:rootInfo.size,stamp:fingerprint(rootInfo)});bytes=rootInfo.size;}
  return {files,directories,protectedItems,bytes};
 }
 const stack=[target];
 while(stack.length){
  await check();const dir=stack.pop();await g.plain(dir,'directory');directories.push(portable(target,dir));
  const entries=await cleanupHandleList(dir);
  if(entries.some(name=>name.toLowerCase()==='.git')){protectedItems.push({path:portable(target,dir),reason:'git-worktree'});continue;}
  for(const name of entries){
   const p=join(dir,name),rel=portable(target,p);
   if(++seen>120000)g.fail('CLEANUP_TOO_MANY_FILES');
   if(cleanupProtectedName(name,{dependency,directory:true})||!dependency&&name.toLowerCase()==='node_modules'||git.has(p.toLowerCase())){
    protectedItems.push({path:rel,reason:'hard-protection'});continue;
   }
   let info;
   try{info=await g.plain(p);}catch(e){protectedItems.push({path:rel,reason:e.code??'CLEANUP_UNSAFE_ITEM'});continue;}
   if(info.isDirectory())stack.push(p);
   else{
    if(!dependency&&!exact&&!cleanupCacheFile(basename(target).toLowerCase(),rel)){protectedItems.push({path:rel,reason:'not-proven-disposable'});continue;}
    files.push({path:rel,size:info.size,stamp:fingerprint(info)});bytes+=info.size;
   }
   if(bytes>4*1024**3)g.fail('CLEANUP_TOO_LARGE');
  }
  await progress({phase:'scanning',scannedFiles:files.length,scannedBytes:bytes,scannedDirectories:directories.length,protectedCount:protectedItems.length});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path));
 return {files,directories,protectedItems,bytes};
}
async function readWitness(path,witnesses,{body=true}={}){
 const before=await g.plain(path,'file');
 const value=await cleanupHandleRead(path,{size:before.size,stamp:fingerprint(before)},{body});const after=await g.plain(path,'file');
 if(fingerprint(before)!==fingerprint(after))g.fail('CLEANUP_TARGET_CHANGED');
 witnesses.set(path,{path,stamp:fingerprint(after)});return value;
}
// Compare only the selected third-party dependency files. Source/Agent material
// in the candidate is never opened or deleted. The retained release stays intact.
async function verifyDependencies(target,inventory,retained,{progress,check,referenceCache=new Map()}){
 const candidate=dirname(target),tag=basename(candidate).replace(/^(?:quick-trust-)?candidate-/,''),
  release=join(dirname(candidate),basename(candidate).startsWith('quick-trust-')?'quick-trust-release-'+tag:'release-'+tag);
 const witnesses=new Map(),read=p=>readWitness(p,witnesses),digest=p=>readWitness(p,witnesses,{body:false});
 const manifest=JSON.parse(await read(join(release,'release-manifest.json'))),proof=JSON.parse(await read(join(candidate,'release-restore-evidence.json')));
 if(manifest.commit?.slice(0,tag.length)!==tag||proof.commit!==manifest.commit||proof.patchChecked!==true||proof.sqliteNativeLoaded!==true||proof.nativeRestore!=='exact archived hashes')g.fail('CLEANUP_ARCHIVE_INVALID');
 if(!Array.isArray(manifest.files))g.fail('CLEANUP_ARCHIVE_INVALID');
 const archives=manifest.files.filter(x=>x.path==='code/source.tar'||x.path==='code/source/package-lock.json'||String(x.path).startsWith('native/node_modules/'));
 if(archives.length<25||!archives.some(x=>x.path==='code/source.tar')||!archives.some(x=>x.path==='code/source/package-lock.json'))g.fail('CLEANUP_ARCHIVE_INVALID');
 for(const item of archives){
  await check();if(!validRel(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256??''))g.fail('CLEANUP_ARCHIVE_INVALID');
  const parts=item.path.split('/').slice(2);if(parts.some((name,i)=>cleanupProtectedName(name,{dependency:true,directory:i<parts.length-1})))g.fail('CLEANUP_PROTECTED_CONTENT');
  if(await digest(join(release,...item.path.split('/')))!==item.sha256)g.fail('CLEANUP_ARCHIVE_MISMATCH');
  await progress({phase:'verifying',stage:'release',verifiedArchive:item.path});
 }
 const expectedLock=archives.find(x=>x.path==='code/source/package-lock.json').sha256;
 if(hash(await read(join(candidate,'package-lock.json')))!==expectedLock)g.fail('CLEANUP_ARCHIVE_MISMATCH');
 await g.checkAncestors(retained);
 let verifiedFiles=0,verifiedBytes=0;
 await parallel(inventory.files,async item=>{
  await check();const p=join(target,...item.path.split('/'));
  const patch=item.path.match(/^@waishnav\/devspace\/dist\/(pi-tools\.js|server\.js|workspaces\.js)$/);
  let expected;
  if(patch){expected=manifest.expectedDevspaceHashes?.[patch[1]];if(!/^[a-f0-9]{64}$/.test(expected??''))g.fail('CLEANUP_ARCHIVE_INVALID');}
  else{
   const saved=join(retained,...item.path.split('/'));
   const info=await g.plain(saved,'file').catch(()=>g.fail('CLEANUP_DEPENDENCY_MISMATCH'));if(info.size!==item.size)g.fail('CLEANUP_DEPENDENCY_MISMATCH');
   const stamp=fingerprint(info),cached=referenceCache.get(saved);
   let digest=cached?.stamp===stamp?cached.digest:null;
   if(!digest){digest=await readWitness(saved,witnesses,{body:false});referenceCache.set(saved,{stamp,digest});}
   else witnesses.set(saved,{path:saved,stamp});
   expected=digest;
  }
  // Unknown files with no retained counterpart are rejected before their body
  // is opened; only a proven dependency path proceeds to content comparison.
  const actual=await digest(p);
  if(witnesses.get(p).stamp!==item.stamp)g.fail('CLEANUP_TARGET_CHANGED');
  witnesses.delete(p);
  if(actual!==expected)g.fail('CLEANUP_DEPENDENCY_MISMATCH');
  verifiedFiles++;verifiedBytes+=item.size;
  await progress({phase:'verifying',stage:'dependencies',verifiedFiles,verifiedBytes});
 });
 return {witnesses:[...witnesses.values()],release,lock:expectedLock};
}
export async function prepareCleanupSelection(manager,{projectId,path,exact=false},hooks={}){
 const {progress=async()=>{},check=async()=>{},referenceCache}=hooks,target=g.safePath(path),category=g.supportedTarget(target);
 const {root,revision}=await g.safeAuthorizedRoot(manager.access,manager.authorization,projectId,target,{execute:true,exact});
 assertSelectionTarget(root,target,exact);await g.checkAncestors(target);await g.plain(target);
 await progress({phase:'verifying',stage:'references'});await check();
 await g.pinnedProtected(target,manager.productionRoot);
 const referenceTarget=basename(target)==='node_modules'?dirname(target):target;
 const referenceWarnings=await g.assertNoRuntimeReferences(referenceTarget);
 const dependency=basename(target)==='node_modules'&&['historical-candidate','quick-trust-candidate'].includes(category);
 // Broad historic parents are deliberately not deletion targets in this path.
 if(!exact&&category!=='cache'&&!dependency)g.fail('CLEANUP_SELECT_DEPENDENCY_SUBTREE');
 if(exact&&basename(target).toLowerCase()==='node_modules'&&!dependency)g.fail('CLEANUP_SHARED_DEPENDENCY_DENIED');
 const inventory=await cleanupInventory(target,{dependency,exact,progress,check});
 const evidence=dependency?await verifyDependencies(target,inventory,manager.retainedDependencies,{progress,check,referenceCache}):{witnesses:[]};
 return {schemaVersion:1,projectId,target,root,revision,category:exact?'exact':category,exact,dependency,inventory,evidence,referenceWarnings,preparedAt:Date.now()};
}
async function livePermission(manager,plan){
 const auth=await g.safeAuthorizedRoot(manager.access,manager.authorization,plan.projectId,plan.target,{execute:true,exact:plan.exact});
 if(!g.same(auth.root,plan.root)||auth.revision!==plan.revision)g.fail('CLEANUP_PERMISSION_CHANGED');
 assertSelectionTarget(auth.root,plan.target,plan.exact);await g.checkAncestors(plan.target);await g.pinnedProtected(plan.target,manager.productionRoot);
}
async function pins(manager,target){
 if(!g.within('D:\\Tong\\state',target))return '';
 const records=[];for(const name of ['release-pin.json','manager-pin.json'])records.push(fingerprint(await g.plain(join(manager.productionRoot,'run',name),'file')));return records.join('|');
}
export async function executeCleanupSelection(manager,plan,{progress=async()=>{},check=async()=>{},journalPath}={}){
 if(!journalPath||g.within(plan.target,journalPath))g.fail('CLEANUP_AUDIT_TARGET');
 let records=[];
 try{
  await g.plain(journalPath,'file');const bytes=await readFile(journalPath),end=bytes.lastIndexOf(10)+1;
  records=bytes.subarray(0,end).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  if(end<bytes.length){
   await writeFile(journalPath+'.torn-'+Date.now(),bytes.subarray(end),{flag:'wx',mode:0o600});
   const handle=await open(journalPath,'r+');try{await handle.truncate(end);await handle.sync();}finally{await handle.close();}
  }
 }catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
 const finished=records.findLast(x=>x.event==='cleanup_result');
 if(finished&&!finished.skipped.length&&!finished.ambiguousMissing.length)return {path:finished.path,files:finished.files,logicalBytes:finished.logicalBytes,freeBytesBefore:finished.freeBytesBefore,freeBytesAfter:finished.freeBytesAfter,protectedCount:finished.protectedCount,protectedItems:finished.protectedItems,skipped:finished.skipped,ambiguousMissing:finished.ambiguousMissing};
 const deleted=new Map(records.filter(x=>x.event==='deleted').map(x=>[x.path,x.bytes]));
 const intents=new Set(records.filter(x=>x.event==='delete_intent').map(x=>x.path));
 try{await g.plain(plan.target);}catch(e){
  if(e.code!=='CLEANUP_PATH_MISSING')throw e;
  if(plan.inventory.protectedItems.length||plan.inventory.files.some(f=>!deleted.has(f.path)&&!intents.has(f.path)))g.fail('CLEANUP_TARGET_CHANGED');
  return {path:plan.target,files:deleted.size,logicalBytes:[...deleted.values()].reduce((a,b)=>a+b,0),freeBytesBefore:null,freeBytesAfter:await cleanupFreeBytes(dirname(plan.target)),protectedCount:0,protectedItems:[],skipped:[],ambiguousMissing:plan.inventory.files.filter(f=>!deleted.has(f.path)).map(f=>f.path),reconciled:true};
 }
 const pinIdentity=await pins(manager,plan.target);
 await livePermission(manager,plan);
 if(await pins(manager,plan.target)!==pinIdentity)g.fail('CLEANUP_PIN_CHANGED');
 await progress({phase:'verifying',stage:'predelete-references'});
 const referenceWarnings=await g.assertNoRuntimeReferences(plan.dependency?dirname(plan.target):plan.target);
 for(const item of plan.evidence.witnesses){
  await check();
  if(fingerprint(await g.plain(item.path,'file'))!==item.stamp)g.fail('CLEANUP_ARCHIVE_OR_REFERENCE_CHANGED');
 }
 const journal=async value=>{
  await g.checkAncestors(dirname(journalPath));
  try{await g.plain(journalPath,'file');}catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
  const h=await open(journalPath,'a',0o600);try{await h.writeFile(JSON.stringify({at:new Date().toISOString(),...value})+'\n');if(value.event==='delete_intent'||value.event==='cleanup_result')await h.sync();}finally{await h.close();}
 };
 const current=await cleanupInventory(plan.target,{dependency:plan.dependency,exact:plan.exact,progress,check});
 const expected=new Map(plan.inventory.files.map(x=>[x.path,x]));
 for(const file of current.files){if(!expected.has(file.path)||expected.get(file.path).stamp!==file.stamp||deleted.has(file.path))g.fail('CLEANUP_TARGET_CHANGED');}
 const existing=new Set(current.files.map(x=>x.path));
 const ambiguous=[];
 for(const file of plan.inventory.files){
  if(!existing.has(file.path)&&!deleted.has(file.path)){
   if(!intents.has(file.path))g.fail('CLEANUP_TARGET_CHANGED');
   ambiguous.push(file.path);
  }
 }
 // A crash between unlink and its receipt is explicitly reconciled, never
 // counted as a confirmed deletion. Remaining verified files can still proceed.
 let files=deleted.size,logicalBytes=[...deleted.values()].reduce((a,b)=>a+b,0),skipped=[];
 const freeBytesBefore=await cleanupFreeBytes(plan.target);
 await journal({event:'cleanup_begin',projectId:plan.projectId,path:plan.target,revision:plan.revision,referenceWarnings});
 let permissionAt=0;
 for(const file of current.files){
  await check();
  if(Date.now()-permissionAt>10000){await livePermission(manager,plan);permissionAt=Date.now();}
  const p=join(plan.target,...file.path.split('/'));
  if(cleanupProtectedName(basename(p),{dependency:plan.dependency})||fingerprint(await g.plain(p,'file'))!==file.stamp)g.fail('CLEANUP_TARGET_CHANGED');
  await journal({event:'delete_intent',path:file.path,bytes:file.size});
  // Observe cancellation/revocation immediately before each new unlink batch.
  await check(true);
  if(await pins(manager,plan.target)!==pinIdentity)g.fail('CLEANUP_PIN_CHANGED');
  if(plan.revision==='project-write')await livePermission(manager,plan);
  else await manager.authorization.assertCurrent({projectId:plan.projectId,target:plan.target,category:g.supportedTarget(plan.target),root:plan.root,revision:plan.revision});
  try{await cleanupHandleDelete(p,file);}catch(e){
   if(!['EPERM','EACCES','EBUSY','ENOENT','CLEANUP_WIN32_2','CLEANUP_WIN32_3','CLEANUP_WIN32_5','CLEANUP_WIN32_32','CLEANUP_WIN32_33'].includes(e.code))throw e;
   skipped.push({path:file.path,reason:e.code});await journal({event:'skipped',path:file.path,code:e.code});continue;
  }
  await journal({event:'deleted',path:file.path,bytes:file.size});
  files++;logicalBytes+=file.size;
  await progress({phase:'deleting',deletedFiles:files,deletedBytes:logicalBytes,remainingFiles:current.files.length-(files-deleted.size),skippedCount:skipped.length});
 }
 await progress({phase:'verifying_result'});
 // Only remove empty directories; protected/new content always keeps its parent.
 for(const rel of current.directories.sort((a,b)=>b.length-a.length)){
  await check(true);if(Date.now()-permissionAt>10000){await livePermission(manager,plan);permissionAt=Date.now();}
  if(await pins(manager,plan.target)!==pinIdentity)g.fail('CLEANUP_PIN_CHANGED');
  if(plan.revision==='project-write')await livePermission(manager,plan);
  else await manager.authorization.assertCurrent({projectId:plan.projectId,target:plan.target,category:g.supportedTarget(plan.target),root:plan.root,revision:plan.revision});
  const p=join(plan.target,...rel.split('/').filter(Boolean));
  try{await g.checkAncestors(p);await cleanupHandleDelete(p);}catch(e){if(!['ENOTEMPTY','EEXIST','ENOENT','EPERM','EACCES','CLEANUP_WIN32_145','CLEANUP_WIN32_2','CLEANUP_WIN32_3','CLEANUP_WIN32_5','CLEANUP_WIN32_32'].includes(e.code))throw e;}
 }
 const freeBytesAfter=await cleanupFreeBytes(dirname(plan.target));
 const result={path:plan.target,files,logicalBytes,freeBytesBefore,freeBytesAfter,protectedCount:current.protectedItems.length,protectedItems:current.protectedItems.slice(0,100),skipped,ambiguousMissing:ambiguous};
 await journal({event:'cleanup_result',...result});return result;
}
