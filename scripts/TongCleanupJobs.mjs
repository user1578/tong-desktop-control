import {mkdir,readFile,unlink,readdir,open} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TongManagedCleanup,cleanupGuards as g} from './TongManagedCleanup.mjs';
import {TongProjectAccess} from './TongProjectAccess.mjs';
import {prepareCleanupSelection,executeCleanupSelection} from './TongCleanupSelection.mjs';
import {cleanupAtomicReplace,closeCleanupNative,acquireCleanupLock} from './TongCleanupNative.mjs';

const idPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const terminal=new Set(['completed','blocked','cancelled','failed','ready']);
const ownsTarget=s=>!['completed','cancelled','failed','blocked'].includes(s.status);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const safeError=e=>/^CLEANUP_[A-Z0-9_]+$/.test(e?.code??'')?e.code:'CLEANUP_IO_FAILED';
async function atomic(path,value){
 await g.checkAncestors(dirname(path));
 try{await g.plain(path,'file');}catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
 const temp=path+'.'+randomUUID()+'.tmp';
 const h=await open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();}finally{await h.close();}
 await cleanupAtomicReplace(temp,path);
}
async function json(path){await g.checkAncestors(path);const info=await g.plain(path,'file');if(info.size>64*1024**2)g.fail('CLEANUP_JOB_TOO_LARGE');return JSON.parse(await readFile(path,'utf8'));}
export class TongCleanupJobs{
 constructor(manager){this.manager=manager;this.dir=join(dirname(manager.authorization.path),'disk-cleanup-jobs');}
 async ensure(){
  await g.checkAncestors(dirname(this.dir));
  try{await mkdir(this.dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  await g.plain(this.dir,'directory');
 }
 async load(projectId,jobId){
  if(!idPattern.test(jobId??''))g.fail('CLEANUP_JOB_INVALID');await this.ensure();
  let state;try{state=await json(join(this.dir,jobId+'.json'));}catch(e){if(e.code==='CLEANUP_PATH_MISSING')g.fail('CLEANUP_JOB_NOT_FOUND');throw e;}
  if(state.schemaVersion!==1||state.jobId!==jobId||state.projectId!==projectId)g.fail('CLEANUP_JOB_PROJECT_MISMATCH');return state;
 }
 view(state){
  const {schemaVersion,config,inventory,...publicState}=state;
  if(!terminal.has(state.status)&&state.workerPid&&!alive(state.workerPid))return {...publicState,status:'blocked',code:'CLEANUP_WORKER_INTERRUPTED',recoverable:true,workerAlive:false};
  if(!terminal.has(state.status)&&Date.now()-Date.parse(state.updatedAt)>60000)return {...publicState,status:'blocked',code:'CLEANUP_NO_PROGRESS',recoverable:true,workerAlive:alive(state.workerPid)};
  return publicState;
 }
 async detailedView(state){
  const view=this.view(state);
  if(view.code!=='CLEANUP_WORKER_INTERRUPTED'||!state.workerPid)return view;
  // An absent witness means the process did not reach JS normal/exception exit
  // handling. Do not speculate about native crash, external kill or Job limits.
  let witness=null;
  try{
   const p=join(this.dir,state.jobId+'.worker-'+state.workerPid+'.exit.json');
   const candidate=await json(p);
   if(candidate.schemaVersion===1&&candidate.jobId===state.jobId&&candidate.pid===state.workerPid&&
      Number.isInteger(candidate.exitCode)&&candidate.exitCode>=0&&candidate.exitCode<=255&&
      ['normal','uncaught-exception'].includes(candidate.reason)){
    witness={recorded:true,pid:candidate.pid,exitCode:candidate.exitCode,reason:candidate.reason,
      errorCode:typeof candidate.errorCode==='string'&&/^CLEANUP_[A-Z0-9_]+$/.test(candidate.errorCode)?candidate.errorCode:null,at:candidate.at};
   }
  }catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
  return {...view,workerExit:witness??{recorded:false}};
 }
 async status({projectId,jobId}){return this.detailedView(await this.load(projectId,jobId));}
 async launch(state){
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',this.manager.stateDir,state.jobId],{windowsHide:true,detached:true,stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP}});
  await new Promise((accept,reject)=>{child.once('spawn',accept);child.once('error',reject);});child.unref();
 }
 async start({projectId,path,mode='clean',idempotencyKey}={}){
  if(!/^[a-z][a-z0-9-]{1,39}$/.test(projectId??'')||!['clean','plan','exact'].includes(mode)||mode==='exact'&&!path||idempotencyKey!==undefined&&!/^[a-zA-Z0-9_-]{1,100}$/.test(idempotencyKey))g.fail('CLEANUP_JOB_INVALID');
  await this.ensure();
  // Admission is serialized across MCP instances. No second writer can claim an
  // overlapping subtree while a durable job (including a paused plan) owns it.
  const admission=join(this.dir,'admission.lock');
  const release=await acquireCleanupLock(admission);
  let state;
  try{
   const entries=(await readdir(this.dir)).filter(n=>idPattern.test(n.slice(0,-5))&&n.endsWith('.json'));
   const previous=[];
   for(const name of entries){
    const prior=await json(join(this.dir,name));previous.push(prior);
    if(prior.projectId===projectId&&idempotencyKey&&prior.idempotencyKey===idempotencyKey){
     if(prior.requestedPath!==(path?g.safePath(path):undefined)||(prior.requestedMode??prior.mode)!==mode)g.fail('CLEANUP_IDEMPOTENCY_CONFLICT');return this.view(prior);
    }
   }
   const targets=path?[g.safePath(path)]:await this.discover(projectId,previous);
   if(!targets.length)g.fail('CLEANUP_NO_AUTHORIZED_TARGETS');
   let outstanding=0;
   for(const prior of previous){
    if(ownsTarget(prior)){outstanding++;if(prior.targets.some(a=>targets.some(b=>g.within(a,b)||g.within(b,a))))g.fail('CLEANUP_JOB_CONFLICT');}
   }
   if(outstanding>=128)g.fail('CLEANUP_JOB_STORE_FULL');
   state={schemaVersion:1,jobId:randomUUID(),projectId,targets,mode,requestedMode:mode,requestedPath:path?g.safePath(path):undefined,idempotencyKey,status:'queued',phase:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),results:[],index:0,
    config:{registryPath:this.manager.access.registryPath,agentAccessPath:this.manager.access.agentAccessPath,demoRoot:this.manager.access.demoRoot,productionRoot:this.manager.productionRoot,retainedDependencies:this.manager.retainedDependencies}};
   await atomic(join(this.dir,state.jobId+'.json'),state);
  }finally{await release();}
  await this.launch(state);return this.view(state);
 }
 async discover(projectId,previous=[]){
  const grant=(await this.manager.authorization.read()).grants.find(x=>x.id===projectId&&x.enabled);
  if(!grant)g.fail('CLEANUP_PERMISSION_REQUIRED');
  const paths=[];
  const completed=new Map(previous.filter(s=>s.projectId===projectId).flatMap(s=>(s.results??[]).filter(r=>r.status==='completed'&&r.restoreStamp).map(r=>[r.path,r.restoreStamp])));
  // Existing Tong index, no disk-wide recursion and no already-removed temp cache.
  const group=join(grant.root,'p27-autonomy-candidate-20261017');
  try{
   await g.checkAncestors(group);
   for(const name of await readdir(group))if(/^quick-trust-candidate-[a-f0-9]{7}$/.test(name)){
    const p=join(group,name,'node_modules');try{
     await g.plain(p,'directory');const proof=await g.plain(join(group,name,'release-restore-evidence.json'),'file');
     const stamp=[proof.dev,proof.ino,proof.size,proof.mtimeMs,proof.ctimeMs,proof.nlink].join(':');
     if(completed.get(p)!==stamp)paths.push(p);
    }catch{}
   }
  }catch{}
  // Only immediate known cache roots inside each pre-existing authorized scope.
  for(const scope of grant.scopes){
   const root=resolve(grant.root,scope.relativeRoot);await g.checkAncestors(root);
   for(const entry of (await readdir(root,{withFileTypes:true})).slice(0,256))if(entry.isDirectory()&&g.supportedTarget(join(root,entry.name))==='cache')paths.unshift(join(root,entry.name));
  }
  return [...new Set(paths)].slice(0,32);
 }
 async control({projectId,jobId,action='status'}){
  const state=await this.load(projectId,jobId);
  if(action==='status')return this.detailedView(state);
  if(action==='cancel'){
   const release=await acquireCleanupLock(join(this.dir,'admission.lock'));
   try{
   await atomic(join(this.dir,jobId+'.cancel'),{cancelledAt:new Date().toISOString()});
   if(terminal.has(state.status)||!alive(state.workerPid)){state.status='cancelled';state.phase='cancelled';state.updatedAt=new Date().toISOString();await atomic(join(this.dir,jobId+'.json'),state);}
   return {...this.view(state),cancelRequested:true};
   }finally{await release();}
  }
  if(action!=='resume')g.fail('CLEANUP_JOB_INVALID');
  if(state.status==='completed')return this.view(state);
  // Never steal an active worker lock or kill a process to resume a job.
  if(state.workerPid&&alive(state.workerPid)&&!terminal.has(state.status))g.fail('CLEANUP_JOB_BUSY');
  const release=await acquireCleanupLock(join(this.dir,'admission.lock'));
  try{
  const workerRelease=await acquireCleanupLock(join(this.dir,jobId+'.lock'));await workerRelease();
  for(const name of await readdir(this.dir))if(name.endsWith('.json')&&idPattern.test(name.slice(0,-5))&&name!==jobId+'.json'){
   const other=await json(join(this.dir,name));if(ownsTarget(other)&&other.targets.some(a=>state.targets.some(b=>g.within(a,b)||g.within(b,a))))g.fail('CLEANUP_JOB_CONFLICT');
  }
  const cancel=join(this.dir,jobId+'.cancel');
  try{await g.plain(cancel,'file');await unlink(cancel);}catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
  state.status='queued';state.updatedAt=new Date().toISOString();if(state.mode==='plan')state.mode='clean';
  if(state.index===state.targets.length&&state.results.some(x=>x.status!=='completed')){state.index=state.results.findIndex(x=>x.status!=='completed');state.results=state.results.slice(0,state.index);}
  await atomic(join(this.dir,jobId+'.json'),state);
  }finally{await release();}
  await this.launch(state);return this.view(state);
 }
 async work(jobId){
  await this.ensure();
  const path=join(this.dir,jobId+'.json'),state=await json(path);
  const lockPath=join(this.dir,jobId+'.lock');let release;
  try{release=await acquireCleanupLock(lockPath);}catch(e){if(e.code==='CLEANUP_JOB_BUSY')return;throw e;}
  let lastWrite=0,writeQueue=Promise.resolve(),lastCheck=0;
  const persist=async(force=false)=>{
   if(!force&&Date.now()-lastWrite<500)return;
   lastWrite=Date.now();state.updatedAt=new Date().toISOString();
   const memory=process.memoryUsage();
   state.workerStats={pid:process.pid,rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,uptimeSeconds:Math.round(process.uptime())};
   const value=structuredClone(state);
   writeQueue=writeQueue.then(()=>atomic(path,value));await writeQueue;
  };
  const progress=async value=>{Object.assign(state,value);state.status=value.phase;await persist();};
  const check=async(force=false)=>{
   if(!force&&Date.now()-lastCheck<50)return;lastCheck=Date.now();
   try{await g.plain(join(this.dir,jobId+'.cancel'),'file');g.fail('CLEANUP_CANCELLED');}catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
  };
  const referenceCache=new Map();
  try{
   state.workerPid=process.pid;await progress({phase:'scanning'});await persist(true);
   while(state.index<state.targets.length){
    await check();const target=state.targets[state.index];state.currentPath=target;
    const selectionPath=join(this.dir,jobId+'.'+state.index+'.selection');
    try{
     let selection;
     try{selection=await json(selectionPath);}catch(e){if(e.code!=='CLEANUP_PATH_MISSING')throw e;}
     if(!selection){selection=await prepareCleanupSelection(this.manager,{projectId:state.projectId,path:target,exact:state.mode==='exact'},{progress,check,referenceCache});await atomic(selectionPath,selection);}
     if(state.mode==='plan'){state.status='ready';state.phase='ready';await persist(true);return;}
     const result=await executeCleanupSelection(this.manager,selection,{progress,check,journalPath:join(this.dir,jobId+'.'+state.index+'.audit.jsonl')});
     state.results.push({...result,status:result.skipped.length||result.ambiguousMissing.length?'partial':'completed'});
    }catch(e){
     if(e.code==='CLEANUP_CANCELLED')throw e;
     state.results.push({path:target,status:'blocked',code:safeError(e)});
     // A rejected item never blocks the next independently authorized target.
    }
    state.index++;await persist(true);
   }
   state.status=state.results.some(x=>x.status!=='completed')?'blocked':'completed';state.phase=state.status;
  }catch(e){state.status=e.code==='CLEANUP_CANCELLED'?'cancelled':'failed';state.phase=state.status;state.code=safeError(e);}
  finally{try{
   const finishRelease=await acquireCleanupLock(join(this.dir,'admission.lock'));
   try{if(state.status!=='completed'){try{await check(true);}catch(e){if(e.code==='CLEANUP_CANCELLED'){state.status='cancelled';state.phase='cancelled';}else throw e;}}await persist(true);}finally{await finishRelease();}
  }finally{await release();await closeCleanupNative();}}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--worker'){
 const [stateDir,jobId]=process.argv.slice(3);
 // The parent intentionally detaches workers. Keep a bounded, content-free
 // exit witness so a vanished PID is not always an unexplained interruption.
 // If no witness exists after termination, suspect a forced/native process kill.
 let exitReason='normal',exitErrorCode=null,exitOrigin=null;
 let witnessPath=null;
 process.on('uncaughtExceptionMonitor',(error,origin)=>{
  exitReason='uncaught-exception';exitErrorCode=safeError(error);exitOrigin=origin==='unhandledRejection'?'unhandled-rejection':'exception';
 });
 process.on('exit',code=>{
  if(!witnessPath)return;
  try{
   writeFileSync(witnessPath,JSON.stringify({schemaVersion:1,jobId,pid:process.pid,at:new Date().toISOString(),exitCode:code,reason:exitReason,errorCode:exitErrorCode,origin:exitOrigin})+'\n',{flag:'wx',mode:0o600});
  }catch{}
 });
 const temporary=new TongManagedCleanup({access:{listProjects:async()=>[]},stateDir});
 const jobs=new TongCleanupJobs(temporary),state=await jobs.load((await json(join(jobs.dir,jobId+'.json'))).projectId,jobId);
 witnessPath=join(jobs.dir,jobId+'.worker-'+process.pid+'.exit.json');
 const access=new TongProjectAccess({...state.config,scanRoots:[]});
 jobs.manager=new TongManagedCleanup({access,stateDir,...state.config});
 await jobs.work(jobId);
}
