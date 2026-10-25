// Finite deployment rehearsal worker. No production target, real secrets,
// Task mutation, installer or recovery-platform entry point is implemented.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,cp,symlink,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {loginFixture,sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {minimalStartupSources,startupBase} from './fixtures/TongMinimalStartupCandidate.mjs';
import {buildRelease,verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {createProductionSimulationProfile} from '../scripts/TongProductionProfile.mjs';
import {protectSecret,processIdentity,sameProcess,startupJobsState,runtimeProcessInventory} from '../scripts/TongRuntimeSecurity.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const existing='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const action=process.argv[2],inputRoot=process.argv[3]??(action!=='prepare'?(await json(join(project,'artifacts/024-recovery/seven-file-prep-current.local.json'))).root:undefined);
function git(args,{input,env}={}){const r=spawnSync('git',args,{cwd:project,input,env:env??process.env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function privateCommit(root,parent,files,label){
  const env={...process.env,GIT_INDEX_FILE:join(root,label+'.index')};
  git(['read-tree',parent],{env});
  for(const [path,bytes] of Object.entries(files)){const blob=git(['hash-object','-w','--stdin'],{input:bytes});git(['update-index','--add','--cacheinfo','100644,'+blob+','+path],{env});}
  const tree=git(['write-tree'],{env});return git(['commit-tree',tree,'-p',parent,'-m',label]);
}
async function checkRoot(root){assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);const marker=await json(join(root,'seven-file-preparation.json'));assert.equal(marker.scope,'seven-file-preparation-isolation');assert.equal(marker.root,root);assert.equal(marker.releaseRoot,join(root,'seven-file-release'));return marker;}
if(action==='prepare'){
  const seven=await minimalStartupSources(),review=await json(join(project,'docs/evidence/024-startup-minimal-fix-20261026/CANDIDATE-MANIFEST.json'));
  for(const item of review.files)assert.equal(sha(seven[item.path]),item.candidateSha256);
  const oldProfile=await json(join(existing,'profile.json')),oldPin=await json(join(existing,'run/release-pin.json'));
  assert.equal(oldProfile.mode,'production-simulation');assert.equal(oldPin.commit,startupBase);assert.equal(oldPin.sourceFiles.length,283);assert.equal(oldPin.native.length,23);
  let fixture;
  if(inputRoot){assert.match(inputRoot,/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);const profile=await json(join(inputRoot,'profile.json')),pin=await json(join(inputRoot,'run/release-pin.json'));assert.equal(profile.mode,'production-simulation');assert.equal(pin.commit,'c'.repeat(40));for(const item of review.files)assert.equal(sha(await readFile(join(profile.managerRoot,item.path))),item.candidateSha256);fixture={root:inputRoot,profile};}
  else fixture=await loginFixture({sourceRef:startupBase,sourceOverrides:seven,ports:{gatewayPort:29676,upstreamPort:29677,agentdockPort:29675}});
  const {root}=fixture;
  process.env.TEMP=process.env.TMP=join(root,'temp');
  const exactCommit=await privateCommit(root,startupBase,seven,'seven-file-review-candidate');
  const relocated={};
  for(const name of ['TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1']){
    const path='scripts/'+name,source=seven[path];
    assert.ok(source.includes('D:\\Tong\\runtime'));
    relocated[path]=source.replaceAll('D:\\Tong\\runtime\\releases\\manager\\scripts\\TongAgentDockRuntime.mjs',join(fixture.profile.managerRoot,'scripts','TongAgentDockRuntime.mjs')).replaceAll('D:\\Tong\\runtime',root);
  }
  const testCommit=await privateCommit(root,exactCommit,relocated,'seven-file-isolated-fixed-root-relocation');
  const releaseRoot=join(root,'seven-file-release');
  await writeFile(join(root,'preparation-progress.json'),JSON.stringify({root,exactCommit,testCommit,stage:'before-release'}));
  const gitExecutable=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe');
  const release=await buildRelease({codeRoot:'D:\\Tong\\development\\tong-desktop-control',commit:testCommit,releaseRoot,gitExecutable,pythonExecutable:'C:\\Program Files\\Python311\\python.exe'});
  assert.equal(release.sourceFiles.length,284);assert.equal(release.native.length,23);
  for(const file of oldPin.sourceFiles){const actual=await readFile(join(oldProfile.codeRoot,file.path));assert.equal(sha(actual),file.sha256,'original2 source: '+file.path);}
  for(const target of [fixture.profile.codeRoot,fixture.profile.managerRoot]){
    for(const file of release.sourceFiles){const dest=join(target,file.path);await mkdir(dirname(dest),{recursive:true});await copyFile(join(releaseRoot,'code/source',file.path),dest);}
    for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty'])await cp(join(oldProfile.codeRoot,'node_modules',name),join(target,'node_modules',name),{recursive:true});
    for(const file of release.native)assert.equal(sha(await readFile(join(target,file.path))),file.sha256);
  }
  await symlink(join(existing,'node_modules'),join(root,'node_modules'),'junction');
  const pinBytes=await readFile(join(releaseRoot,'release-manifest.json'));
  const profile=createProductionSimulationProfile({simulationId:fixture.profile.simulationId,gatewayPort:29676,upstreamPort:29677,agentdockPort:29675,sourceDigest:release.files.find(x=>x.path==='code/source.tar').sha256,releaseDigest:sha(pinBytes),agentdockEnabled:true});
  for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
  await writeFile(join(root,'profile.json'),JSON.stringify(profile));
  await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
  await writeFile(join(root,'tong-policy/agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
  await writeFile(join(profile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
  await writeFile(join(profile.configDir,'auth.json'),'{}');await mkdir(join(profile.codeRoot,'config'),{recursive:true});await writeFile(join(profile.codeRoot,'config/tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
  const marker={scope:'seven-file-preparation-isolation',root,exactCommit,testCommit,releaseRoot,sourceFiles:284,nativeFiles:23,seven:review.files,relocated:Object.keys(relocated),baselineBackupReused:true,realCredentialsUsed:false};
  await writeFile(join(root,'seven-file-preparation.json'),JSON.stringify(marker,null,2));
  await writeFile(join(project,'artifacts/024-recovery/seven-file-prep-current.local.json'),JSON.stringify(marker,null,2));
  const login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));await login.issueSimulationLoginRecovery(profile);
  console.log(JSON.stringify(marker));
}else{
  const marker=await checkRoot(inputRoot),root=inputRoot,profile=await json(join(root,'profile.json'));
  assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,root);assert.equal(profile.codeRoot,join(root,'tong'));assert.equal(profile.managerRoot,join(root,'releases/manager'));
  process.env.TEMP=process.env.TMP=join(root,'temp');
  const runtime=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongAgentDockRuntime.mjs'))),login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));
  if(action==='status'){
    const state=await runtime.runtimeStatus(root),doctor=await login.withLoginRecovery(root,'doctor',()=>runtime.runtimeDoctor(root));
    const launcher=await json(join(root,'run',`launcher.${state.runId}.json`)),guardian=await json(join(root,'run',`guardian.${state.runId}.json`));
    assert.equal(state.phase,'ready');assert.equal(doctor.healthy,true);assert.equal(state.sourceCommit,marker.testCommit);assert.equal(state.managerCommit,marker.testCommit);
    for(const r of [launcher,guardian]){assert.equal(r.preflight.exitCode,0);assert.equal(r.preflightClean,true);assert.ok(r.preflight.child.startTicks);}
    console.log(JSON.stringify({phase:state.phase,runId:state.runId,healthy:doctor.healthy,health:doctor.health,supervisor:state.supervisor,children:state.children,guardian:await json(join(root,'run/guardian.json')),launcher,guardianReceipt:guardian}));
  }else if(action==='stop'||action==='verify-stopped'){
    const state=await runtime.runtimeStatus(root);
    if(action==='verify-stopped'){assert.equal(state.phase,'stopped');assert.equal(state.supervisorAlive,false);}
    if(state.supervisorAlive)await login.withLoginRecovery(root,'stop-run',()=>runtime.stopRuntime(root,{expectedRunId:state.runId}));
    const after=await runtime.runtimeStatus(root),g=await json(join(root,'run/guardian.json'));
    assert.equal(after.supervisorAlive,false);assert.equal(g.jobActiveAfterCleanup,0);assert.ok(g.finishedAt);
    for(const p of [g,after.supervisor,...after.children,...after.descendants])assert.equal(sameProcess(await processIdentity(p.pid),p),false);
    assert.deepEqual(await startupJobsState(after.runId),{owner:0,launcher:0,guardian:0,runtime:0});
    const inventory=await runtimeProcessInventory({roots:[root],runIds:[after.runId],mode:profile.mode});assert.equal(inventory.complete,true);assert.equal(inventory.matchingProcesses.length,0);
    console.log(JSON.stringify({stopped:true,runId:after.runId,phase:after.phase,allExactIdentitiesGone:true,fourJobsEmpty:true,inventoryEmpty:true}));
  }else if(action==='grant'){await login.issueSimulationLoginRecovery(profile);console.log(JSON.stringify({syntheticGrantEnabled:true}));}
  else if(action==='revoke'){await login.revokeSimulationLoginRecovery(root);console.log(JSON.stringify({revoked:true}));}
  else if(action==='seal-exact-release'){
    let testManifest;try{testManifest=await readFile(join(root,'test-release-manifest.json'));}catch(error){if(error.code!=='ENOENT')throw error;testManifest=await readFile(join(marker.releaseRoot,'release-manifest.json'));await writeFile(join(root,'test-release-manifest.json'),testManifest);await copyFile(join(marker.releaseRoot,'code/source.tar'),join(root,'test-source.tar'));}
    const seven=await minimalStartupSources();
    git(['archive','--format=tar','--output='+join(marker.releaseRoot,'code/source.tar'),marker.exactCommit]);
    // Git archive applies this repository's checkout EOL conversion. Bind the
    // actual archive bytes; never write LF blobs then claim they match CRLF.
    const extraction=spawnSync('C:\\Program Files\\Python311\\python.exe',['-I','-c','import tarfile,json,base64,sys\na=tarfile.open(sys.argv[1]);names=json.loads(sys.argv[2]);print(json.dumps({n:base64.b64encode(a.extractfile(n).read()).decode() for n in names}))',join(marker.releaseRoot,'code/source.tar'),JSON.stringify(Object.keys(seven))],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});assert.equal(extraction.status,0);
    for(const [path,encoded] of Object.entries(JSON.parse(extraction.stdout))){assert.ok(Object.hasOwn(seven,path));const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('utf8').replaceAll('\r\n','\n'),seven[path]);await writeFile(join(marker.releaseRoot,'code/source',path),bytes);}
    const exact=JSON.parse(testManifest);exact.commit=marker.exactCommit;
    for(const f of exact.sourceFiles){const bytes=await readFile(join(marker.releaseRoot,'code/source',f.path));f.size=bytes.length;f.sha256=sha(bytes);}
    for(const f of exact.files){const bytes=await readFile(join(marker.releaseRoot,f.path));f.size=bytes.length;f.sha256=sha(bytes);}
    const encoded=JSON.stringify(exact,null,2)+'\n';await writeFile(join(marker.releaseRoot,'release-manifest.json'),encoded);
    await verifyRelease({releaseRoot:marker.releaseRoot});
    console.log(JSON.stringify({verified:true,exactCommit:marker.exactCommit,releaseDigest:sha(encoded),sourceDigest:exact.files.find(x=>x.path==='code/source.tar').sha256,sourceFiles:exact.sourceFiles.length,nativeFiles:exact.native.length}));
  }else throw Error('ISOLATION_ACTION_DENIED');
}
