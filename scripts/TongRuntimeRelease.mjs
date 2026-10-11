import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProtectedPaths, safeEnvironment } from './TongRuntimeSecurity.mjs';

// Build eligibility is not production approval: the approval document must bind
// the reviewed archive hash. Neither a branch name nor dirty tree is a release.
const baseCommit='9589698864e70a61299e839c34ab5ab1b8677bf9';
const oldCommit='58786f601ceb8c7f3842225697adfb5e4034a73f';
const preciseCommit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const defaultPython='C:\\Program Files\\Python311\\python.exe';
const developmentRoot = resolve('C:\\Users\\Rune\\.codex\\worktrees\\p24-agentdock-client\\tong-desktop-control');
const stateRoot = resolve('D:\\agentdock-poc-20261010\\isolated\\state');
const packages = ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty'];
const fail = code => new Error(code);
const sha = value => createHash('sha256').update(value).digest('hex');
const within = (root,target) => { const value=relative(root,target); return value==='' || !isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep); };
function allowedRoot(value) {
  if(typeof value!=='string'||!isAbsolute(value)||!within(stateRoot,resolve(value))||resolve(value)===stateRoot) throw fail('PATH_DENIED');
  if(value.split(/[\\/]/).some(part=>part==='.'||part==='..'))throw fail('PATH_DENIED');
  relativeFile(relative(stateRoot,resolve(value)).split(sep).join('/'));
  return resolve(value);
}
function relativeFile(value) {
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) throw fail('PATH_DENIED');
  return value;
}
function separate(left,right) {if(within(left,right)||within(right,left)) throw fail('PATH_DENIED');}
async function ordinary(path) {
  const info=await lstat(path);
  if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||info.isFile()&&info.nlink!==1||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase()) throw fail('LINK_DENIED');
  return info;
}
async function inventory(root,prefix='') {
  await ordinary(root);const files=[];
  for(const name of (await readdir(root)).sort()) {
    const path=join(root,name),rel=relativeFile(prefix?prefix+'/'+name:name),info=await ordinary(path);
    if(info.isDirectory()) files.push(...await inventory(path,rel));
    else files.push({path:rel,size:info.size,sha256:sha(await readFile(path))});
  }
  return files;
}
async function protectedTree(root) {
  const paths=[root];
  async function visit(path) {for(const name of await readdir(path)) {const child=join(path,name),info=await ordinary(child);paths.push(child);if(info.isDirectory())await visit(child);}}
  await ordinary(root);await visit(root);
  for(let index=0;index<paths.length;index+=256)await assertProtectedPaths(paths.slice(index,index+256));
}
async function newDirectory(root) {
  root=allowedRoot(root);await ordinary(dirname(root));await assertProtectedPaths([dirname(root)]);
  try {await mkdir(root);}catch(error){throw fail(error.code==='EEXIST'?'DESTINATION_EXISTS':'DESTINATION_UNAVAILABLE');}
  await assertProtectedPaths([root]);return root;
}
async function tool(executable) {if(typeof executable!=='string'||!isAbsolute(executable)||(await ordinary(executable)).isDirectory())throw fail('TOOL_REQUIRED');return executable;}
function command(executable,args,cwd,timeout=30000) {
  return new Promise((ok,reject)=>{
    const child=spawn(executable,args,{cwd,windowsHide:true,env:safeEnvironment(cwd),stdio:['ignore','pipe','pipe']});let out='',size=0;
    const timer=setTimeout(()=>child.kill(),timeout);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)child.kill();else out+=chunk;});
    // Do not return npm/environment or dependency error text to callers.
    child.stderr.resume();
    child.once('error',()=>{clearTimeout(timer);reject(fail('LOCAL_TOOL_FAILED'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||size>8*1024*1024)reject(fail('LOCAL_TOOL_FAILED'));else ok(out);});
  });
}
const extractScript = `import tarfile,sys,pathlib,re,json,hashlib
root=pathlib.Path(sys.argv[2]).resolve(); seen=set()
with tarfile.open(sys.argv[1]) as archive:
 if archive.pax_headers.get('comment')!=sys.argv[3]: raise RuntimeError('commit')
 members=archive.getmembers()
 for member in members:
  name=member.name.rstrip('/') if member.isdir() else member.name
  parts=name.split('/')
  if not name or name.startswith('/') or any(not p or p in ('.','..') or re.search(r'[<>:"|?*\\\\\\x00-\\x1f]',p) or p.endswith(('.', ' ')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\.|$)',p,re.I) for p in parts) or not (member.isdir() or member.isfile()) or name.lower() in seen: raise RuntimeError('path')
  seen.add(name.lower())
 if len(sys.argv)>4 and sys.argv[4]=='verify':
  print(json.dumps([{'path':m.name,'size':m.size,'sha256':hashlib.sha256(archive.extractfile(m).read()).hexdigest()} for m in members if m.isfile()]))
  sys.exit(0)
 for member in members:
  target=root.joinpath(*member.name.rstrip('/').split('/'))
  if member.isdir(): target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as out: out.write(archive.extractfile(member).read())`;
