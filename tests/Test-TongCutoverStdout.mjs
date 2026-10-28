import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
const tmp=await createTongTestDirectory('cutover-stdout-');let passed=false;
try{
 const source=(await fs.readFile(new URL('../scripts/TongQuickTrustFullCutover.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const extract=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
 const roots={app:join(tmp.path,'app'),manager:join(tmp.path,'manager')},runtime=join(tmp.path,'runtime'),release=join(tmp.path,'release'),candidate=join(tmp.path,'candidate'),snapshot=join(tmp.path,'snapshot');
 const oldCommit='a'.repeat(40),nextCommit='b'.repeat(40),sha=b=>createHash('sha256').update(b).digest('hex');
 const save=async(p,b)=>{await fs.mkdir(dirname(p),{recursive:true});await fs.writeFile(p,b);};
 // Security/activation boundaries use tiny simulation modules; source copying,
 // stage persistence, runner, pins, rollback and CLI stdout are the actual code.
 const modules={
  'scripts/payload.txt':'new payload',
  'scripts/TongRuntimeCandidate.mjs':`import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';export async function pinRuntimeRelease(p,r,{manager}){await writeFile(join(p.root,'run',manager?'manager-pin.json':'release-pin.json'),await readFile(join(r,'release-manifest.json')));}export async function verifyRuntimeCandidate(){}`,
  'scripts/TongAgentDockRuntime.mjs':`import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import {pinRuntimeRelease} from './TongRuntimeCandidate.mjs';export async function updateRuntimeProfile(p,{releaseRoot}){await pinRuntimeRelease(p,releaseRoot,{manager:false});await writeFile(join(p.root,'profile.json'),JSON.stringify(p));}`,
  'scripts/TongLoginRuntime.ps1':'new runner'
 };
 const files=Object.entries(modules).map(([path,body])=>({path,size:Buffer.byteLength(body),sha256:sha(body)}));
 const oldFiles=files.map(f=>f.path==='scripts/payload.txt'?{...f,size:3,sha256:sha('old')}:f);
 const oldPin={commit:oldCommit,sourceFiles:oldFiles,expectedDevspaceHashes:{}};
 const manifest={commit:nextCommit,sourceFiles:files,expectedDevspaceHashes:{},files:[{path:'code/source.tar',sha256:'c'.repeat(64)}]};
 await save(join(release,'release-manifest.json'),JSON.stringify(manifest));
 const next={root:runtime,sourceDigest:'c'.repeat(64),releaseDigest:sha(JSON.stringify(manifest)),agentdockEnabled:true};
 const oldProfile={root:runtime,sourceDigest:'d'.repeat(64),releaseDigest:'e'.repeat(64)};
 for(const [name,body] of Object.entries(modules))await save(join(candidate,name),body);
 for(const key of Object.keys(roots)){
  for(const [name,body] of Object.entries(modules)){const b=name==='scripts/payload.txt'?'old':body;await save(join(roots[key],name),b);await save(join(snapshot,'backup',key,name),b);}
  await save(join(snapshot,key==='app'?'release-pin.json':'manager-pin.json'),JSON.stringify(oldPin));
  await save(join(runtime,'run',key==='app'?'release-pin.json':'manager-pin.json'),JSON.stringify(oldPin));
 }
 await save(join(snapshot,'profile.json'),JSON.stringify(oldProfile));await save(join(runtime,'profile.json'),JSON.stringify(oldProfile));
 await save(join(snapshot,'login-runner.ps1'),'old runner');await save(join(runtime,'login-management/TongLoginRuntime.ps1'),'old runner');
 await save(join(snapshot,'snapshot.json'),JSON.stringify({stage:'snapshotted'}));
 const prelude=`import {readFile,writeFile,mkdir,copyFile as realCopy,lstat,rename} from 'node:fs/promises';import {join,dirname,relative,isAbsolute} from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
 const ROOTS=${JSON.stringify(roots)},RUNTIME=${JSON.stringify(runtime)},RELEASE=${JSON.stringify(release)},CANDIDATE=${JSON.stringify(candidate)},snapshot=${JSON.stringify(snapshot)},TASK_RUNNER=join(RUNTIME,'login-management/TongLoginRuntime.ps1'),ORIGINAL={app:'${oldCommit}',manager:'${oldCommit}'},NEW='${nextCommit}',baselineOverride='${oldCommit}',extra=[];
 const [action,fault]=process.argv.slice(2),releaseOverride=undefined,candidateOverride=undefined,commitOverride=undefined,sha=b=>createHash('sha256').update(b).digest('hex'),read=async p=>JSON.parse(await readFile(p,'utf8')),data=readFile,fail=m=>{throw Error(m)};
 const checked=(root,rel)=>{if(rel.split('/').includes('..')||isAbsolute(rel))throw Error('UNSAFE_FIXTURE_PATH');return join(root,rel);};
 const regular=async p=>{const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('UNSAFE_FIXTURE_FILE');return s;};
 const verified=async(p,f)=>{await regular(p);const b=await readFile(p);if(b.length!==f.size||sha(b)!==f.sha256)throw Error('HASH_MISMATCH');return b;};
 let copies=0;const copyFile=async(a,b)=>{if(fault==='restore-fails'&&a.includes('backup'))throw Error('INJECTED_RESTORE_FAILURE');await realCopy(a,b);if(fault==='partial-install'&&++copies===1)throw Error('INJECTED_PARTIAL_INSTALL');};
 const existingSnapshot=async dir=>read(join(dir,'snapshot.json')),recordStage=async(dir,stage)=>writeFile(join(dir,'snapshot.json'),JSON.stringify({stage}));
 const assertStopped=async()=>{},verifySnapshot=async()=>({ok:true}),upgradeProfiles=async()=>({baseline:${JSON.stringify(oldProfile)},next:${JSON.stringify(next)}});
 const withMaintenanceFreeze=async(p,o,fn)=>{let proofs=0;return fn({proof:async()=>{if(fault==='final-proof'&&++proofs===2)throw Error('INJECTED_FINAL_PROOF_FAILURE');},release:async()=>{await writeFile(join(RUNTIME,'gate-released'),'yes');}});};
 `;
 const dispatcher=source.slice(source.lastIndexOf("try{\n if(extra.length)"));
 assert.ok(dispatcher.includes("action==='install-activate'"),'Extract actual CLI dispatcher');
 const code=prelude+extract('async function install(dir){','// Reuse the existing snapshot/install/rollback')+extract('async function upgradeGate(dir,fn,','try{\n if(extra.length)')+dispatcher;
 const cli=join(tmp.path,'cutover-fixture.mjs');await save(cli,code);
 function run(action,fault){const r=spawnSync(process.execPath,[cli,action,...(fault?[fault]:[])],{encoding:'utf8',windowsHide:true,timeout:10000});assert.ifError(r.error);let value;try{value=JSON.parse(r.stdout);}catch{assert.fail(`${action}: expected one final JSON, got ${r.stdout.trim().split(/\r?\n/).length} records: ${r.stderr}`);}return {...r,value};}
 let r=run('install-activate');assert.equal(r.status,0,r.stderr);assert.equal(r.value.ok,true);assert.equal(r.value.stage,'installed-verified');assert.equal(r.value.app,nextCommit);
 r=run('release-upgrade-gate');assert.equal(r.status,0,r.stderr);assert.equal(r.value.stage,'upgrade-gate-released');
 r=run('rollback');assert.equal(r.status,0,r.stderr);assert.equal(r.value.stage,'rolled-back-old-code');
 assert.equal(await fs.readFile(join(roots.app,'scripts/payload.txt'),'utf8'),'old');
 await save(join(snapshot,'snapshot.json'),JSON.stringify({stage:'snapshotted'}));
 r=run('install-activate','final-proof');assert.notEqual(r.status,0);assert.equal(r.value.ok,false);assert.equal(r.value.error,'INJECTED_FINAL_PROOF_FAILURE');
 assert.equal(JSON.parse(await fs.readFile(join(snapshot,'snapshot.json'),'utf8')).stage,'runner-installed');
 r=run('rollback');assert.equal(r.status,0,r.stderr);assert.equal(r.value.stage,'rolled-back-old-code');
 await save(join(snapshot,'snapshot.json'),JSON.stringify({stage:'snapshotted'}));
 r=run('install-activate','partial-install');assert.notEqual(r.status,0);assert.equal(r.value.ok,false);assert.equal(r.value.error,'INJECTED_PARTIAL_INSTALL');
 assert.equal(JSON.parse(await fs.readFile(join(snapshot,'snapshot.json'),'utf8')).stage,'installing');
 assert.equal(await fs.readFile(join(roots.app,'scripts/payload.txt'),'utf8'),'new payload','Injected failure must leave genuinely changed bytes');
 r=run('rollback','restore-fails');assert.notEqual(r.status,0);assert.equal(r.value.ok,false);assert.equal(r.value.error,'INJECTED_RESTORE_FAILURE');
 assert.notEqual(JSON.parse(await fs.readFile(join(snapshot,'snapshot.json'),'utf8')).stage,'rolled-back-old-code');
 r=run('rollback');assert.equal(r.status,0,r.stderr);assert.equal(r.value.stage,'rolled-back-old-code');
 assert.equal(await fs.readFile(join(roots.app,'scripts/payload.txt'),'utf8'),'old');
 assert.equal(await fs.readFile(join(roots.manager,'scripts/payload.txt'),'utf8'),'old');
 passed=true;console.log(JSON.stringify({passed,compositeSingleJson:true,releaseSingleJson:true,finalProofFailureOnly:true,partialInstallFailure:true,restoreFailureReported:true,oldFilesRestored:true,productionModified:false}));
}finally{await tmp.finish(passed);}
