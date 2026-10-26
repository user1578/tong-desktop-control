import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter,once} from 'node:events';
import {join,isAbsolute} from 'node:path';
import {startupBudgetMs} from '../scripts/TongAgentDockRuntime.mjs';

// Execute the actual Manager orchestration with a virtual clock and an owned
// launcher. No production files, permissions, processes or ports are accessed.
const source=process.argv.includes('--minimal-candidate')?(await (await import('./fixtures/TongMinimalStartupCandidate.mjs')).minimalStartupSources())['scripts/TongAgentDockRuntime.mjs']:await readFile(new URL('../scripts/TongAgentDockRuntime.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function startRuntime('),source.indexOf('export async function stopRuntime(')).replace('export ','');
async function scenario({launchAt=16000,receipt=true,stdoutOnly=false,created=false,guardianAlive=false,guardianReused=false,guardianReceipt=true,confirmedFailureStage,guardianPreflightFailure=false,receiptRun,completeReceipt=false,nodeAlive=false,receiptPatch={},launcherStage,preflightFailure=false,previous=false,failObservation=false,failStateRead=false,creatorCleanup=false,production=false,budget=30000,failAbort=false,failLog=false,jobs={owner:0,launcher:0,guardian:0,runtime:0}}={}){
  let now=0,seq=0,result,done=false,request,aborted=false,released=false;
  const timers=new Map(),files=new Map(),events=[];
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const timeout=(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;};
  const clear=id=>timers.delete(id);
  const delay=ms=>new Promise(resolve=>timeout(resolve,ms));
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stderr.resume=()=>{};
  child.pid=42;child.exitCode=null;child.kill=()=>{child.exitCode=1;child.emit('close',1);};
  const old={runId:'old-run',phase:'abnormal_exit',children:[],descendants:[]};
  const identity={pid:42,exe:'D:\\launcher.exe',startTicks:'1',markerMatches:true};
  const json=async path=>{if(failStateRead&&path.endsWith('guardian.json')&&request&&child.exitCode!==null){failStateRead=false;const error=Error('INVALID_STATE');error.stateFailure={file:'guardian.json',operation:'read',code:'EPERM',errno:-4048};throw error;}return files.get(path)??(path.endsWith('guardian.json')&&previous?{runId:'old-run',finishedAt:'old',jobActiveAfterCleanup:0}:null);};
  const save=async(path,value)=>{if(failAbort&&path.endsWith('abort.json'))throw Error('STATE_UNAVAILABLE');files.set(path,value);if(path.endsWith('request.json'))request=value;if(path.endsWith('abort.json'))aborted=true;};
  const spawn=()=>{timeout(()=>{
    child.stderr.emit('data','Runtime launch refused\nBearer PRIVATE_TEST_TOKEN\n'+ 's'.repeat(6000));
    if(receipt){files.set(join('root','run',`launcher.${request.runId}.json`),{schemaVersion:2,role:'launcher',runId:receiptRun??request.runId,launcher:identity,guardian:created?{pid:43,exe:'D:\\guardian.exe',startTicks:'2',markerMatches:true}:undefined,...(creatorCleanup?{guardianTreeCleanup:{proven:true,runId:request.runId,jobName:`Local\\TongGuardian-${request.runId}`,stage:'guardian_adoption'}}:{}),stage:created?'guardian_created':'preflight',guardianCreated:created,preflightClean:true,finishedAt:'done',code:'APPROVAL_DENIED'});if(!created)child.stdout.emit('data',JSON.stringify({runId:receiptRun??request.runId,guardianCreated:false}));}
    if(receipt&&launcherStage)files.get(join('root','run',`launcher.${request.runId}.json`)).stage=launcherStage;
    if(receipt&&preflightFailure)Object.assign(files.get(join('root','run',`launcher.${request.runId}.json`)),{preflight:{failure:{role:'launcher',stage:'preflight',code:'APPROVAL_DENIED'}},failure:{role:'launcher',stage:'preflight',code:'PREFLIGHT_JOB_FAILED'}});
    if(created&&guardianReceipt)files.set(join('root','run',`guardian.${request.runId}.json`),{schemaVersion:2,role:'guardian',runId:request.runId,preflightClean:true,finishedAt:'done',failure:confirmedFailureStage?{role:'guardian',stage:confirmedFailureStage,code:'JOB_CREATE_FAILED',win32Error:5,exitCode:2,diagnosticId:request.runId+'/guardian'}:undefined,...(completeReceipt?{owner:{pid:43,exe:'D:\\guardian.exe',startTicks:'2',markerMatches:true},stage:'wait-node',nodeCreated:true,node:{pid:44,exe:'D:\\node.exe',startTicks:'3',markerMatches:true},runtimeClean:true,jobName:`Local\\TongRuntime-${request.runId}`,jobActiveAfterCleanup:0}:{}),...receiptPatch});
    if(stdoutOnly)child.stdout.emit('data',JSON.stringify({runId:request.runId,guardianCreated:false}));
    if(confirmedFailureStage){files.set(join('root','run','guardian-failure.json'),{runId:request.runId,stage:confirmedFailureStage});child.stdout.emit('data',JSON.stringify({pid:43}));}
    if(guardianPreflightFailure)Object.assign(files.get(join('root','run',`guardian.${request.runId}.json`)),{preflight:{failure:{role:'guardian',stage:'preflight',code:'APPROVAL_DENIED'}},preflightExitCode:1,failure:{role:'guardian',stage:'preflight',code:'PREFLIGHT_JOB_FAILED'}});
    child.exitCode=confirmedFailureStage?0:2;child.emit('close',child.exitCode);
  },launchAt);return child;};
  const names={absoluteRoot:x=>x,guardedRoot:()=>false,loadApprovedProfile:async()=>null,layout:async()=>({managerRoot:'D:\\manager'}),preserved:()=>production,
    freeze:async()=>({close:async()=>{}}),runtimeStatus:async()=>{if(failObservation)throw Error('SECURITY_UNAVAILABLE');return previous?old:{phase:'not_started'};},guardianComplete:async(_r,id)=>id==='old-run',
    hash:async()=> 'hash',AGENTDOCK_SHA256:'hash',AGENTDOCK_EXE:'binary',dockEnabled:()=>false,hasTong:()=>false,
    readSecret:async()=>'',randomUUID:()=> '01234567-89ab-4cde-9012-0123456789ab',loginRecoveryGrantId:()=>null,
    save,spawn,join,process:{env:{},execPath:'node'},safeEnvironment:()=>({}),guardianScript:'launcher',self:'manager',
    once,isAbsolute,processIdentity:async pid=>pid===44?(nodeAlive?{pid:44,exe:'D:\\node.exe',startTicks:'3',markerMatches:true}:null):pid===43?(guardianReused?{pid:43,exe:'D:\\unrelated.exe',startTicks:'999',markerMatches:false}:guardianAlive?{pid:43,exe:'D:\\guardian.exe',startTicks:'2',markerMatches:true}:null):(child.exitCode===null?identity:null),sameProcess:(a,b)=>!!a&&a.pid===b?.pid&&a.startTicks===b?.startTicks,
    json,delay,writeFile:async(_p,text)=>{if(failLog&&JSON.parse(text).event!=='startup_checkpoint')throw Error('STATE_UNAVAILABLE');events.push(JSON.parse(text));},releaseFreeze:async()=>{released=true;},fail:code=>Error(code),
    validRunId:id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),Date:Clock,setTimeout:timeout,clearTimeout:clear,verifyRuntimeApproval:async()=>{},readApprovedEnabledState:async()=>{},verifyRuntimeCandidate:async()=>{},
    startupJobsState:async()=>jobs,assertProtectedPaths:async()=>{if(receiptPatch.slowProofObservation)await delay(31000);}};
  names.startupBudgetMs=startupBudgetMs;
  const start=new Function(...Object.keys(names),body+'\nreturn startRuntime;')(...Object.values(names));
  start('root',{startupTimeoutMs:budget}).then(value=>{result=value;done=true;},error=>{result=error;done=true;});
  for(let step=0;step<5000&&!done;step++){
    for(let n=0;n<40;n++)await Promise.resolve();
    if(done)break;
    const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
    assert.ok(next,'orchestration must settle or have a bounded timer');timers.delete(next[0]);now=next[1].at;next[1].fn();
  }
  assert.ok(done,'orchestration did not settle');return {error:result,now,aborted,released,events,files};
}
const slow=await scenario();
assert.equal(slow.error.message,'SUPERVISOR_START_FAILED','a >15s preflight refusal must retain its original error after proven no-create');
assert.equal(slow.released,true);assert.ok(slow.now>=16000,'the real preflight result must be observed after 15 seconds');
assert.equal(slow.error.startupFailure.launcher.elapsedMs,16000);
assert.equal(slow.error.startupFailure.launcher.exitCode,2);
assert.equal(slow.error.startupFailure.launcher.pid,42);
assert.equal(slow.error.startupFailure.launcher.stderr.text,'Runtime launch refused');
assert.equal(slow.error.startupFailure.launcher.stderr.truncated,true);
assert.equal(JSON.stringify(slow.events).includes('PRIVATE_TEST_TOKEN'),false);
const masked=await scenario({launchAt:10,preflightFailure:true,jobs:{owner:0,launcher:1,guardian:0,runtime:0}});
assert.equal(masked.error.message,'CLEANUP_REQUIRED');
assert.equal(masked.error.startupFailure.code,'SUPERVISOR_START_FAILED');
assert.equal(masked.error.startupFailure.origin.code,'APPROVAL_DENIED','a later preflight cleanup exception must not replace its initial failure');
assert.equal(masked.error.startupFailure.secondaryFailure.code,'PREFLIGHT_JOB_FAILED');
assert.equal(masked.error.startupFailure.cleanup.proven,false);
const maskedGuardian=await scenario({created:true,guardianAlive:true,confirmedFailureStage:'preflight',guardianPreflightFailure:true,launchAt:10});
assert.equal(maskedGuardian.error.startupFailure.origin.code,'APPROVAL_DENIED','Guardian preflight must also retain the error before finally cleanup');
assert.equal(maskedGuardian.error.startupFailure.origin.preflightExitCode,1);
assert.equal(maskedGuardian.error.startupFailure.secondaryFailure.code,'PREFLIGHT_JOB_FAILED');
const missing=await scenario({receipt:false,launchAt:10,previous:true});
assert.equal(missing.error.message,'CLEANUP_REQUIRED');assert.equal(missing.released,false);
assert.equal(missing.error.startupFailure.code,'SUPERVISOR_START_FAILED');
assert.equal(missing.error.startupFailure.cleanup.proven,false);
const timedOut=await scenario({launchAt:100000,receipt:false,budget:1000});
assert.equal(timedOut.error.message,'CLEANUP_REQUIRED');assert.equal(timedOut.released,false);
assert.equal(timedOut.error.startupFailure.code,'START_TIMEOUT');
const productionSlow=await scenario({production:true,budget:180000,launchAt:150000});
assert.equal(productionSlow.error.startupFailure.code,'SUPERVISOR_START_FAILED','production observes the actual delayed launch result above 120s');
assert.equal([...productionSlow.files].find(([p])=>p.endsWith('request.json'))[1].startupDeadline,180000,'one absolute deadline starts at request creation');
for(const input of [{production:true,budget:180001},{production:false,budget:30001},{budget:0}])assert.equal((await scenario(input)).error.message,'INVALID_TIMEOUT');
for(const options of [{created:true,guardianAlive:true},{created:true,guardianReceipt:false},{jobs:{launcher:1,guardian:0,runtime:0}},{receiptRun:'old-run',previous:true},{receipt:false,failAbort:true},{receipt:false,failLog:true},{receipt:false,stdoutOnly:true}]){
  const unknown=await scenario({...options,launchAt:10});assert.equal(unknown.error.message,'CLEANUP_REQUIRED');assert.equal(unknown.released,false);
}
const durable=await scenario({created:true,launchAt:10});
assert.equal(durable.error.message,'CLEANUP_REQUIRED');assert.equal(durable.released,false,'preflight-only receipt and absent Job do not prove the Node tree was contained');
for(const options of [{launcherStage:'guardian_created'},{created:true,completeReceipt:true,launcherStage:'preflight'}]){
 const inconsistent=await scenario({...options,launchAt:10});assert.equal(inconsistent.released,false);assert.equal(inconsistent.error.message,'CLEANUP_REQUIRED');
}
const guardianFailure=await scenario({created:true,guardianAlive:true,confirmedFailureStage:'create-job',launchAt:10});
assert.equal(guardianFailure.error.startupFailure.origin.win32Error,5);
assert.equal(guardianFailure.error.startupFailure.origin.exitCode,2);
assert.equal(guardianFailure.error.startupFailure.stage,'create-job','retain the actual Guardian stage, including its established hyphenated names');
const readFailure=await scenario({created:true,guardianAlive:true,confirmedFailureStage:'record-start',failStateRead:true,launchAt:10});
assert.equal(readFailure.error.startupFailure.origin.role,'manager');
assert.equal(readFailure.error.startupFailure.origin.code,'INVALID_STATE');
assert.equal(readFailure.error.startupFailure.stage,'guardian_confirmation');
assert.equal(readFailure.error.startupFailure.observedRuntimeFailure.role,'guardian');
assert.equal(readFailure.error.startupFailure.stateFailure.code,'EPERM');
assert.equal(readFailure.released,false);
assert.equal(readFailure.events.find(event=>event.event==='startup_result').origin.role,'manager');
const completeBody=source.slice(source.indexOf('async function guardianComplete('),source.indexOf('export async function startRuntime('));
let oldGuardian={runId:'old',finishedAt:'done',jobAssigned:true,jobActiveAfterCleanup:0,nodePid:44};
const priorComplete=new Function('json','join','reconciliationComplete','oldRuntimeGone',completeBody+'\nreturn guardianComplete;')(
  async path=>path.endsWith('guardian.json')?oldGuardian:{runId:'old',supervisor:{pid:44}},join,async()=>true,async()=>{});
