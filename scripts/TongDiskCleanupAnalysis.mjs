import {mkdir,readFile,readdir,opendir,rename,open,unlink} from 'node:fs/promises';
import {join,dirname,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {cleanupGuards as g} from './TongManagedCleanup.mjs';
import {cleanupProtectedName,cleanupCacheFile} from './TongCleanupProtection.mjs';
import {windowsCleanupRoots,windowsCacheKind,windowsCachePublicPath,windowsCacheFile,windowsCacheDirectory} from './TongWindowsCleanup.mjs';

export class TongDiskCleanupAnalysis{
 constructor(manager,{knownRoots=windowsCleanupRoots,now=()=>Date.now()}={}){this.manager=manager;this.knownRoots=knownRoots;this.now=now;this.dir=join(dirname(manager.authorization.path),'disk-cleanup-analyses');}
 async analyze({path,drive,refresh=false}={}){
  if(path!==undefined&&drive!==undefined||drive!==undefined&&!['C','D'].includes(drive)||typeof refresh!=='boolean')g.fail('CLEANUP_ANALYSIS_INVALID');
  if(!await this.manager.access.authorize('disk.metadata'))g.fail('CLEANUP_PERMISSION_REQUIRED');
  if(path!==undefined)path=g.safePath(path);
  const roots=await this.knownRoots();
  if(path!==undefined){
   if(windowsCacheKind(path)){
    if(!roots.some(r=>g.same(r.path,path))||g.blockPath(windowsCachePublicPath(path)))g.fail('CLEANUP_PROTECTED_PATH');
    await g.checkAncestors(path);await g.plain(path,'directory');
   }else await this.manager.access.authorizeScanPath(path);
  }
  await g.checkAncestors(dirname(this.dir));await mkdir(this.dir,{recursive:true});await g.plain(this.dir,'directory');
  const key=createHash('sha256').update(JSON.stringify({path:path?.toLowerCase(),drive})).digest('hex'),file=join(this.dir,key+'.json');
  if(!refresh){try{
   const info=await g.plain(file,'file');if(info.size>131072)g.fail('CLEANUP_ANALYSIS_INVALID');
   const saved=JSON.parse(await readFile(file,'utf8'));
   if(saved.schemaVersion===1&&this.now()-Date.parse(saved.observedAt)>=0&&this.now()-Date.parse(saved.observedAt)<300000)return {...saved,entries:saved.entries.map(e=>({...e,deletionAuthorized:false})),reused:true,snapshotOnly:true};
  }catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}}
  const drives=await this.manager.access.listDrives();
  const entries=[],issues=[];let files=0,bytes=0,eligibleFiles=0,eligibleBytes=0,complete=true;
  if(path!==undefined){
   const kind=windowsCacheKind(path),known=kind&&roots.some(r=>g.same(r.path,path));
   if(kind&&!known)g.fail('CLEANUP_PERMISSION_REQUIRED');
   if(known){
    if(g.blockPath(windowsCachePublicPath(path)))g.fail('CLEANUP_PROTECTED_PATH');
    await g.checkAncestors(path);await g.plain(path,'directory');
    const queue=[{path,depth:0}],deadline=this.now()+1500;let visited=0;
    while(queue.length&&visited<2000&&this.now()<deadline){
     const item=queue.shift();await g.checkAncestors(item.path);
     let handle;try{handle=await opendir(item.path);}catch{issues.push('metadata_unavailable');complete=false;continue;}
     try{for await(const entry of handle){
      if(++visited>2000||this.now()>=deadline){complete=false;break;}
      if(cleanupProtectedName(entry.name,{directory:true})){continue;}
      const p=join(item.path,entry.name),rel=relative(path,p).replaceAll('\\','/');
      let info;try{info=await g.plain(p);}catch{issues.push('protected_or_unavailable');continue;}
      if(info.isDirectory()){
       if(windowsCacheDirectory(kind,rel)&&item.depth<8)queue.push({path:p,depth:item.depth+1});
       else{complete=false;if(entries.length<100)entries.push({path:p,type:'directory',bytes:null,classification:'retain-unrecognized',deletionAuthorized:false});}
       continue;
      }
      files++;bytes+=info.size;
      const eligible=windowsCacheFile(kind,rel,info,this.now());if(eligible){eligibleFiles++;eligibleBytes+=info.size;}
      if(entries.length<100)entries.push({path:p,type:'file',bytes:info.size,classification:eligible?'rebuildable-cache':'retain-unrecognized',deletionAuthorized:false});
     }}finally{await handle.close().catch(()=>{});}
    }
    if(queue.length||visited>=2000)complete=false;
   }else{
    const scan=await this.manager.access.scanDirectory({path,maxDepth:2,limit:200});
    files=scan.summary.files;bytes=Number(scan.summary.bytes);complete=!scan.truncated&&!scan.nextCursor;
    for(const item of scan.entries){
     const category=g.supportedTarget(item.path);
     entries.push({...item,classification:category==='cache'?'cache-preview-required':category?'retain-history-evidence-required':'retain-unrecognized',deletionAuthorized:false});
    }
   }
  }else{
   if(drive){
    try{const scan=await this.manager.access.scanDirectory({path:drive+':\\',maxDepth:0,limit:100});entries.push(...scan.entries.map(e=>({...e,classification:'retain-unrecognized',deletionAuthorized:false})));}
    catch{issues.push('drive_metadata_unavailable');}
   }
   for(const root of roots){if(drive&&!root.path.toUpperCase().startsWith(drive+':'))continue;
    try{await g.checkAncestors(root.path);await g.plain(root.path,'directory');entries.push({...root,classification:'cache-preview-required',deletionAuthorized:Boolean(await this.manager.authorization.resolve('tong-windows-cache',root.path,'cache'))});}
    catch{issues.push('known_cache_unavailable');entries.push({...root,classification:'retain-unavailable',deletionAuthorized:false});}
   }
   complete=false;
  }
  const result={schemaVersion:1,analysisId:randomUUID(),observedAt:new Date(this.now()).toISOString(),path,drive,drives,entries,files,logicalBytesObserved:bytes,eligibleFiles,eligibleBytes,complete,issues:[...new Set(issues)],deletionAuthorized:false,reused:false,snapshotOnly:true,requiresLiveVerification:true};
  if((await readdir(this.dir)).filter(n=>n.endsWith('.json')).length>=64){try{await g.plain(file,'file');}catch{g.fail('CLEANUP_ANALYSIS_STORE_FULL');}}
  const body=JSON.stringify(result)+'\n';if(Buffer.byteLength(body)>131072)g.fail('CLEANUP_ANALYSIS_TOO_LARGE');
  const temp=file+'.'+randomUUID()+'.tmp';const h=await open(temp,'wx',0o600);let moved=false;
  try{await h.writeFile(body);await h.sync();await h.close();await rename(temp,file);moved=true;}
  finally{await h.close().catch(()=>{});if(!moved)await unlink(temp).catch(()=>{});}
  return result;
 }
}
