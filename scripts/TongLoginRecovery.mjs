import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCTION_ROOT,runtimeApprovalStore,assertRuntimeApprovalPaths,validateProductionProfile,createProductionProfile,createProductionSimulationProfile,runLoginRecoveryHelper} from './TongProductionProfile.mjs';
import {verifyRuntimeCandidate} from './TongRuntimeCandidate.mjs';
import {assertProtectedPaths} from './TongRuntimeSecurity.mjs';
const scope=new AsyncLocalStorage(),purpose='tong-login-recovery',self=fileURLToPath(import.meta.url);
const entryActions=new Set(['start','stop-run','reconcile-stale','status','doctor','preflight-login','supervise','child']);
const operations=['start','stop-run','reconcile-stale'],components=['agentdock','devspace','gateway'];
const fail=code=>new Error(code),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function prefix(root){
  if(root===PRODUCTION_ROOT)return 'production';
  if(typeof root!=='string'||win32.dirname(root)!=='D:\\Tong\\state'||!/^b23-[a-zA-Z0-9_-]{1,100}$/.test(win32.basename(root)))throw fail('APPROVAL_DENIED');
  return 'simulation-'+sha(root);
}
function formalOnly(root){
  prefix(root);
  if(root===PRODUCTION_ROOT&&(self.toLowerCase()!==join(root,'releases','manager','scripts','TongLoginRecovery.mjs').toLowerCase()||process.execPath.toLowerCase()!=='d:\\node\\node.exe'))throw fail('APPROVAL_DENIED');
}
export const loginRecoveryPath=root=>join(runtimeApprovalStore(root),prefix(root)+'.login-recovery.current.dpapi.json');
// Revocation history is protected metadata, not a secret envelope. Keeping it
// in logs preserves the runtime backup's ciphertext-only secrets invariant.
export const loginRecoveryAuditPath=root=>join(root===PRODUCTION_ROOT?join(root,'logs'):runtimeApprovalStore(root),prefix(root)+'.login-recovery.audit.jsonl');
export function loginRecoveryGrantId(){return scope.getStore()?.grantId;}
export function validateLoginRecoveryDescriptor(value){
  const runtimeProfile=validateProductionProfile(value?.runtimeProfile),managerProfile=validateProductionProfile(value?.managerProfile);
  if(runtimeProfile.root!==managerProfile.root||value.root!==runtimeProfile.root||!runtimeProfile.agentdockEnabled||managerProfile.agentdockEnabled
    ||!same({...runtimeProfile,sourceDigest:managerProfile.sourceDigest,releaseDigest:managerProfile.releaseDigest,agentdockEnabled:false},managerProfile)
    ||value.schemaVersion!==1||value.purpose!==purpose||!same(value.operations,operations)||!same(value.components,components)
    ||!/^[a-f0-9]{64}$/.test(value.runnerSha256??'')||Object.keys(value).sort().join(',')!=='components,managerProfile,operations,purpose,root,runnerSha256,runtimeProfile,schemaVersion')throw fail('APPROVAL_DENIED');
  prefix(value.root);return {schemaVersion:1,purpose,root:value.root,runtimeProfile,managerProfile,runnerSha256:value.runnerSha256,components,operations};
}
export async function loginRecoveryDescriptor(root){
  formalOnly(root);
  const paths=[root,join(root,'run'),join(root,'profile.json'),join(root,'run','release-pin.json'),join(root,'run','manager-pin.json')];await assertProtectedPaths(paths);
  const profile=validateProductionProfile(JSON.parse(await readFile(join(root,'profile.json'),'utf8')));
  if(profile.root!==root||!profile.agentdockEnabled)throw fail('APPROVAL_DENIED');
  const pinBytes=await readFile(join(root,'run','manager-pin.json')),pin=JSON.parse(pinBytes);
  const input={...(profile.mode==='production-simulation'?{simulationId:profile.simulationId,gatewayPort:profile.gatewayPort,upstreamPort:profile.upstreamPort,agentdockPort:profile.agentdockPort}:{}),sourceDigest:pin.files?.find(f=>f.path==='code/source.tar')?.sha256,releaseDigest:sha(pinBytes),agentdockEnabled:false};
  const managerProfile=profile.mode==='production'?createProductionProfile(input):createProductionSimulationProfile(input);
  await verifyRuntimeCandidate(profile);await verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:managerProfile});
  const critical=['TongLoginRecovery.mjs','TongProductionProfile.mjs','TongProductionApproval.ps1','TongAgentDockRuntime.mjs','TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1','TongRuntimeServer.mjs','TongLoginRuntime.ps1'];
  if(!/^[a-f0-9]{40}$/.test(pin.commit??'')||critical.some(name=>!pin.sourceFiles.some(file=>file.path==='scripts/'+name)))throw fail('CANDIDATE_DENIED');
  return validateLoginRecoveryDescriptor({schemaVersion:1,purpose,root,runtimeProfile:profile,managerProfile,runnerSha256:pin.sourceFiles.find(file=>file.path==='scripts/TongLoginRuntime.ps1').sha256,components,operations});
}
async function loadGrant(root,expectedId){
  formalOnly(root);
  try{
    const path=loginRecoveryPath(root);await assertRuntimeApprovalPaths(root,[path]);
    const grant=await runLoginRecoveryHelper('login-recovery-unseal',{path});
    const descriptor=validateLoginRecoveryDescriptor(grant.descriptor);
    if(grant.schemaVersion!==1||grant.purpose!==purpose||grant.enabled!==true||descriptor.root!==root
      ||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(grant.grantId??'')||expectedId!==undefined&&grant.grantId!==expectedId
      ||!Number.isFinite(Date.parse(grant.issuedAt))||Date.parse(grant.issuedAt)>Date.now()+5000||grant.expiresAt!==undefined
      ||Object.keys(grant).sort().join(',')!=='descriptor,enabled,grantId,issuedAt,purpose,schemaVersion')throw fail('APPROVAL_DENIED');
    const auditPath=loginRecoveryAuditPath(root);await assertRuntimeApprovalPaths(root,[auditPath]);
    const events=(await readFile(auditPath,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(event=>event.root===root&&event.grantId===grant.grantId);
    // A retained revocation also rejects an accidentally restored old envelope.
    // An interrupted enable without a committed audit cannot grant capability.
    if(!events.some(event=>event.event==='enabled'&&event.phase==='committed')||events.some(event=>event.event==='revoked'))throw fail('APPROVAL_DENIED');
    return Object.freeze({...grant,descriptor});
  }catch{throw fail('APPROVAL_DENIED');}
}
async function audit(root,event,action,grant){
  const path=loginRecoveryAuditPath(root);await assertRuntimeApprovalPaths(root);
  try{await assertRuntimeApprovalPaths(root,[path]);}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(path,JSON.stringify({at:new Date().toISOString(),event,action,root,grantId:grant?.grantId??null,runtimeReleaseDigest:grant?.descriptor.runtimeProfile.releaseDigest??null,managerReleaseDigest:grant?.descriptor.managerProfile.releaseDigest??null,pid:process.pid})+'\n',{flag:'a'});
  await assertRuntimeApprovalPaths(root,[path]);
}
// No environment variable enables this context. Each process must explicitly
// enter it with the CurrentUser sealed grant, then verify both pinned releases.
export async function withLoginRecovery(root,action,fn,{grantId}={}){
  formalOnly(root);if(!entryActions.has(action))throw fail('APPROVAL_DENIED');
  let grant;
  try{
    grant=await loadGrant(root,grantId);
    return await scope.run(grant,async()=>{
      await verifyRuntimeCandidate(grant.descriptor.runtimeProfile);await verifyRuntimeCandidate(grant.descriptor.runtimeProfile,{manager:true});
      if(operations.includes(action))await audit(root,'authorized',action,grant);
      return fn(grant);
    });
  }catch(error){
    // Missing/invalid grants cannot be used to create production state. Existing
    // protected stores retain denial evidence for actual recovery operations.
    if(operations.includes(action))await audit(root,'denied',action,grant);
    throw error;
  }
}
export async function recoveryApproval(profile,action){
  const current=scope.getStore();if(!current)return null;
  const grant=await loadGrant(current.descriptor.root,current.grantId),descriptor=grant.descriptor;
  const expected=action==='manager'?descriptor.managerProfile:descriptor.runtimeProfile;
  if(!['start','stop','manager','enable-agentdock'].includes(action)||!same(validateProductionProfile(profile),expected))throw fail('APPROVAL_DENIED');
  return Object.freeze({...grant,profile:expected,action,agentdockEnabled:expected.agentdockEnabled});
}
export async function recoveryProfile(root,action){
  const current=scope.getStore();if(!current)return null;
  if(root!==current.descriptor.root)throw fail('APPROVAL_DENIED');
  const profile=action==='manager'?current.descriptor.managerProfile:current.descriptor.runtimeProfile;
  await recoveryApproval(profile,action);return profile;
}
export async function issueSimulationLoginRecovery(profile){
  profile=validateProductionProfile(profile);if(profile.mode!=='production-simulation')throw fail('SIMULATION_ONLY');
  const descriptor=await loginRecoveryDescriptor(profile.root);
  if(!same(descriptor.runtimeProfile,profile))throw fail('APPROVAL_DENIED');
  return runLoginRecoveryHelper('login-recovery-simulation',{descriptor,enabled:true});
}
export async function revokeSimulationLoginRecovery(root){
  if(root===PRODUCTION_ROOT)throw fail('SIMULATION_ONLY');
  const grant=await loadGrant(root);
  return runLoginRecoveryHelper('login-recovery-simulation',{descriptor:grant.descriptor,enabled:false,grantId:grant.grantId});
}
