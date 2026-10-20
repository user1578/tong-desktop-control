import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sameProcess} from '../scripts/TongRuntimeSecurity.mjs';

// Exercise the actual cleanup predicate without creating a runtime or touching
// production state. Process, Job and port observations are deterministic.
const source=await readFile(new URL('../scripts/TongAgentDockRuntime.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function oldRuntimeGone('),source.indexOf('async function reconciliationComplete('));
const runId='01234567-89ab-4cde-9012-0123456789abc';
const identity={pid:6664,exe:'D:\\node\\node.exe',startTicks:'100'};
const record={runId,phase:'stopped',supervisor:identity,children:[],descendants:[]};
const guardian={runId,pid:9999,exe:'C:\\Windows\\powershell.exe',startTicks:'200',nodePid:6664,
  jobAssigned:true,jobName:`Local\\TongRuntime-${runId}`,killOnJobClose:true,
  finishedAt:'2026-10-20T08:52:43.468Z',jobActiveAfterCleanup:0};
let actual={...identity,startTicks:'300',exe:'C:\\Windows\\powershell.exe'},activeProcesses=0,occupied=false;
const cleanup=new Function('processIdentity','runtimeJobState','layout','unused','fail','previousIdentities','sameProcess',
  body+'\nreturn oldRuntimeGone;')(
  async pid=>pid===6664?actual:null,async()=>({activeProcesses}),async()=>({agentdockPort:1,gatewayPort:2,upstreamPort:3}),
  async()=>{if(occupied)throw Error('PORT_OCCUPIED')},code=>Error(code),
  (r,g)=>[g,r.supervisor,...r.children,...r.descendants],sameProcess);

await cleanup('synthetic',record,guardian,{completed:true});
actual={...identity};
await assert.rejects(cleanup('synthetic',record,guardian,{completed:true}),/RECONCILIATION_DENIED/,'a live original process remains blocked');
actual={...identity,startTicks:'300'};activeProcesses=1;
await assert.rejects(cleanup('synthetic',record,guardian,{completed:true}),/CLEANUP_REQUIRED/,'unrecorded Job members remain blocked');
activeProcesses=0;occupied=true;
await assert.rejects(cleanup('synthetic',record,guardian,{completed:true}),/PORT_OCCUPIED/);
occupied=false;
await assert.rejects(cleanup('synthetic',record,guardian),/RECONCILIATION_DENIED/,'lost-Guardian reconciliation stays conservative about reused PIDs');
for(const change of [{jobName:undefined},{killOnJobClose:false},{jobActiveAfterCleanup:1},{finishedAt:undefined},{jobAssigned:false}]){
  await assert.rejects(cleanup('synthetic',record,{...guardian,...change},{completed:true}),/RECONCILIATION_DENIED/);
}
assert.match(source,/oldRuntimeGone\(root,record,guardian,\{completed:guardian\.jobName!==undefined\}\)/,'only completed Guardian cleanup opts into exact identity comparisons');
console.log('PASS: completed named Job permits recycled PIDs; live identities, active Jobs, ports and lost Guardians stay blocked.');
