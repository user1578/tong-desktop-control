import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';

const fixture=await createTongTestDirectory('tong-plan-cross-client-');
let passed=false;
try {
  const root=join(fixture.path,'registered');
  const stateDir=join(fixture.path,'state');
  const cache=join(root,'npm-cache');
  await mkdir(cache,{recursive:true});
  await mkdir(stateDir);
  await writeFile(join(cache,'fixture.txt'),'disposable test cache');
  await writeFile(join(stateDir,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[{
    id:'fixture',root,enabled:true,revision:'rev1',scopes:[{relativeRoot:'.',categories:['cache']}]
  }]}));
  const access={listProjects:async()=>[{id:'fixture',root,status:'enabled',available:true,effectiveCapabilities:['project.read']}]};
  const one=new TongManagedCleanup({access,stateDir});
  const plan=await one.plan({projectId:'fixture',path:cache});
  assert.equal(plan.deletionAuthorized,true);
  assert.ok((await stat(cache)).isDirectory(),'plan never deletes');

  // Invoke in another OS process to model MCP Plan and Execute on separate
  // tool transports / new server object. Old in-memory Map fails here.
  const source=String.raw`
    const [moduleUrl,stateDir,projectId,planId]=process.argv.slice(1);
    const {TongManagedCleanup}=await import(moduleUrl);
    const access={listProjects:async()=>[]};
    const manager=new TongManagedCleanup({access,stateDir});
    try {
      const result=await manager.execute({projectId,planId});
      process.stdout.write(JSON.stringify({ok:true,result}));
    }catch(e) {
      process.stdout.write(JSON.stringify({ok:false,code:e.code||e.message}));
      process.exitCode=1;
    }
  `;
  const argv=['--input-type=module','-e',source,
    pathToFileURL(join(import.meta.dirname,'..','scripts','TongManagedCleanup.mjs')).href,
    stateDir,'fixture',plan.planId];
  const result=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:15000,maxBuffer:100000});
  assert.equal(result.status,0,JSON.stringify(result));
  const data=JSON.parse(result.stdout);
  assert.equal(data.result.status,'deleted');
  assert.equal(data.result.logicalBytes,21);
  await assert.rejects(stat(cache),{code:'ENOENT'});
  const replay=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:15000,maxBuffer:100000});
  assert.equal(replay.status,1);
  assert.equal(JSON.parse(replay.stdout).code,'CLEANUP_PLAN_NOT_FOUND');
  const audit=await readFile(join(stateDir,'disk-cleanup-audit.jsonl'),'utf8');
  assert.equal(audit.split('\n').filter(Boolean).length,2);
  console.log(JSON.stringify({passed:true,transport:'separate-process',oneUse:true,audited:true}));
  passed=true;
}finally{await fixture.finish(passed);}
