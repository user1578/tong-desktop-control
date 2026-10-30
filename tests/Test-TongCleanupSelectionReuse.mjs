import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {TongManagedCleanup,cleanupGuards} from '../scripts/TongManagedCleanup.mjs';
import {TongCleanupJobs} from '../scripts/TongCleanupJobs.mjs';
import {prepareCleanupSelection,executeCleanupSelection} from '../scripts/TongCleanupSelection.mjs';
import {closeCleanupNative} from '../scripts/TongCleanupNative.mjs';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';

// Tiny synthetic dependencies, never the user's candidate trees or real job.
const fixture=await createTongTestDirectory('tong-selection-reuse-');let passed=false;
try{
 const root=join(fixture.path,'root'),store=join(fixture.path,'store'),retained=join(fixture.path,'retained');
 for(const p of [root,store,retained])await mkdir(p);
 await writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[{id:'synthetic',root,enabled:true,revision:'one',scopes:[{relativeRoot:'.',categories:['quick-trust-candidate','cache']}]}]}));
 const manager=new TongManagedCleanup({access:{listProjects:async()=>[]},stateDir:store,retainedDependencies:retained});
 const candidate=join(root,'p27-autonomy-candidate-20261017','quick-trust-candidate-abcdef0'),target=join(candidate,'node_modules'),release=join(dirname(candidate),'quick-trust-release-abcdef0');
 await mkdir(target,{recursive:true});await mkdir(release);
 const files=[],hash=b=>createHash('sha256').update(b).digest('hex');
 for(const path of ['code/source.tar','code/source/package-lock.json',...Array.from({length:23},(_,i)=>'native/node_modules/pkg/'+i+'.node')]){
  const p=join(release,path),body=path==='code/source/package-lock.json'?'lock':'fixture';await mkdir(dirname(p),{recursive:true});await writeFile(p,body);files.push({path,sha256:hash(body)});
 }
 await writeFile(join(release,'release-manifest.json'),JSON.stringify({commit:'abcdef0'+'a'.repeat(33),files}));
 await writeFile(join(candidate,'package-lock.json'),'lock');await writeFile(join(candidate,'release-restore-evidence.json'),JSON.stringify({commit:'abcdef0'+'a'.repeat(33),patchChecked:true,sqliteNativeLoaded:true,nativeRestore:'exact archived hashes'}));
 for(const base of [target,retained]){await writeFile(join(base,'a.js'),'third-party');await writeFile(join(base,'b.js'),'third-party');}
 await writeFile(join(target,'AGENTS.md'),'keep rules');
 const plan=await prepareCleanupSelection(manager,{projectId:'synthetic',path:target});
 const journal=join(store,'selection.audit.jsonl');
 const noRescan=async p=>{assert.notEqual(p.phase,'scanning','saved dependency selection must not enumerate node_modules again');};
 const gitMarker=join(target,'.git');await writeFile(gitMarker,'synthetic worktree marker; never opened');
 await assert.rejects(executeCleanupSelection(manager,plan,{journalPath:join(store,'git.jsonl'),progress:noRescan}),/CLEANUP_GIT_WORKTREE_PROTECTED/);
 assert.ok((await stat(join(target,'a.js'))).isFile());await unlink(gitMarker);
 const changed=structuredClone(plan);changed.inventory.files[0].stamp='invalid old file identity';
 await assert.rejects(executeCleanupSelection(manager,changed,{journalPath:join(store,'changed.jsonl'),progress:noRescan}),/CLEANUP_TARGET_CHANGED/);
 assert.ok((await stat(join(target,'a.js'))).isFile(),'identity failure precedes deletion');
 const badArchive=structuredClone(plan);badArchive.evidence.witnesses[0].stamp='changed archive';
 await assert.rejects(executeCleanupSelection(manager,badArchive,{journalPath:join(store,'archive.jsonl'),progress:noRescan}),/CLEANUP_ARCHIVE_OR_REFERENCE_CHANGED/);
 await mkdir(join(target,'new-private'));await writeFile(join(target,'new-private','AGENTS.md'),'new unselected rules');
 const result=await executeCleanupSelection(manager,plan,{journalPath:journal,progress:noRescan});
 assert.equal(result.files,2);assert.equal(await readFile(join(target,'AGENTS.md'),'utf8'),'keep rules');
 assert.equal(await readFile(join(target,'new-private','AGENTS.md'),'utf8'),'new unselected rules');
 assert.equal((await executeCleanupSelection(manager,plan,{journalPath:journal,progress:noRescan})).restoreStamp,result.restoreStamp,'receipt replay retains archive identity');
 // Resume preserves completed results, revisits the saved blocked selection,
 // and refuses an unprepared historical target instead of hashing it again.
 const jobs=new TongCleanupJobs(manager);await jobs.ensure();jobs.launch=async()=>{};
 const id=randomUUID(),donePath=join(root,'already-removed','__pycache__'),missing=join(dirname(candidate),'quick-trust-candidate-fffffff','node_modules');
 await mkdir(missing,{recursive:true});await writeFile(join(missing,'never-open.js'),'not selected');
 const receipt={path:donePath,status:'completed',files:9,logicalBytes:90,restoreStamp:'saved'};
 const state={schemaVersion:1,jobId:id,projectId:'synthetic',targets:[donePath,target,missing],status:'verifying',phase:'verifying',mode:'clean',index:2,results:[receipt,{path:target,status:'blocked',code:'CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN'}],updatedAt:new Date().toISOString()};
 await writeFile(join(jobs.dir,id+'.json'),JSON.stringify(state));
 await writeFile(join(jobs.dir,id+'.1.selection'),JSON.stringify(plan));
 const originalReferences=cleanupGuards.assertNoRuntimeReferences;
 try{
  cleanupGuards.assertNoRuntimeReferences=async()=>{const e=Error('CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN');e.code=e.message;e.referenceCheck={kind:'unknown',references:0,unknown:1,unknownKinds:{process_command_line:1}};throw e;};
  await jobs.control({projectId:'synthetic',jobId:id,action:'resume'});await jobs.work(id);
 }finally{cleanupGuards.assertNoRuntimeReferences=originalReferences;}
 const refused=await jobs.load('synthetic',id);
 assert.equal(refused.results[1].stage,'predelete-references');assert.equal(refused.results[1].referenceCheck.unknown,1);
 // A completed audit can be replayed for the same selection without rescanning.
 await writeFile(join(jobs.dir,id+'.1.audit.jsonl'),await readFile(journal));
 await jobs.control({projectId:'synthetic',jobId:id,action:'resume'});
 await jobs.work(id);
 const resumed=await jobs.load('synthetic',id);
 assert.deepEqual(resumed.results[0],receipt);
 assert.equal(resumed.results[1].status,'completed');
 assert.equal(resumed.results[2].code,'CLEANUP_SELECTION_REQUIRED');
 assert.equal(resumed.status,'blocked');assert.ok((await stat(join(missing,'never-open.js'))).isFile());
 console.log('PASS: saved dependency selection without re-enumeration, completed receipts preserved, missing proof retained.');passed=true;
}finally{await closeCleanupNative();await fixture.finish(passed);}
