import { spawn, fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, mkdir, rename, unlink, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve, isAbsolute, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { TongAgentDockClient } from './TongAgentDockClient.mjs';
import { assertProtectedPaths, inspectSecurity, protectSecret, readSecret, safeEnvironment, processIdentity, processDescendants, sameProcess, terminateOwnedProcess, exitDiagnostic } from './TongRuntimeSecurity.mjs';
import {PRODUCTION_ROOT,validateProductionProfile,loadApprovedProfile,verifyRuntimeApproval,initializeProductionRoot,recordApprovedEnabledState,readApprovedEnabledState} from './TongProductionProfile.mjs';
import {pinRuntimeRelease,verifyRuntimeCandidate} from './TongRuntimeCandidate.mjs';
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
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
async function json(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw fail('INVALID_STATE');}}
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
  profile=validateProductionProfile(profile);await verifyRuntimeApproval(profile,'start');
  const previous=await layout(profile.root),status=await runtimeStatus(profile.root);
  if(status.supervisorAlive||!['not_started','stopped','abnormal_exit'].includes(status.phase)||status.runId&&!await guardianComplete(profile.root,status.runId))throw fail('RUNTIME_BUSY');
  if(profile.agentdockEnabled){await verifyRuntimeApproval(profile,'enable-agentdock');try{await readApprovedEnabledState(profile);}catch{await recordApprovedEnabledState(profile);}}
  else if(previous.agentdockEnabled){await verifyRuntimeApproval(profile,'disable-agentdock');await recordApprovedEnabledState(profile);}
  await pinRuntimeRelease(profile,releaseRoot,{replace:true});await save(join(profile.root,'profile.json'),profile);return profile;
}
async function unused(port){await new Promise((ok,reject)=>{const socket=createConnection({host:'127.0.0.1',port});const timer=setTimeout(()=>{socket.destroy();reject(fail('PORT_CHECK_FAILED'));},1000);socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(fail('PORT_OCCUPIED'));});socket.once('error',error=>{clearTimeout(timer);socket.destroy();error.code==='ECONNREFUSED'?ok():reject(fail('PORT_CHECK_FAILED'));});});}
async function freeze(root){try{return await open(join(root,'run','backup.freeze'),'wx');}catch{throw fail('RUNTIME_BUSY');}}
async function releaseFreeze(root,handle){await handle.close();await unlink(join(root,'run','backup.freeze'));}
export async function initializeRuntime({root,tongRoot,withTong=false,gatewayPort=17876,upstreamPort=17877}) {
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
function previousIdentities(record,guardian){return [guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].filter(identity=>identity&&Number.isInteger(identity.pid)&&identity.pid>0);}
async function reconciliationComplete(root,record){
  if(!record?.runId||!record.supervisor)return false;
  const guardian=await json(join(root,'run','guardian.json'));
  if(!guardian||guardian.runId!==record.runId||guardian.nodePid!==record.supervisor?.pid||guardian.finishedAt||guardian.jobActiveAfterCleanup!==undefined)return false;
  const path=join(root,'run',reconciliationName),proof=await json(path);
  if(!proof)return false;
  await assertProtectedPaths([path]);
  if(proof.schemaVersion!==1||proof.kind!=='guardian-lost' || proof.runId!==record.runId
    || proof.runtimeSha256!==await hash(join(root,'run','runtime.json'))
    || proof.guardianSha256!==await hash(join(root,'run','guardian.json'))
    || !Number.isFinite(Date.parse(proof.observedAt))||Date.parse(proof.observedAt)>Date.now()+5000
    || proof.identityCount!==previousIdentities(record,guardian).length)return false;
  for(const identity of previousIdentities(record,guardian))if(sameProcess(await processIdentity(identity.pid,record.runId),identity))return false;
  const profile=await layout(root);
  for(const port of [profile.agentdockPort,profile.gatewayPort,profile.upstreamPort]){try{await unused(port);}catch{return false;}}
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
    const record=await json(join(root,'run','runtime.json')),guardian=await json(join(root,'run','guardian.json'));
    if(!record||!guardian||!['starting','ready','stopping'].includes(record.phase)||!record.runId
      || guardian.runId!==record.runId||guardian.nodePid!==record.supervisor?.pid||guardian.jobAssigned!==true
      || guardian.finishedAt||guardian.jobActiveAfterCleanup!==undefined
      || ![guardian,record.supervisor,...(record.children??[]),...(record.descendants??[])].every(identity=>Number.isInteger(identity?.pid)&&identity.pid>0&&typeof identity.exe==='string'&&/^\d+$/.test(identity.startTicks)))throw fail('RECONCILIATION_DENIED');
    if((await runtimeStatus(root)).phase!=='stale_record')throw fail('RECONCILIATION_DENIED');
    for(const identity of previousIdentities(record,guardian))if(sameProcess(await processIdentity(identity.pid,record.runId),identity))throw fail('RECONCILIATION_DENIED');
    for(const port of [profile.agentdockPort,profile.gatewayPort,profile.upstreamPort])await unused(port);
    const proof={schemaVersion:1,kind:'guardian-lost',runId:record.runId,runtimeSha256:await hash(join(root,'run','runtime.json')),
      guardianSha256:await hash(join(root,'run','guardian.json')),observedAt:new Date().toISOString(),identityCount:previousIdentities(record,guardian).length};
    const path=join(root,'run',reconciliationName);
    await writeFile(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});await assertProtectedPaths([path]);
    if((await runtimeStatus(root)).phase!=='abnormal_exit'||!await guardianComplete(root,record.runId))throw fail('RECONCILIATION_DENIED');
    return {runId:record.runId,reconciled:true,observedAt:proof.observedAt,originalRecordsPreserved:true};
  }finally{await releaseFreeze(root,held);}
}
export async function runtimeStatus(root){await layout(root);const record=await json(join(root,'run','runtime.json'));if(!record)return {phase:'not_started',supervisorAlive:false};const actual=await processIdentity(record.supervisor?.pid??0,record.runId);const alive=sameProcess(actual,record.supervisor)&&actual.markerMatches;const stale=['starting','ready','stopping'].includes(record.phase)&&!alive;const reconciled=stale&&await reconciliationComplete(root,record);return {...record,phase:stale?(reconciled?'abnormal_exit':'stale_record'):record.phase,supervisorAlive:alive,...(reconciled?{reconciled:true}:{})};}
async function dockHealth(root){const profile=await layout(root);const token=await readSecret(root,'agentdock');const response=await fetch(`http://127.0.0.1:${profile.agentdockPort}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});await response.body?.cancel();if(response.status!==401)throw fail('AUTH_BOUNDARY_FAILED');const client=new TongAgentDockClient({url:`http://127.0.0.1:${profile.agentdockPort}/mcp`,tokenProvider:()=>token,controlledExecution:true,timeoutMs:2000});try{await client.connect();return {authenticatedMcp:true,toolCount:(await client.listTools()).length};}finally{await client.close();}}
async function tongHealth(profile){const response=await fetch(`http://127.0.0.1:${profile.gatewayPort}/.well-known/oauth-authorization-server`,{signal:AbortSignal.timeout(2000)});if(!response.ok)throw fail('TONG_HEALTH_FAILED');const metadata=await response.json();if(metadata.issuer!==`${(profile.publicOrigin??`http://127.0.0.1:${profile.gatewayPort}`).replace(/\/$/,'')}/`)throw fail('TONG_HEALTH_FAILED');const rejected=await fetch(`http://127.0.0.1:${profile.gatewayPort}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'runtime-health',version:'1'}}}),signal:AbortSignal.timeout(2000)});await rejected.body?.cancel();if(rejected.status!==401)throw fail('TONG_AUTH_BOUNDARY_FAILED');return {discovery:true,unauthenticatedRejected:true};}
export async function runtimeDoctor(root){const profile=await layout(root),status=await runtimeStatus(root);const binaryHash=await hash(AGENTDOCK_EXE);let health=null;try{if(status.phase==='ready'&&status.supervisorAlive)health={...(dockEnabled(profile)?{agentdock:await dockHealth(root)}:{}),...(hasTong(profile)?{tong:await tongHealth(profile)}:{})};}catch{health=null;}return {root,phase:status.phase,healthy:binaryHash===AGENTDOCK_SHA256&&!!health,binaryHash,security:await inspectSecurity([root,...(preserved(profile)?preservedDirs:dirs).map(dir=>join(root,dir))]),health};}
async function guardianComplete(root,runId) {
  const guardian=await json(join(root,'run','guardian.json'));
  if(guardian?.runId!==runId)return false;
  if(!guardian.finishedAt)return (await reconciliationComplete(root,await json(join(root,'run','runtime.json'))))===true;
  return guardian.jobActiveAfterCleanup===0
    && !sameProcess(await processIdentity(guardian.pid),guardian)
    && !(await processIdentity(guardian.nodePid,runId))?.markerMatches;
}
export async function startRuntime(root,{startupTimeoutMs}={}) {
  if(startupTimeoutMs!==undefined&&(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1||startupTimeoutMs>120000))throw fail('INVALID_TIMEOUT');
  root=absoluteRoot(root);const approved=guardedRoot(root)?await loadApprovedProfile(root,'start'):null;
  const profile=await layout(root);if(approved&&JSON.stringify(profile)!==JSON.stringify(approved))throw fail('APPROVAL_DENIED');
  const maxStartupMs=preserved(profile)?120000:30000;
  startupTimeoutMs??=maxStartupMs;if(startupTimeoutMs>maxStartupMs)throw fail('INVALID_TIMEOUT');
  if(preserved(profile)){await verifyRuntimeApproval(profile,'start');if(profile.agentdockEnabled)await readApprovedEnabledState(profile);await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});}
  const held=await freeze(root);
  let runId,child,launchedIdentity,release=true;
  try {
    const status=await runtimeStatus(root);
    if(status.supervisorAlive)throw fail('ALREADY_RUNNING');
    if(!['not_started','stopped','abnormal_exit'].includes(status.phase))throw fail('STALE_RECORD');
    if(status.runId&&!await guardianComplete(root,status.runId))throw fail('CLEANUP_REQUIRED');
    for(const identity of [...(status.children??[]),...(status.descendants??[])])
      if(sameProcess(await processIdentity(identity.pid),identity))throw fail('CHILD_STILL_ALIVE');
    if(await hash(AGENTDOCK_EXE)!==AGENTDOCK_SHA256)throw fail('BINARY_CHANGED');
    for(const port of [...(dockEnabled(profile)?[profile.agentdockPort]:[]),...(hasTong(profile)?[profile.gatewayPort,profile.upstreamPort]:[])])await unused(port);
    if(dockEnabled(profile))await readSecret(root,'agentdock');if(preserved(profile)?profile.mode==='production-simulation':profile.withTong)await readSecret(root,'oauth-owner');
    runId=randomUUID();await save(join(root,'run','request.json'),{runId,createdAt:new Date().toISOString()});
    child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',preserved(profile)?join(profile.managerRoot,'scripts','TongRuntimeLaunch.ps1'):guardianScript,'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',preserved(profile)?join(profile.managerRoot,'scripts','TongAgentDockRuntime.mjs'):self],
      {cwd:root,env:{...safeEnvironment(root),USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA},windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
    child.stderr.resume();let launchOutput='';child.stdout.on('data',chunk=>{launchOutput+=chunk;if(launchOutput.length>100)child.kill();});
    let spawnError=false;child.once('error',()=>{spawnError=true;});
    let launchTimer;
    try{await Promise.race([once(child,'close'),new Promise((_,reject)=>{launchTimer=setTimeout(()=>{child.kill();reject(fail('SUPERVISOR_START_FAILED'));},15000);})]);}
    finally{clearTimeout(launchTimer);}
    if(spawnError||child.exitCode!==0)throw fail('SUPERVISOR_START_FAILED');
    const launched=JSON.parse(launchOutput);launchedIdentity=await processIdentity(launched.pid,runId);
    if(!launchedIdentity?.markerMatches)throw fail('SUPERVISOR_START_FAILED');
    const deadline=Date.now()+startupTimeoutMs;
    while(Date.now()<deadline) {
      if(spawnError)throw fail('SUPERVISOR_START_FAILED');
      const guardian=await json(join(root,'run','guardian.json')),failure=await json(join(root,'run','guardian-failure.json'));
      if(failure?.runId===runId||guardian?.runId===runId&&guardian.finishedAt)throw fail('START_FAILED');
      const record=await json(join(root,'run','runtime.json'));
      if(record?.runId===runId) {
        if(record.phase==='ready')return record;
        if(['abnormal_exit','cleanup_required'].includes(record.phase))throw fail('START_FAILED');
      }
      await delay(100);
    }
    throw fail('START_TIMEOUT');
  } catch(error) {
    if(child?.pid) {
      // Cancel only this run's private Job; hold backup/start lock until completion.
      await save(join(root,'run','abort.json'),{runId,requestedAt:new Date().toISOString(),reason:'START_ABORT'});
      let complete=false;
      for(let n=0;n<300;n++) {
        if(await guardianComplete(root,runId)){complete=true;break;}
        // If no Job record was ever published, require the exact launcher-owned identity to be gone.
        const guardian=await json(join(root,'run','guardian.json'));
        if(launchedIdentity&&guardian?.runId!==runId&&!sameProcess(await processIdentity(launchedIdentity.pid),launchedIdentity)){complete=true;break;}
        await delay(100);
      }
      if(!complete){release=false;throw fail('CLEANUP_REQUIRED');}
    }
    throw error;
  } finally {if(release)await releaseFreeze(root,held);else await held.close();}
}
export async function stopRuntime(root,{expectedRunId}={}){if(expectedRunId!==undefined&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(expectedRunId))throw fail('INVALID_RUN');root=absoluteRoot(root);const profile=await layout(root);if(preserved(profile))await verifyRuntimeApproval(profile,'stop');const status=await runtimeStatus(root);if(expectedRunId!==undefined&&status.runId!==expectedRunId)throw fail('IDENTITY_MISMATCH');if(status.phase==='not_started')return status;const previousGuardian=await json(join(root,'run','guardian.json'));if(['stopped','abnormal_exit'].includes(status.phase)&&!status.supervisorAlive&&previousGuardian?.runId===status.runId&&previousGuardian.finishedAt&&previousGuardian.jobActiveAfterCleanup===0&&await guardianComplete(root,status.runId))return status;if(!status.supervisorAlive)throw fail('IDENTITY_MISMATCH');await save(join(root,'run','stop.json'),{runId:status.runId,requestedAt:new Date().toISOString()});for(let n=0;n<300;n++){const record=await json(join(root,'run','runtime.json'));if(record?.runId===status.runId&&['stopped','abnormal_exit','cleanup_required'].includes(record.phase)){if(record.phase==='cleanup_required')throw fail('CLEANUP_REQUIRED');const guardian=await json(join(root,'run','guardian.json'));if(guardian?.runId===status.runId&&guardian.finishedAt&&guardian.jobActiveAfterCleanup===0&&!sameProcess(await processIdentity(status.supervisor.pid),status.supervisor)&&!sameProcess(await processIdentity(guardian.pid),guardian))return record;}await delay(100);}throw fail('STOP_TIMEOUT');}
export function redactedStream(secrets){const decoder=new StringDecoder('utf8');let pending='';const redact=text=>secrets.reduce((value,secret)=>value.split(secret).join('[REDACTED]'),text);return new Transform({transform(chunk,_encoding,callback){pending+=decoder.write(chunk);const max=Math.max(1,...secrets.map(s=>s.length));let cut=Math.max(0,pending.length-max+1);for(const secret of secrets){let index=pending.indexOf(secret);while(index>=0){if(index<cut&&index+secret.length>cut)cut=index;index=pending.indexOf(secret,index+1);}}this.push(redact(pending.slice(0,cut)));pending=pending.slice(cut);callback();},flush(callback){this.push(redact(pending+decoder.end()));callback();}});}
async function supervise(root,runId){root=absoluteRoot(root);const request=await json(join(root,'run','request.json'));if(request?.runId!==runId)throw fail('INVALID_RUN');for(let n=0;n<100;n++){const guardian=await json(join(root,'run','guardian.json'));if(guardian?.runId===runId&&guardian.jobAssigned&&guardian.nodePid===process.pid)break;if(n===99)throw fail('GUARDIAN_NOT_READY');await delay(100);}const profile=await layout(root);if(preserved(profile)){await verifyRuntimeApproval(profile,'start');if(profile.agentdockEnabled)await readApprovedEnabledState(profile);await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});}const token=dockEnabled(profile)?await readSecret(root,'agentdock'):null,owner=(preserved(profile)?profile.mode==='production-simulation':profile.withTong)?await readSecret(root,'oauth-owner'):null;const secrets=[...(token?[token]:[]),...(owner?[owner]:[])];const supervisor=await processIdentity(process.pid,runId);const record={schemaVersion:1,runId,phase:'starting',profileMode:profile.mode??'synthetic',codeRoot:codeRoot(profile),...(preserved(profile)?{sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,sourceCommit:(await json(join(root,'run','release-pin.json'))).commit,managerCommit:(await json(join(root,'run','manager-pin.json'))).commit}:{}),supervisor,children:[],descendants:[],pids:[process.pid],exits:[],startedAt:new Date().toISOString(),nodeVersion:process.version,nodeExecutable:process.execPath,nodeSha256:await hash(process.execPath),agentdockSha256:AGENTDOCK_SHA256};const children=new Map(),streams=[];let closing=false,capturing=false,timer,shutdownPromise;let chain=Promise.resolve();const persist=()=>{chain=chain.then(()=>save(join(root,'run','runtime.json'),record));return chain;};const event=async value=>{await writeFile(join(root,'logs','lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),runId,...value})+'\n',{flag:'a'});};
  async function capture(){if(capturing)return;capturing=true;try{record.descendants=await processDescendants(process.pid);record.pids=[...new Set([process.pid,...record.children.map(c=>c.pid),...record.descendants.map(c=>c.pid)])];await persist();}finally{capturing=false;}}
  async function attach(role,child){children.set(role,child);const out=join(root,'logs',runId+'-'+role+'.stdout.log'),err=join(root,'logs',runId+'-'+role+'.stderr.log');for(const [source,path] of [[child.stdout,out],[child.stderr,err]]){const stream=createWriteStream(path,{flags:'wx'});streams.push(stream);source.pipe(redactedStream(secrets)).pipe(stream);}child.once('error',()=>{void shutdown('abnormal_exit','CHILD_SPAWN_FAILED');});child.once('exit',(code,signal)=>{const entry={at:new Date().toISOString(),role,pid:child.pid,...exitDiagnostic(code,signal)};record.exits.push(entry);void event({event:'process_exit',...entry});if(!closing)void shutdown('abnormal_exit','CHILD_EXIT');});const identity=await processIdentity(child.pid);if(!identity)throw fail('CHILD_EXIT');record.children.push({role,...identity,stdoutLog:out,stderrLog:err,tokenInArgv:false});await persist();return child;}
  async function managed(role,settings){
    const began=Date.now();await event({event:'readiness_begin',role});
    const child=fork(childScript,[],{cwd:codeRoot(profile),env:safeEnvironment(root),windowsHide:true,execArgv:['--trace-uncaught','--trace-warnings'],stdio:['ignore','pipe','pipe','ipc']});
    await attach(role,child);
    const ready=new Promise((ok,reject)=>{
      const time=setTimeout(()=>reject(fail('CHILD_READINESS_TIMEOUT')),preserved(profile)?45000:20000);
      child.on('message',message=>{if(message.event==='stage'&&/^[a-z_]{1,40}$/.test(message.stage??''))void event({event:'child_stage',role,stage:message.stage,durationMs:Date.now()-began});});
      child.on('message',message=>{if(message.event==='stage')return;if(message.event==='logging_secret'&&role==='devspace'&&preserved(profile)){if(typeof message.ownerToken!=='string'||message.ownerToken.length<16||message.ownerToken.length>4096||/[\x00-\x20\x7f]/.test(message.ownerToken)){clearTimeout(time);reject(fail('CHILD_READINESS_FAILED'));return;}if(!secrets.includes(message.ownerToken))secrets.push(message.ownerToken);child.send({event:'logging_ready'});return;}clearTimeout(time);message.event==='ready'?ok():reject(fail('CHILD_READINESS_FAILED'));});
      child.once('exit',()=>{clearTimeout(time);reject(fail('CHILD_EXIT'));});
    });
    child.send({schemaVersion:1,role,root,...settings,tongRoot:codeRoot(profile),...(preserved(profile)?{profile}:{}),gatewayPort:profile.gatewayPort,upstreamPort:profile.upstreamPort});
    await ready;await event({event:'readiness_complete',role,durationMs:Date.now()-began});
  }
  async function shutdown(phase='stopped',reason='REQUESTED'){return shutdownPromise??=(async()=>{closing=true;clearInterval(timer);record.phase='stopping';await persist();await event({event:'shutdown',reason});await capture().catch(()=>{});for(const role of ['gateway','devspace']){const child=children.get(role);if(child?.connected){child.send({event:'stop'});await Promise.race([once(child,'exit'),delay(role==='devspace'?11000:2000)]);}}await capture().catch(()=>{});// Descendant snapshots are diagnostic only. The guardian owns the private Job.
for(const identity of [...record.children].reverse()){if(sameProcess(await processIdentity(identity.pid),identity))await terminateOwnedProcess(identity);}const alive=[];for(const identity of record.children)if(sameProcess(await processIdentity(identity.pid),identity))alive.push(identity.pid);record.phase=alive.length?'cleanup_required':phase;record.remainingPids=alive;record.finishedAt=new Date().toISOString();await persist();await event({event:'shutdown_complete',phase:record.phase,remainingPids:alive});await Promise.race([Promise.all(streams.map(stream=>stream.closed?Promise.resolve():new Promise(ok=>stream.once('close',ok)))),delay(2000)]);for(const child of children.values()){child.stdout?.destroy();child.stderr?.destroy();if(child.connected)child.disconnect();child.unref();}for(const stream of streams)if(!stream.closed)stream.destroy();process.exitCode=record.phase==='stopped'?0:1;})();}
  await persist();await event({event:'start',supervisorPid:process.pid});
  try{if(await hash(AGENTDOCK_EXE)!==AGENTDOCK_SHA256)throw fail('BINARY_CHANGED');if(dockEnabled(profile)){await unused(profile.agentdockPort);const dock=spawn(AGENTDOCK_EXE,['--host','127.0.0.1','--port',String(profile.agentdockPort),'--mcp-apps-mode','off'],{cwd:root,windowsHide:true,env:{...safeEnvironment(root),AGENTDOCK_HOME:join(root,'backend-state'),AGENTDOCK_DEFAULT_DIR:join(root,'workspace'),AGENTDOCK_AUTH_TOKEN:token,AGENTDOCK_BROWSER_ENABLED:'false',AGENTDOCK_ACP_ENABLED:'false',AGENTDOCK_MCP_APPS_MODE:'off'},stdio:['ignore','pipe','pipe']});await attach('agentdock',dock);for(let n=0;n<60;n++){if(dock.exitCode!==null)throw fail('BACKEND_EXIT');try{await dockHealth(root);break;}catch{if(n===59)throw fail('BACKEND_HEALTH_FAILED');await delay(100);}}}if(hasTong(profile)){await managed('devspace',{agentdockToken:token,ownerToken:owner});await managed('gateway',{});await tongHealth(profile);}await capture();if(closing)return;record.phase='ready';await persist();await event({event:'ready'});timer=setInterval(()=>{void (async()=>{const stop=await json(join(root,'run','stop.json'));if(stop?.runId===runId)await shutdown();else await capture();})().catch(()=>shutdown('abnormal_exit','MONITOR_FAILED'));},1000);process.on('SIGTERM',()=>{void shutdown();});}
  catch(error){await event({event:'startup_failure',code:['CHILD_READINESS_TIMEOUT','CHILD_READINESS_FAILED','CHILD_EXIT','BACKEND_EXIT','BACKEND_HEALTH_FAILED','TONG_HEALTH_FAILED','TONG_AUTH_BOUNDARY_FAILED','BINARY_CHANGED','PORT_OCCUPIED'].includes(error.message)?error.message:'START_FAILED'});await shutdown('abnormal_exit','START_FAILED');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [command,...args]=process.argv.slice(2);const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};const root=option('--root');try{if(command==='preflight-production'){const profile=await loadApprovedProfile(PRODUCTION_ROOT,'start');await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true});if(args.includes('--login-recovery')){const stop=await loadApprovedProfile(PRODUCTION_ROOT,'stop');if(JSON.stringify(stop)!==JSON.stringify(profile))throw fail('APPROVAL_DENIED');}console.log(JSON.stringify({approved:true,stopRunSupported:true}));}else if(command==='init-production'){const profile=await loadApprovedProfile(PRODUCTION_ROOT,'init');console.log(JSON.stringify(await initializeProductionRuntime(profile,{releaseRoot:option('--release-root'),managerReleaseRoot:option('--manager-release-root')})));}else if(command==='activate-production'){const profile=await loadApprovedProfile(PRODUCTION_ROOT,'start');console.log(JSON.stringify(await updateRuntimeProfile(profile,{releaseRoot:option('--release-root'),managerReleaseRoot:option('--manager-release-root')})));}else if(command==='reconcile-stale')console.log(JSON.stringify(await reconcileStaleRuntime(root)));else if(command==='stop-run'){const expectedRunId=option('--run-id');if(!expectedRunId)throw fail('INVALID_RUN');console.log(JSON.stringify(await stopRuntime(root,{expectedRunId})));}else if(command==='supervise')await supervise(root,option('--run-id'));else{const result=command==='init'?await initializeRuntime({root,tongRoot:option('--tong-root'),withTong:args.includes('--with-tong')}):command==='start'?await startRuntime(root):command==='stop'?await stopRuntime(root):command==='status'?await runtimeStatus(root):command==='doctor'?await runtimeDoctor(root):null;if(!result)throw fail('INVALID_COMMAND');console.log(JSON.stringify(result));}}catch(error){console.error(['ACL_DENIED','PORT_OCCUPIED','ALREADY_RUNNING','STALE_RECORD','IDENTITY_MISMATCH','INIT_EXISTS','SECRET_UNAVAILABLE','RUNTIME_BUSY','CLEANUP_REQUIRED','STOP_TIMEOUT','START_TIMEOUT','START_FAILED','BINARY_CHANGED','INVALID_COMMAND','INVALID_ROOT','APPROVAL_DENIED','CANDIDATE_DENIED','RECONCILIATION_DENIED'].includes(error.message)?error.message:'RUNTIME_OPERATION_REFUSED');process.exitCode=1;}}
