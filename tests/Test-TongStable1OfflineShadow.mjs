// One fixed, inert destination. Never executes captured product code or applies
// captured task/service definitions. Requires this run's explicit 2.5GB grant.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const ops='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\offline-9850e1a';
const snapshot=join(ops,'production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956');
const seal='db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f';
const shadow=join(ops,'production-shadow'),script=fileURLToPath(new URL('../scripts/TongStable1Offline.ps1',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex'),commands=[];
assert.equal(process.argv[2],'--approved-2500000000','This fixed run requires the existing explicit resource grant.');
await assert.rejects(lstat(join(ops,'shadow-result.json')),{code:'ENOENT'});
async function restore(){
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Mode','RestoreShadow','-Snapshot',snapshot,'-ExpectedSeal',seal,'-ResourceBudgetBytes','2500000000'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>{out+=b;process.stdout.write(b);});child.stderr.on('data',b=>err+=b);
 const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});
 commands.push({workerPid:child.pid,code,stdout:out,stderr:err});await writeFile(join(ops,'shadow-commands.json'),JSON.stringify(commands,null,2)+'\n');
 assert.equal(code,0,err);const result=JSON.parse(out.trim().split(/\r?\n/).at(-1));assert.equal(result.operation,'shadow-restored');assert.equal(result.files,77485);assert.equal(result.productionWrite,false);assert.equal(result.noActivation,true);return result;
}
const initial=await restore();
const relative=['manager/scripts/TongAgentDockRuntime.mjs','app/runtime/agent-tasks.json','oauth/devspace.sqlite','secrets/agentdock.dpapi','binding/profile.json','control/runtime.json','monitor/TongLoginHost.exe'];
const originals={};for(const rel of relative){const p=join(shadow,rel);originals[rel]=sha(await readFile(p));await writeFile(p,'INTERRUPTED_SHADOW_BYTES');}
const extras=['app/scripts/offline-candidate-added.mjs','manager/scripts/offline-candidate-added.mjs','control/offline-added.json','binding/offline-added.json'];
for(const rel of extras){await mkdir(join(shadow,rel,'..'),{recursive:true});await writeFile(join(shadow,rel),'candidate-only');}
const restored=await restore();assert.notEqual(restored.workerPid,initial.workerPid);assert.equal(restored.gateFileKey,initial.gateFileKey);
for(const [rel,expected] of Object.entries(originals))assert.equal(sha(await readFile(join(shadow,rel))),expected,rel);
for(const rel of extras)await assert.rejects(lstat(join(shadow,rel)),{code:'ENOENT'});
assert.equal(restored.taskXmlSha256,initial.taskXmlSha256);assert.equal(restored.externalConfigRecovered,true);
const result={at:new Date().toISOString(),passed:true,snapshot,seal,initial,restored,independentWorkerProcesses:true,all77485FileBytesVerified:true,managerImported:false,damagedRelativePaths:relative,addedFilesRetired:extras,oauthBusinessAndDpapiCiphertextExact:true,externalConfigRecovered:true,externalTaskServiceDefinitionsApplied:false,originalAbsolutePathsApplied:false,sourceProductionWrite:false,activationTested:false,resourceApprovalBytes:2500000000};
await writeFile(join(ops,'shadow-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
