// The actual 2->1 file installer is interrupted, then a fresh PS7 process
// restores the full fixture including OAuth/business/control/permission bytes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,rename,readdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const ops=join(root,'offline-9850e1a'),snapshot=join(ops,'isolation-52b84969-c847-4f78-9699-d57c5d46842a');
const release2='D:\\Tong\\state\\p27-autonomy-candidate-20261017\\quick-trust-release-024d5b0';
const one='37dc649c46ad0e267c3471f750b97227cf106310',two='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';
const script=fileURLToPath(new URL('../scripts/TongStable1Offline.ps1',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p)),commands=[];await mkdir(join(ops,'temp'),{recursive:true});
const env={...process.env,TEMP:join(ops,'temp'),TMP:join(ops,'temp')};let seal;
async function command(mode,extra=[],expected=0){const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode',mode,'-Snapshot',snapshot,...(seal?['-ExpectedSeal',seal]:[]),...extra],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});const result={mode,extra,code,workerPid:child.pid,stdoutSha256:sha(out),stderrSha256:sha(err),stdout:out,stderr:err};commands.push(result);await writeFile(join(ops,'isolation-commands.json'),JSON.stringify(commands,null,2)+'\n');console.log(JSON.stringify({mode,code,workerPid:child.pid,stdout:out,stderr:code===expected?'':err}));assert.equal(code,expected,err);return out.trim()?JSON.parse(out):null;}
const action=process.argv[2]??'run';assert.equal(action,'run');
await command('InspectIsolation');
await assert.rejects(lstat(snapshot),{code:'ENOENT'});
const profile1=await json(join(root,'profile.json'));assert.equal((await verifyRuntimeCandidate(profile1)).commit,one);
const saved=join(ops,'original-1-source');await mkdir(saved);
const pin1=await json(join(root,'run/release-pin.json')),pin2=await json(join(release2,'release-manifest.json'));
assert.equal(pin2.commit,two);const pin2Bytes=await readFile(join(release2,'release-manifest.json'));
for(const [group,target] of [['app',profile1.codeRoot],['manager',profile1.managerRoot]]){
 for(const f of pin1.sourceFiles){const to=join(saved,group,f.path);await mkdir(dirname(to),{recursive:true});await copyFile(join(target,f.path),to);}
 for(const f of pin2.sourceFiles){const to=join(target,f.path);await mkdir(dirname(to),{recursive:true});const b=await readFile(join(release2,'code/source',f.path));assert.equal(sha(b),f.sha256);await writeFile(to,b);}
 for(const f of pin2.native)assert.equal(sha(await readFile(join(target,f.path))),f.sha256);
 for(const [name,hash] of Object.entries(pin2.expectedDevspaceHashes)){const b=await readFile(join('D:\\Tong\\app\\node_modules\\@waishnav\\devspace\\dist',name));assert.equal(sha(b),hash);await writeFile(join(target,'node_modules/@waishnav/devspace/dist',name),b);}
}
await writeFile(join(saved,'profile.json'),JSON.stringify(profile1));
const profile2={...profile1,sourceDigest:pin2.files.find(f=>f.path==='code/source.tar').sha256,releaseDigest:sha(pin2Bytes)};
await writeFile(join(root,'profile.json'),JSON.stringify(profile2));
const retainedRun=join(ops,'original-1-run');await rename(join(root,'run'),retainedRun);await mkdir(join(root,'run'));
// Original production incident controls, never edited or fabricated. The fixture
// has no production authority; the native probe independently checks all IDs.
for(const name of await readdir('D:\\Tong\\runtime\\run'))await copyFile(join('D:\\Tong\\runtime\\run',name),join(root,'run',name));
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pin2Bytes);
assert.equal((await readFile(join(root,'run/backup.freeze'))).length,0);
for(const p of [profile2.runtimeDir,join(root,'login-management'),join(root,'secrets/runtime-permissions')])await mkdir(p,{recursive:true});
const business=join(profile2.runtimeDir,'offline-business.json');await writeFile(business,JSON.stringify({fixtureOnly:true,revision:2}));
const permission=join(root,'secrets/runtime-permissions/offline-original.dpapi');
// Keep an existing real simulation DPAPI envelope opaque during the file test.
await copyFile(join(root,'secrets/agentdock.dpapi'),permission);
await writeFile(join(root,'login-management/task.xml'),'<Task fixtureOnly="true" enabled="false"><Version>2</Version></Task>');
const dbPath=join(profile2.oauthStateDir,'devspace.sqlite');
async function db(sql){const child=spawn(process.execPath,['--input-type=module','-e',`import{createRequire}from'node:module';const r=createRequire(process.cwd()+'/package.json');const D=r('better-sqlite3');const d=new D(process.argv[1]);try{d.exec(process.argv[2]);}finally{d.close();}`,dbPath,sql],{cwd:profile2.codeRoot,windowsHide:true,env,stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);child.stdout.resume();assert.equal(await new Promise(ok=>child.once('close',ok)),0,err);}
await db("CREATE TABLE IF NOT EXISTS offline_restore_probe(value TEXT); DELETE FROM offline_restore_probe; INSERT INTO offline_restore_probe VALUES('version2-baseline');");
const captured=await command('CaptureIsolation');seal=captured.seal;assert.equal(captured.scope,'isolation');
await command('Verify');
const originals={};for(const p of [business,permission,dbPath,join(root,'run/runtime.json'),join(root,'run/abort.json'),join(root,'profile.json'),join(root,'login-management/task.xml')])originals[p]=sha(await readFile(p));
const stages=['app-half','bindings'];
for(const stage of stages){
 await command('InstallIsolation',['-InterruptAt',stage],71);
 await writeFile(business,JSON.stringify({fixtureOnly:true,revision:1,damaged:true}));
 await writeFile(permission,'deliberately interrupted fixture ciphertext');
 await writeFile(join(profile2.codeRoot,'scripts/offline-candidate-added.mjs'),'throw Error("fixture candidate");');
 await writeFile(join(profile2.managerRoot,'scripts/offline-candidate-added.mjs'),'throw Error("fixture candidate");');
 await writeFile(join(profile2.managerRoot,'scripts/TongAgentDockRuntime.mjs'),'INTERRUPTED_MANAGER_NOT_IMPORTABLE');
 await writeFile(join(root,'run/offline-added.json'),'{}');
 const abort=await json(join(root,'run/abort.json'));await writeFile(join(root,'run/abort.json'),JSON.stringify({...abort,candidateInterrupted:true}));
 await db("UPDATE offline_restore_probe SET value='version1-damaged';");
 if(stage==='bindings')await writeFile(join(root,'profile.json'),'{"interrupted":');
 const restored=await command('RestoreIsolation');assert.equal(restored.managerImported,false);assert.equal(restored.gateFileKey,captured.gateFileKey);
 for(const [p,hash] of Object.entries(originals))assert.equal(sha(await readFile(p)),hash,p);
 for(const target of [profile2.codeRoot,profile2.managerRoot])await assert.rejects(lstat(join(target,'scripts/offline-candidate-added.mjs')),{code:'ENOENT'});
 await assert.rejects(lstat(join(root,'run/offline-added.json')),{code:'ENOENT'});
 for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile2,{manager,reviewedManagerProfile:{...profile2,agentdockEnabled:false}})).commit,two);
 console.log(JSON.stringify({event:'full-original-restored',stage,businessAndOauthExact:true,permissionCiphertextExact:true,newFilesRetired:true,bindingsExact:true,gateSameFile:true}));
}
await command('InstallIsolation');
const profile=await json(join(root,'profile.json'));for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,one);
const hostHash=sha(await readFile(join(root,'login-management/TongLoginHost.exe')));
const archived=await command('ArchiveIsolation');assert.equal(archived.gateFileKey,captured.gateFileKey);assert.equal(archived.productionHandoffProven,false);
const login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));await login.issueSimulationLoginRecovery(profile);
const boot=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('Test-TongStable1OfflineBoot.ps1',import.meta.url))],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let bootOut='',bootErr='';boot.stdout.on('data',b=>bootOut+=b);boot.stderr.on('data',b=>bootErr+=b);const bootCode=await new Promise(ok=>boot.once('close',ok));await writeFile(join(ops,'boot-output.json'),JSON.stringify({code:bootCode,stdout:bootOut,stderr:bootErr},null,2));assert.equal(bootCode,0,bootErr);const bootResult=await json(join(ops,'boot-result.json'));assert.equal(bootResult.passed,true);
// A fresh independent process returns the ORIGINAL archived freeze and then
// restores version 2 after a fully installed, healthy version 1 was stopped.
const afterBoot=await command('RestoreIsolation');assert.equal(afterBoot.gateFileKey,captured.gateFileKey);
for(const [p,hash] of Object.entries(originals))assert.equal(sha(await readFile(p)),hash,p);
for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile2,{manager,reviewedManagerProfile:{...profile2,agentdockEnabled:false}})).commit,two);
const result={at:new Date().toISOString(),passed:true,root,snapshot,seal,captured,stages,commands:commands.map(({stdout,stderr,...r})=>r),independentPs7Restorer:true,fullFixtureByteRestore:true,oauthAndBusinessAppliedToOriginalFixturePaths:true,permissionCiphertextRestored:true,originalIncidentControlsRestored:true,addedFilesRetired:true,gateSameFile:true,sourceOneUnmodified:true,externalHostSha256:hostHash,productionWrite:false,productionEntryClosureProven:false,startAfterArchiveTested:true,boot:bootResult,afterHealthyVersion1StoppedFullVersion2Restore:true,finalFixtureVersion:two};
await writeFile(join(ops,'isolation-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
