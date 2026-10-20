import {mkdir,cp,copyFile,readFile,writeFile,rename} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProductionSimulationProfile} from '../../scripts/TongProductionProfile.mjs';
import {assertProtectedPaths,processIdentity,runtimeJobState,sameProcess} from '../../scripts/TongRuntimeSecurity.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function loginFixture({full=false,sharedDependencies=false,ports={},reuseRoot,dependencyRoot=project}={}){
  const simulationId=reuseRoot?basename(reuseRoot):'b23-login-'+randomUUID().replaceAll('-','');
  const initial=createProductionSimulationProfile({simulationId,...ports,sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64),agentdockEnabled:true});
  const root=initial.root;
  // Only this newly created runtime fixture needs the runtime's restricted ACL.
  // Ordinary state and the separate simulation receipt store stay sandbox-writable.
  if(reuseRoot){
    if(resolve(reuseRoot)!==root||!/^b23-login-[a-f0-9]{32}$/.test(simulationId))throw Error('FIXTURE_REUSE_SCOPE');
    await assertProtectedPaths([root,join(root,'run'),initial.codeRoot,initial.managerRoot]);
    const previous=JSON.parse(await readFile(join(root,'run','manager-pin.json'),'utf8'));
    if(previous.commit!=='c'.repeat(40))throw Error('FIXTURE_REUSE_NOT_SYNTHETIC');
    const record=JSON.parse(await readFile(join(root,'run','runtime.json'),'utf8'));
    const guardian=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));
    if(!['stopped','abnormal_exit'].includes(record.phase)||!guardian.finishedAt||guardian.jobAssigned!==true||guardian.killOnJobClose!==true||guardian.jobActiveAfterCleanup!==0||guardian.jobName!==`Local\\TongRuntime-${record.runId}`||(await runtimeJobState(record.runId)).activeProcesses!==0)throw Error('FIXTURE_REUSE_JOB_BUSY');
    for(const identity of [guardian,record.supervisor,...record.children,...record.descendants])if(sameProcess(await processIdentity(identity.pid),identity))throw Error('FIXTURE_REUSE_PROCESS_BUSY');
    const retained=join(root,'retained-'+randomUUID());await mkdir(retained);
    await cp(join(initial.codeRoot,'scripts'),join(retained,'app-scripts'),{recursive:true});
    await cp(join(initial.managerRoot,'scripts'),join(retained,'manager-scripts'),{recursive:true});
    await rename(join(root,'run'),join(retained,'run')); // Both paths verified within this synthetic root.
  }else await mkdir(root);
  const encoded=Buffer.from(root).toString('base64');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
  const protectedRoot=reuseRoot?{status:0}:spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid); foreach($allow in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($allow),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}; Set-Acl -LiteralPath $target -AclObject $acl`],{env,encoding:'utf8',windowsHide:true,timeout:10000});
  if(protectedRoot.status!==0)throw Error('FIXTURE_ACL_FAILED:'+protectedRoot.stderr);
  for(const dir of ['backend-state','workspace','tong-policy/agentdock-operations','secrets','run','logs','temp','home','releases','tong/runtime','tong/demo-workspace','tong/home/.devspace','tong/oauth'])await mkdir(join(root,dir),{recursive:true});
  const git=spawnSync('git',['ls-files','scripts'],{cwd:project,encoding:'utf8',windowsHide:true});
  if(git.status!==0)throw Error('FIXTURE_SOURCE_INVENTORY_FAILED');
  const names=git.stdout.trim().split(/\r?\n/);
  // New source under test is explicitly included before it is committed.
  if(!names.includes('scripts/TongLoginRecovery.mjs'))names.push('scripts/TongLoginRecovery.mjs');
  const files=[];
  for(const path of names){
    const bytes=await readFile(join(project,path));files.push({path,size:bytes.length,sha256:sha(bytes)});
    for(const target of [initial.codeRoot,initial.managerRoot]){await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),bytes);}
  }
  const hashes={};
  // One ordinary, isolated dependency tree can serve both fixture releases.
  // Keep each release's relative DevSpace imports and pinned patch files local.
  if(full&&sharedDependencies&&!reuseRoot)await cp(join(dependencyRoot,'node_modules'),join(root,'node_modules'),{recursive:true,force:false,errorOnExist:true});
  for(const target of [initial.codeRoot,initial.managerRoot]){
    if(full&&sharedDependencies){if(!reuseRoot)await cp(join(dependencyRoot,'node_modules','@waishnav','devspace'),join(target,'node_modules','@waishnav','devspace'),{recursive:true,force:false,errorOnExist:true});}
    else if(full)await cp(join(dependencyRoot,'node_modules'),join(target,'node_modules'),{recursive:true,force:false,errorOnExist:true});
    else for(const name of ['pi-tools.js','server.js','workspaces.js']){
      const path=join('node_modules','@waishnav','devspace','dist',name);await mkdir(dirname(join(target,path)),{recursive:true});await copyFile(join(dependencyRoot,path),join(target,path));
    }
  }
  for(const name of ['pi-tools.js','server.js','workspaces.js'])hashes[name]=sha(await readFile(join(dependencyRoot,'node_modules','@waishnav','devspace','dist',name)));
  const node={executable:process.execPath,version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch,sha256:sha(await readFile(process.execPath))};
  // Controlled manifests bind the final working-tree bytes. These fixtures are
  // not production releases and cannot mint any production permission.
  const manifest={schemaVersion:1,commit:'c'.repeat(40),files:[{path:'code/source.tar',sha256:'a'.repeat(64)}],sourceFiles:files,native:[],versions:{},expectedDevspaceHashes:hashes,node};
  const pin=JSON.stringify(manifest),releaseDigest=sha(pin);
  const profile=createProductionSimulationProfile({simulationId,...ports,sourceDigest:'a'.repeat(64),releaseDigest,agentdockEnabled:true});
  await writeFile(join(root,'run','release-pin.json'),pin);await writeFile(join(root,'run','manager-pin.json'),pin);
  await writeFile(join(root,'profile.json'),JSON.stringify(profile));await writeFile(join(root,'production-root.json'),JSON.stringify({schemaVersion:1,mode:profile.mode,root}));
  const managerProfile=createProductionSimulationProfile({simulationId,...ports,sourceDigest:'a'.repeat(64),releaseDigest,agentdockEnabled:false});
  return {root,profile,managerProfile,project};
}
