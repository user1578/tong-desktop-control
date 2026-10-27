import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
const tmp=await createTongTestDirectory('upgrade-delta-');let passed=false;
try{
 const source=await fs.readFile(new URL('../scripts/TongQuickTrustFullCutover.mjs',import.meta.url),'utf8');
 const extract=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
 const roots={app:join(tmp.path,'app'),manager:join(tmp.path,'manager')},runtime=join(tmp.path,'runtime'),release=join(tmp.path,'release'),candidate=join(tmp.path,'candidate'),snapshot=join(tmp.path,'snapshot'),runner=join(runtime,'login-management','TongLoginRuntime.ps1');
 await fs.mkdir(join(runtime,'run'),{recursive:true});await fs.mkdir(dirname(runner),{recursive:true});
 const sha=b=>createHash('sha256').update(b).digest('hex'),save=async(p,b)=>{await fs.mkdir(dirname(p),{recursive:true});await fs.writeFile(p,b);};
 const old=[{path:'scripts/one.mjs',size:3,sha256:sha('old')}],next=[{path:'scripts/one.mjs',size:3,sha256:sha('new')},{path:'scripts/added.mjs',size:5,sha256:sha('added')}];
 const pins={commit:'a'.repeat(40),sourceFiles:old,expectedDevspaceHashes:{}};
 await save(join(release,'release-manifest.json'),JSON.stringify({sourceFiles:next,expectedDevspaceHashes:{}}));
 for(const f of next)await save(join(candidate,f.path),f.path.includes('added')?'added':'new');
 for(const key of Object.keys(roots)){
  await save(join(roots[key],'scripts/one.mjs'),'old');await save(join(roots[key],'private-user-file'),'must survive');
  await save(join(snapshot,'backup',key,'scripts/one.mjs'),'old');
  await save(join(snapshot,key==='app'?'release-pin.json':'manager-pin.json'),JSON.stringify(pins));
 }
 for(const [name,body] of [['profile.json','original profile'],['login-runner.ps1','original runner']])await save(join(snapshot,name),body);
 const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));let stage='state-backed-up',interrupted=true,copies=0;
 const checked=(root,rel)=>{assert.ok(!rel.split('/').some(p=>p==='..'));const p=join(root,...rel.split('/'));assert.ok(p.startsWith(tmp.path+sep));return p;};
 const regular=async p=>{const s=await fs.lstat(p);assert.ok(s.isFile()&&!s.isSymbolicLink());return s;};
 const verified=async(p,f)=>{await regular(p);const b=await fs.readFile(p);assert.equal(b.length,f.size);assert.equal(sha(b),f.sha256);return b;};
 const context={read:json,existingSnapshot:async()=>({stage}),assertStopped:async()=>{},RELEASE:release,CANDIDATE:candidate,ROOTS:roots,RUNTIME:runtime,TASK_RUNNER:runner,ORIGINAL:{app:pins.commit,manager:pins.commit},baselineOverride:pins.commit,checked,verified,regular,recordStage:async(_,s)=>{stage=s;},sha,data:fs.readFile,join,dirname,fail:m=>{throw Error(m);},mkdir:fs.mkdir,rename:fs.rename,lstat:fs.lstat,
 copyFile:async(a,b)=>{await fs.copyFile(a,b);if(interrupted&&++copies===1)throw Error('INJECTED_PARTIAL_INSTALL');},console:{log:()=>{}}};
 const code=extract('async function install(dir){','async function installRunner(dir){')+'\n'+extract('async function rollback(dir){','// Reuse the existing snapshot/install/rollback');
 const methods=new Function(...Object.keys(context),code+';return {install,rollback};')(...Object.values(context));
 await assert.rejects(methods.install(snapshot),/INJECTED_PARTIAL_INSTALL/);assert.equal(stage,'installing');
 assert.equal(await fs.readFile(join(roots.app,'scripts/one.mjs'),'utf8'),'new');
 interrupted=false;await methods.rollback(snapshot);assert.equal(stage,'rolled-back-old-code');
 for(const root of Object.values(roots)){assert.equal(await fs.readFile(join(root,'scripts/one.mjs'),'utf8'),'old');assert.equal(await fs.readFile(join(root,'private-user-file'),'utf8'),'must survive');}
 assert.equal(await fs.readFile(runner,'utf8'),'original runner');
 stage='state-backed-up';await methods.install(snapshot);assert.equal(stage,'files-installed');await methods.rollback(snapshot);
 for(const root of Object.values(roots))await assert.rejects(fs.stat(join(root,'scripts/added.mjs')),{code:'ENOENT'});
 passed=true;console.log(JSON.stringify({passed,partialInstallRolledBack:true,fullInstallRolledBack:true,uniqueFilesPreserved:true,productionModified:false}));
}finally{await tmp.finish(passed);}
