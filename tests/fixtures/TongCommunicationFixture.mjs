// Fresh synthetic state for independent communication/recovery rounds. Reuse
// the verified dependency tree/release; never copy prior state or its budget.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,cp,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loginFixture,sha} from './TongLoginRecoveryFixture.mjs';
import {startupBase} from './TongMinimalStartupCandidate.mjs';
import {createProductionSimulationProfile} from '../../scripts/TongProductionProfile.mjs';
import {protectSecret} from '../../scripts/TongRuntimeSecurity.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const old='D:\\Tong\\state\\b23-login-70f1b7d66215458c8ffa0d822348de0f';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const oldProfile=await json(join(old,'profile.json')),oldMarker=await json(join(old,'seven-file-preparation.json'));
const pin=await json(join(old,'run/release-pin.json'));
assert.equal(oldProfile.mode,'production-simulation');assert.equal(pin.commit,oldMarker.testCommit);
assert.equal(pin.sourceFiles.length,284);assert.equal(pin.native.length,23);
const fixture=await loginFixture({sourceRef:startupBase,ports:{gatewayPort:29676,upstreamPort:29677,agentdockPort:29675}}),{root}=fixture;
await symlink(join(old,'node_modules'),join(root,'node_modules'),'junction');
const relocated={};
for(const target of [fixture.profile.codeRoot,fixture.profile.managerRoot]){
 for(const item of pin.sourceFiles){
  const source=await readFile(join(oldProfile.codeRoot,item.path));assert.equal(sha(source),item.sha256);
  const bytes=/scripts\/TongRuntime(Launch|Guardian)\.ps1$/.test(item.path)?Buffer.from(source.toString('utf8').replaceAll(old,root)):source;
  if(bytes!==source){assert.ok(bytes.toString('utf8').includes(root));relocated[item.path]=bytes;}
  const destination=join(target,item.path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
 }
 for(const name of ['@waishnav/devspace','@modelcontextprotocol/sdk','better-sqlite3','node-pty'])await cp(join(oldProfile.codeRoot,'node_modules',name),join(target,'node_modules',name),{recursive:true});
 for(const item of pin.native)assert.equal(sha(await readFile(join(target,item.path))),item.sha256);
}
// A local Git object records the two literal path relocations. No ref/history
// or remote is changed; this is a synthetic pin, not a new production release.
const env={...process.env,GIT_INDEX_FILE:join(root,'communication.index')};
const git=(args,input)=>{const r=spawnSync('git',args,{cwd:project,env,input,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
git(['read-tree',pin.commit]);
for(const [path,bytes] of Object.entries(relocated)){const blob=git(['hash-object','-w','--stdin'],bytes);git(['update-index','--add','--cacheinfo','100644,'+blob+','+path]);}
pin.commit=git(['commit-tree',git(['write-tree']),'-p',pin.commit,'-m','Synthetic communication fixture path relocation']);
for(const f of pin.sourceFiles){const bytes=await readFile(join(fixture.profile.codeRoot,f.path));f.size=bytes.length;f.sha256=sha(bytes);}
pin.files=[{path:'code/source.tar',sha256:'a'.repeat(64)}];
const pinBytes=JSON.stringify(pin);
const profile=createProductionSimulationProfile({simulationId:fixture.profile.simulationId,gatewayPort:29676,upstreamPort:29677,agentdockPort:29675,sourceDigest:'a'.repeat(64),releaseDigest:sha(pinBytes),agentdockEnabled:true});
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile));
await protectSecret(root,'agentdock',randomBytes(32).toString('hex'));await protectSecret(root,'oauth-owner',randomBytes(32).toString('hex'));
await writeFile(join(root,'tong-policy/agentdock-access.json'),JSON.stringify({schemaVersion:1,backendWorkspaceRoot:join(root,'workspace'),projects:[],approvals:[]}));
const config={host:'127.0.0.1',port:profile.upstreamPort,publicBaseUrl:profile.publicOrigin,allowedRoots:[profile.demoRoot],allowedHosts:['127.0.0.1','localhost'],stateDir:profile.oauthStateDir,agentDir:profile.demoRoot,worktreeRoot:join(profile.codeRoot,'unused-worktrees'),subagents:{enabled:false,providers:[]},widgets:'off',skillsEnabled:false,artifactsEnabled:false,toolMode:'minimal',logging:{level:'warn',format:'json'}};
await writeFile(join(profile.configDir,'config.json'),JSON.stringify(config));await writeFile(join(profile.configDir,'auth.json'),'{}');
await mkdir(join(profile.codeRoot,'config'),{recursive:true});await writeFile(join(profile.codeRoot,'config/tong.config.json'),JSON.stringify({publicOrigin:profile.publicOrigin,workspacePath:profile.demoRoot,port:profile.gatewayPort,scanRoots:[]}));
const marker={...oldMarker,root,communicationFixture:true,testCommit:pin.commit,sourceFiles:pin.sourceFiles.length,nativeFiles:pin.native.length,releaseRoot:oldMarker.releaseRoot,realCredentialsUsed:false,freshSyntheticState:true,oldRootUnchanged:true};
await writeFile(join(root,'seven-file-preparation.json'),JSON.stringify(marker,null,2));
const login=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongLoginRecovery.mjs')));await login.issueSimulationLoginRecovery(profile);
console.log(JSON.stringify({root,testCommit:pin.commit,sourceFiles:pin.sourceFiles.length,nativeFiles:pin.native.length,reusedRelease:oldMarker.releaseRoot,productionChanged:false}));
