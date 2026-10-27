import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';

const tmp=await createTongTestDirectory('tong-cleanup-');
let passed=false;
try {
  const root=join(tmp.path,'authorized-project');
  const audits=join(tmp.path,'audit-store');
  await mkdir(root,{recursive:true});
  await mkdir(audits);
  const grant={id:'synthetic-project',root,enabled:true,revision:'fixture-1',scopes:[{relativeRoot:'.',categories:['cache','historical-candidate']}]};
  const saveGrant=()=>writeFile(join(audits,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[grant]}));
  await saveGrant();
  let enabled=true;
  const access={listProjects:async()=>[{
    id:'synthetic-project',root,status:'enabled',available:true,
    effectiveCapabilities:enabled?['project.read','project.write']:['project.read']
  }]};
  let now=Date.now();
  const cleanup=new TongManagedCleanup({access,stateDir:audits,now:()=>now});
  const cache=join(root,'npm-cache');
  await mkdir(join(cache,'_cacache'),{recursive:true});
  await writeFile(join(cache,'_cacache','blob'),'disposable synthetic cache');
  let p=await cleanup.plan({projectId:'synthetic-project',path:cache});
  assert.equal(p.requiresExecute,true);
  assert.equal(p.files,1);
  assert.ok(p.bytes>0);
  assert.ok((await stat(cache)).isDirectory(),'read-only plan never deletes');
  assert.equal((await cleanup.execute({projectId:'synthetic-project',planId:p.planId})).status,'deleted');
  await assert.rejects(stat(cache),{code:'ENOENT'});
  const audit=await readFile(join(audits,'disk-cleanup-audit.jsonl'),'utf8');
  assert.equal(audit.split('\n').filter(Boolean).length,2);
  assert.ok(audit.includes('cleanup_deleted'));
  await assert.rejects(cleanup.execute({projectId:'synthetic-project',planId:p.planId}),/CLEANUP_PLAN_EXPIRED/);
  // Ordinary source directories cannot be recursively erased.
  await mkdir(join(root,'src'));
  await writeFile(join(root,'src','work.js'),'important');
  await assert.rejects(cleanup.plan({projectId:'synthetic-project',path:join(root,'src')}),/CLEANUP_CATEGORY_NOT_ALLOWED/);
  // A registry write flag is mandatory; it cannot be inferred from chat text.
  enabled=false;
  grant.enabled=false;await saveGrant();
  await mkdir(join(root,'__pycache__'));
  await writeFile(join(root,'__pycache__','x.pyc'),'test');
  const deniedPlan=await cleanup.plan({projectId:'synthetic-project',path:join(root,'__pycache__')});
  assert.equal(deniedPlan.deletionAuthorized,false);
  await assert.rejects(cleanup.execute({projectId:'synthetic-project',planId:deniedPlan.planId}),/CLEANUP_PERMISSION_REQUIRED/);
  enabled=true;
  grant.enabled=true;await saveGrant();
  // Any change between plan and execution causes rejection.
  let expired=await cleanup.plan({projectId:'synthetic-project',path:join(root,'__pycache__')});
  now+=5*60*1000+1;
  await assert.rejects(cleanup.execute({projectId:'synthetic-project',planId:expired.planId}),/CLEANUP_PLAN_EXPIRED/);
  now-=5*60*1000+1;
  let changed=await cleanup.plan({projectId:'synthetic-project',path:join(root,'__pycache__')});
  await writeFile(join(root,'__pycache__','new.pyc'),'changed after planning');
  await assert.rejects(cleanup.execute({projectId:'synthetic-project',planId:changed.planId}),/CLEANUP_TARGET_CHANGED/);
  assert.ok((await stat(join(root,'__pycache__'))).isDirectory());
  await mkdir(join(root,'node_modules'),{recursive:true});
  await mkdir(join(root,'node_modules','.cache'),{recursive:true});
  await assert.rejects(cleanup.plan({projectId:'synthetic-project',path:join(root,'node_modules','.cache')}),/CLEANUP_SHARED_DEPENDENCY_DENIED/);
  assert.equal((await readFile(join(root,'src','work.js'),'utf8')),'important');
  // Synthetic B2.3 archive: deletion only if manifest, native archives and lock match.
  const historical=join(root,'b23-release-abcdef'),suffix='abcdef0',commit=suffix+'a'.repeat(33);
  const candidate=join(historical,'candidate-'+suffix),release=join(historical,'release-'+suffix);
  await mkdir(candidate,{recursive:true});
  const records=[];
  const hash=b=>createHash('sha256').update(b).digest('hex');
  async function archived(rel,body){
    const where=join(release,...rel.split('/'));
    await mkdir(join(where,'..'),{recursive:true});
    await writeFile(where,body);
    records.push({path:rel,sha256:hash(body)});
  }
  await archived('code/source.tar','synthetic source archive');
  await archived('code/source/package-lock.json','synthetic lock');
  for(let i=0;i<23;i++)await archived('native/node_modules/f'+i+'.bin','synthetic native '+i);
  await writeFile(join(candidate,'package-lock.json'),'synthetic lock');
  const sourceFiles=[{path:'package-lock.json',size:Buffer.byteLength('synthetic lock'),sha256:hash('synthetic lock')}];
  await writeFile(join(candidate,'release-restore-evidence.json'),JSON.stringify({commit,sourceFilesVerified:1,patchChecked:true,sqliteNativeLoaded:true,nativeRestore:'exact archived hashes'}));
  await writeFile(join(release,'release-manifest.json'),JSON.stringify({commit,sourceFiles,files:records}));
  const histPlan=await cleanup.plan({projectId:'synthetic-project',path:candidate});
  await writeFile(join(release,'code','source.tar'),'tampered archive');
  await assert.rejects(cleanup.execute({projectId:'synthetic-project',planId:histPlan.planId}),/CLEANUP_ARCHIVE_MISMATCH/);
  assert.ok((await stat(candidate)).isDirectory(),'reject changed archive, retain candidate');
  await writeFile(join(release,'code','source.tar'),'synthetic source archive');
  const histPlan2=await cleanup.plan({projectId:'synthetic-project',path:candidate});
  assert.equal((await cleanup.execute({projectId:'synthetic-project',planId:histPlan2.planId})).status,'deleted');
  assert.ok((await stat(release)).isDirectory(),'preserved release cannot be erased with candidate');
  console.log(JSON.stringify({passed:true,deletedCache:true,audited:true,protectedSource:true,permissionDenied:true,expired:true,changed:true,sharedDependenciesDenied:true,historicalArchiveVerified:true}));
  passed=true;
}finally{await tmp.finish(passed);}
