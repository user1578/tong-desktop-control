import {randomUUID, createHash} from 'node:crypto';
import {lstat, realpath, readdir, rm, appendFile, mkdir, readFile} from 'node:fs/promises';
import {isAbsolute, resolve, relative, sep, parse, basename, dirname, join} from 'node:path';

const CACHE_NAMES=new Set(['npm-cache','.npm-cache','node-compile-cache','.pytest_cache','__pycache__','.cache']);
const PRIVATE_PARTS=new Set(['.git','.hg','.svn','.ssh','.codex','.devspace','appdata','program files','program files (x86)','windows','system volume information','$recycle.bin','.aws','.gnupg','credentials','secrets','state-backups','state-restores','oauth','runtime']);
const LOCK_NAMES=/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const maxItems=120000,maxBytes=4*1024**3,ttl=5*60*1000;
const same=(a,b)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
const within=(root,target)=>{const rel=relative(resolve(root),resolve(target));return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));};
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const safePath=p=>{
  if(typeof p!=='string'||p.length>2048||!isAbsolute(p)||p.includes('\0')||/^[\\/]{2}/.test(p))fail('CLEANUP_INVALID_PATH');
  const parts=p.slice(parse(p).root.length).split(/[\\/]/);
  if(parts.some(x=>x==='..'||x.includes(':')))fail('CLEANUP_INVALID_PATH');
  return resolve(p);
};
async function plain(path,kind){
  const x=await lstat(path).catch(()=>fail('CLEANUP_PATH_MISSING'));
  if(x.isSymbolicLink()||!x.isDirectory()&&!x.isFile()||kind==='directory'&&!x.isDirectory()||kind==='file'&&!x.isFile()||x.nlink>1)fail('CLEANUP_UNSAFE_ITEM');
  if(!same(await realpath(path),path))fail('CLEANUP_REPARSE_PATH');
  return x;
}
async function checkAncestors(path){
  let current=parse(path).root;
  await plain(current,'directory');
  for(const part of relative(current,path).split(/[\\/]/).filter(Boolean)){
    current=join(current,part);
    await plain(current);
  }
}
function blockPath(p){
  const normalized=p.toLowerCase();
  if(/[\\/](?:windows|program files(?: \(x86\))?|programdata|users[\\/][^\\/]+[\\/]appdata)(?:[\\/]|$)/i.test(p))return true;
  const parts=relative(parse(p).root,p).split(/[\\/]/).map(x=>x.toLowerCase());
  if(parts.some(x=>PRIVATE_PARTS.has(x)||/^\.env(?:\.|$)/.test(x)))return true;
  return normalized.includes('\\tong\\runtime\\')||normalized.includes('\\tong\\app\\')||normalized.includes('\\tong\\tools\\');
}
// Conservative targeted categories only; explicitly reject arbitrary source
// projects, personal folders and broad root-directory removal.
function supportedTarget(p){
  const base=basename(p).toLowerCase();
  if(CACHE_NAMES.has(base))return 'cache';
  if(/^candidate-[a-f0-9]{7,12}$/.test(base) && /[\\/]b23-release-[a-z0-9]+[\\/]candidate-[a-f0-9]{7,12}$/i.test(p))return 'historical-candidate';
  return null;
}
async function snapshot(target){
  let files=0,dirs=0,total=0,lastSha=createHash('sha256');
  const stack=[target];
  while(stack.length){
    const dir=stack.pop();
    const entries=await readdir(dir,{withFileTypes:true}).catch(()=>fail('CLEANUP_SCAN_FAILED'));
    dirs++;
    if(dirs+files>maxItems)fail('CLEANUP_TOO_MANY_FILES');
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const item of entries){
      const path=join(dir,item.name);
      const x=await plain(path);
      if(item.isSymbolicLink()||x.isSymbolicLink()||x.nlink>1)fail('CLEANUP_UNSAFE_ITEM');
      const rel=relative(target,path);
      if(x.isDirectory())stack.push(path);
      else if(x.isFile()){files++;total+=x.size;}
      else fail('CLEANUP_UNSAFE_ITEM');
      if(total>maxBytes)fail('CLEANUP_TOO_LARGE');
      lastSha.update(rel).update('\0').update(String(x.size)).update('\0').update(String(x.mtimeMs)).update('\0').update(x.isDirectory()?'d':'f');
    }
  }
  return {files,directories:dirs,bytes:total,signature:lastSha.digest('hex')};
}
async function safeAuthorizedRoot(access,projectId,target){
  const p=(await access.listProjects()).find(item=>item.id===projectId&&item.available&&item.status==='enabled'&&item.effectiveCapabilities.includes('project.write'));
  if(!p)fail('CLEANUP_PERMISSION_REQUIRED');
  const root=safePath(p.root);
  await checkAncestors(root);
  if(same(root,target)||!within(root,target))fail('CLEANUP_OUTSIDE_ROOT');
  return root;
}
function assertTarget(root,target){
  if(blockPath(target)||blockPath(root))fail('CLEANUP_PROTECTED_PATH');
  if(!supportedTarget(target))fail('CLEANUP_CATEGORY_NOT_ALLOWED');
  if(target.toLowerCase().includes('\\node_modules\\')||basename(target).toLowerCase()==='node_modules')fail('CLEANUP_SHARED_DEPENDENCY_DENIED');
  if(LOCK_NAMES.test(basename(target)))fail('CLEANUP_LOCK_FILE_DENIED');
}
async function pinnedProtected(target,productionRoot){
  if(!within('D:\\Tong\\state',target))return;
  for(const name of ['release-pin.json','manager-pin.json']){
    const doc=JSON.parse(await readFile(join(productionRoot,'run',name),'utf8').catch(()=>fail('CLEANUP_PIN_UNAVAILABLE')));
    if(!doc?.releaseRoot||!isAbsolute(doc.releaseRoot))fail('CLEANUP_PIN_UNAVAILABLE');
    if(within(target,doc.releaseRoot)||within(doc.releaseRoot,target))fail('CLEANUP_PIN_PROTECTED');
  }
}
// An optional immutable legacy candidate may be deleted only when an adjacent
// archive preserves its complete version manifest, lock file and native files.
async function verifyHistoric(target) {
  if(supportedTarget(target)!=='historical-candidate')return;
  const tag=basename(target).slice('candidate-'.length);
  const release=join(dirname(target),'release-'+tag);
  await plain(release,'directory');
  const manifest=JSON.parse(await readFile(join(release,'release-manifest.json'),'utf8').catch(()=>fail('CLEANUP_ARCHIVE_MISSING')));
  const proof=JSON.parse(await readFile(join(target,'release-restore-evidence.json'),'utf8').catch(()=>fail('CLEANUP_ARCHIVE_MISSING')));
  if(manifest.commit?.slice(0,tag.length)!==tag||proof.commit!==manifest.commit||
    proof.patchChecked!==true||proof.sqliteNativeLoaded!==true||proof.nativeRestore!=='exact archived hashes'||
    !Array.isArray(manifest.files)||!manifest.files.some(x=>x.path==='code/source.tar')||
    !manifest.files.some(x=>x.path==='code/source/package-lock.json')||
    !manifest.files.some(x=>String(x.path).startsWith('native/node_modules/')))fail('CLEANUP_ARCHIVE_INVALID');
  const preserved=manifest.files.filter(x=>x.path==='code/source.tar'||x.path==='code/source/package-lock.json'||x.path.startsWith('native/node_modules/'));
  if(preserved.length<25)fail('CLEANUP_ARCHIVE_INVALID');
  for(const item of preserved){
    if(typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))fail('CLEANUP_ARCHIVE_INVALID');
    const saved=join(release,...item.path.split('/'));
    await plain(saved,'file');
    const digest=createHash('sha256').update(await readFile(saved)).digest('hex');
    if(digest!==item.sha256)fail('CLEANUP_ARCHIVE_MISMATCH');
  }
  const lock=manifest.files.find(x=>x.path==='code/source/package-lock.json');
  const actual=createHash('sha256').update(await readFile(join(target,'package-lock.json'))).digest('hex');
  if(actual!==lock.sha256)fail('CLEANUP_ARCHIVE_MISMATCH');
}
export class TongManagedCleanup{
  #plans=new Map();
  constructor({access,stateDir,productionRoot='D:\\Tong\\runtime',now=()=>Date.now()}={}){
    if(!access||!isAbsolute(stateDir??''))throw Error('CLEANUP_INVALID_CONFIGURATION');
    this.access=access;this.stateDir=stateDir;this.productionRoot=productionRoot;this.now=now;
  }
  async plan({projectId,path}){
    const target=safePath(path);
    const root=await safeAuthorizedRoot(this.access,projectId,target);
    assertTarget(root,target);
    await checkAncestors(target);
    await plain(target,'directory');
    await pinnedProtected(target,this.productionRoot);
    await verifyHistoric(target);
    const stats=await snapshot(target);
    const planId=randomUUID(),expiresAt=this.now()+ttl;
    this.#plans.set(planId,{projectId,root,target,stats,expiresAt});
    if(this.#plans.size>64)this.#plans.delete(this.#plans.keys().next().value);
    return {planId,projectId,path:target,category:supportedTarget(target),files:stats.files,directories:stats.directories,bytes:stats.bytes,expiresAt:new Date(expiresAt).toISOString(),requiresExecute:true};
  }
  async execute({planId,projectId}){
    const plan=this.#plans.get(planId);
    this.#plans.delete(planId);
    if(!plan||plan.projectId!==projectId||this.now()>plan.expiresAt)fail('CLEANUP_PLAN_EXPIRED');
    const root=await safeAuthorizedRoot(this.access,projectId,plan.target);
    if(!same(root,plan.root))fail('CLEANUP_PERMISSION_CHANGED');
    assertTarget(root,plan.target);
    await checkAncestors(plan.target);
    await pinnedProtected(plan.target,this.productionRoot);
    await verifyHistoric(plan.target);
    const next=await snapshot(plan.target);
    if(next.signature!==plan.stats.signature||next.bytes!==plan.stats.bytes||next.files!==plan.stats.files||next.directories!==plan.stats.directories)fail('CLEANUP_TARGET_CHANGED');
    const auditPath=join(this.stateDir,'disk-cleanup-audit.jsonl');
    if(within(plan.target,this.stateDir))fail('CLEANUP_AUDIT_TARGET');
    await mkdir(this.stateDir,{recursive:true});
    const at=new Date(this.now()).toISOString();
    // Predelete audit must succeed: never delete unaccountably.
    await appendFile(auditPath,JSON.stringify({at,event:'cleanup_begin',planId,projectId,path:plan.target,bytes:next.bytes,files:next.files})+'\n',{flag:'a',mode:0o600});
    try{
      await rm(plan.target,{recursive:true,force:false,maxRetries:0});
      await appendFile(auditPath,JSON.stringify({at:new Date(this.now()).toISOString(),event:'cleanup_deleted',planId,path:plan.target,bytes:next.bytes})+'\n');
      return {status:'deleted',path:plan.target,files:next.files,logicalBytes:next.bytes};
    }catch{
      await appendFile(auditPath,JSON.stringify({at:new Date(this.now()).toISOString(),event:'cleanup_failed',planId,path:plan.target})+'\n').catch(()=>{});
      fail('CLEANUP_DELETE_FAILED');
    }
  }
}
