import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, open, unlink, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProtectedPaths, processIdentity, sameProcess, safeEnvironment } from './TongRuntimeSecurity.mjs';
import {revokeRestoredTrustedAuthorization} from './TongRestoredAuthorization.mjs';

const isolated = resolve('D:\\Tong\\state');
const codeBase = 'b96795840cf5a320090861389b63796a1be164bd';
const fail = code => new Error(code);
const sha = value => createHash('sha256').update(value).digest('hex');
const within = (root, target) => { const rel = relative(root, target); return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
function allowedRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || !within(isolated,resolve(root)) || resolve(root)===isolated) throw fail('PATH_DENIED');
  return resolve(root);
}
function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part=>!part || part==='.' || part==='..')) throw fail('PATH_DENIED');
  return value;
}
async function ordinary(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink!==1 || (await realpath(path)).toLowerCase()!==resolve(path).toLowerCase()) throw fail('LINK_DENIED');
  return info;
}
async function inventory(root, prefix='') {
  await ordinary(root); const files=[];
  for (const name of (await readdir(root)).sort()) {
    const path=join(root,name), rel=prefix ? prefix+'/'+name : name;
    relativeFile(rel); const info=await ordinary(path);
    if (info.isDirectory()) files.push(...await inventory(path,rel));
    else if (rel!=='run/backup.freeze') files.push({path:rel,size:info.size,sha256:sha(await readFile(path))});
  }
  return files;
}
async function protectedTree(root) {
  const paths=[root];
  async function visit(dir) { for(const name of await readdir(dir)) { const path=join(dir,name), info=await ordinary(path); paths.push(path); if(info.isDirectory()) await visit(path); } }
  await visit(root); await assertProtectedPaths(paths);
}
async function newDirectory(root) {
  root=allowedRoot(root); await assertProtectedPaths([dirname(root)]);
  try { await mkdir(root); } catch(error) { throw fail(error.code==='EEXIST'?'DESTINATION_EXISTS':'BACKUP_UNAVAILABLE'); }
  await assertProtectedPaths([root]); return root;
}
function command(exe,args,cwd,timeout=30000) {
  return new Promise((ok,reject)=> {
    const child=spawn(exe,args,{cwd,windowsHide:true,env:safeEnvironment(cwd),stdio:['ignore','pipe','pipe']}); let stdout='',stderr='',size=0;
    const timer=setTimeout(()=>child.kill(),timeout);
    child.stdout.on('data',chunk=>{size+=chunk.length; if(size>4*1024*1024) child.kill(); else stdout+=chunk;});
    // Child stderr is never returned: database/business values and npm environment are private.
    child.stderr.on('data',chunk=>{if(stderr.length<16384) stderr+=chunk;});
    child.once('error',()=>{clearTimeout(timer);reject(fail('LOCAL_TOOL_FAILED'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||size>4*1024*1024) reject(fail('LOCAL_TOOL_FAILED')); else ok(stdout);});
  });
}
async function stopped(root) {
  const marker=JSON.parse(await readFile(join(root,'runtime-synthetic.json'),'utf8'));
  if(marker.schemaVersion!==1||marker.syntheticOnly!==true) throw fail('SYNTHETIC_ONLY');
  const record=JSON.parse(await readFile(join(root,'run/runtime.json'),'utf8'));
  if(record.phase!=='stopped') throw fail('RUNTIME_NOT_STOPPED');
  let guardian;
  try {guardian=JSON.parse(await readFile(join(root,'run/guardian.json'),'utf8'));}catch(error){if(error.code!=='ENOENT') throw fail('RUNTIME_NOT_STOPPED');}
  if(guardian&&(!guardian.finishedAt||guardian.jobActiveAfterCleanup!==0)) throw fail('RUNTIME_NOT_STOPPED');
  const identities=[guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].filter(Boolean);
  for(const identity of identities) if(identity.pid) {
    const actual=await processIdentity(identity.pid);
    if(sameProcess(actual,identity)) throw fail('RUNTIME_NOT_STOPPED');
  }
  for(const pid of record.pids??[]) {
    if(!Number.isSafeInteger(pid)||pid<=0) throw fail('RUNTIME_NOT_STOPPED');
    const actual=await processIdentity(pid);
    if(actual && !identities.some(entry=>entry.pid===pid && entry.exe && entry.startTicks)) throw fail('RUNTIME_NOT_STOPPED');
  }
  return record;
}
const sqliteScript = `import sqlite3,sys,json,hashlib
from pathlib import Path
p=Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
c.execute('PRAGMA query_only=ON')
integrity=c.execute('PRAGMA integrity_check').fetchall()
if integrity!=[('ok',)]: raise RuntimeError('integrity')
schema=c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
h=hashlib.sha256(); h.update(repr(schema).encode())
rows=0
for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
 quoted='"'+name.replace('"','""')+'"'; data=c.execute('SELECT * FROM '+quoted).fetchall()
 for row in sorted(repr(row) for row in data): h.update(name.encode()); h.update(row.encode()); h.update(b'\\x00')
 rows+=len(data)
print(json.dumps({'integrity':'ok','schemaHash':hashlib.sha256(repr(schema).encode()).hexdigest(),'logicalHash':h.hexdigest(),'rowCount':rows}))
c.close()`;
async function sqliteEvidence(root,files,pythonExecutable) {
  if(!isAbsolute(pythonExecutable??'')) throw fail('PYTHON_REQUIRED');
  const results=[];
  for(const file of files.filter(file=>/\.(sqlite|sqlite3|db)$/i.test(file.path))) {
    const path=join(root,...file.path.split('/'));
    // Opening a read-only copy includes its WAL; no source DB is opened or checkpointed.
    const evidence=JSON.parse(await command(pythonExecutable,['-I','-c',sqliteScript,path],root));
    results.push({path:file.path,...evidence});
  }
  return results;
}
async function copyInventory(from,to,files) {
  for(const file of files) { relativeFile(file.path); const source=join(from,...file.path.split('/')),dest=join(to,...file.path.split('/')); await ordinary(source); await mkdir(dirname(dest),{recursive:true}); await copyFile(source,dest); if(sha(await readFile(dest))!==file.sha256) throw fail('HASH_MISMATCH'); }
}
async function ciphertextOnly(root,files) {
  for(const file of files.filter(file=>file.path.startsWith('secrets/'))) {
    const permission=file.path.startsWith('secrets/runtime-permissions/');
    if(permission?!/^secrets\/runtime-permissions\/(?:[a-f0-9]{64}\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager|enabled)|production\.(?:init|start|stop|enable-agentdock|disable-agentdock|backup|restore|manager|login-recovery)\.current)\.dpapi\.json$/.test(file.path):!file.path.endsWith('.dpapi')) throw fail('CIPHERTEXT_REQUIRED');
    const purposes=permission?[file.path.endsWith('.login-recovery.current.dpapi.json')?'tong-login-recovery':'tong-runtime-permission']:['agentdock','oauth-owner'];
    let value;try {value=JSON.parse(await readFile(join(root,...file.path.split('/')),'utf8'));} catch {throw fail('CIPHERTEXT_REQUIRED');}
    if(Object.keys(value).sort().join(',')!=='ciphertext,purpose,schemaVersion,scope,userSid' || value.schemaVersion!==1||value.scope!=='CurrentUser'||!purposes.includes(value.purpose)||!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(value.userSid??'')||typeof value.ciphertext!=='string') throw fail('CIPHERTEXT_REQUIRED');
    const bytes=Buffer.from(value.ciphertext,'base64');
    if(bytes.toString('base64')!==value.ciphertext||bytes.length<64||bytes.subarray(0,20).toString('hex')!=='01000000d08c9ddf0115d1118c7a00c04fc297eb') throw fail('CIPHERTEXT_REQUIRED');
  }
}
async function snapshotCode(codeRoot,destination,commit,gitExecutable,pythonExecutable) {
  if(commit!==codeBase||!isAbsolute(codeRoot??'')||!isAbsolute(gitExecutable??'')) throw fail('CODE_BASE_REQUIRED');
  const actual=(await command(gitExecutable,['-C',codeRoot,'rev-parse',commit+'^{commit}'],destination)).trim();
  if(actual!==commit) throw fail('CODE_BASE_REQUIRED');
  const tree=await command(gitExecutable,['-C',codeRoot,'ls-tree','-r',commit],destination);
  if(tree.split('\n').some(line=>line.startsWith('120000')||line.startsWith('160000'))) throw fail('LINK_DENIED');
  await mkdir(join(destination,'code'));
  await command(gitExecutable,['-C',codeRoot,'archive','--format=tar','--output='+join(destination,'code/source.tar'),commit],destination);
  const names=['package.json','package-lock.json','scripts/Apply-TongDevSpacePatch.mjs'];
  // git archive applies the commit's EOL attributes; snapshot bytes from that exact archive.
  await command(pythonExecutable,['-I','-c',`import tarfile,sys,pathlib,json\nwith tarfile.open(sys.argv[1]) as a:\n for name in json.loads(sys.argv[3]):\n  pathlib.Path(sys.argv[2],name.replace('/','__')).write_bytes(a.extractfile(name).read())`,join(destination,'code/source.tar'),join(destination,'code'),JSON.stringify(names)],destination);
  const versions={};
  for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty']) {
    const packagePath=join(codeRoot,'node_modules',...name.split('/'),'package.json');
    const info=JSON.parse(await readFile(packagePath,'utf8')); versions[name]=info.version;
  }
  const hashes={};
  for(const name of ['pi-tools.js','server.js','workspaces.js']) hashes[name]=sha(await readFile(join(codeRoot,'node_modules/@waishnav/devspace/dist',name)));
  const native=[];
  async function visit(dir,prefix='') {
    for(const name of await readdir(dir)) {const path=join(dir,name),rel=prefix?prefix+'/'+name:name,info=await ordinary(path);if(info.isDirectory()) await visit(path,rel);else if(/\.(node|dll|exe)$/i.test(name)) {
      const item={path:relative(codeRoot,path).split(sep).join('/'),sha256:sha(await readFile(path))};native.push(item);
      const target=join(destination,'code/native',...item.path.split('/'));await mkdir(dirname(target),{recursive:true});await copyFile(path,target);
    }}
  }
  await visit(join(codeRoot,'node_modules/better-sqlite3')); await visit(join(codeRoot,'node_modules/node-pty'));
  const metadata={commit,nodeVersion:process.version,nodeAbi:process.versions.modules,platform:process.platform,arch:process.arch,versions,devspaceHashes:hashes,native};
  await writeFile(join(destination,'code/installed-dependencies.json'),JSON.stringify(metadata)+'\n',{flag:'wx'});
  return metadata;
}

