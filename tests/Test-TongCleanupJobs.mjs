import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,symlink,link,lstat,readdir,unlink,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';
import {TongCleanupJobs} from '../scripts/TongCleanupJobs.mjs';
const fixture=await createTongTestDirectory('tong-cleanup-jobs-');let passed=false;
const wait=async jobs=>{for(let i=0;i<300;i++){const s=await jobs.status(request);if(['completed','failed','blocked','cancelled','ready'].includes(s.status))return s;await new Promise(r=>setTimeout(r,100));}throw Error('job deadline');};
let request;
try{
 const root=join(fixture.path,'root'),store=join(fixture.path,'store');await mkdir(root);await mkdir(store);
 const grant={id:'synthetic',root,enabled:true,revision:'first',scopes:[{relativeRoot:'.',categories:['cache','quick-trust-candidate']}]};
 const save=()=>writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[grant]}));await save();
 const manager=new TongManagedCleanup({access:{listProjects:async()=>[]},stateDir:store}),jobs=new TongCleanupJobs(manager);
 const cache=join(root,'__pycache__');await mkdir(cache);
 const protectedPaths=['AGENTS.md','agent.md','CLAUDE.md','my-rules.md','Cookies','Login Data','api-key.txt','business.sqlite','id_rsa','id_ed25519','NTUSER.DAT','.npmrc','.netrc','.git-credentials','.config/settings','unique-notes.txt','git-project/.git/config','.codex/sessions/native.json','config/settings.json'];
 for(const rel of protectedPaths){const p=join(cache,rel);await mkdir(dirname(p),{recursive:true});await writeFile(p,'protected synthetic value');}
 await writeFile(join(cache,'a.pyc'),'safe Python cache');
 const elsewhere=join(root,'unique.bin');await writeFile(elsewhere,'unique');await link(elsewhere,join(cache,'hardlink.bin'));
 await symlink(root,join(cache,'junction'),'junction');
 const start=performance.now(),job=await jobs.start({projectId:'synthetic',path:cache,idempotencyKey:'mixed'});
 assert.ok(performance.now()-start<10000);assert.equal(job.status,'queued');
 request={projectId:'synthetic',jobId:job.jobId};
 const done=await wait(new TongCleanupJobs(manager));assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.results[0].files,1);
 await assert.rejects(stat(join(cache,'a.pyc')),{code:'ENOENT'});
 for(const rel of protectedPaths)assert.equal(await readFile(join(cache,rel),'utf8'),'protected synthetic value');
 assert.equal(await readFile(elsewhere,'utf8'),'unique');assert.ok((await lstat(join(cache,'junction'))).isSymbolicLink());
 assert.equal((await jobs.start({projectId:'synthetic',path:cache,idempotencyKey:'mixed'})).jobId,job.jobId);
 await assert.rejects(jobs.status({...request,projectId:'wrong'}),/CLEANUP_JOB_PROJECT_MISMATCH/);
 // A cancelled plan cannot resume over a newer job owning the same subtree.
 const overlap=join(root,'.mypy_cache');await mkdir(overlap);await writeFile(join(overlap,'a.pyc'),'cache');
 const a=await jobs.start({projectId:'synthetic',path:overlap,mode:'plan'});request={projectId:'synthetic',jobId:a.jobId};assert.equal((await wait(jobs)).status,'ready');await jobs.control({...request,action:'cancel'});assert.equal((await wait(jobs)).status,'cancelled');
 const b=await jobs.start({projectId:'synthetic',path:overlap,mode:'plan'});request={projectId:'synthetic',jobId:b.jobId};assert.equal((await wait(jobs)).status,'ready');
 await assert.rejects(jobs.control({projectId:'synthetic',jobId:a.jobId,action:'resume'}),/CLEANUP_JOB_CONFLICT/);
 await jobs.control({...request,action:'cancel'});assert.equal((await wait(jobs)).status,'cancelled');
 const nodeCache=join(root,'node-compile-cache');await mkdir(nodeCache);await writeFile(join(nodeCache,'a1234567'),'safe node cache');
 const planned=await jobs.start({projectId:'synthetic',path:nodeCache,mode:'plan'});request={projectId:'synthetic',jobId:planned.jobId};assert.equal((await wait(jobs)).status,'ready');
 // Mutation after verification is rejected without any deletion.
 await writeFile(join(nodeCache,'12345678'),'new unique bytes');await jobs.control({...request,action:'resume'});assert.equal((await wait(jobs)).status,'blocked');assert.ok((await stat(join(nodeCache,'a1234567'))).isFile());
 await jobs.control({...request,action:'cancel'});
 const py=join(root,'.pytest_cache');await mkdir(py);await writeFile(join(py,'CACHEDIR.TAG'),'cache');
 const denied=await jobs.start({projectId:'synthetic',path:py,mode:'plan'});request={projectId:'synthetic',jobId:denied.jobId};assert.equal((await wait(jobs)).status,'ready');
 grant.enabled=false;await save();await jobs.control({...request,action:'resume'});assert.equal((await wait(jobs)).status,'blocked');assert.ok((await stat(join(py,'CACHEDIR.TAG'))).isFile());grant.enabled=true;await save();
 // Small third-party dependency fixture, no dependency tree copy.
 const group=join(root,'p27-autonomy-candidate-20261017'),tag='abcdef0',candidate=join(group,'quick-trust-candidate-'+tag),release=join(group,'quick-trust-release-'+tag),modules=join(candidate,'node_modules'),retained=join(fixture.path,'retained');
 await mkdir(modules,{recursive:true});await mkdir(retained);
 const hash=b=>createHash('sha256').update(b).digest('hex'),files=[];
 const archived=async(path,body)=>{const p=join(release,...path.split('/'));await mkdir(dirname(p),{recursive:true});await writeFile(p,body);files.push({path,sha256:hash(body)});};
 await archived('code/source.tar','archive');await archived('code/source/package-lock.json','lock');for(let i=0;i<23;i++)await archived('native/node_modules/'+i+'.node','native'+i);
 await writeFile(join(release,'release-manifest.json'),JSON.stringify({commit:tag+'a'.repeat(33),files}));await writeFile(join(candidate,'package-lock.json'),'lock');await writeFile(join(candidate,'AGENTS.md'),'retain candidate rules');
 await writeFile(join(candidate,'release-restore-evidence.json'),JSON.stringify({commit:tag+'a'.repeat(33),patchChecked:true,sqliteNativeLoaded:true,nativeRestore:'exact archived hashes'}));
 for(const path of ['pkg/README.md','pkg/main.js']){for(const base of [modules,retained]){await mkdir(dirname(join(base,path)),{recursive:true});await writeFile(join(base,path),'third party '+path);}}
 await writeFile(join(modules,'pkg','AGENTS.md'),'retain nested rules');
 const depsJobs=new TongCleanupJobs(new TongManagedCleanup({access:manager.access,stateDir:store,retainedDependencies:retained}));
 const deps=await depsJobs.start({projectId:'synthetic',path:modules});request={projectId:'synthetic',jobId:deps.jobId};const d=await wait(depsJobs);assert.equal(d.status,'completed',JSON.stringify(d));assert.equal(d.results[0].files,2);
 await assert.rejects(stat(join(modules,'pkg','README.md')),{code:'ENOENT'});assert.equal(await readFile(join(modules,'pkg','AGENTS.md'),'utf8'),'retain nested rules');assert.ok((await stat(release)).isDirectory());assert.equal(await readFile(join(candidate,'AGENTS.md'),'utf8'),'retain candidate rules');
 await archived('native/node_modules/.env','synthetic credential');await writeFile(join(release,'release-manifest.json'),JSON.stringify({commit:tag+'a'.repeat(33),files}));
 const rejected=await depsJobs.start({projectId:'synthetic',path:modules});request={projectId:'synthetic',jobId:rejected.jobId};const r=await wait(depsJobs);assert.equal(r.status,'blocked');assert.equal(r.results[0].code,'CLEANUP_PROTECTED_CONTENT');assert.equal(await readFile(join(modules,'pkg','AGENTS.md'),'utf8'),'retain nested rules');
 console.log('PASS: detached durable cache/dependency deletion, idempotency, mixed protection, links, mutation, revoked grants, retained release and third-party README deletion.');passed=true;
}finally{await fixture.finish(passed);}
