import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,stat,utimes,realpath,rm,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerAppTool} from '@modelcontextprotocol/ext-apps/server';
import * as z from 'zod/v4';
import {registerTongMcpTools} from '../scripts/TongMcpTools.mjs';
import {TongProjectAccess} from '../scripts/TongProjectAccess.mjs';
import {TongAgentTaskManager} from '../scripts/TongAgentTasks.mjs';
import {windowsCleanupRoots} from '../scripts/TongWindowsCleanup.mjs';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {closeCleanupNative} from '../scripts/TongCleanupNative.mjs';

// Real C/D files + real native file checks + real detached workers + MCP.
// Policy/registry are isolated test state; no production grant, job or cache is
// changed, and no production deployment/acceptance is claimed.
const fixture=await createTongTestDirectory('tong-windows-acceptance-');
const cRoot=await mkdtemp(join(homedir(),'TongCleanupAcceptance-'));
assert.match(cRoot,/^C:\\/i);let passed=false,client,server,tasks;
process.env.TONG_RESTRICTED_MCP='1';
try{
 const store=join(fixture.path,'store');await mkdir(store);
 const dRoot=join(fixture.path,'D-sample');await mkdir(dRoot);
 const access=new TongProjectAccess({registryPath:join(store,'projects.json'),agentAccessPath:join(store,'agents.json'),demoRoot:join(fixture.path,'demo'),scanRoots:['C:\\','D:\\']});
 const grants=[],targets=[];
 for(const [drive,root] of [['C',cRoot],['D',dRoot]]){
  const base=join(root,'AppData','Local'),target=join(base,'Temp');await mkdir(target,{recursive:true});
  const old=new Date(Date.now()-3*86400000);await writeFile(join(target,'acceptance.tmp'),Buffer.alloc(4096,65));await utimes(join(target,'acceptance.tmp'),old,old);
  await writeFile(join(target,'AGENTS.md'),'KEEP_ACCEPTANCE_RULES');await writeFile(join(target,'recent.tmp'),'KEEP_RECENT');
  grants.push({id:'acceptance-'+drive.toLowerCase(),root:base,enabled:true,revision:'isolated-'+drive,scopes:[{relativeRoot:'Temp',categories:['cache']}]});
  targets.push({drive,target,projectId:'acceptance-'+drive.toLowerCase()});
 }
 await writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants}));
 tasks=new TongAgentTaskManager({access,statePath:join(store,'tasks.json'),executionEnabled:false});
 server=new McpServer({name:'windows-cleanup-acceptance',version:'1'});registerTongMcpTools(server,registerAppTool,z,access,tasks);
 client=new Client({name:'acceptance',version:'1'},{capabilities:{}});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent;};
 for(const drive of ['C','D']){const v=await call('tong_disk_cleanup_analyze',{drive});assert.ok(v.drives.some(d=>d.drive===drive+':'&&d.status==='available'));assert.equal(v.snapshotOnly,true);}
 const actualRoots=await windowsCleanupRoots();const readonly=await call('tong_disk_cleanup_analyze',{path:actualRoots.find(r=>r.kind==='temporary').path});assert.equal(readonly.deletionAuthorized,false);
 const wait=async(projectId,jobId)=>{
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){const s=await call('tong_disk_cleanup_job',{projectId,jobId});if(['ready','completed','blocked','failed'].includes(s.status)){
   const witness=join(store,'disk-cleanup-jobs',jobId+'.worker-'+s.workerPid+'.exit.json');
   for(let i=0;i<40;i++){try{await stat(witness);return s;}catch{await new Promise(r=>setTimeout(r,100));}}throw Error('worker exit not witnessed');
  }await new Promise(r=>setTimeout(r,100));}throw Error('acceptance job deadline');
 };
 const receipts=[];
 for(const sample of targets){
  const start=await call('tong_disk_cleanup_run',{projectId:sample.projectId,path:sample.target,mode:'plan'});
  const preview=await wait(sample.projectId,start.jobId);assert.equal(preview.status,'ready',JSON.stringify(preview));assert.equal(preview.preview.files,1);
  await call('tong_disk_cleanup_job',{projectId:sample.projectId,jobId:start.jobId,action:'resume'});
  const done=await wait(sample.projectId,start.jobId);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.results[0].files,1);assert.equal(done.results[0].logicalBytes,4096);
  await assert.rejects(stat(join(sample.target,'acceptance.tmp')),{code:'ENOENT'});assert.equal(await readFile(join(sample.target,'AGENTS.md'),'utf8'),'KEEP_ACCEPTANCE_RULES');assert.ok((await stat(join(sample.target,'recent.tmp'))).isFile());
  const journal=await readFile(join(store,'disk-cleanup-jobs',start.jobId+'.0.audit.jsonl'),'utf8');assert.ok(journal.includes('"event":"deleted"')&&journal.includes('"event":"cleanup_result"'));
  receipts.push({drive:sample.drive,jobId:start.jobId,files:done.results[0].files,logicalBytes:done.results[0].logicalBytes,freeBytesBefore:done.results[0].freeBytesBefore,freeBytesAfter:done.results[0].freeBytesAfter});
 }
 console.log(JSON.stringify({passed:true,realFileSystem:true,realDetachedWorkers:true,transport:'isolated MCP',receipts,productionAcceptance:false,personalCachesDeleted:0}));passed=true;
}finally{
 await client?.close();await server?.close();await tasks?.close();await closeCleanupNative();delete process.env.TONG_RESTRICTED_MCP;
 if(passed){assert.equal((await realpath(cRoot)).toLowerCase(),resolve(cRoot).toLowerCase());assert.equal(dirname(cRoot).toLowerCase(),resolve(homedir()).toLowerCase());assert.equal((await lstat(cRoot)).isSymbolicLink(),false);await rm(cRoot,{recursive:true});}else console.error('C acceptance evidence retained: '+cRoot);
 await fixture.finish(passed);
}
