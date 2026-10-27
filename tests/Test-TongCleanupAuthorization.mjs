import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';

const tmp=await createTongTestDirectory('cleanup-authorization-');let passed=false;
try{
  const root=join(tmp.path,'state'),store=join(tmp.path,'policy');
  const cache=join(root,'accepted-test','npm-cache');
  await mkdir(cache,{recursive:true});await mkdir(store);
  await writeFile(join(cache,'blob'),'rebuildable');
  const access={listProjects:async()=>[{id:'cleanup-state',root,status:'enabled',available:true,effectiveCapabilities:['project.read','project.write']}]};
  const cleanup=new TongManagedCleanup({access,stateDir:store});
  const unapproved=await cleanup.plan({projectId:'cleanup-state',path:cache});
  await assert.rejects(cleanup.execute({projectId:'cleanup-state',planId:unapproved.planId}),/CLEANUP_PERMISSION_REQUIRED/,'ordinary project write must not grant recursive deletion');
  const grant={id:'cleanup-state',root,enabled:true,revision:'test-revision-1',scopes:[{relativeRoot:'accepted-test',categories:['cache']}]};
  const save=async()=>writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[grant]}));
  await save();
  // Reconstructed instances reuse the persistent local grant; no per-batch challenge.
  const next=new TongManagedCleanup({access:{listProjects:async()=>[]},stateDir:store});
  const p=await next.plan({projectId:'cleanup-state',path:cache});
  assert.equal(p.deletionAuthorized,true);
  grant.enabled=false;await save();
  await assert.rejects(next.execute({projectId:'cleanup-state',planId:p.planId}),/CLEANUP_PERMISSION_REQUIRED/);
  assert.ok((await stat(cache)).isDirectory());
  grant.enabled=true;await save();
  const p2=await next.plan({projectId:'cleanup-state',path:cache});
  grant.revision='test-revision-2';await save();
  await assert.rejects(next.execute({projectId:'cleanup-state',planId:p2.planId}),/CLEANUP_PERMISSION_CHANGED/);
  await mkdir(join(root,'unapproved','npm-cache'),{recursive:true});
  await assert.rejects(next.plan({projectId:'cleanup-state',path:join(root,'unapproved','npm-cache')}),/CLEANUP_PERMISSION_REQUIRED/);
  await writeFile(join(cache,'business.sqlite'),'not a disposable cache');
  await assert.rejects(next.plan({projectId:'cleanup-state',path:cache}),/CLEANUP_PROTECTED_CONTENT/);
  await import('node:fs/promises').then(fs=>fs.unlink(join(cache,'business.sqlite')));
  const p3=await next.plan({projectId:'cleanup-state',path:cache});
  assert.equal((await next.execute({projectId:'cleanup-state',planId:p3.planId})).status,'deleted');
  await assert.rejects(stat(cache),{code:'ENOENT'});
  const audit=(await readFile(join(store,'disk-cleanup-audit.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const done=audit.find(x=>x.event==='cleanup_deleted');
  assert.equal(done.category,'cache');assert.equal(done.files,1);assert.equal(done.logicalBytes,11);
  assert.equal(done.reason,'locally-authorized-rebuildable-cache');
  assert.ok(audit.some(x=>x.event==='cleanup_rejected'&&x.code==='CLEANUP_PERMISSION_REQUIRED'));
  assert.ok(audit.every(x=>x.at&&x.path&&x.planId));
  passed=true;console.log(JSON.stringify({passed,separateDeleteGrant:true,persistent:true,revocable:true,scopeBound:true,auditedRejections:true}));
}finally{await tmp.finish(passed);}