export async function createRuntimeBackup({sourceRoot,backupRoot,codeRoot,codeCommit,gitExecutable,pythonExecutable}) {
  if(codeCommit!==codeBase) throw fail('CODE_BASE_REQUIRED');
  sourceRoot=allowedRoot(sourceRoot);backupRoot=allowedRoot(backupRoot);
  if(within(sourceRoot,backupRoot)||within(backupRoot,sourceRoot)) throw fail('PATH_DENIED');
  await protectedTree(sourceRoot); await stopped(sourceRoot);
  let freeze;
  try { freeze=await open(join(sourceRoot,'run/backup.freeze'),'wx',0o600); }
  catch(error) {throw fail(error.code==='EEXIST'?'BACKUP_BUSY':'BACKUP_UNAVAILABLE');}
  try {
    await freeze.writeFile(JSON.stringify({pid:process.pid,operation:'stopped-backup',at:new Date().toISOString()})+'\n'); await freeze.sync();
    const lifecycle=await stopped(sourceRoot), before=await inventory(sourceRoot);
    await ciphertextOnly(sourceRoot,before);
    await newDirectory(backupRoot); await mkdir(join(backupRoot,'runtime')); await copyInventory(sourceRoot,join(backupRoot,'runtime'),before);
    const code=await snapshotCode(codeRoot,backupRoot,codeCommit,gitExecutable,pythonExecutable);
    const sqlite=await sqliteEvidence(join(backupRoot,'runtime'),before,pythonExecutable);
    await stopped(sourceRoot);
    if(JSON.stringify(before)!==JSON.stringify(await inventory(sourceRoot))) throw fail('SOURCE_CHANGED');
    const files=[...(await inventory(join(backupRoot,'runtime'))).map(file=>({...file,path:'runtime/'+file.path})),...(await inventory(join(backupRoot,'code'))).map(file=>({...file,path:'code/'+file.path}))];
    const manifest={schemaVersion:1,syntheticOnly:true,sourceRoot,createdAt:new Date().toISOString(),lifecyclePhase:lifecycle.phase,code,sqlite,files};
    await writeFile(join(backupRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    await protectedTree(backupRoot); return manifest;
  } finally {await freeze.close();await unlink(join(sourceRoot,'run/backup.freeze'));}
}
export async function verifyRuntimeBackup(backupRoot) {
  backupRoot=allowedRoot(backupRoot); await protectedTree(backupRoot);
  const manifest=JSON.parse(await readFile(join(backupRoot,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.syntheticOnly!==true||!Array.isArray(manifest.files)||!manifest.code||!Array.isArray(manifest.sqlite)||!Array.isArray(manifest.code.native)) throw fail('MANIFEST_INVALID');
  if(manifest.code.commit!==codeBase) throw fail('CODE_BASE_REQUIRED');
  const seen=new Set();
  for(const file of manifest.files) {
    relativeFile(file.path);
    if(!/^(runtime|code)\//.test(file.path)||seen.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0) throw fail('MANIFEST_INVALID');
    seen.add(file.path);const path=join(backupRoot,...file.path.split('/'));
    try {await ordinary(path);if(sha(await readFile(path))!==file.sha256||(await lstat(path)).size!==file.size) throw fail('HASH_MISMATCH');} catch(error) {if(error.code==='ENOENT') throw fail('HASH_MISMATCH');throw error;}
  }
  const actual=[...(await inventory(join(backupRoot,'runtime'))).map(file=>({...file,path:'runtime/'+file.path})),...(await inventory(join(backupRoot,'code'))).map(file=>({...file,path:'code/'+file.path}))];
  if(actual.length!==manifest.files.length||actual.some(file=>!seen.has(file.path))) throw fail('MANIFEST_INVALID');
  for(const item of manifest.code.native) {relativeFile(item.path);if(!/^node_modules\/(better-sqlite3|node-pty)\//.test(item.path)||!manifest.files.some(file=>file.path==='code/native/'+item.path&&file.sha256===item.sha256)) throw fail('MANIFEST_INVALID');}
  return manifest;
}
function remap(value,from,to) {
  if(Array.isArray(value)) return value.map(item=>remap(item,from,to));
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item,from,to)]));
  if(typeof value==='string'&&isAbsolute(value)&&within(from,resolve(value))) return join(to,relative(from,resolve(value)));
  return value;
}
export async function restoreRuntimeBackup({backupRoot,restoreRoot,pythonExecutable,journalFloorRoot}) {
  if(!journalFloorRoot) throw fail('JOURNAL_FLOOR_REQUIRED');
  journalFloorRoot=allowedRoot(journalFloorRoot);
  restoreRoot=allowedRoot(restoreRoot);backupRoot=allowedRoot(backupRoot);
  if(within(backupRoot,restoreRoot)||within(restoreRoot,backupRoot)||within(journalFloorRoot,restoreRoot)||within(restoreRoot,journalFloorRoot)) throw fail('PATH_DENIED');
  const manifest=await verifyRuntimeBackup(backupRoot);
  const authoritativeFloor=allowedRoot(manifest.sourceRoot);
  if(journalFloorRoot.toLowerCase()!==authoritativeFloor.toLowerCase()) throw fail('JOURNAL_FLOOR_DENIED');
  await protectedTree(journalFloorRoot);await stopped(journalFloorRoot);
  let freeze;
  try {freeze=await open(join(journalFloorRoot,'run/backup.freeze'),'wx',0o600);}catch(error){throw fail(error.code==='EEXIST'?'BACKUP_BUSY':'BACKUP_UNAVAILABLE');}
  try {
  await freeze.writeFile(JSON.stringify({pid:process.pid,operation:'journal-floor-restore',at:new Date().toISOString()})+'\n');await freeze.sync();await stopped(journalFloorRoot);
  const journalFiles=(await inventory(journalFloorRoot)).filter(file=>file.path.includes('/agentdock-operations/'));
  await newDirectory(restoreRoot);
  const files=manifest.files.filter(file=>file.path.startsWith('runtime/')).map(file=>({...file,path:file.path.slice(8)}));
  await copyInventory(join(backupRoot,'runtime'),restoreRoot,files);
  await ciphertextOnly(restoreRoot,files);
  for(const file of journalFiles) {
    if(!/^(tong-state|tong-policy)\/agentdock-operations\/[a-f0-9]{64}\.json$/.test(file.path)) throw fail('JOURNAL_INVALID');
    const record=JSON.parse(await readFile(join(journalFloorRoot,...file.path.split('/')),'utf8'));
    if(record.operationId!==file.path.split('/').at(-1).slice(0,-5)) throw fail('JOURNAL_INVALID');
    const previous=files.find(entry=>entry.path===file.path);
    if(previous&&previous.sha256!==file.sha256) throw fail('JOURNAL_CONFLICT');
    if(!previous) await copyInventory(journalFloorRoot,restoreRoot,[file]);
  }
  const sqlite=await sqliteEvidence(restoreRoot,files,pythonExecutable);
  if(JSON.stringify(sqlite)!==JSON.stringify(manifest.sqlite)) throw fail('SQLITE_MISMATCH');
  // Raw approvals/tasks/lifecycle remain in the immutable snapshot for local reconciliation.
  for(const file of files.filter(file=>file.path.endsWith('.json')&&!file.path.includes('agentdock-operations/')&&!file.path.startsWith('secrets/'))) {
    const path=join(restoreRoot,...file.path.split('/'));
    let value; try {value=JSON.parse(await readFile(path,'utf8'));} catch {throw fail('STATE_INVALID');}
    value=remap(value,manifest.sourceRoot,restoreRoot);
    if(file.path.endsWith('/agentdock-access.json')) {value.projects=[];value.approvals=[];value.enabled=false;}
    if(file.path.endsWith('/trusted-codex.json')) revokeRestoredTrustedAuthorization(value);
    if(file.path.endsWith('/agent-execution.json')) value.projects=[];
    if(file.path.endsWith('/project-access.json')) {if(!Array.isArray(value.projects)) throw fail('STATE_INVALID');for(const project of value.projects) {if(!within(restoreRoot,resolve(project.root))) throw fail('PATH_DENIED');project.status='disabled';}}
    if(file.path.endsWith('/agent-tasks.json')) {if(!Array.isArray(value.tasks)) throw fail('STATE_INVALID');for(const task of value.tasks) {task.restoreOriginalStatus=task.status;if(['queued','running','waiting_user_action'].includes(task.status)) task.status='failed';task.pendingApproval=false;task.codexSessionId=null;task.restoreRequiresReconciliation=true;}}
    if(file.path==='run/runtime.json') {value.restoreRequiresReconciliation=true;value.phase='stopped';}
    await writeFile(path,JSON.stringify(value,null,2)+'\n');
  }
  await stopped(journalFloorRoot);
  if(JSON.stringify(journalFiles)!==JSON.stringify((await inventory(journalFloorRoot)).filter(file=>file.path.includes('/agentdock-operations/')))) throw fail('SOURCE_CHANGED');
  const evidence={schemaVersion:1,syntheticOnly:true,restoreRoot,backupRoot,journalFloorRoot,journalFloorRecords:journalFiles.length,codeCommit:manifest.code.commit,sqlite,executionDisabled:true,autoDispatch:false,restoredAt:new Date().toISOString()};
  await writeFile(join(restoreRoot,'restore-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  await protectedTree(restoreRoot);return evidence;
  }finally{await freeze.close();await unlink(join(journalFloorRoot,'run/backup.freeze'));}
}

const extractScript=`import tarfile,sys,pathlib
root=pathlib.Path(sys.argv[2]).resolve()
with tarfile.open(sys.argv[1]) as archive:
 for member in archive.getmembers():
  p=pathlib.PurePosixPath(member.name)
  if p.is_absolute() or '..' in p.parts or ':' in member.name or '\\\\' in member.name or not (member.isdir() or member.isfile()): raise RuntimeError('path')
  target=root.joinpath(*p.parts)
  if member.isdir(): target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as out: out.write(archive.extractfile(member).read())`;
export async function restoreRuntimeCode({backupRoot,codeRestoreRoot,pythonExecutable,npmCli,npmCacheRoot}) {
  const manifest=await verifyRuntimeBackup(backupRoot);
  if(manifest.code.nodeAbi!==process.versions.modules||manifest.code.platform!==process.platform||manifest.code.arch!==process.arch||manifest.code.nodeVersion!==process.version) throw fail('NATIVE_ABI_MISMATCH');
  codeRestoreRoot=allowedRoot(codeRestoreRoot);
  if(within(backupRoot,codeRestoreRoot)||within(codeRestoreRoot,backupRoot)) throw fail('PATH_DENIED');
  if(npmCacheRoot) {npmCacheRoot=allowedRoot(npmCacheRoot);await assertProtectedPaths([npmCacheRoot]);}
  codeRestoreRoot=await newDirectory(codeRestoreRoot);
  if(!isAbsolute(npmCli??'')) throw fail('NPM_REQUIRED');
  await command(pythonExecutable,['-I','-c',extractScript,join(backupRoot,'code/source.tar'),codeRestoreRoot],codeRestoreRoot);
  for(const name of ['package.json','package-lock.json','scripts/Apply-TongDevSpacePatch.mjs']) {
    if(sha(await readFile(join(codeRestoreRoot,...name.split('/'))))!==sha(await readFile(join(backupRoot,'code',name.replaceAll('/','__'))))) throw fail('CODE_HASH_MISMATCH');
  }
  // Restore locked package contents, exact archived native helpers, then the archived Tong patch.
  // Install scripts would redownload/rebuild native assets and are deliberately skipped.
  await command(process.execPath,[npmCli,'ci','--ignore-scripts','--no-audit','--no-fund',...(npmCacheRoot?['--cache',npmCacheRoot,'--prefer-offline']:[])],codeRestoreRoot,300000);
  for(const item of manifest.code.native) {const target=join(codeRestoreRoot,...item.path.split('/'));await mkdir(dirname(target),{recursive:true});await ordinary(dirname(target));await copyFile(join(backupRoot,'code/native',...item.path.split('/')),target);if(sha(await readFile(target))!==item.sha256) throw fail('DEPENDENCY_MISMATCH');}
  await command(process.execPath,[join(codeRestoreRoot,'scripts/Apply-TongDevSpacePatch.mjs')],codeRestoreRoot);
  await command(process.execPath,[join(codeRestoreRoot,'scripts/Apply-TongDevSpacePatch.mjs'),'--check'],codeRestoreRoot);
  for(const [name,version] of Object.entries(manifest.code.versions)) if(JSON.parse(await readFile(join(codeRestoreRoot,'node_modules',...name.split('/'),'package.json'),'utf8')).version!==version) throw fail('DEPENDENCY_MISMATCH');
  for(const [name,hash] of Object.entries(manifest.code.devspaceHashes)) if(sha(await readFile(join(codeRestoreRoot,'node_modules/@waishnav/devspace/dist',name)))!==hash) throw fail('DEPENDENCY_MISMATCH');
  const native=[];
  for(const item of manifest.code.native) {const hash=sha(await readFile(join(codeRestoreRoot,...item.path.split('/'))));native.push({path:item.path,sha256:hash,matchesBaseline:hash===item.sha256});}
  if(native.some(item=>!item.matchesBaseline)) throw fail('DEPENDENCY_MISMATCH');
  // Load the restored SQLite binding; PTY spawning remains the runtime owner's independent live check.
  const probe=JSON.parse(await command(process.execPath,['--input-type=module','-e',`import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('PRAGMA integrity_check').pluck().get()!=='ok') throw Error('integrity');db.close();console.log(JSON.stringify({sqliteNativeLoaded:true}));`],codeRestoreRoot));
  const evidence={schemaVersion:1,codeCommit:manifest.code.commit,codeRestoreRoot,nodeVersion:process.version,nodeAbi:process.versions.modules,lockedInstall:'npm ci --ignore-scripts',nativeRestore:'exact archived hashes',versions:manifest.code.versions,devspaceHashes:manifest.code.devspaceHashes,native,...probe};
  await writeFile(join(codeRestoreRoot,'dependency-restore-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  await assertProtectedPaths([codeRestoreRoot,join(codeRestoreRoot,'dependency-restore-evidence.json')]);return evidence;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,configPath,...extra]=process.argv.slice(2);
    if(extra.length||!['backup','restore','restore-code','verify'].includes(action)||!isAbsolute(configPath??'')) throw fail('USAGE: backup|restore|restore-code|verify ABSOLUTE_JSON_CONFIG');
    await assertProtectedPaths([configPath]);const config=JSON.parse(await readFile(configPath,'utf8'));
    const result=action==='backup'?await createRuntimeBackup(config):action==='restore'?await restoreRuntimeBackup(config):action==='restore-code'?await restoreRuntimeCode(config):await verifyRuntimeBackup(config.backupRoot);
    console.log(JSON.stringify({ok:true,action,codeCommit:result.codeCommit??result.code?.commit}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