assert.equal(await priorComplete('root','old'),false,'an assigned legacy Job cannot exclude children created before assignment');
oldGuardian={...oldGuardian,containment:'create_process_job_list'};
assert.equal(await priorComplete('root','old'),false,'an atomic marker without the named Job and kill-on-close identity is incomplete proof');
oldGuardian={...oldGuardian,jobName:'Local\\TongRuntime-old',killOnJobClose:true};
assert.equal(await priorComplete('root','old'),true);
const observation=await scenario({failObservation:true});assert.equal(observation.released,false);assert.equal(observation.error.message,'CLEANUP_REQUIRED');
assert.equal(observation.events.find(event=>event.event==='startup_result').runId,null,'pre-request refusal still needs correlated lifecycle evidence');
const creator=await scenario({created:true,guardianReceipt:false,creatorCleanup:true,launchAt:10});assert.equal(creator.released,true);
const recycled=await scenario({created:true,completeReceipt:true,guardianReused:true,launchAt:10});assert.equal(recycled.released,true);
const complete=await scenario({created:true,launchAt:10,completeReceipt:true});
assert.equal(complete.released,true);
const delayedProof=await scenario({launchAt:10,receiptPatch:{slowProofObservation:true}});
assert.equal(delayedProof.released,false,'a proof that finishes after the shared cleanup deadline must not release the lock');
assert.equal(delayedProof.error.message,'CLEANUP_REQUIRED');
assert.ok(delayedProof.now<31000,'one slow observation must not extend the cleanup window');
for(const options of [{nodeAlive:true},{guardianAlive:true},{receiptPatch:{runtimeClean:false}},{receiptPatch:{owner:{pid:99,exe:'D:\\guardian.exe',startTicks:'2',markerMatches:true}}},{receiptPatch:{jobName:'Local\\TongRuntime-old-run'}},{receiptPatch:{stage:'preflight'}},{receiptPatch:{nodeCreated:null}},{receiptPatch:{jobActiveAfterCleanup:1}},{jobs:{owner:1,launcher:0,guardian:0,runtime:0}}]){
 const unsafe=await scenario({created:true,launchAt:10,completeReceipt:true,...options});assert.equal(unsafe.released,false,JSON.stringify(options));assert.equal(unsafe.error.message,'CLEANUP_REQUIRED');
}
console.log(JSON.stringify({passed:true,virtualTime:true,slowPreflight:true,lostReceiptFailClosed:true,previousRunNotProof:true,originalFailureRetained:true}));