function patchHashes(source) {
  const result={};
  for(const match of source.matchAll(/name:\s*["']([^"']+)["'][\s\S]*?patchedHash:\s*["']([a-f0-9]{64})["']/g))result[match[1]]=match[2];
  if(Object.keys(result).sort().join(',')!=='pi-tools.js,server.js,workspaces.js')throw fail('PATCH_INVALID');
  return result;
}
async function nativeFiles(codeRoot) {
  const result=[];
  for(const name of ['better-sqlite3','node-pty']) {
    const prefix='node_modules/'+name;
    for(const item of await inventory(join(codeRoot,...prefix.split('/'))))if(/\.(node|dll|exe)$/i.test(item.path))result.push({...item,path:prefix+'/'+item.path});
  }
  if(!result.some(item=>item.path==='node_modules/better-sqlite3/build/Release/better_sqlite3.node')||!result.some(item=>item.path==='node_modules/node-pty/prebuilds/win32-x64/conpty.node'))throw fail('NATIVE_REQUIRED');
  return result;
}
async function copyKnown(from,to,files) {
  for(const item of files) {
    relativeFile(item.path);const source=join(from,...item.path.split('/')),target=join(to,...item.path.split('/'));
    await ordinary(source);await mkdir(dirname(target),{recursive:true});await ordinary(dirname(target));
    try {await ordinary(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    await copyFile(source,target);if(sha(await readFile(target))!==item.sha256)throw fail('HASH_MISMATCH');
  }
}
export async function buildRelease({codeRoot,commit,releaseRoot,gitExecutable,pythonExecutable}) {
  if(typeof codeRoot!=='string'||!isAbsolute(codeRoot)||resolve(codeRoot).toLowerCase()!==developmentRoot.toLowerCase())throw fail('CODE_ROOT_DENIED');
  if(!preciseCommit(commit))throw fail('COMMIT_DENIED');
  releaseRoot=allowedRoot(releaseRoot);await ordinary(codeRoot);await tool(gitExecutable);await tool(pythonExecutable);
  const actual=(await command(gitExecutable,['-C',codeRoot,'rev-parse',commit+'^{commit}'],codeRoot)).trim();
  if(actual!==commit)throw fail('COMMIT_DENIED');
  if(commit!==oldCommit&&commit!==baseCommit) {
    try {await command(gitExecutable,['-C',codeRoot,'merge-base','--is-ancestor',baseCommit,commit],codeRoot);}
    catch {throw fail('COMMIT_DENIED');}
  }
  const tree=await command(gitExecutable,['-C',codeRoot,'ls-tree','-r',commit],codeRoot);
  if(tree.split('\n').some(line=>/^(120000|160000)/.test(line)))throw fail('LINK_DENIED');
  await newDirectory(releaseRoot);await mkdir(join(releaseRoot,'code'));await mkdir(join(releaseRoot,'code/source'));
  const sourceArchive=join(releaseRoot,'code/source.tar');
  await command(gitExecutable,['-C',codeRoot,'archive','--format=tar','--output='+sourceArchive,commit],releaseRoot);
  await command(pythonExecutable,['-I','-c',extractScript,sourceArchive,join(releaseRoot,'code/source'),commit],releaseRoot);
  const sourceFiles=await inventory(join(releaseRoot,'code/source'));
  if(sourceFiles.some(item=>item.path.startsWith('node_modules/')||item.path==='.git'||item.path.startsWith('.git/')))throw fail('SOURCE_INVALID');
  const lock=JSON.parse(await readFile(join(releaseRoot,'code/source/package-lock.json'),'utf8'));
  const versions={};
  for(const name of packages) {
    const installed=JSON.parse(await readFile(join(codeRoot,'node_modules',...name.split('/'),'package.json'),'utf8'));
    if(installed.version!==lock.packages?.['node_modules/'+name]?.version)throw fail('DEPENDENCY_MISMATCH');
    versions[name]=installed.version;
  }
  const expectedDevspaceHashes=patchHashes(await readFile(join(releaseRoot,'code/source/scripts/Apply-TongDevSpacePatch.mjs'),'utf8'));
  const native=await nativeFiles(codeRoot);await mkdir(join(releaseRoot,'native'));await copyKnown(codeRoot,join(releaseRoot,'native'),native);
  if(JSON.stringify(native)!==JSON.stringify(await nativeFiles(codeRoot)))throw fail('SOURCE_CHANGED');
  const node={executable:process.execPath,version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch,sha256:sha(await readFile(process.execPath))};
  const files=await inventory(releaseRoot);
  const manifest={schemaVersion:1,syntheticOnly:true,commit,sourceRepository:developmentRoot,releaseRoot,createdAt:new Date().toISOString(),sourceFiles,native,versions,expectedDevspaceHashes,node,files};
  await writeFile(join(releaseRoot,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await verifyRelease({releaseRoot,pythonExecutable});return manifest;
}
function validFiles(files) {
  if(!Array.isArray(files)||!files.length)throw fail('MANIFEST_INVALID');const seen=new Set();
  for(const file of files) {
    relativeFile(file.path);const key=file.path.toLowerCase();
    if(seen.has(key)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)throw fail('MANIFEST_INVALID');seen.add(key);
  }
}
export async function verifyRelease({releaseRoot,pythonExecutable=defaultPython}) {
  releaseRoot=allowedRoot(releaseRoot);await protectedTree(releaseRoot);
  const manifest=JSON.parse(await readFile(join(releaseRoot,'release-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.syntheticOnly!==true||!preciseCommit(manifest.commit)||manifest.sourceRepository!==developmentRoot)throw fail('MANIFEST_INVALID');
  validFiles(manifest.files);validFiles(manifest.sourceFiles);validFiles(manifest.native);
  const actual=(await inventory(releaseRoot)).filter(item=>item.path!=='release-manifest.json');
  if(actual.length!==manifest.files.length)throw fail('MANIFEST_INVALID');
  for(const file of manifest.files) {
    if(file.path!=='code/source.tar'&&!file.path.startsWith('code/source/')&&!file.path.startsWith('native/node_modules/better-sqlite3/')&&!file.path.startsWith('native/node_modules/node-pty/'))throw fail('MANIFEST_INVALID');
    const found=actual.find(item=>item.path===file.path);if(!found||found.size!==file.size||found.sha256!==file.sha256)throw fail('HASH_MISMATCH');
  }
  const sourceFiles=actual.filter(file=>file.path.startsWith('code/source/')).map(file=>({...file,path:file.path.slice(12)}));
  const native=actual.filter(file=>file.path.startsWith('native/')).map(file=>({...file,path:file.path.slice(7)}));
  if(JSON.stringify(sourceFiles)!==JSON.stringify(manifest.sourceFiles)||JSON.stringify(native)!==JSON.stringify(manifest.native)||!actual.some(file=>file.path==='code/source.tar'))throw fail('MANIFEST_INVALID');
  await tool(pythonExecutable);let archiveFiles;
  try {archiveFiles=JSON.parse(await command(pythonExecutable,['-I','-c',extractScript,join(releaseRoot,'code/source.tar'),releaseRoot,manifest.commit,'verify'],releaseRoot));}
  catch {throw fail('ARCHIVE_INVALID');}
  if(archiveFiles.length!==sourceFiles.length||archiveFiles.some(item=>!sourceFiles.some(file=>file.path===item.path&&file.size===item.size&&file.sha256===item.sha256)))throw fail('CODE_HASH_MISMATCH');
  const expected=patchHashes(await readFile(join(releaseRoot,'code/source/scripts/Apply-TongDevSpacePatch.mjs'),'utf8'));
  if(JSON.stringify(expected)!==JSON.stringify(manifest.expectedDevspaceHashes))throw fail('MANIFEST_INVALID');
  const lock=JSON.parse(await readFile(join(releaseRoot,'code/source/package-lock.json'),'utf8'));
  if(!manifest.versions||Object.keys(manifest.versions).sort().join(',')!==packages.slice().sort().join(',')||packages.some(name=>manifest.versions[name]!==lock.packages?.['node_modules/'+name]?.version)||!manifest.node||!/^[a-f0-9]{64}$/.test(manifest.node.sha256))throw fail('MANIFEST_INVALID');
  return manifest;
}
export async function restoreRelease({releaseRoot,candidateRoot,pythonExecutable,npmCli,npmCacheRoot}) {
  candidateRoot=allowedRoot(candidateRoot);releaseRoot=allowedRoot(releaseRoot);separate(releaseRoot,candidateRoot);
  const manifest=await verifyRelease({releaseRoot,pythonExecutable});
  const node=manifest.node;
  if(node.version!==process.version||node.abi!==process.versions.modules||node.platform!==process.platform||node.arch!==process.arch||node.sha256!==sha(await readFile(process.execPath)))throw fail('NODE_MISMATCH');
  await tool(pythonExecutable);await tool(npmCli);
  // A protected copied cache stays within this run's new tree. --offline prevents
  // registry requests and --ignore-scripts prevents native rebuilds/downloads.
  npmCacheRoot=allowedRoot(npmCacheRoot);separate(npmCacheRoot,candidateRoot);separate(npmCacheRoot,releaseRoot);await protectedTree(npmCacheRoot);
  await newDirectory(candidateRoot);
  await command(pythonExecutable,['-I','-c',extractScript,join(releaseRoot,'code/source.tar'),candidateRoot,manifest.commit],candidateRoot);
  const sourceFiles=await inventory(candidateRoot);
  if(JSON.stringify(sourceFiles)!==JSON.stringify(manifest.sourceFiles))throw fail('CODE_HASH_MISMATCH');
  await command(process.execPath,[npmCli,'ci','--ignore-scripts','--no-audit','--no-fund','--offline','--cache',npmCacheRoot],candidateRoot,300000);
  await copyKnown(join(releaseRoot,'native'),candidateRoot,manifest.native);
  const patch=join(candidateRoot,'scripts/Apply-TongDevSpacePatch.mjs');
  await command(process.execPath,[patch],candidateRoot);await command(process.execPath,[patch,'--check'],candidateRoot);
  for(const name of packages)if(JSON.parse(await readFile(join(candidateRoot,'node_modules',...name.split('/'),'package.json'),'utf8')).version!==manifest.versions[name])throw fail('DEPENDENCY_MISMATCH');
  const devspaceHashes={};
  for(const [name,expected] of Object.entries(manifest.expectedDevspaceHashes)) {
    const actual=sha(await readFile(join(candidateRoot,'node_modules/@waishnav/devspace/dist',name)));if(actual!==expected)throw fail('DEPENDENCY_MISMATCH');devspaceHashes[name]=actual;
  }
  const native=await nativeFiles(candidateRoot);if(JSON.stringify(native)!==JSON.stringify(manifest.native))throw fail('DEPENDENCY_MISMATCH');
  for(const item of manifest.sourceFiles)if(sha(await readFile(join(candidateRoot,...item.path.split('/'))))!==item.sha256)throw fail('CODE_HASH_MISMATCH');
  const probe=JSON.parse(await command(process.execPath,['--input-type=module','-e',`import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('PRAGMA integrity_check').pluck().get()!=='ok')throw Error('integrity');db.close();console.log(JSON.stringify({sqliteNativeLoaded:true}));`],candidateRoot));
  await verifyRelease({releaseRoot,pythonExecutable});
  const evidence={schemaVersion:1,syntheticOnly:true,commit:manifest.commit,releaseRoot,candidateRoot,sourceFilesVerified:manifest.sourceFiles.length,node,versions:manifest.versions,devspaceHashes,native,lockedInstall:'npm ci --ignore-scripts --offline',nativeRestore:'exact archived hashes',patchChecked:true,...probe,restoredAt:new Date().toISOString()};
  const evidencePath=join(candidateRoot,'release-restore-evidence.json');await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});await assertProtectedPaths([candidateRoot,evidencePath]);return evidence;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,configPath,...extra]=process.argv.slice(2);
    if(extra.length||!['build','verify','restore'].includes(action))throw fail('USAGE: build|verify|restore ABSOLUTE_JSON_CONFIG');
    allowedRoot(configPath);await assertProtectedPaths([configPath]);const config=JSON.parse(await readFile(configPath,'utf8'));
    const result=action==='build'?await buildRelease(config):action==='restore'?await restoreRelease(config):await verifyRelease(config);
    console.log(JSON.stringify({ok:true,action,commit:result.commit,releaseRoot:result.releaseRoot,candidateRoot:result.candidateRoot}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
