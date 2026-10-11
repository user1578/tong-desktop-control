import { spawn } from 'node:child_process';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { win32, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertProtectedPaths } from './TongRuntimeSecurity.mjs';

export const PRODUCTION_ROOT = 'D:\\tong-agentdock-local';
export const PRODUCTION_SIMULATION_STATE_ROOT = 'D:\\agentdock-poc-20261010\\isolated\\state';
export const PRODUCTION_APPROVAL_STORE = win32.join(PRODUCTION_SIMULATION_STATE_ROOT, 'b23-production-approvals');
const helper = fileURLToPath(new URL('TongProductionApproval.ps1', import.meta.url));
const actions = new Set(['init','start','stop','enable-agentdock','disable-agentdock','backup','restore','manager']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => new Error(code);
const production = {
  schemaVersion:1, mode:'production', root:PRODUCTION_ROOT, codeRoot:'D:\\tong-desktop-control', originalTongRoot:'D:\\tong-desktop-control',
  originalStateRoot:'D:\\tong-desktop-control\\runtime', runtimeDir:'D:\\tong-desktop-control\\runtime', demoRoot:'D:\\tong-desktop-control\\demo-workspace',
  stageRoot:PRODUCTION_ROOT+'\\releases\\candidate', managerRoot:PRODUCTION_ROOT+'\\releases\\manager', configDir:'C:\\Users\\Rune\\.devspace', oauthStateDir:'C:\\Users\\Rune\\.local\\share\\devspace',
  publicOrigin:'https://retold-pointer-irregular.ngrok-free.dev', host:'127.0.0.1', gatewayPort:7676, upstreamPort:7677, agentdockPort:18765,
};
function digestInputs(input, allowed) {
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) || !/^[a-f0-9]{64}$/.test(input.sourceDigest ?? '') || !/^[a-f0-9]{64}$/.test(input.releaseDigest ?? '')
    || input.agentdockEnabled !== undefined && typeof input.agentdockEnabled !== 'boolean') throw fail('PROFILE_DENIED');
  return {sourceDigest:input.sourceDigest,releaseDigest:input.releaseDigest,agentdockEnabled:input.agentdockEnabled ?? false};
}
export function createProductionProfile(input) { return Object.freeze({...production,...digestInputs(input,['sourceDigest','releaseDigest','agentdockEnabled'])}); }
function simulationTopology(simulationId, gatewayPort = 17876, upstreamPort = 17877, agentdockPort = 18766) {
  if (typeof simulationId !== 'string' || !/^b23-[a-zA-Z0-9_-]{1,100}$/.test(simulationId)) throw fail('PROFILE_DENIED');
  const ports=[gatewayPort,upstreamPort,agentdockPort];
  if (new Set(ports).size!==3 || ports.some(port=>!Number.isInteger(port)||port<1024||port>65535||[7676,7677,18765].includes(port))) throw fail('PROFILE_DENIED');
  const root=win32.join(PRODUCTION_SIMULATION_STATE_ROOT,simulationId), codeRoot=win32.join(root,'tong'), runtimeDir=win32.join(codeRoot,'runtime');
  return {schemaVersion:1,mode:'production-simulation',simulationId,root,codeRoot,originalTongRoot:codeRoot,originalStateRoot:runtimeDir,runtimeDir,
    demoRoot:win32.join(codeRoot,'demo-workspace'),stageRoot:win32.join(root,'releases','candidate'),managerRoot:win32.join(root,'releases','manager'),configDir:win32.join(codeRoot,'home','.devspace'),oauthStateDir:win32.join(codeRoot,'oauth'),
    publicOrigin:`http://127.0.0.1:${gatewayPort}`,host:'127.0.0.1',gatewayPort,upstreamPort,agentdockPort};
}
export function createProductionSimulationProfile(input) {
  const digests=digestInputs(input,['simulationId','sourceDigest','releaseDigest','agentdockEnabled','gatewayPort','upstreamPort','agentdockPort']);
  return Object.freeze({...simulationTopology(input.simulationId,input.gatewayPort,input.upstreamPort,input.agentdockPort),...digests});
}
export function validateProductionProfile(profile) {
  if (!profile || typeof profile!=='object' || Array.isArray(profile)) throw fail('PROFILE_DENIED');
  let expected;
  if (profile.mode==='production') expected=createProductionProfile({sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,agentdockEnabled:profile.agentdockEnabled});
  else if (profile.mode==='production-simulation') expected=createProductionSimulationProfile({simulationId:profile.simulationId,sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,agentdockEnabled:profile.agentdockEnabled,gatewayPort:profile.gatewayPort,upstreamPort:profile.upstreamPort,agentdockPort:profile.agentdockPort});
  else throw fail('PROFILE_DENIED');
  if (Object.keys(profile).length!==Object.keys(expected).length || Object.entries(expected).some(([key,value])=>profile[key]!==value)) throw fail('PROFILE_DENIED');
  return expected;
}
export function productionProfileDigest(profile) { return hash(validateProductionProfile(profile)); }
export function runtimeApprovalPath(profile,action) {
  if (!actions.has(action)) throw fail('APPROVAL_DENIED');
  return win32.join(PRODUCTION_APPROVAL_STORE,productionProfileDigest(profile)+'.'+action+'.dpapi.json');
}
function approvedProfileIndex(root,action) {
  if(!actions.has(action)) throw fail('APPROVAL_DENIED');
  let prefix='production';
  if(root!==PRODUCTION_ROOT) {
    if(typeof root!=='string' || !root.startsWith(PRODUCTION_SIMULATION_STATE_ROOT+'\\') || win32.dirname(root)!==PRODUCTION_SIMULATION_STATE_ROOT
      || !/^b23-[a-zA-Z0-9_-]{1,100}$/.test(win32.basename(root))) throw fail('PROFILE_DENIED');
    prefix='simulation-'+createHash('sha256').update(root).digest('hex');
  }
  return win32.join(PRODUCTION_APPROVAL_STORE,prefix+'.'+action+'.current.dpapi.json');
}
// Bootstrap never reads the requested runtime root. Its only I/O is the fixed protected receipt store.
export async function loadApprovedProfile(root,action) {
  const path=approvedProfileIndex(root,action);
  try {
    await assertProtectedPaths([PRODUCTION_SIMULATION_STATE_ROOT,PRODUCTION_APPROVAL_STORE,path]);
    const sealed=await run('receipt-unseal',{path}),profile=validateProductionProfile(sealed.profile);
    if(profile.root!==root || sealed.action!==action || sealed.profileDigest!==productionProfileDigest(profile)) throw fail('APPROVAL_DENIED');
    const verified=await verifyRuntimeApproval(profile,action);
    if(JSON.stringify(sealed)!==JSON.stringify(verified)) throw fail('APPROVAL_DENIED');
    return profile;
  } catch {throw fail('APPROVAL_DENIED');}
}
export function getApprovedProductionProfile(action) {return loadApprovedProfile(PRODUCTION_ROOT,action);}
function descriptor(profile,action) {
  const valid=validateProductionProfile(profile);
  if (!actions.has(action)) throw fail('APPROVAL_DENIED');
  if (action==='enable-agentdock' && !valid.agentdockEnabled || action==='disable-agentdock' && valid.agentdockEnabled) throw fail('APPROVAL_DENIED');
  return {...valid,profileDigest:productionProfileDigest(valid),action,receiptPath:runtimeApprovalPath(valid,action),approvalStore:PRODUCTION_APPROVAL_STORE};
}
function run(mode,input) {
  if (process.platform!=='win32') throw fail('APPROVAL_DENIED');
  const keys = new Set(['SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PROGRAMDATA','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>keys.has(key.toUpperCase())));
  return new Promise((accept,reject)=>{
    const child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode],{windowsHide:true,env,stdio:['pipe','pipe','ignore']});
    let out='',bytes=0; const timer=setTimeout(()=>child.kill(),25000);
    child.stdin.on('error',()=>{}); child.stdin.end(JSON.stringify(input));
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144)child.kill();else out+=chunk;});
    child.once('error',()=>{clearTimeout(timer);reject(fail(mode==='init-root'?'ROOT_DENIED':'APPROVAL_DENIED'));});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||bytes>262144)return reject(fail(mode==='init-root'?'ROOT_DENIED':'APPROVAL_DENIED'));try{accept(JSON.parse(out));}catch{reject(fail('APPROVAL_DENIED'));}});
  });
}
export async function verifyRuntimeApproval(profile,action) {
  const expected=descriptor(profile,action);
  try {
    await assertProtectedPaths([PRODUCTION_SIMULATION_STATE_ROOT,PRODUCTION_APPROVAL_STORE,expected.receiptPath]);
    const actual=await run('receipt-unseal',{path:expected.receiptPath});
    if (actual.schemaVersion!==1 || actual.purpose!=='tong-runtime-permission' || actual.scope!=='CurrentUser' || actual.mode!==expected.mode || actual.root!==expected.root
      || actual.action!==action || actual.profileDigest!==expected.profileDigest || actual.sourceDigest!==expected.sourceDigest || actual.releaseDigest!==expected.releaseDigest
      || actual.agentdockEnabled!==expected.agentdockEnabled || actual.expiresAt<=new Date().toISOString() || !Number.isFinite(Date.parse(actual.expiresAt))
      || !Number.isFinite(Date.parse(actual.issuedAt)) || Date.parse(actual.issuedAt)>Date.now()+5000 || Date.parse(actual.expiresAt)-Date.parse(actual.issuedAt)>3600000
      || productionProfileDigest(actual.profile)!==expected.profileDigest) throw fail('APPROVAL_DENIED');
    return Object.freeze(actual);
  } catch { throw fail('APPROVAL_DENIED'); }
}
// Deliberately cannot issue a production receipt. This is only a sealed PoC permission fixture.
export async function issueSimulationApproval(profile,action,{expiresAt=new Date(Date.now()+600000).toISOString()}={}) {
  const valid=validateProductionProfile(profile);
  if (valid.mode!=='production-simulation') throw fail('SIMULATION_ONLY');
  const expected=descriptor(valid,action);
  const expires=Date.parse(expiresAt);
  if (!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+3600000) throw fail('APPROVAL_DENIED');
  return run('receipt-simulation',{profile:valid,action,expiresAt:new Date(expires).toISOString(),descriptor:expected});
}
export async function initializeProductionRoot(profile) {
  const valid=validateProductionProfile(profile);
  await verifyRuntimeApproval(valid,'init'); // Must happen before even lstat/readdir of the target root.
  return run('init-root',{profile:valid,action:'init'});
}
export async function recordApprovedEnabledState(profile) {
  const valid=validateProductionProfile(profile), action=valid.agentdockEnabled?'enable-agentdock':'disable-agentdock';
  await verifyRuntimeApproval(valid,action);
  const path=win32.join(PRODUCTION_APPROVAL_STORE,productionProfileDigest(valid)+'.enabled.dpapi.json');
  try {
    try { const old=await lstat(path); if (!old.isFile()||old.nlink!==1) throw fail('APPROVAL_DENIED'); await assertProtectedPaths([path]); } catch(error){if(error.code!=='ENOENT')throw error;}
    await writeFile(path,await readFile(runtimeApprovalPath(valid,action)),{flag:'wx'});
    await assertProtectedPaths([path]);
    return {path,agentdockEnabled:valid.agentdockEnabled,profileDigest:productionProfileDigest(valid)};
  } catch { throw fail('APPROVAL_DENIED'); }
}
export async function readApprovedEnabledState(profile) {
  const valid=validateProductionProfile(profile),action=valid.agentdockEnabled?'enable-agentdock':'disable-agentdock';
  await verifyRuntimeApproval(valid,action);
  const path=win32.join(PRODUCTION_APPROVAL_STORE,productionProfileDigest(valid)+'.enabled.dpapi.json');
  try {await assertProtectedPaths([path]);const actual=await run('receipt-unseal',{path});if(actual.profileDigest!==productionProfileDigest(valid)||actual.action!==action||actual.agentdockEnabled!==valid.agentdockEnabled)throw fail('APPROVAL_DENIED');return actual;}
  catch {throw fail('APPROVAL_DENIED');}
}

// The private PS helper asks this module to validate full descriptors; no configurable production root exists.
if (process.argv[1] && win32.resolve(process.argv[1]).toLowerCase()===win32.resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  try {
    const [command,encoded,action]=process.argv.slice(2),profile=JSON.parse(Buffer.from(encoded??'','base64').toString('utf8'));
    if(command==='--approval-descriptor') console.log(JSON.stringify(descriptor(profile,action)));
    else if(command==='--verify-approval-profile') {await verifyRuntimeApproval(profile,action); console.log(JSON.stringify(descriptor(profile,action)));}
    else throw fail('APPROVAL_DENIED');
  } catch {console.error('Production approval refused');process.exitCode=2;}
}
