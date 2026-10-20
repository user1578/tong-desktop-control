import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';

// Replay the actual install/rollback code in an isolated file tree. The native
// lifecycle boundary is mocked here; its Job/identity/port proof has separate
// real-Windows and checkpoint regressions. No production operation is called.
const execute=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const base='D:\\Tong\\state\\p27-autonomy-candidate-20261017';
const original=join(base,'quick-trust-full-cutover-20261020084000551-ffdcdbb2');
const candidate=join(base,'quick-trust-candidate-37dc649');
const release=join(base,'quick-trust-release-37dc649');
const manifestBytes=await readFile(join(release,'release-manifest.json')),manifest=JSON.parse(manifestBytes);
const temp=await createTongTestDirectory('tong-full-cutover-files-');let passed=false;
try{
  const root=temp.path,runtime=join(root,'runtime'),app=join(root,'app'),manager=join(runtime,'releases/manager');
  const staged=join(root,'quick-trust-candidate-37dc649'),pack=join(root,'quick-trust-release-37dc649');
  const targets={app,manager},runner=join(runtime,'login-management/TongLoginRuntime.ps1');
  const read=async p=>JSON.parse(await readFile(p,'utf8'));
  const copy=async(from,to)=>{await mkdir(dirname(to),{recursive:true});await copyFile(from,to)};
  let helper=await readFile(new URL('../scripts/TongQuickTrustFullCutover.mjs',import.meta.url),'utf8');
  const replace=(from,to)=>{assert.ok(helper.includes(from),from);helper=helper.replaceAll(from,to)};
  replace("const BASE='D:\\\\Tong\\\\state\\\\p27-autonomy-candidate-20261017';",'const BASE='+JSON.stringify(root)+';');
  replace("const RUNTIME='D:\\\\Tong\\\\runtime';",'const RUNTIME='+JSON.stringify(runtime)+';');
  replace("app:'D:\\\\Tong\\\\app'",'app:'+JSON.stringify(app));
  replace("'D:\\\\Tong\\\\runtime\\\\login-management\\\\TongLoginRuntime.ps1'",JSON.stringify(runner));
  const start=helper.indexOf('async function assertStopped(){'),end=helper.indexOf('async function backupPrivateState(',start);
  assert.ok(start>0&&end>start);
  helper=helper.slice(0,start)+"async function assertStopped(){return {phase:'stopped',runId:'synthetic'};}\n"+helper.slice(end);
  const program=join(root,'helper.mjs');await writeFile(program,helper);
  await mkdir(pack);await writeFile(join(pack,'release-manifest.json'),manifestBytes);
  for(const f of manifest.sourceFiles)await copy(join(candidate,f.path),join(staged,f.path));
  for(const name of Object.keys(manifest.expectedDevspaceHashes))await copy(join(candidate,'node_modules/@waishnav/devspace/dist',name),join(staged,'node_modules/@waishnav/devspace/dist',name));
  const old={app:await read(join(original,'release-pin.json')),manager:await read(join(original,'manager-pin.json'))};
  for(const key of Object.keys(targets)){
    for(const f of old[key].sourceFiles)await copy(join(original,'backup',key,f.path),join(targets[key],f.path));
    for(const name of Object.keys(old[key].expectedDevspaceHashes))await copy(join(original,'patched-backup',key,name),join(targets[key],'node_modules/@waishnav/devspace/dist',name));
  }
  const metadata=[['release-pin.json',join(runtime,'run/release-pin.json')],['manager-pin.json',join(runtime,'run/manager-pin.json')],['profile.json',join(runtime,'profile.json')],['login-runner.ps1',runner]];
  for(const [name,to]of metadata)await copy(join(original,name),to);
  const sentinel=join(runtime,'tong-policy/keep-project-and-session-state.json');await mkdir(dirname(sentinel));await writeFile(sentinel,'{"preserved":true}');
  const invoke=async(action,snapshot)=>{const result=await execute(process.execPath,[program,action,snapshot??'-',pack,staged,manifest.commit],{windowsHide:true,timeout:30000});return JSON.parse(result.stdout)};
  for(const mode of ['full','partial']){
    const snapshot=join(root,'quick-trust-full-cutover-'+mode);await mkdir(snapshot);
    for(const key of Object.keys(targets)){
      for(const f of old[key].sourceFiles)await copy(join(original,'backup',key,f.path),join(snapshot,'backup',key,f.path));
      for(const name of Object.keys(old[key].expectedDevspaceHashes))await copy(join(original,'patched-backup',key,name),join(snapshot,'patched-backup',key,name));
    }
    for(const [name]of metadata)await copy(join(original,name),join(snapshot,name));
    await writeFile(join(snapshot,'snapshot.json'),JSON.stringify({schemaVersion:1,oldApp:old.app.commit,oldManager:old.manager.commit,newCommit:manifest.commit,stage:mode==='full'?'state-backed-up':'installing'}));
    if(mode==='full'){
      assert.equal((await invoke('install',snapshot)).ok,true);
      for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(runtime,'run',name),manifestBytes);
      const profile=await read(join(runtime,'profile.json'));profile.sourceDigest=manifest.files.find(f=>f.path==='code/source.tar').sha256;profile.releaseDigest=hash(manifestBytes);
      await writeFile(join(runtime,'profile.json'),JSON.stringify(profile));
      assert.equal((await invoke('install-runner',snapshot)).ok,true);
      assert.equal((await invoke('verify-installed')).ok,true);
    }else for(const key of Object.keys(targets))for(const f of manifest.sourceFiles.slice(0,key==='app'?17:9))await copy(join(staged,f.path),join(targets[key],f.path));
    assert.equal((await invoke('rollback',snapshot)).ok,true);
    for(const key of Object.keys(targets)){
      for(const f of old[key].sourceFiles){const b=await readFile(join(targets[key],f.path));assert.equal(b.length,f.size);assert.equal(hash(b),f.sha256)}
      for(const [name,sha]of Object.entries(old[key].expectedDevspaceHashes))assert.equal(hash(await readFile(join(targets[key],'node_modules/@waishnav/devspace/dist',name))),sha);
      for(const f of manifest.sourceFiles.filter(f=>!old[key].sourceFiles.some(previous=>previous.path===f.path)))await assert.rejects(lstat(join(targets[key],f.path)),{code:'ENOENT'});
    }
    for(const [name,to]of metadata)assert.deepEqual(await readFile(to),await readFile(join(original,name)));
    assert.equal(await readFile(sentinel,'utf8'),'{"preserved":true}');
  }
  passed=true;console.log('PASS: real full/partial file cutovers restore both releases, patches, pins, profile and runner; project/session state preserved.');
}finally{await temp.finish(passed)}
