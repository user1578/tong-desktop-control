import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, open, unlink, copyFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PRODUCTION_ROOT, getApprovedProductionProfile, validateProductionProfile, verifyRuntimeApproval, productionProfileDigest } from './TongProductionProfile.mjs';
import { assertProtectedPaths, processIdentity, sameProcess } from './TongRuntimeSecurity.mjs';

const helper=fileURLToPath(new URL('TongProductionState.ps1',import.meta.url));
const fail=code=>new Error(code),sha=value=>createHash('sha256').update(value).digest('hex');
const STATE_ROOT=resolve('D:\\Tong\\runtime\\state');
const within=(root,path)=>{const part=relative(root,path);return part===''||!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
function newTarget(profile,path) {
  const approved=profile.mode==='production'?resolve(profile.root):STATE_ROOT;
  if(typeof path!=='string'||!isAbsolute(path)||!within(approved,resolve(path))||resolve(path)===approved||!within(profile.root,resolve(path))||resolve(path)===profile.root) throw fail('STATE_PATH_DENIED');
  if([profile.codeRoot,join(profile.root,'run'),join(profile.root,'tong-policy'),join(profile.root,'logs'),join(profile.root,'secrets')].some(root=>within(root,resolve(path))||within(resolve(path),root))) throw fail('STATE_PATH_DENIED');
  return resolve(path);
}
async function ordinary(path) {
  const info=await lstat(path);
  if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||info.isFile()&&info.nlink!==1||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())throw fail('STATE_LINK_DENIED');
  await assertProtectedPaths([path]); return info;
}
async function listFiles(root,prefix) {
  await ordinary(root); const files=[];
  for(const name of (await readdir(root)).sort()) {
    if(!name||name.includes(':')||name.includes('/')||name.includes('\\'))throw fail('STATE_PATH_DENIED');
    const path=join(root,name),logical=prefix+'/'+name,info=await ordinary(path);
    if(info.isDirectory())files.push(...await listFiles(path,logical));
    else {if(info.size>64*1024*1024)throw fail('STATE_TOO_LARGE');files.push({logical,path,size:info.size,sha256:sha(await readFile(path))});}
  }
  return files;
}
async function maybeFiles(root,prefix) {try{return await listFiles(root,prefix);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function sourceFiles(profile) {
  const files=[...await listFiles(profile.runtimeDir,'runtime'),...await listFiles(profile.configDir,'config'),...await listFiles(profile.oauthStateDir,'oauth'),...await maybeFiles(join(profile.root,'tong-policy'),'policy')];
  const tongConfig=join(profile.originalTongRoot,'config','tong.config.json');
  try{const info=await ordinary(tongConfig);if(!info.isFile()||info.size>1048576)throw fail('STATE_CONFIG_DENIED');files.push({logical:'tong-config/tong.config.json',path:tongConfig,size:info.size,sha256:sha(await readFile(tongConfig))});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(files.length>2048||files.reduce((n,f)=>n+f.size,0)>128*1024*1024)throw fail('STATE_TOO_LARGE');
  if(files.some(f=>/^config\//.test(f.logical)&&!/^config\/(config|auth)\.json$/.test(f.logical)))throw fail('STATE_CONFIG_DENIED');
  if(files.some(f=>/^oauth\//.test(f.logical)&&!/^oauth\/devspace\.sqlite(?:-wal|-shm)?$/.test(f.logical)))throw fail('STATE_OAUTH_DENIED');
  return files;
}
async function stopped(profile,action='backup') {
  const root=profile.root;
  const read=async name=>{try{return JSON.parse(await readFile(join(root,'run',name),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const record=await read('runtime.json'),guardian=await read('guardian.json');
  if(!record&&!guardian) {
    const proof=await native('quiescence',{profile,action});
    if(proof.quiescent!==true)throw fail('STATE_RUNTIME_NOT_STOPPED');
    return {runId:null,phase:'initial_stopped',jobActiveAfterCleanup:null,quiescent:true,checkedAt:proof.checkedAt};
  }
  if(!record||!guardian)throw fail('STATE_RUNTIME_NOT_STOPPED');
  if(!['stopped','abnormal_exit'].includes(record.phase)||guardian.runId!==record.runId||!guardian.finishedAt||guardian.jobActiveAfterCleanup!==0)throw fail('STATE_RUNTIME_NOT_STOPPED');
  for(const identity of [guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].filter(Boolean)) if(identity.pid&&sameProcess(await processIdentity(identity.pid),identity))throw fail('STATE_RUNTIME_NOT_STOPPED');
  return {runId:record.runId,phase:record.phase,jobActiveAfterCleanup:guardian.jobActiveAfterCleanup,finishedAt:guardian.finishedAt};
}
async function lock(profile) {try {const handle=await open(join(profile.root,'run','backup.freeze'),'wx');await handle.writeFile(JSON.stringify({operation:'production-state',id:randomUUID(),at:new Date().toISOString()}));return handle;}catch{throw fail('STATE_BUSY');}}
async function native(mode,input) {
  const keys=new Set(['SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PROGRAMDATA','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>keys.has(key.toUpperCase())));
  return new Promise((accept,reject)=>{
    const child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode],{windowsHide:true,env,stdio:['pipe','pipe','ignore']});
    let out='',bytes=0;const timer=setTimeout(()=>child.kill(),30000);
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)child.kill();else out+=chunk;});
    child.once('error',()=>{clearTimeout(timer);reject(fail('STATE_CRYPTO_UNAVAILABLE'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||bytes>1048576)return reject(fail('STATE_CRYPTO_UNAVAILABLE'));try{accept(JSON.parse(out));}catch{reject(fail('STATE_CRYPTO_UNAVAILABLE'));}});
  });
}
function entropy(profile) {return 'tong-production-state-v1:'+profile.mode+':'+profile.root;}
function logicalName(value) {if(typeof value!=='string'||!value||! /^(runtime|config|oauth|policy|tong-config)\//.test(value)||value.includes('\\')||value.includes(':')||value.split('/').some(part=>!part||part==='.'||part==='..'))throw fail('STATE_MANIFEST_DENIED');return value;}
async function fresh(path) {await ordinary(dirname(path));try{await mkdir(path);}catch(error){throw fail(error.code==='EEXIST'?'STATE_DESTINATION_EXISTS':'STATE_UNAVAILABLE');}await ordinary(path);}

export async function createProductionStateBackup(input,options) {
  const profile=validateProductionProfile(input);await verifyRuntimeApproval(profile,'backup');
  if(!options||Object.keys(options).some(key=>key!=='backupRoot'))throw fail('STATE_OPTIONS_DENIED');
  const backupRoot=newTarget(profile,options.backupRoot);await ordinary(profile.root);await stopped(profile);
  const held=await lock(profile);
  try {
    const lifecycle=await stopped(profile),files=await sourceFiles(profile);
    await fresh(backupRoot);
    const encrypted=await native('snapshot',{profile,binding:entropy(profile),backupRoot,files});
    assertEncryptedFiles(encrypted.files,files);
    await stopped(profile);
    const after=await sourceFiles(profile);if(JSON.stringify(files)!==JSON.stringify(after))throw fail('STATE_SOURCE_CHANGED');
    const manifest={schemaVersion:1,scope:'CurrentUser',encrypted:true,mode:profile.mode,sourceRoot:profile.root,profileDigest:productionProfileDigest(profile),sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,createdAt:new Date().toISOString(),lifecycle,files:encrypted.files};
    await writeFile(join(backupRoot,'state-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await ordinary(join(backupRoot,'state-manifest.json'));return manifest;
  } finally {await held.close();await unlink(join(profile.root,'run','backup.freeze'));}
}
function assertEncryptedFiles(encrypted,source) {
  if(!Array.isArray(encrypted)||encrypted.length!==source.length)throw fail('STATE_MANIFEST_DENIED');
  for(let i=0;i<source.length;i++)if(encrypted[i].logical!==source[i].logical||encrypted[i].size!==source[i].size||encrypted[i].sha256!==source[i].sha256||encrypted[i].encryptedFile!==i+'.dpapi.bin'||! /^[a-f0-9]{64}$/.test(encrypted[i].sha256??'')||! /^[a-f0-9]{64}$/.test(encrypted[i].encryptedSha256??''))throw fail('STATE_MANIFEST_DENIED');
}
export async function verifyProductionStateBackup(input,{backupRoot}) {
  const profile=validateProductionProfile(input);await verifyRuntimeApproval(profile,'restore');backupRoot=newTarget(profile,backupRoot);
  await ordinary(backupRoot);const manifest=JSON.parse(await readFile(join(backupRoot,'state-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.encrypted!==true||manifest.scope!=='CurrentUser'||manifest.sourceRoot!==profile.root||manifest.mode!==profile.mode||manifest.sourceDigest!==profile.sourceDigest||!Array.isArray(manifest.files)||manifest.files.length>2048)throw fail('STATE_MANIFEST_DENIED');
  const expected=new Set(['state-manifest.json']);
  for(const [index,file] of manifest.files.entries()) {
    logicalName(file.logical);if(file.encryptedFile!==index+'.dpapi.bin'||! /^[a-f0-9]{64}$/.test(file.sha256??'')||! /^[a-f0-9]{64}$/.test(file.encryptedSha256??'')||!Number.isSafeInteger(file.size)||file.size<0||file.size>64*1024*1024)throw fail('STATE_MANIFEST_DENIED');
    const path=join(backupRoot,file.encryptedFile);await ordinary(path);if(sha(await readFile(path))!==file.encryptedSha256)throw fail('STATE_HASH_MISMATCH');expected.add(file.encryptedFile);
  }
  if((await readdir(backupRoot)).some(name=>!expected.has(name)))throw fail('STATE_MANIFEST_DENIED');return manifest;
}
function sanitize(logical,value) {
  if(logical==='runtime/agent-execution.json') {value.projects=[];}
  if(logical==='runtime/trusted-codex.json') {value.enabled=false;value.projects=[];value.approvals=[];value.generation=(value.generation??0)+1;}
  if(logical==='runtime/project-access.json') {if(!Array.isArray(value.projects))throw fail('STATE_INVALID');for(const project of value.projects)project.status='disabled';}
  if(logical==='runtime/agent-tasks.json') {if(!Array.isArray(value.tasks))throw fail('STATE_INVALID');for(const task of value.tasks){task.restoreOriginalStatus=task.status;if(['queued','running','waiting_user_action'].includes(task.status))task.status='failed';task.pendingApproval=false;task.codexSessionId=null;task.restoreRequiresReconciliation=true;}}
  if(logical==='policy/agentdock-access.json') {value.projects=[];value.approvals=[];value.enabled=false;}
  return value;
}
const grantDefaults = {
  'runtime/agent-execution.json': {schemaVersion:1,projects:[]},
  'runtime/trusted-codex.json': {schemaVersion:1,enabled:false,executable:null,projects:[],approvals:[],generation:0},
  'runtime/project-access.json': {schemaVersion:1,projects:[]},
  'runtime/agent-tasks.json': {schemaVersion:1,tasks:[]},
  'policy/agentdock-access.json': {schemaVersion:1,enabled:false,projects:[],approvals:[]},
};
function oauthCopyEvidence(profile,path) {
  // Open only the new protected copy, including its WAL. The authoritative
  // source is never checkpointed or opened by the verifier.
  const require=createRequire(join(profile.codeRoot,'package.json')),Database=require('better-sqlite3'),db=new Database(path,{readonly:true,fileMustExist:true});
  try {
    if(db.pragma('integrity_check',{simple:true})!=='ok')throw fail('STATE_OAUTH_INCOMPATIBLE');
    const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const required={oauth_clients:['client_id','client_json','issued_at'],oauth_access_tokens:['token_hash','client_id','scopes_json','expires_at','resource'],oauth_refresh_tokens:['token_hash','client_id','scopes_json','expires_at','resource']};
    for(const [table,columns] of Object.entries(required))if(JSON.stringify(db.prepare('PRAGMA table_info("'+table+'")').all().map(row=>row.name))!==JSON.stringify(columns))throw fail('STATE_OAUTH_INCOMPATIBLE');
    return {integrity:'ok',schemaHash:sha(JSON.stringify(schema)),oauthSchemaCompatible:true,tables:Object.keys(required).map(table=>({name:table,rows:db.prepare('SELECT count(*) AS count FROM "'+table+'"').get().count}))};
  } catch(error) {if(error.message==='STATE_OAUTH_INCOMPATIBLE')throw error;throw fail('STATE_OAUTH_INCOMPATIBLE');}finally{db.close();}
}
export async function restoreProductionStateBackup(input,options) {
  const profile=validateProductionProfile(input);await verifyRuntimeApproval(profile,'restore');
  if(!options||Object.keys(options).some(key=>!['backupRoot','restoreRoot'].includes(key)))throw fail('STATE_OPTIONS_DENIED');
  const backupRoot=newTarget(profile,options.backupRoot),restoreRoot=newTarget(profile,options.restoreRoot);
  if(within(backupRoot,restoreRoot)||within(restoreRoot,backupRoot))throw fail('STATE_PATH_DENIED');
  await ordinary(profile.root);await stopped(profile,'restore');const held=await lock(profile);
  try {
    const manifest=await verifyProductionStateBackup(profile,{backupRoot});const latest=await sourceFiles(profile);
    const journal=latest.filter(file=>/^policy\/agentdock-operations\/[a-f0-9]{64}\.json$/.test(file.logical));
    const invalidJournal=latest.filter(file=>file.logical.startsWith('policy/agentdock-operations/')&&!journal.includes(file));if(invalidJournal.length)throw fail('STATE_JOURNAL_DENIED');
    await fresh(restoreRoot);
    // Restore the protected state/config snapshot, while the existing compatible
    // OAuth database is authoritative after refresh-token rotation.
    const selected=manifest.files.filter(file=>!file.logical.startsWith('oauth/'));
    await native('restore',{profile,binding:entropy(profile),backupRoot,restoreRoot,files:selected});
    // Missing grants in an old snapshot must also close grants added later.
    // Keep current metadata/tasks when available, but never their execution rights.
    for(const [logical,defaults] of Object.entries(grantDefaults)) {
      if(selected.some(file=>file.logical===logical))continue;
      const current=latest.find(file=>file.logical===logical);
      let value=structuredClone(defaults);
      if(current){try{value=JSON.parse(await readFile(current.path,'utf8'));}catch{throw fail('STATE_INVALID');}}
      const path=join(restoreRoot,...logical.split('/'));await mkdir(dirname(path),{recursive:true});
      await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
      selected.push({logical});
    }
    for(const file of selected) {
      if(!['runtime/agent-execution.json','runtime/trusted-codex.json','runtime/project-access.json','runtime/agent-tasks.json','policy/agentdock-access.json'].includes(file.logical))continue;
      const path=join(restoreRoot,...file.logical.split('/'));let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw fail('STATE_INVALID');}
      const result=sanitize(file.logical,value);await writeFile(path,JSON.stringify(result,null,2)+'\n');
    }
    for(const file of journal) {
      const value=JSON.parse(await readFile(file.path,'utf8'));if(value.operationId!==file.logical.split('/').at(-1).slice(0,-5))throw fail('STATE_JOURNAL_DENIED');
      const to=join(restoreRoot,...file.logical.split('/'));await mkdir(dirname(to),{recursive:true});
      try{const old=await readFile(to);if(sha(old)!==sha(await readFile(file.path)))throw fail('STATE_JOURNAL_CONFLICT');}catch(error){if(error.code!=='ENOENT')throw error;await copyFile(file.path,to);}
    }
    const oauth=latest.filter(file=>file.logical.startsWith('oauth/'));if(!oauth.some(file=>file.logical==='oauth/devspace.sqlite'))throw fail('STATE_OAUTH_DENIED');
    for(const file of oauth){const to=join(restoreRoot,...file.logical.split('/'));await mkdir(dirname(to),{recursive:true});await copyFile(file.path,to);if(sha(await readFile(to))!==sha(await readFile(file.path)))throw fail('STATE_SOURCE_CHANGED');}
    const oauthSqlite=oauthCopyEvidence(profile,join(restoreRoot,'oauth','devspace.sqlite'));
    const check=await sourceFiles(profile);if(JSON.stringify(latest)!==JSON.stringify(check))throw fail('STATE_SOURCE_CHANGED');await stopped(profile,'restore');
    const evidence={schemaVersion:1,sourceRoot:profile.root,backupRoot,restoreRoot,encryptedBackup:true,restoredAt:new Date().toISOString(),executionDisabled:true,autoDispatch:false,latestJournalRecords:journal.length,oauthDisposition:'preserve-latest-compatible',oauthSqlite,runtimeDir:join(restoreRoot,'runtime'),configDir:join(restoreRoot,'config'),tongConfigDir:join(restoreRoot,'tong-config'),oauthStateDir:join(restoreRoot,'oauth'),policyDir:join(restoreRoot,'policy')};
    await writeFile(join(restoreRoot,'restore-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});await ordinary(restoreRoot);return evidence;
  } finally {await held.close();await unlink(join(profile.root,'run','backup.freeze'));}
}

export async function applyRestoredProductionState(input,{restoreRoot}) {
  const profile=validateProductionProfile(input);await verifyRuntimeApproval(profile,'restore');restoreRoot=newTarget(profile,restoreRoot);
  await ordinary(profile.root);await stopped(profile,'restore');const held=await lock(profile);
  try {
    const evidence=JSON.parse(await readFile(join(restoreRoot,'restore-evidence.json'),'utf8'));
    if(evidence.sourceRoot!==profile.root||evidence.restoreRoot!==restoreRoot||evidence.executionDisabled!==true||evidence.autoDispatch!==false||evidence.oauthDisposition!=='preserve-latest-compatible')throw fail('STATE_RESTORE_DENIED');
    // Require the complete fail-closed set before writing any destination.
    for(const logical of Object.keys(grantDefaults)) {
      const path=join(restoreRoot,...logical.split('/'));await ordinary(path);
      const value=JSON.parse(await readFile(path,'utf8'));
      if(JSON.stringify(sanitize(logical,structuredClone(value)))!==JSON.stringify(value)
        && logical!=='runtime/trusted-codex.json' && logical!=='runtime/agent-tasks.json')throw fail('STATE_RESTORE_DENIED');
      if(logical==='runtime/trusted-codex.json'&&(value.enabled!==false||value.projects.length||value.approvals.length))throw fail('STATE_RESTORE_DENIED');
      if(logical==='runtime/agent-tasks.json'&&value.tasks.some(t=>['queued','running','waiting_user_action'].includes(t.status)||t.pendingApproval||t.codexSessionId||!t.restoreRequiresReconciliation))throw fail('STATE_RESTORE_DENIED');
    }
    for(const [prefix,target] of [['runtime',profile.runtimeDir],['config',profile.configDir],['tong-config',join(profile.originalTongRoot,'config')],['policy',join(profile.root,'tong-policy')]]) {
      const source=join(restoreRoot,prefix);const files=await maybeFiles(source,prefix);
      for(const file of files) {
        const to=join(target,file.logical.slice(prefix.length+1));await mkdir(dirname(to),{recursive:true});
        if(file.logical.includes('/agentdock-operations/')) {
          try{if(sha(await readFile(to))!==sha(await readFile(file.path)))throw fail('STATE_JOURNAL_CONFLICT');}
          catch(error){if(error.code!=='ENOENT')throw error;await copyFile(file.path,to);}
        } else {
          await ordinary(dirname(to));try{await ordinary(to);}catch(error){if(error.code!=='ENOENT')throw error;}
          if(['runtime/agent-execution.json','runtime/trusted-codex.json','runtime/project-access.json','runtime/agent-tasks.json','policy/agentdock-access.json'].includes(file.logical)) {
            const value=JSON.parse(await readFile(file.path,'utf8'));
            if(file.logical==='runtime/agent-execution.json'&&value.projects.length)throw fail('STATE_RESTORE_DENIED');
            if(file.logical==='runtime/project-access.json'&&value.projects.some(p=>p.status!=='disabled'))throw fail('STATE_RESTORE_DENIED');
            if(file.logical==='runtime/agent-tasks.json'&&value.tasks.some(t=>['queued','running','waiting_user_action'].includes(t.status)||t.pendingApproval||t.codexSessionId||!t.restoreRequiresReconciliation))throw fail('STATE_RESTORE_DENIED');
            if(file.logical==='policy/agentdock-access.json'&&(value.projects.length||value.approvals.length||value.enabled!==false))throw fail('STATE_RESTORE_DENIED');
            if(file.logical==='runtime/trusted-codex.json'&&(value.enabled!==false||value.projects.length||value.approvals.length))throw fail('STATE_RESTORE_DENIED');
          }
          await copyFile(file.path,to);
        }
      }
    }
    // Never copy staged OAuth back over the current database: rotated refresh
    // tokens and access-token rows must survive rollback.
    await stopped(profile,'restore');
    const result={schemaVersion:1,sourceRoot:profile.root,restoreRoot,appliedAt:new Date().toISOString(),executionDisabled:true,autoDispatch:false,oauthDisposition:'unchanged-latest',journalDisposition:'append-only'};
    await writeFile(join(profile.root,'logs','state-restore.jsonl'),JSON.stringify(result)+'\n',{flag:'a'});return result;
  } finally {await held.close();await unlink(join(profile.root,'run','backup.freeze'));}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv[2]==='--native-preflight') {
      const [encoded,action,backupRoot,restoreRoot,...extra]=process.argv.slice(3),profile=validateProductionProfile(JSON.parse(Buffer.from(encoded,'base64').toString('utf8')));
      if(extra.length||!['backup','restore'].includes(action))throw fail('STATE_OPTIONS_DENIED');
      await verifyRuntimeApproval(profile,action);await ordinary(profile.root);await stopped(profile,action);await ordinary(newTarget(profile,backupRoot));
      if(action==='restore')await ordinary(newTarget(profile,restoreRoot));
      console.log(JSON.stringify({approved:true,sourceRoot:profile.root,action}));
    } else {
    const [action,configPath,...extra]=process.argv.slice(2);
    if(extra.length||!['backup','verify','restore','apply'].includes(action)||typeof configPath!=='string'||!isAbsolute(configPath))throw fail('STATE_OPTIONS_DENIED');
    const productionCommand=resolve(configPath)===join(PRODUCTION_ROOT,'run','state-command.json');
    const approved=productionCommand?await getApprovedProductionProfile(action==='backup'?'backup':'restore'):null;
    if(!productionCommand&&(!within(STATE_ROOT,resolve(configPath))||resolve(configPath)===STATE_ROOT))throw fail('STATE_OPTIONS_DENIED');
    await ordinary(configPath);const {profile,...options}=JSON.parse(await readFile(configPath,'utf8'));
    if(approved&&productionProfileDigest(profile)!==productionProfileDigest(approved))throw fail('STATE_OPTIONS_DENIED');
    const result=action==='backup'?await createProductionStateBackup(profile,options):action==='verify'?await verifyProductionStateBackup(profile,options):action==='restore'?await restoreProductionStateBackup(profile,options):await applyRestoredProductionState(profile,options);
    console.log(JSON.stringify({ok:true,action,encryptedBackup:result.encrypted??result.encryptedBackup,sourceRoot:result.sourceRoot,backupRoot:result.backupRoot,restoreRoot:result.restoreRoot,executionDisabled:result.executionDisabled,autoDispatch:result.autoDispatch}));
    }
  } catch {console.error('Production state operation refused');process.exitCode=2;}
}
