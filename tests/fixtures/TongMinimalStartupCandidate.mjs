import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const startupBase='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';
export const startupReference='34e26801876d8b1a2fc874dddce72b0939924e87';
const project=fileURLToPath(new URL('../../',import.meta.url));
const names=['TongAgentDockRuntime.mjs','TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1','TongStartupProtocol.ps1','TongRuntimeSecurity.mjs','TongRuntimeSecurity.ps1','TongLoginRecovery.mjs'];
const section=(text,start,end)=>{assert.equal(text.split(start).length,2);assert.equal(text.split(end).length,2);return text.slice(text.indexOf(start),text.indexOf(end));};
const replace=(text,from,to)=>{assert.equal(text.split(from).length,2,from);return text.replace(from,()=>to);};

// Test/review assembly only. Reuse the seven-file startup dependency closure,
// exclude all later maintenance/handoff/port/freeze platforms and offline tools.
// No installation, production I/O, authorization or release signing is offered.
export async function minimalStartupSources(){
  const result={};
  for(const name of names){
    const blob=spawnSync('git',['show',`${startupReference}:scripts/${name}`],{cwd:project,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});
    assert.equal(blob.status,0);result['scripts/'+name]=blob.stdout.replaceAll('\r\n','\n');
  }
  const runtime=(await readFile(new URL('../../scripts/TongAgentDockRuntime.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  let start=section(runtime,'export async function startRuntime(','export async function stopRuntime(');
  start=replace(start,'{startupTimeoutMs,onRequest,handoffId}={}','{startupTimeoutMs}={}');
  start=replace(start,"  if(onRequest!==undefined&&typeof onRequest!=='function')throw fail('INVALID_REQUEST_OBSERVER');\n",'');
  start=replace(start,"freeze(root,{handoffId,profile,action:'start'})",'freeze(root)');
  start=replace(start,'runtimeStatus(root,{diagnostics:true})','runtimeStatus(root)');
  start=replace(start,",...(handoffId?{handoff:{sessionId:handoffId,profileDigest:productionProfileDigest(profile)}}:{})",'');
  start=replace(start,'    // Maintenance persists this identity before the launcher can create a tree.\n    if(onRequest)await onRequest({runId});\n','');
  const original=result['scripts/TongAgentDockRuntime.mjs'];
  result['scripts/TongAgentDockRuntime.mjs']=replace(original,section(original,'export async function startRuntime(','export async function stopRuntime('),start);
  const budget=section(runtime,'// Production request->DevSpace','export function readinessPolicy(');
  result['scripts/TongAgentDockRuntime.mjs']=replace(result['scripts/TongAgentDockRuntime.mjs'],'export function readinessPolicy(',budget+'export function readinessPolicy(');
  result['scripts/TongAgentDockRuntime.mjs']=replace(result['scripts/TongAgentDockRuntime.mjs'],section(original,'  async function managed(','  async function shutdown('),section(runtime,'  async function managed(','  async function shutdown('));
  const guardian=(await readFile(new URL('../../scripts/TongRuntimeGuardian.ps1',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const oldGuardian=result['scripts/TongRuntimeGuardian.ps1'];
  const preflight="    Assert-TongStartupActive\n    $stage='preflight'\n",approved='    $approvedRoot=$true';
  result['scripts/TongRuntimeGuardian.ps1']=replace(oldGuardian,section(oldGuardian,preflight,approved),section(guardian,preflight,approved));
  const request="    $stage='read-request'\n    $request=",createJob="    $stage='create-job'\n";
  result['scripts/TongRuntimeGuardian.ps1']=replace(result['scripts/TongRuntimeGuardian.ps1'],section(oldGuardian,request,createJob),section(guardian,request,createJob));
  let protocol=result['scripts/TongStartupProtocol.ps1'];
  protocol=replace(protocol,' public TongStartupPreflight(string name,string exe,string args,string cwd) {',' public int Pid {get;private set;}\n public string StartTicks {get;private set;}\n public TongStartupPreflight(string name,string exe,string args,string cwd) {');
  protocol=replace(protocol,'   process=info.process;','   process=info.process;\n   Pid=(int)info.pid;long a,b,c,d;Check(GetProcessTimes(process,out a,out b,out c,out d),"PREFLIGHT_IDENTITY_FAILED");StartTicks=(DateTime.FromFileTimeUtc(a).Ticks/10*10).ToString();');
  const workingProtocol=(await readFile(new URL('../../scripts/TongStartupProtocol.ps1',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  protocol=replace(protocol,section(protocol,'function Invoke-TongStartupPreflight(','function Complete-TongStartupFailure('),section(workingProtocol,'function Invoke-TongStartupPreflight(','function Complete-TongStartupFailure('));
  result['scripts/TongStartupProtocol.ps1']=protocol;
  return result;
}
