import { spawn, fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, mkdir, rename, unlink, readdir } from 'node:fs/promises';
import { createWriteStream, appendFileSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { TongAgentDockClient } from './TongAgentDockClient.mjs';
import { assertProtectedPaths, inspectSecurity, protectSecret, readSecret, safeEnvironment, processIdentity, processDescendants, sameProcess, terminateOwnedProcess, exitDiagnostic, runtimeJobState, startupJobsState } from './TongRuntimeSecurity.mjs';
import {PRODUCTION_ROOT,validateProductionProfile,loadApprovedProfile,verifyRuntimeApproval,initializeProductionRoot,recordApprovedEnabledState,readApprovedEnabledState} from './TongProductionProfile.mjs';
import {pinRuntimeRelease,verifyRuntimeCandidate} from './TongRuntimeCandidate.mjs';
import {withLoginRecovery,loginRecoveryGrantId} from './TongLoginRecovery.mjs';
import {acquireRuntimeFreeze,releaseRuntimeFreeze} from './TongLifecycleFreeze.mjs';
export const AGENTDOCK_EXE='D:\\Tong\\runtime\\agentdock\\agentdock.exe';
export const AGENTDOCK_SHA256='bc1a7a35f1985e9f7827142577fc31bd4ca536e27252b08fc28c5ed636cf5e8d';
const self=fileURLToPath(import.meta.url), guardianScript=fileURLToPath(new URL('TongRuntimeLaunch.ps1',import.meta.url)), childScript=fileURLToPath(new URL('TongRuntimeServer.mjs',import.meta.url));
const preservedDirs=['backend-state','workspace','tong-policy','tong-policy/agentdock-operations','secrets','run','logs','temp','home'];
const preserved=profile=>['production','production-simulation'].includes(profile.mode);
const dockEnabled=profile=>!preserved(profile)||profile.agentdockEnabled;
const codeRoot=profile=>preserved(profile)?profile.codeRoot:profile.tongRoot;
const hasTong=profile=>preserved(profile)||profile.withTong;
const guardedRoot=root=>root===PRODUCTION_ROOT||/^b23-[a-zA-Z0-9_-]+$/.test(relative(resolve('D:\\Tong\\state'),resolve(root)));
const dirs=['backend-state','workspace','workspace/demo','tong-state','tong-state/config','tong-policy','tong-policy/agentdock-operations','secrets','run','logs','temp','home'];
const fail=code=>new Error(code), delay=ms=>new Promise(ok=>setTimeout(ok,ms));
export function readinessPolicy(role,production){
  // Observed cold starts: DevSpace 23.6/38.3/44.3s, import up to 18.9s,
  // Gateway up to 24.6s. Progress buys a stage budget, never a new total.
  return {totalMs:production?(role==='devspace'?75000:35000):20000,slowMs:production?45000:20000,
    stages:role==='devspace'?['spawned','settings_received','approval_verified','candidate_verified','config_loaded','log_protection_ready','server_import_begin','server_import_complete']:['spawned','settings_received','approval_verified','candidate_verified'],
    stageMs:{spawned:30000,settings_received:15000,approval_verified:20000,candidate_verified:role==='devspace'?10000:15000,config_loaded:10000,log_protection_ready:10000,server_import_begin:30000,server_import_complete:10000}};
}
export function waitForChildReadiness(child,{role,preserved:production,began=Date.now(),startupDeadline=Infinity,onEvent=()=>{},signal,clock={now:Date.now,setTimeout,clearTimeout}}){
  const policy=readinessPolicy(role,production);let stage='spawned',stageAt=began,index=0,timer,done=false,slow=false;
  return new Promise((resolve,reject)=>{
    const details=()=>({role,stage,durationMs:clock.now()-began,stageDurationMs:clock.now()-stageAt});
    function finish(error){if(done)return;done=true;clock.clearTimeout(timer);child.off('message',message);child.off('exit',exited);child.off('error',spawnFailed);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();}
    function refused(code,extra={}){const error=fail(code);error.readiness={...details(),...extra};finish(error);}
    function emit(value){try{Promise.resolve(onEvent(value)).catch(finish);}catch(error){finish(error);}}
    function check(){
      if(done)return true;
      const now=clock.now();
      if(now>=startupDeadline){refused('START_TIMEOUT',{timeoutKind:'startup_total'});return true;}
      if(now>=began+policy.totalMs){refused('CHILD_READINESS_TIMEOUT',{timeoutKind:'child_total'});return true;}
      if(now>=stageAt+policy.stageMs[stage]){refused('CHILD_STAGE_TIMEOUT',{timeoutKind:'stage'});return true;}
      if(!slow&&now>=began+policy.slowMs){slow=true;emit({event:'readiness_slow',...details()});}
      return done;
    }
    function arm(){clock.clearTimeout(timer);if(check())return;timer=clock.setTimeout(arm,Math.max(1,Math.min(startupDeadline,began+policy.totalMs,stageAt+policy.stageMs[stage],slow?Infinity:began+policy.slowMs)-clock.now()));}
    function message(value){
      if(check()||!value||typeof value!=='object')return;
      if(value.event==='stage'){
        const next=policy.stages.indexOf(value.stage);if(next<=index)return;
        const previousStage=stage,stageDurationMs=clock.now()-stageAt;
        stage=value.stage;stageAt=clock.now();index=next;
        const diagnostic={};for(const key of ['importDurationMs','importCpuUserMs','importCpuSystemMs','rssBytes'])if(Number.isSafeInteger(value[key])&&value[key]>=0)diagnostic[key]=value[key];
        emit({event:'child_stage',...details(),previousStage,stageDurationMs,...diagnostic});arm();
      }else if(value.event==='ready')finish();
      else if(value.event!=='logging_secret')refused('CHILD_READINESS_FAILED');
    }
    function exited(exitCode,signal){refused('CHILD_EXIT',{exitCode,signal});}
    function spawnFailed(){refused('CHILD_SPAWN_FAILED');}
    function aborted(){refused('START_ABORTED');}
    child.on('message',message);child.once('exit',exited);child.once('error',spawnFailed);signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted)aborted();else if(child.exitCode!==null||child.signalCode!==null)exited(child.exitCode,child.signalCode);else arm();
  });
}
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
async function json(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;const refused=fail('INVALID_STATE');refused.stateFailure={file:basename(path),operation:typeof error.code==='string'?'read':'parse',code:/^[A-Z_]{1,64}$/.test(error.code??'')?error.code:'JSON_PARSE_FAILED',...(Number.isSafeInteger(error.errno)?{errno:error.errno}:{})};throw refused;}}
async function save(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});for(let n=0;n<10;n++){try{await rename(tmp,path);return;}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||n===9)throw fail('STATE_UNAVAILABLE');await delay(25);}}}
function absoluteRoot(root){
  const approved=resolve('D:\\Tong\\state');
  if(typeof root!=='string'||/[\r\n"]/.test(root)||!isAbsolute(root))throw fail('INVALID_ROOT');
  root=resolve(root);if(root===PRODUCTION_ROOT)return root;const rel=relative(approved,root);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw fail('INVALID_ROOT');
  return root;
}
async function layout(root){
  root=absoluteRoot(root);await assertProtectedPaths([root]);
  const profile=await json(join(root,'profile.json'));
  if(preserved(profile??{})){
    validateProductionProfile(profile);
    if(profile.root!==root)throw fail('INVALID_PROFILE');
    const marker=await json(join(root,'production-root.json'));
    if(marker?.root!==root||marker.mode!==profile.mode)throw fail('INVALID_PROFILE');
    await assertProtectedPaths([root,...preservedDirs.map(dir=>join(root,dir)),join(root,'profile.json'),join(root,'production-root.json')]);
    return profile;
  }
  if(root===PRODUCTION_ROOT||guardedRoot(root))throw fail('APPROVAL_DENIED');
  const marker=await json(join(root,'runtime-synthetic.json'));
  if(marker?.scope!=='synthetic-only'||profile?.schemaVersion!==1||profile.root!==root||profile.host!=='127.0.0.1'||profile.agentdockPort!==18765)throw fail('INVALID_PROFILE');
  await assertProtectedPaths([root,...dirs.map(dir=>join(root,dir)),join(root,'profile.json'),join(root,'runtime-synthetic.json')]);return profile;
}
export async function initializeProductionRuntime(profile,{releaseRoot,managerReleaseRoot}={}){
  profile=validateProductionProfile(profile);await verifyRuntimeApproval(profile,'init');
  await initializeProductionRoot(profile);
  const existing=await json(join(profile.root,'profile.json'));
  if(existing&&JSON.stringify(existing)!==JSON.stringify(profile))throw fail('INIT_EXISTS');
  await pinRuntimeRelease(profile,releaseRoot);
  const manager=await loadApprovedProfile(profile.root,'manager');await pinRuntimeRelease(manager,managerReleaseRoot,{manager:true});
  for(const purpose of ['agentdock',...(profile.mode==='production-simulation'?['oauth-owner']:[])]){
    const path=join(profile.root,'secrets',purpose+'.dpapi');
    try{await readFile(path);await readSecret(profile.root,purpose);}catch(error){if(error.code!=='ENOENT')throw error;await protectSecret(profile.root,purpose,randomBytes(32).toString('hex'));}
  }
  const policy=join(profile.root,'tong-policy','agentdock-access.json');
  try{await writeFile(policy,JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(profile.root,'workspace'),projects:[],approvals:[]}),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  await mkdir(join(profile.root,'tong-policy','agentdock-operations'),{recursive:true});
  await assertProtectedPaths([policy,join(profile.root,'tong-policy','agentdock-operations')]);
  if(!existing)await writeFile(join(profile.root,'profile.json'),JSON.stringify(profile,null,2)+'\n',{flag:'wx'});
  return {root:profile.root,initialized:true,agentdockEnabled:profile.agentdockEnabled,originalStateRoot:profile.runtimeDir};
}
export async function updateRuntimeProfile(profile,{releaseRoot}={}){
  if(loginRecoveryGrantId())throw fail('APPROVAL_DENIED');
  profile=validateProductionProfile(profile);await verifyRuntimeApproval(profile,'start');
  const held=await freeze(profile.root);
  try{
  const previous=await layout(profile.root),status=await runtimeStatus(profile.root);
  if(status.supervisorAlive||!['not_started','stopped','abnormal_exit'].includes(status.phase)||status.runId&&!await guardianComplete(profile.root,status.runId))throw fail('RUNTIME_BUSY');
  if(profile.agentdockEnabled){await verifyRuntimeApproval(profile,'enable-agentdock');try{await readApprovedEnabledState(profile);}catch{await recordApprovedEnabledState(profile);}}
  else if(previous.agentdockEnabled){await verifyRuntimeApproval(profile,'disable-agentdock');await recordApprovedEnabledState(profile);}
  await pinRuntimeRelease(profile,releaseRoot,{replace:true});await save(join(profile.root,'profile.json'),profile);return profile;
  }finally{await releaseFreeze(profile.root,held);}
}
async function unused(port){await new Promise((ok,reject)=>{const socket=createConnection({host:'127.0.0.1',port});const timer=setTimeout(()=>{socket.destroy();reject(fail('PORT_CHECK_FAILED'));},1000);socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(fail('PORT_OCCUPIED'));});socket.once('error',error=>{clearTimeout(timer);socket.destroy();error.code==='ECONNREFUSED'?ok():reject(fail('PORT_CHECK_FAILED'));});});}
async function freeze(root){try{return await acquireRuntimeFreeze(root);}catch{throw fail('RUNTIME_BUSY');}}
async function releaseFreeze(root,handle){await releaseRuntimeFreeze(root,handle);}
export async function initializeRuntime({root,tongRoot,withTong=false,gatewayPort=17876,upstreamPort=17877}) {
  if(loginRecoveryGrantId())throw fail('APPROVAL_DENIED');
  root=absoluteRoot(root);if(root===PRODUCTION_ROOT)throw fail('INVALID_ROOT');if(guardedRoot(root))throw fail('APPROVAL_DENIED');await assertProtectedPaths([dirname(root)]);await mkdir(root,{recursive:true});await assertProtectedPaths([root]);
  if((await readdir(root)).length)throw fail('INIT_EXISTS');
  if(!isAbsolute(tongRoot)||![gatewayPort,upstreamPort].every(port=>Number.isInteger(port)&&port>1024&&port<65536&&![7676,7677,18765].includes(port))||gatewayPort===upstreamPort)throw fail('INVALID_PROFILE');
  for(const dir of dirs)await mkdir(join(root,dir),{recursive:true});
  if(await hash(AGENTDOCK_EXE)!==AGENTDOCK_SHA256)throw fail('BINARY_CHANGED');
  await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
  await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
  await writeFile(join(root,'runtime-synthetic.json'),JSON.stringify({schemaVersion:1,syntheticOnly:true,scope:'synthetic-only'}));
  const profile={schemaVersion:1,root,tongRoot:resolve(tongRoot),withTong:withTong===true,host:'127.0.0.1',agentdockPort:18765,gatewayPort,upstreamPort};await save(join(root,'profile.json'),profile);return {root,initialized:true};
}
const reconciliationName='stale-reconciliation.json';
const validRunId=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const reconciliationPath=(root,runId)=>join(root,'run',`stale-reconciliation.${runId}.json`);
function previousIdentities(record,guardian){return [guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].filter(identity=>identity&&Number.isInteger(identity.pid)&&identity.pid>0);}
function validReconciliation(proof){
  return proof&&[1,2].includes(proof.schemaVersion)&&proof.kind==='guardian-lost'&&validRunId(proof.runId)
    &&['runtimeSha256','guardianSha256'].every(key=>/^[a-f0-9]{64}$/.test(proof[key]??''))
    &&Number.isFinite(Date.parse(proof.observedAt))&&Date.parse(proof.observedAt)<=Date.now()+5000
    &&Number.isInteger(proof.identityCount)&&proof.identityCount>=2
    &&(proof.schemaVersion===1||['runtime','guardian'].every(key=>typeof proof[key+'Record']==='string'
      &&createHash('sha256').update(proof[key+'Record']).digest('hex')===proof[key+'Sha256']));
}
async function reconciliationProof(root,runId){
  let selected;
  for(const path of [join(root,'run',reconciliationName),reconciliationPath(root,runId)]){
    const proof=await json(path);if(!proof)continue;
    await assertProtectedPaths([path]);
    if(!validReconciliation(proof))throw fail('RECONCILIATION_DENIED');
    if(path===reconciliationPath(root,runId)&&proof.runId!==runId)throw fail('RECONCILIATION_DENIED');
    if(proof.runId!==runId)continue; // Retain the valid legacy history in place.
    if(selected&&['runtimeSha256','guardianSha256','observedAt','identityCount'].some(key=>selected[key]!==proof[key]))throw fail('RECONCILIATION_DENIED');
    selected=proof;
  }
  return selected;
}
async function oldRuntimeGone(root,record,guardian,{completed=false,observe=async()=>{}}={}){
  // A completed, named kill-on-close Job provides cleanup evidence independent
  // of recycled Windows PIDs. Never kill or mistake a replacement process for
  // the recorded one. Lost/legacy Guardians retain the conservative PID gate.
  if(completed&&(!guardian.finishedAt||!Number.isFinite(Date.parse(guardian.finishedAt))
    ||guardian.jobAssigned!==true||guardian.jobActiveAfterCleanup!==0
    ||guardian.jobName!==`Local\\TongRuntime-${record.runId}`||guardian.killOnJobClose!==true))throw fail('RECONCILIATION_DENIED');
  for(const identity of previousIdentities(record,guardian)){
    const actual=await processIdentity(identity.pid);
    if(actual&&(!completed||sameProcess(actual,identity))){await observe({reason:'PID_PRESENT',expected:identity,actual,sameIdentity:sameProcess(actual,identity)});throw fail('RECONCILIATION_DENIED');}
  }
  if(guardian.jobName!==undefined){
    if(guardian.jobName!==`Local\\TongRuntime-${record.runId}`||guardian.killOnJobClose!==true)throw fail('RECONCILIATION_DENIED');
    if((await runtimeJobState(record.runId)).activeProcesses!==0)throw fail('CLEANUP_REQUIRED');
  }
  // Legacy unnamed Jobs are accepted only with the original jobAssigned record,
  // every recorded identity gone and every related endpoint unused.
  const profile=await layout(root);
  for(const port of [profile.agentdockPort,profile.gatewayPort,profile.upstreamPort])await unused(port);
}
async function reconciliationComplete(root,record,{diagnostics=false}={}){
  if(!validRunId(record?.runId)||!record.supervisor)return false;
  const guardian=await json(join(root,'run','guardian.json'));
  if(!guardian||guardian.runId!==record.runId||guardian.nodePid!==record.supervisor?.pid||guardian.finishedAt||guardian.jobActiveAfterCleanup!==undefined)return false;
  const proof=await reconciliationProof(root,record.runId);
  if(!proof)return false;
  if(guardian.jobAssigned!==true||proof.runtimeSha256!==await hash(join(root,'run','runtime.json'))
    || proof.guardianSha256!==await hash(join(root,'run','guardian.json'))
    || !Number.isFinite(Date.parse(proof.observedAt))||Date.parse(proof.observedAt)>Date.now()+5000
    || proof.identityCount!==previousIdentities(record,guardian).length)return false;
  try{await oldRuntimeGone(root,record,guardian,{observe:async detail=>{if(diagnostics)await writeFile(join(root,'logs','reconciliation-observations.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:record.runId,...detail})+'\n',{flag:'a'});}});}catch{return false;}
  return true;
}
export async function reconcileStaleRuntime(root){
  root=absoluteRoot(root);const profile=await layout(root);
  if(preserved(profile)){
    const approved=await loadApprovedProfile(root,'stop');
    if(JSON.stringify(approved)!==JSON.stringify(profile))throw fail('APPROVAL_DENIED');
    await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});
  }
  const held=await freeze(root);
  try{
    await assertProtectedPaths([join(root,'run','runtime.json'),join(root,'run','guardian.json')]);
    const record=await json(join(root,'run','runtime.json')),guardian=await json(join(root,'run','guardian.json'));
    if(!record||!guardian||!['starting','ready','stopping'].includes(record.phase)||!validRunId(record.runId)
      || guardian.runId!==record.runId||guardian.nodePid!==record.supervisor?.pid||guardian.jobAssigned!==true
      || guardian.finishedAt||guardian.jobActiveAfterCleanup!==undefined
      || ![guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].every(identity=>Number.isInteger(identity?.pid)&&identity.pid>0&&typeof identity.exe==='string'&&isAbsolute(identity.exe)&&/^\d+$/.test(identity.startTicks)))throw fail('RECONCILIATION_DENIED');
    const previous=await reconciliationProof(root,record.runId);
    if(previous&&!await reconciliationComplete(root,record))throw fail('RECONCILIATION_DENIED');
    await oldRuntimeGone(root,record,guardian);
    const runtimeRecord=await readFile(join(root,'run','runtime.json'),'utf8'),guardianRecord=await readFile(join(root,'run','guardian.json'),'utf8');
    if(JSON.stringify(JSON.parse(runtimeRecord))!==JSON.stringify(record)||JSON.stringify(JSON.parse(guardianRecord))!==JSON.stringify(guardian))throw fail('RECONCILIATION_DENIED');
    const proof=previous??{schemaVersion:2,kind:'guardian-lost',runId:record.runId,runtimeSha256:await hash(join(root,'run','runtime.json')),
      guardianSha256:await hash(join(root,'run','guardian.json')),observedAt:new Date().toISOString(),identityCount:previousIdentities(record,guardian).length,runtimeRecord,guardianRecord};
    if(!previous){const path=reconciliationPath(root,record.runId);await writeFile(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});await assertProtectedPaths([path]);}
    if(!await reconciliationComplete(root,record))throw fail('RECONCILIATION_DENIED');
    await writeFile(join(root,'logs','reconciliation.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:record.runId,event:previous?'proof_reused':'proof_created',runtimeSha256:proof.runtimeSha256,guardianSha256:proof.guardianSha256})+'\n',{flag:'a'});
    return {runId:record.runId,reconciled:true,alreadyReconciled:!!previous,observedAt:proof.observedAt,originalRecordsPreserved:true};
  }finally{await releaseFreeze(root,held);}
}
export async function runtimeStatus(root,{diagnostics=false}={}){await layout(root);const record=await json(join(root,'run','runtime.json'));if(!record)return {phase:'not_started',supervisorAlive:false};const actual=await processIdentity(record.supervisor?.pid??0,record.runId);const alive=sameProcess(actual,record.supervisor)&&actual.markerMatches;const guardian=await json(join(root,'run','guardian.json'));const guardianAlive=guardian?.runId===record.runId&&sameProcess(await processIdentity(guardian.pid,record.runId),guardian);const stop=await json(join(root,'run','stop.json'));const stale=['starting','ready','stopping'].includes(record.phase)&&!alive;const reconciled=stale&&await reconciliationComplete(root,record,{diagnostics});return {...record,phase:stale?(reconciled?'abnormal_exit':'stale_record'):record.phase,supervisorAlive:alive,guardianAlive,stopRequested:stop?.runId===record.runId,...(reconciled?{reconciled:true}:{})};}
async function dockHealth(root){const profile=await layout(root);const token=await readSecret(root,'agentdock');const response=await fetch(`http://127.0.0.1:${profile.agentdockPort}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});await response.body?.cancel();if(response.status!==401)throw fail('AUTH_BOUNDARY_FAILED');const client=new TongAgentDockClient({url:`http://127.0.0.1:${profile.agentdockPort}/mcp`,tokenProvider:()=>token,controlledExecution:true,timeoutMs:2000});try{await client.connect();return {authenticatedMcp:true,toolCount:(await client.listTools()).length};}finally{await client.close();}}
async function tongHealth(profile){const response=await fetch(`http://127.0.0.1:${profile.gatewayPort}/.well-known/oauth-authorization-server`,{signal:AbortSignal.timeout(2000)});if(!response.ok)throw fail('TONG_HEALTH_FAILED');const metadata=await response.json();if(metadata.issuer!==`${(profile.publicOrigin??`http://127.0.0.1:${profile.gatewayPort}`).replace(/\/$/,'')}/`)throw fail('TONG_HEALTH_FAILED');const rejected=await fetch(`http://127.0.0.1:${profile.gatewayPort}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'runtime-health',version:'1'}}}),signal:AbortSignal.timeout(2000)});await rejected.body?.cancel();if(rejected.status!==401)throw fail('TONG_AUTH_BOUNDARY_FAILED');return {discovery:true,unauthenticatedRejected:true};}
export async function runtimeDoctor(root){const profile=await layout(root),status=await runtimeStatus(root);const binaryHash=await hash(AGENTDOCK_EXE);let health=null;try{if(status.phase==='ready'&&status.supervisorAlive)health={...(dockEnabled(profile)?{agentdock:await dockHealth(root)}:{}),...(hasTong(profile)?{tong:await tongHealth(profile)}:{})};}catch{health=null;}return {root,phase:status.phase,healthy:binaryHash===AGENTDOCK_SHA256&&!!health,binaryHash,security:await inspectSecurity([root,...(preserved(profile)?preservedDirs:dirs).map(dir=>join(root,dir))]),health};}
async function guardianComplete(root,runId) {
  const guardian=await json(join(root,'run','guardian.json'));
  if(guardian?.runId!==runId)return false;
  // A legacy assigned-Job record cannot exclude descendants created before
  // assignment. It needs a separately reviewed recovery, never an automatic
  // upgrade to the atomic containment proof used by this protocol.
  if(guardian.containment!=='create_process_job_list')return false;
  if(guardian.jobName!==`Local\\TongRuntime-${runId}`||guardian.killOnJobClose!==true)return false;
  if(!guardian.finishedAt)return (await reconciliationComplete(root,await json(join(root,'run','runtime.json'))))===true;
  if(guardian.jobActiveAfterCleanup!==0||guardian.jobAssigned!==true)return false;
  const record=await json(join(root,'run','runtime.json'));
  if(record?.runId!==runId||guardian.nodePid!==record.supervisor?.pid)return false;
  try{await oldRuntimeGone(root,record,guardian,{completed:true});return true;}catch{return false;}
}
export async function startRuntime(root,{startupTimeoutMs,onRequest}={}) {
  if(onRequest!==undefined&&typeof onRequest!=='function')throw fail('INVALID_REQUEST_OBSERVER');
  if(startupTimeoutMs!==undefined&&(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1||startupTimeoutMs>120000))throw fail('INVALID_TIMEOUT');
  root=absoluteRoot(root);const approved=guardedRoot(root)?await loadApprovedProfile(root,'start'):null;
  const profile=await layout(root);if(approved&&JSON.stringify(profile)!==JSON.stringify(approved))throw fail('APPROVAL_DENIED');
  const maxStartupMs=preserved(profile)?120000:30000;
  startupTimeoutMs??=maxStartupMs;if(startupTimeoutMs>maxStartupMs)throw fail('INVALID_TIMEOUT');
  if(preserved(profile)){await verifyRuntimeApproval(profile,'start');if(profile.agentdockEnabled)await readApprovedEnabledState(profile);await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});}
  const held=await freeze(root);
  let runId,child,launchedIdentity,deadline,release=true,stage='previous_cleanup';
  const diagnosticId=randomUUID();
  const checkpoint=async name=>{stage=name;await writeFile(join(root,'logs','lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),event:'startup_checkpoint',diagnosticId,role:'manager',stage:name})+'\n',{flag:'a'});};
  const receipt=async(id=runId)=>{
    if(!validRunId(id))return null;
    try{
      const value=await json(join(root,'run',`launcher.${id}.json`));
      if(value===null)return null;
      if(value?.schemaVersion!==2||value.role!=='launcher'||value.runId!==id||!['initializing','preflight','preflight_complete','create_guardian','guardian_created'].includes(value.stage)
        ||value.code!==undefined&&!/^[A-Z_]{1,64}$/.test(value.code))return {invalid:true};
      if(value.guardianCreated===false&&value.stage==='guardian_created'||value.guardianCreated===true&&!['create_guardian','guardian_created'].includes(value.stage))return {invalid:true};
      return value;
    }catch{return {invalid:true};}
  };
  const launchComplete=async(id=runId,launcherPid=child?.pid,{signal}={})=>{
    // A dead launcher or empty Job alone cannot exclude a raced CreateProcess.
    // Require its terminal negative receipt, or the exact acknowledged Guardian
    // to be gone, as well as both preflight Jobs and the runtime Job being empty.
    const value=await receipt(id);
    const validIdentity=identity=>Number.isInteger(identity?.pid)&&identity.pid>0&&typeof identity.exe==='string'&&isAbsolute(identity.exe)&&/^\d+$/.test(identity.startTicks)&&identity.markerMatches===true;
    if(id===runId&&child?.exitCode===null)return false;
    if(!value)return false;
    if(value.invalid||!value.finishedAt||value.preflightClean!==true||!validIdentity(value.launcher)||launcherPid!==undefined&&value.launcher.pid!==launcherPid||sameProcess(await processIdentity(value.launcher.pid,'',{signal}),value.launcher))return false;
    await assertProtectedPaths([join(root,'run',`launcher.${id}.json`)],{signal});
    if(value.guardianCreated!==false){
      if(value.guardianCreated!==true||!validIdentity(value.guardian)||sameProcess(await processIdentity(value.guardian.pid,'',{signal}),value.guardian))return false;
      const creatorCleanup=value.guardianTreeCleanup;
      if(creatorCleanup!==undefined){
        if(creatorCleanup.proven!==true||creatorCleanup.runId!==id||creatorCleanup.jobName!==`Local\\TongGuardian-${id}`||creatorCleanup.stage!=='guardian_adoption')return false;
      }else{
      const guardianReceiptPath=join(root,'run',`guardian.${id}.json`),guardianReceipt=await json(guardianReceiptPath);
      if(guardianReceipt?.schemaVersion!==2||guardianReceipt.role!=='guardian'||guardianReceipt.runId!==id||!guardianReceipt.finishedAt||guardianReceipt.preflightClean!==true
        ||!validIdentity(guardianReceipt.owner)||!sameProcess(guardianReceipt.owner,value.guardian)||guardianReceipt.runtimeClean!==true
        ||guardianReceipt.jobName!==`Local\\TongRuntime-${id}`||guardianReceipt.jobActiveAfterCleanup!==0
        ||!['compile','initializing','preflight','preflight_complete','read-request','create-job','spawn-node','record-start','wait-node'].includes(guardianReceipt.stage))return false;
      if(guardianReceipt.nodeCreated!==false){
        if(guardianReceipt.nodeCreated!==true||!['spawn-node','record-start','wait-node'].includes(guardianReceipt.stage)||!validIdentity(guardianReceipt.node)||sameProcess(await processIdentity(guardianReceipt.node.pid,'',{signal}),guardianReceipt.node))return false;
      }else if(['record-start','wait-node'].includes(guardianReceipt.stage))return false;
      await assertProtectedPaths([guardianReceiptPath],{signal});
      }
    }
    const jobs=await startupJobsState(id,{signal});
    return jobs.owner===0&&jobs.launcher===0&&jobs.guardian===0&&jobs.runtime===0;
  };
  try {
    // Reading prior state is itself part of the proof. An ACL/CIM/Job failure
    // must retain the lock even though this call has not created a child yet.
    release=false;
    await checkpoint('previous_status');
    const status=await runtimeStatus(root,{diagnostics:true});
    if(status.supervisorAlive){release=true;throw fail('ALREADY_RUNNING');}
    if(!['not_started','stopped','abnormal_exit'].includes(status.phase))throw fail('STALE_RECORD');
    const previousRequest=await json(join(root,'run','request.json'));
    if(previousRequest&&previousRequest.runId!==status.runId&&!await launchComplete(previousRequest.runId)){release=false;throw fail('CLEANUP_REQUIRED');}
    if(status.runId&&!await guardianComplete(root,status.runId)){release=false;throw fail('CLEANUP_REQUIRED');}
    for(const identity of [...(status.children??[]),...(status.descendants??[])])
      if(sameProcess(await processIdentity(identity.pid),identity))throw fail('CHILD_STILL_ALIVE');
    release=true;
    await checkpoint('binary_hash');
    if(await hash(AGENTDOCK_EXE)!==AGENTDOCK_SHA256)throw fail('BINARY_CHANGED');
    await checkpoint('ports');
    for(const port of [...(dockEnabled(profile)?[profile.agentdockPort]:[]),...(hasTong(profile)?[profile.gatewayPort,profile.upstreamPort]:[])])await unused(port);
    await checkpoint('secrets');
    if(dockEnabled(profile))await readSecret(root,'agentdock');if(preserved(profile)?profile.mode==='production-simulation':profile.withTong)await readSecret(root,'oauth-owner');
    await checkpoint('request');
    deadline=Date.now()+startupTimeoutMs;
    runId=randomUUID();const recoveryGrantId=loginRecoveryGrantId();await save(join(root,'run','request.json'),{runId,createdAt:new Date().toISOString(),startupDeadline:deadline,...(recoveryGrantId?{recoveryGrantId}:{})});
    // Maintenance persists this identity before the launcher can create a tree.
    if(onRequest)await onRequest({runId});
    stage='launcher_start';
    child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',preserved(profile)?join(profile.managerRoot,'scripts','TongRuntimeLaunch.ps1'):guardianScript,'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',preserved(profile)?join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs'):self,...(recoveryGrantId?['-RecoveryGrantId',recoveryGrantId]:[])],
      {cwd:root,env:{...safeEnvironment(root),USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA},windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
    child.stderr.resume();let launchOutput='';child.stdout.on('data',chunk=>{launchOutput+=chunk;if(launchOutput.length>100)child.kill();});
    let spawnError=false,launchClosed=false;child.once('error',()=>{spawnError=true;});child.once('close',()=>{launchClosed=true;});
    // Preflight, CreateProcess and acknowledgement share the original total
    // startup deadline. Cancel cooperatively; hard kill would destroy the only
    // owner capable of proving whether a Guardian was created.
    while(!launchClosed&&!spawnError){
      const progress=await receipt();if(progress?.stage)stage=progress.stage;
      if(Date.now()>=deadline)throw fail('START_TIMEOUT');
      await delay(Math.min(100,Math.max(1,deadline-Date.now())));
    }
    if(spawnError||child.exitCode!==0){
      throw fail('SUPERVISOR_START_FAILED');
    }
    stage='guardian_confirmation';
    let launched;try{launched=JSON.parse(launchOutput);}catch{throw fail('SUPERVISOR_START_FAILED');}
    launchedIdentity=await processIdentity(launched.pid,runId);
    if(!launchedIdentity?.markerMatches)throw fail('SUPERVISOR_START_FAILED');
    while(Date.now()<deadline) {
      if(spawnError)throw fail('SUPERVISOR_START_FAILED');
      const guardian=await json(join(root,'run','guardian.json')),failure=await json(join(root,'run',`guardian.${runId}.json`));
      if(failure?.schemaVersion===2&&failure.runId===runId&&failure.failure||guardian?.runId===runId&&guardian.finishedAt)throw fail('START_FAILED');
      const record=await json(join(root,'run','runtime.json'));
      if(record?.runId===runId) {
        if(record.phase==='ready'&&Date.now()<deadline)return record;
        if(['abnormal_exit','cleanup_required'].includes(record.phase))throw fail('START_FAILED');
      }
      await delay(100);
    }
    throw fail('START_TIMEOUT');
  } catch(error) {
    const originalCode=/^[A-Z_]{1,64}$/.test(error.message)?error.message:'RUNTIME_OPERATION_REFUSED';
    const managerFailure={role:'manager',stage,code:originalCode,diagnosticId};
    let cleanup={proven:release&&!child?.pid,proof:child?.pid||!release?'unresolved':'not_launched'};
    // Any observation, abort write or diagnostic failure from here must retain
    // the lock until positive evidence explicitly changes this decision.
    if(child?.pid)release=false;
    let diagnosticsWriteFailed=false;
    try{
    if(error.message==='START_TIMEOUT'&&runId){
      const current=await json(join(root,'run','runtime.json')),progress=current?.runId===runId?current.startupProgress:null;
      const durationMs=Date.now()-deadline+startupTimeoutMs;
      await writeFile(join(root,'logs','lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),runId,event:'startup_failure',code:'START_TIMEOUT',timeoutKind:'startup_total',role:progress?.role??'supervisor',stage:progress?.stage??'initializing',durationMs,budgetMs:startupTimeoutMs,stageDurationMs:progress?Date.now()-progress.stageStartedAt:durationMs})+'\n',{flag:'a'});
    }
    }catch{diagnosticsWriteFailed=true;}finally{
    if(child?.pid) {
      // Cancel only this run's private Job; hold backup/start lock until completion.
      try{await save(join(root,'run','abort.json'),{runId,requestedAt:new Date().toISOString(),reason:'START_ABORT'});}catch{cleanup={proven:false,proof:'abort_write_failed'};}
      let complete=false;
      const cleanupDeadline=Date.now()+30000;
      while(Date.now()<cleanupDeadline) {
        let proofTimer;
        const proofAbort=new AbortController();
        try{
          // Even a completed Guardian does not cover a still-running Launcher
          // or preflight helper. Both owners must have finished this attempt.
          // Read-only observations may finish late. Their eventual result must
          // never release a lock after the shared cleanup budget has expired.
          const proven=await Promise.race([launchComplete(runId,child?.pid,{signal:proofAbort.signal}),new Promise(resolve=>{proofTimer=setTimeout(()=>{proofAbort.abort();resolve(false);},cleanupDeadline-Date.now());})]);
          if(proven&&Date.now()<cleanupDeadline){complete=true;cleanup={proven:true,proof:'launcher_terminal'};break;}
        }catch{/* A failed observation is not cleanup evidence. */}
        finally{clearTimeout(proofTimer);proofAbort.abort();}
        if(Date.now()<cleanupDeadline)await delay(Math.min(100,cleanupDeadline-Date.now()));
      }
      if(!complete){
        release=false;
        // Closing an unresponsive owner's handles also closes its private
        // preflight Job. Absence of a receipt still keeps the lock fail-closed.
        if(child.exitCode===null)try{child.kill();}catch{cleanup.terminationFailed=true;}
      }else release=true;
    }
    }
    const latest=await receipt();
    let runtimeFailure=null;
    if(runId){
      try{
        const record=await json(join(root,'run','runtime.json')),guardianFailure=await json(join(root,'run',`guardian.${runId}.json`));
        if(record?.runId===runId)runtimeFailure=record.startupFailure??record.startupProgress;
        if(guardianFailure?.schemaVersion===2&&guardianFailure.role==='guardian'&&guardianFailure.runId===runId){
          if(guardianFailure.failure)runtimeFailure={...guardianFailure.failure,...(Number.isInteger(guardianFailure.nodeExitCode)?{nodeExitCode:guardianFailure.nodeExitCode}:{})};
          else if(Number.isInteger(guardianFailure.nodeExitCode))runtimeFailure={role:'supervisor',stage:runtimeFailure?.stage??guardianFailure.stage,code:'SUPERVISOR_EXIT',exitCode:guardianFailure.nodeExitCode,diagnosticId:runId+'/supervisor'};
        }
      }catch{/* Preserve the original exception even if diagnostic state is unreadable. */}
    }
    const observedStage=error.stateFailure?managerFailure.stage:runtimeFailure?.stage??latest?.failure?.stage??(stage==='guardian_confirmation'?stage:latest?.stage??stage);
    const failureStage=/^[a-z][a-z_-]{0,63}$/.test(observedStage)?observedStage:stage;
    const rawOrigin=runtimeFailure??latest?.failure;
    // Metadata only: never copy exception messages, command lines, paths, or
    // arbitrary properties from a diagnostic file into the public failure.
    const observedRuntimeFailure=rawOrigin?Object.fromEntries(Object.entries(rawOrigin).filter(([key,value])=>
      ['role','stage','code','exceptionType','errorId','diagnosticId'].includes(key)?typeof value==='string'&&/^[A-Za-z0-9_.:/-]{1,160}$/.test(value):
      ['win32Error','hresult','exitCode','childExitCode','preflightExitCode','nodeExitCode'].includes(key)&&Number.isSafeInteger(value))):undefined;
    // A state read/parse refusal happened in this Manager. An abort or exit
    // observed during cleanup is separate evidence, never its original cause.
    const origin=error.stateFailure?managerFailure:observedRuntimeFailure;
    const startupFailure={runId:runId??null,diagnosticId,code:originalCode,stage:failureStage,managerFailure,...(origin?{origin}:{}),...(error.stateFailure&&observedRuntimeFailure?{observedRuntimeFailure}:{}),...(latest?.code?{launcherCode:latest.code}:{}),cleanup};
    if(error.stateFailure)startupFailure.stateFailure=error.stateFailure;
    if(diagnosticsWriteFailed)startupFailure.diagnosticsWriteFailed=true;
    try{await writeFile(join(root,'logs','lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),event:'startup_result',...startupFailure})+'\n',{flag:'a'});}catch{startupFailure.diagnosticsWriteFailed=true;}
    if(!cleanup.proven){const refused=fail('CLEANUP_REQUIRED');refused.startupFailure=startupFailure;throw refused;}
    error.startupFailure=startupFailure;
    throw error;
  } finally {if(release)await releaseFreeze(root,held);else await held.close();}
}
export async function stopRuntime(root,options={}) {
  root=absoluteRoot(root);const profile=await layout(root);
  if(preserved(profile))await verifyRuntimeApproval(profile,'stop');
  const held=await freeze(root);let release=true;
  try{return await stopRuntimeLocked(root,options);}catch(error){if(['STOP_TIMEOUT','CLEANUP_REQUIRED'].includes(error.message))release=false;throw error;}
  finally{if(release)await releaseFreeze(root,held);else await held.close();}
}
async function stopRuntimeLocked(root,{expectedRunId}={}){if(expectedRunId!==undefined&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(expectedRunId))throw fail('INVALID_RUN');if(loginRecoveryGrantId()&&!expectedRunId)throw fail('INVALID_RUN');root=absoluteRoot(root);const profile=await layout(root);if(preserved(profile))await verifyRuntimeApproval(profile,'stop');const status=await runtimeStatus(root);if(expectedRunId!==undefined&&status.runId!==expectedRunId)throw fail('IDENTITY_MISMATCH');if(status.phase==='not_started')return status;const previousGuardian=await json(join(root,'run','guardian.json'));if(['stopped','abnormal_exit'].includes(status.phase)&&!status.supervisorAlive&&previousGuardian?.runId===status.runId&&previousGuardian.finishedAt&&previousGuardian.jobActiveAfterCleanup===0&&await guardianComplete(root,status.runId))return status;if(!status.supervisorAlive)throw fail('IDENTITY_MISMATCH');await save(join(root,'run','stop.json'),{runId:status.runId,requestedAt:new Date().toISOString()});for(let n=0;n<300;n++){const record=await json(join(root,'run','runtime.json'));if(record?.runId===status.runId&&['stopped','abnormal_exit','cleanup_required'].includes(record.phase)){if(record.phase==='cleanup_required')throw fail('CLEANUP_REQUIRED');const guardian=await json(join(root,'run','guardian.json'));if(guardian?.runId===status.runId&&guardian.finishedAt&&guardian.jobActiveAfterCleanup===0&&!sameProcess(await processIdentity(status.supervisor.pid),status.supervisor)&&!sameProcess(await processIdentity(guardian.pid),guardian))return record;}await delay(100);}throw fail('STOP_TIMEOUT');}
export function redactedStream(secrets){const decoder=new StringDecoder('utf8');let pending='';const redact=text=>secrets.reduce((value,secret)=>value.split(secret).join('[REDACTED]'),text);return new Transform({transform(chunk,_encoding,callback){pending+=decoder.write(chunk);const max=Math.max(1,...secrets.map(s=>s.length));let cut=Math.max(0,pending.length-max+1);for(const secret of secrets){let index=pending.indexOf(secret);while(index>=0){if(index<cut&&index+secret.length>cut)cut=index;index=pending.indexOf(secret,index+1);}}this.push(redact(pending.slice(0,cut)));pending=pending.slice(cut);callback();},flush(callback){this.push(redact(pending+decoder.end()));callback();}});}
async function supervise(root,runId){root=absoluteRoot(root);const request=await json(join(root,'run','request.json'));if(request?.runId!==runId)throw fail('INVALID_RUN');if(request.recoveryGrantId&&loginRecoveryGrantId()!==request.recoveryGrantId)return withLoginRecovery(root,'supervise',()=>supervise(root,runId),{grantId:request.recoveryGrantId});for(let n=0;n<100;n++){const guardian=await json(join(root,'run','guardian.json'));if(guardian?.runId===runId&&guardian.jobAssigned&&guardian.nodePid===process.pid)break;if(n===99)throw fail('GUARDIAN_NOT_READY');await delay(100);}const profile=await layout(root);if(preserved(profile)){await verifyRuntimeApproval(profile,'start');if(profile.agentdockEnabled)await readApprovedEnabledState(profile);await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});}const token=dockEnabled(profile)?await readSecret(root,'agentdock'):null,owner=(preserved(profile)?profile.mode==='production-simulation':profile.withTong)?await readSecret(root,'oauth-owner'):null;const secrets=[...(token?[token]:[]),...(owner?[owner]:[])];const supervisor=await processIdentity(process.pid,runId);const record={schemaVersion:1,runId,...(loginRecoveryGrantId()?{recoveryGrantId:loginRecoveryGrantId()}:{}),phase:'starting',profileMode:profile.mode??'synthetic',codeRoot:codeRoot(profile),...(preserved(profile)?{sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,sourceCommit:(await json(join(root,'run','release-pin.json'))).commit,managerCommit:(await json(join(root,'run','manager-pin.json'))).commit}:{}),supervisor,children:[],descendants:[],pids:[process.pid],exits:[],startedAt:new Date().toISOString(),nodeVersion:process.version,nodeExecutable:process.execPath,nodeSha256:await hash(process.execPath),agentdockSha256:AGENTDOCK_SHA256};const children=new Map(),streams=[];let closing=false,capturing=false,timer,shutdownPromise;let chain=Promise.resolve();const persist=()=>{chain=chain.then(()=>save(join(root,'run','runtime.json'),record));return chain;};const event=async value=>{await writeFile(join(root,'logs','lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),runId,...value})+'\n',{flag:'a'});};
  async function capture(){if(capturing)return;capturing=true;try{record.descendants=await processDescendants(process.pid);record.pids=[...new Set([process.pid,...record.children.map(c=>c.pid),...record.descendants.map(c=>c.pid)])];await persist();}finally{capturing=false;}}
  async function attach(role,child){children.set(role,child);const out=join(root,'logs',runId+'-'+role+'.stdout.log'),err=join(root,'logs',runId+'-'+role+'.stderr.log');for(const [source,path] of [[child.stdout,out],[child.stderr,err]]){const stream=createWriteStream(path,{flags:'wx'});streams.push(stream);source.pipe(redactedStream(secrets)).pipe(stream);}child.once('error',()=>{void shutdown('abnormal_exit','CHILD_SPAWN_FAILED');});child.once('exit',(code,signal)=>{const entry={at:new Date().toISOString(),role,pid:child.pid,...exitDiagnostic(code,signal)};record.exits.push(entry);void event({event:'process_exit',...entry});if(!closing)void shutdown('abnormal_exit','CHILD_EXIT');});const identity=await processIdentity(child.pid);if(!identity)throw fail('CHILD_EXIT');record.children.push({role,...identity,stdoutLog:out,stderrLog:err,tokenInArgv:false});await persist();return child;}
  async function managed(role,settings){
    const began=Date.now();await event({event:'readiness_begin',role});
    const child=fork(childScript,[],{cwd:codeRoot(profile),env:safeEnvironment(root),windowsHide:true,execArgv:['--trace-uncaught','--trace-warnings'],stdio:['ignore','pipe','pipe','ipc']});
    const cancelled=new AbortController();
    const diagnostic=value=>{if(value.event==='child_stage')record.startupProgress={role,stage:value.stage,stageStartedAt:Date.now()};return Promise.all([event(value),persist()]);};
    const ready=waitForChildReadiness(child,{role,preserved:preserved(profile),began,startupDeadline:request.startupDeadline??Date.parse(record.startedAt)+(preserved(profile)?120000:30000),onEvent:diagnostic,signal:cancelled.signal});
    void ready.catch(()=>{}); // Attach can fail while readiness is already pending.
    const logging=message=>{if(message?.event!=='logging_secret'||role!=='devspace'||!preserved(profile))return;if(typeof message.ownerToken!=='string'||message.ownerToken.length<16||message.ownerToken.length>4096||/[\x00-\x20\x7f]/.test(message.ownerToken)){child.emit('message',{event:'readiness_failed'});return;}if(!secrets.includes(message.ownerToken))secrets.push(message.ownerToken);child.send({event:'logging_ready'});};
    child.on('message',logging);
    try{
      await attach(role,child);
      child.send({schemaVersion:1,role,root,...settings,tongRoot:codeRoot(profile),...(preserved(profile)?{profile}:{}),...(loginRecoveryGrantId()?{recoveryGrantId:loginRecoveryGrantId()}:{}),gatewayPort:profile.gatewayPort,upstreamPort:profile.upstreamPort});
      await ready;await event({event:'readiness_complete',role,durationMs:Date.now()-began});
    }finally{cancelled.abort();child.off('message',logging);}
  }
  async function shutdown(phase='stopped',reason='REQUESTED'){return shutdownPromise??=(async()=>{closing=true;clearInterval(timer);record.phase='stopping';await persist();await event({event:'shutdown',reason});await capture().catch(()=>{});for(const role of ['gateway','devspace']){const child=children.get(role);if(child?.connected){child.send({event:'stop'});await Promise.race([once(child,'exit'),delay(role==='devspace'?11000:2000)]);}}await capture().catch(()=>{});// Descendant snapshots are diagnostic only. The guardian owns the private Job.
for(const identity of [...record.children].reverse()){if(sameProcess(await processIdentity(identity.pid),identity))await terminateOwnedProcess(identity);}const alive=[];for(const identity of record.children)if(sameProcess(await processIdentity(identity.pid),identity))alive.push(identity.pid);record.phase=alive.length?'cleanup_required':phase;record.remainingPids=alive;record.finishedAt=new Date().toISOString();await persist();await event({event:'shutdown_complete',phase:record.phase,remainingPids:alive});await Promise.race([Promise.all(streams.map(stream=>stream.closed?Promise.resolve():new Promise(ok=>stream.once('close',ok)))),delay(2000)]);for(const child of children.values()){child.stdout?.destroy();child.stderr?.destroy();if(child.connected)child.disconnect();child.unref();}for(const stream of streams)if(!stream.closed)stream.destroy();process.exitCode=record.phase==='stopped'?0:1;})();}
  await persist();await event({event:'start',supervisorPid:process.pid});
  try{if(await hash(AGENTDOCK_EXE)!==AGENTDOCK_SHA256)throw fail('BINARY_CHANGED');if(dockEnabled(profile)){await unused(profile.agentdockPort);const dock=spawn(AGENTDOCK_EXE,['--host','127.0.0.1','--port',String(profile.agentdockPort),'--mcp-apps-mode','off'],{cwd:root,windowsHide:true,env:{...safeEnvironment(root),AGENTDOCK_HOME:join(root,'backend-state'),AGENTDOCK_DEFAULT_DIR:join(root,'workspace'),AGENTDOCK_AUTH_TOKEN:token,AGENTDOCK_BROWSER_ENABLED:'false',AGENTDOCK_ACP_ENABLED:'false',AGENTDOCK_MCP_APPS_MODE:'off'},stdio:['ignore','pipe','pipe']});await attach('agentdock',dock);for(let n=0;n<60;n++){if(dock.exitCode!==null)throw fail('BACKEND_EXIT');try{await dockHealth(root);break;}catch{if(n===59)throw fail('BACKEND_HEALTH_FAILED');await delay(100);}}}if(hasTong(profile)){await managed('devspace',{agentdockToken:token,ownerToken:owner});await managed('gateway',{});await tongHealth(profile);}await capture();if(closing)return;record.phase='ready';await persist();await event({event:'ready'});timer=setInterval(()=>{void (async()=>{const stop=await json(join(root,'run','stop.json'));if(stop?.runId===runId)await shutdown();else await capture();})().catch(()=>shutdown('abnormal_exit','MONITOR_FAILED'));},1000);process.on('SIGTERM',()=>{void shutdown();});}
  catch(error){record.startupFailure={code:['START_TIMEOUT','CHILD_STAGE_TIMEOUT','CHILD_READINESS_TIMEOUT','CHILD_READINESS_FAILED','CHILD_SPAWN_FAILED','CHILD_EXIT','BACKEND_EXIT','BACKEND_HEALTH_FAILED','TONG_HEALTH_FAILED','TONG_AUTH_BOUNDARY_FAILED','BINARY_CHANGED','PORT_OCCUPIED'].includes(error.message)?error.message:'START_FAILED',...error.readiness};await event({event:'startup_failure',...record.startupFailure});await shutdown('abnormal_exit',record.startupFailure.code);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,...args]=process.argv.slice(2);
  const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  const root=option('--root');
  async function dispatch(){
    if(command==='preflight-login'){
      const profile=await loadApprovedProfile(root,'start');await verifyRuntimeApproval(profile,'stop');
      if(profile.agentdockEnabled)await readApprovedEnabledState(profile);
      const {loginRecoveryDescriptor}=await import('./TongLoginRecovery.mjs');
      const descriptor=await loginRecoveryDescriptor(root);
      return {approved:true,stopRunSupported:true,loginRecoverySupported:true,runnerSha256:descriptor.runnerSha256,grantId:loginRecoveryGrantId()};
    }
    if(command==='preflight-production'){
      const profile=await loadApprovedProfile(PRODUCTION_ROOT,'start');
      await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});
      return {approved:true,stopRunSupported:true};
    }
    if(command==='init-production'){
      const profile=await loadApprovedProfile(PRODUCTION_ROOT,'init');
      return initializeProductionRuntime(profile,{releaseRoot:option('--release-root'),managerReleaseRoot:option('--manager-release-root')});
    }
    if(command==='activate-production'){
      const profile=await loadApprovedProfile(PRODUCTION_ROOT,'start');
      return updateRuntimeProfile(profile,{releaseRoot:option('--release-root'),managerReleaseRoot:option('--manager-release-root')});
    }
    if(command==='reconcile-stale')return reconcileStaleRuntime(root);
    if(command==='stop-run'){
      const expectedRunId=option('--run-id');if(!expectedRunId)throw fail('INVALID_RUN');
      return stopRuntime(root,{expectedRunId});
    }
    if(command==='supervise'){
      const diagnosticRoot=absoluteRoot(root);await assertProtectedPaths([diagnosticRoot,join(diagnosticRoot,'logs')]);
      // Synchronous, bounded metadata survives Node fatal exits. Do not log error
      // messages or environment values that may contain credentials or inputs.
      const fatal=(event,error)=>{try{appendFileSync(join(diagnosticRoot,'logs','supervisor.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:option('--run-id'),pid:process.pid,event,name:/^[A-Za-z]+Error$/.test(error?.name??'')?error.name:'Error',code:/^[A-Z_]{1,64}$/.test(error?.code??'')?error.code:null,reason:/^[A-Z_]{1,64}$/.test(error?.message??'')?error.message:null,frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,12).map(line=>line.replace(/\?.*?(?=:[0-9]+:[0-9]+\)?$)/,''))})+'\n');}catch{}};
      process.on('uncaughtExceptionMonitor',(error,origin)=>fatal(origin==='unhandledRejection'?'unhandled_rejection':'uncaught_exception',error));
      process.on('exit',code=>{try{appendFileSync(join(diagnosticRoot,'logs','supervisor.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:option('--run-id'),pid:process.pid,event:'supervisor_exit',exitCode:code})+'\n');}catch{}});
      try{await supervise(root,option('--run-id'));}catch(error){fatal('supervisor_start_failed',error);throw error;}return;
    }
    const result=command==='init'?await initializeRuntime({root,tongRoot:option('--tong-root'),withTong:args.includes('--with-tong')}):command==='start'?await startRuntime(root):command==='stop'?await stopRuntime(root):command==='status'?await runtimeStatus(root):command==='doctor'?await runtimeDoctor(root):null;
    if(!result)throw fail('INVALID_COMMAND');return result;
  }
  try{
    const result=command==='preflight-login'||args.includes('--login-recovery')
      ?await withLoginRecovery(root,command,dispatch,{grantId:option('--grant-id')})
      :await dispatch();
    if(result!==undefined)console.log(JSON.stringify(result));
  }catch(error){
    const code=['ACL_DENIED','PORT_OCCUPIED','ALREADY_RUNNING','STALE_RECORD','IDENTITY_MISMATCH','INIT_EXISTS','SECRET_UNAVAILABLE','RUNTIME_BUSY','CLEANUP_REQUIRED','STOP_TIMEOUT','START_TIMEOUT','START_FAILED','SUPERVISOR_START_FAILED','BINARY_CHANGED','INVALID_COMMAND','INVALID_ROOT','INVALID_RUN','APPROVAL_DENIED','CANDIDATE_DENIED','RECONCILIATION_DENIED','INVALID_STATE'].includes(error.message)?error.message:'RUNTIME_OPERATION_REFUSED';
    if(args.includes('--error-json'))console.log(JSON.stringify({error:code,...(error.startupFailure?{startupFailure:error.startupFailure}:{})}));else console.error(code);
    process.exitCode=1;
  }
}
