import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, cp, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createProductionSimulationProfile, issueSimulationApproval, initializeProductionRoot, recordApprovedEnabledState } from '../../scripts/TongProductionProfile.mjs';
import { buildRelease, verifyRelease } from '../../scripts/TongRuntimeRelease.mjs';
import { verifyRuntimeCandidate } from '../../scripts/TongRuntimeCandidate.mjs';
import { protectSecret } from '../../scripts/TongRuntimeSecurity.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
export async function maintenanceNativeFixture(commit) {
  assert.match(commit,/^[a-f0-9]{40}$/);
  const project=fileURLToPath(new URL('../../',import.meta.url));
  const simulationId='b23-maint-native-'+randomUUID().replaceAll('-','');
  const topology={simulationId,gatewayPort:29881,upstreamPort:29882,agentdockPort:29883,...JSON.parse(process.env.TONG_MAINTENANCE_TEST_PORTS??'{}'),agentdockEnabled:true};
  const initial=createProductionSimulationProfile({...topology,sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64)});
  await issueSimulationApproval(initial,'init'); await initializeProductionRoot(initial);
  const root=initial.root;
  console.log(JSON.stringify({event:'native_maintenance_fixture_created',root}));
  const baselineCommit=process.env.TONG_MAINTENANCE_BASELINE_COMMIT??'34e26801876d8b1a2fc874dddce72b0939924e87';
  assert.ok(['34e26801876d8b1a2fc874dddce72b0939924e87','024d5b0920d9ad8f1a2baf2e55640a5666ad4739'].includes(baselineCommit));
  const build=(commit,releaseRoot)=>buildRelease({codeRoot:'D:\\Tong\\development\\tong-desktop-control',commit,releaseRoot,gitExecutable:'C:\\Users\\Rune\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe',pythonExecutable:'C:\\Program Files\\Python311\\python.exe'});
  const oldRelease=baselineCommit.startsWith('024d5b0')?join(root,'baseline-release'):'D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\candidate-release';
  if(baselineCommit.startsWith('024d5b0'))await build(baselineCommit,oldRelease);
  const oldManifest=await verifyRelease({releaseRoot:oldRelease});
  assert.equal(oldManifest.commit,baselineCommit);
  const releaseRoot=join(root,'candidate-release');
  const nextManifest=await build(commit,releaseRoot);
  for(const target of [initial.codeRoot,initial.managerRoot]) {
    await mkdir(target,{recursive:true});
    for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty'])await cp(join(project,'node_modules',...name.split('/')),join(target,'node_modules',...name.split('/')),{recursive:true,errorOnExist:true,force:false});
    for(const [base,files] of [[join(oldRelease,'code','source'),oldManifest.sourceFiles],[join(oldRelease,'native'),oldManifest.native]])for(const file of files){const to=join(target,...file.path.split('/'));await mkdir(dirname(to),{recursive:true});await copyFile(join(base,...file.path.split('/')),to);}
  }
  await symlink(join(project,'node_modules'),join(root,'node_modules'),'junction');
  const oldBytes=await readFile(join(oldRelease,'release-manifest.json')),nextBytes=await readFile(join(releaseRoot,'release-manifest.json'));
  const profileFor=(manifest,bytes)=>createProductionSimulationProfile({...topology,sourceDigest:manifest.files.find(file=>file.path==='code/source.tar').sha256,releaseDigest:sha(bytes)});
  const baselineProfile=profileFor(oldManifest,oldBytes),candidateProfile=profileFor(nextManifest,nextBytes);
  for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),oldBytes);
  await writeFile(join(root,'profile.json'),JSON.stringify(baselineProfile,null,2)+'\n');
  for(const dir of [baselineProfile.runtimeDir,baselineProfile.configDir,baselineProfile.oauthStateDir,baselineProfile.demoRoot,join(root,'tong-policy','agentdock-operations'),join(baselineProfile.codeRoot,'config')])await mkdir(dir,{recursive:true});
  await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
  await writeFile(join(root,'tong-policy','agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
  await writeFile(join(baselineProfile.configDir,'config.json'),JSON.stringify({host:'127.0.0.1',port:baselineProfile.upstreamPort,publicBaseUrl:baselineProfile.publicOrigin,allowedRoots:[baselineProfile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:baselineProfile.oauthStateDir,agentDir:baselineProfile.demoRoot,worktreeRoot:join(root,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}}));
  await writeFile(join(baselineProfile.configDir,'auth.json'),'{}');
  await writeFile(join(baselineProfile.codeRoot,'config','tong.config.json'),JSON.stringify({publicOrigin:baselineProfile.publicOrigin,workspacePath:baselineProfile.demoRoot,port:baselineProfile.gatewayPort,scanRoots:[]}));
  // Issue the candidate first, then baseline, so the initial bootstrap indexes
  // remain bound to the old version. No production minting path is available.
  for(const profile of [candidateProfile,baselineProfile]){
    for(const action of ['backup','restore','start','stop','manager','enable-agentdock'])await issueSimulationApproval(action==='manager'?{...profile,agentdockEnabled:false}:profile,action,{expiresAt:new Date(Date.now()+3500000).toISOString()});
    await recordApprovedEnabledState(profile);
  }
  await verifyRuntimeCandidate(baselineProfile);await verifyRuntimeCandidate(baselineProfile,{manager:true,reviewedManagerProfile:{...baselineProfile,agentdockEnabled:false}});
  const installed=await import(pathToFileURL(join(baselineProfile.managerRoot,'scripts','TongAgentDockRuntime.mjs')).href);
  const run=await installed.startRuntime(root);assert.equal(run.phase,'ready');assert.equal((await installed.runtimeDoctor(root)).healthy,true);
  await installed.stopRuntime(root,{expectedRunId:run.runId});
  await writeFile(join(root,'run','backup.freeze'),Buffer.alloc(0),{flag:'wx'});
  const metadata={schemaVersion:1,root,baselineProfile,candidateProfile,releaseRoot,candidateCommit:commit,baselineRunId:run.runId};
  await writeFile(join(root,'maintenance-native-fixture.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'native_maintenance_fixture_ready',root,candidateCommit:commit,baselineCommit:oldManifest.commit,baselineRunId:run.runId,oldSourceFiles:oldManifest.sourceFiles.length,newSourceFiles:nextManifest.sourceFiles.length,nativeFiles:oldManifest.native.length}));
  return metadata;
}
