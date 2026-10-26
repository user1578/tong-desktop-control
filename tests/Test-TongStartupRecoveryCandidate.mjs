// Reuse the two stopped communication fixtures. No production target, new
// dependency tree, database copy, recovery budget reset or Task registration.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {minimalStartupSources} from './fixtures/TongMinimalStartupCandidate.mjs';
import {buildRelease,verifyRelease} from '../scripts/TongRuntimeRelease.mjs';
import {createProductionSimulationProfile} from '../scripts/TongProductionProfile.mjs';
import {startupJobsState,sameProcess,processIdentity} from '../scripts/TongRuntimeSecurity.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const roots=['D:\\Tong\\state\\b23-login-70f1b7d66215458c8ffa0d822348de0f','D:\\Tong\\state\\b23-login-c2db39cf150c44d584691538559dce3d'];
const [root,releaseInput]=process.argv.slice(2);assert.ok(roots.includes(root),'Only existing reviewed fixtures');
const json=async p=>JSON.parse(await readFile(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
function git(args,{input,env}={}){const r=spawnSync('git',args,{cwd:project,input,env:env??process.env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
const marker=await json(join(root,'seven-file-preparation.json')),oldProfile=await json(join(root,'profile.json'));
assert.equal(marker.scope,'seven-file-preparation-isolation');assert.equal(oldProfile.mode,'production-simulation');assert.equal(oldProfile.root,root);
async function preservation(trial,profile){
 const bindings=[join(root,'profile.json'),join(root,'run/release-pin.json'),join(root,'run/manager-pin.json')];
 const stable=[join(profile.configDir,'config.json'),join(profile.configDir,'auth.json'),join(root,'secrets/agentdock.dpapi'),join(root,'secrets/oauth-owner.dpapi')];
 const baseline=await json(join(root,'communication-preservation.json'));
 const hashes={};for(const path of [...bindings,...stable]){hashes[path]=sha(await readFile(path));if(stable.includes(path))assert.equal(hashes[path],baseline[path],'Original configuration and encrypted credentials stay unchanged');}
 await writeFile(join(trial,'communication-preservation.json'),JSON.stringify(hashes,null,2)+'\n',{flag:'wx'});
}
if(releaseInput==='--preservation-only'){await preservation(marker.startupRecovery.trial,oldProfile);console.log(JSON.stringify({versionScopedBaseline:true,stableConfigAndSecretsUnchanged:true,root}));process.exit(0);}
const previous=await json(join(root,'run/runtime.json'));assert.ok(['stopped','abnormal_exit'].includes(previous.phase));
for(const identity of [previous.supervisor,...previous.children,...previous.descendants])assert.equal(sameProcess(await processIdentity(identity.pid),identity),false);
assert.deepEqual(await startupJobsState(previous.runId),{owner:0,launcher:0,guardian:0,runtime:0});
const trial=join(root,'startup-recovery-'+randomUUID().replaceAll('-',''));await mkdir(trial);
process.env.TEMP=process.env.TMP=join(root,'temp');
async function commit(parent,files,label){
 const env={...process.env,GIT_INDEX_FILE:join(trial,label+'.index')};git(['read-tree',parent],{env});
 for(const [path,bytes] of Object.entries(files)){const blob=git(['hash-object','-w','--stdin'],{input:bytes});git(['update-index','--add','--cacheinfo','100644,'+blob+','+path],{env});}
 return git(['commit-tree',git(['write-tree'],{env}),'-p',parent,'-m',label]);
}
const source=await minimalStartupSources(),prior='3740082b3c11ca4403d1abdceed75d539878a161';
let releaseRoot,release,exactCommit;
if(releaseInput){releaseRoot=releaseInput;release=await verifyRelease({releaseRoot});exactCommit=release.commit;}
else{
 exactCommit=await commit(prior,source,'024-production-startup-recovery-candidate');
 assert.deepEqual(git(['diff','--name-only',prior,exactCommit]).split('\n'),['scripts/TongAgentDockRuntime.mjs','scripts/TongRuntimeGuardian.ps1']);
 releaseRoot=join(trial,'release');release=await buildRelease({codeRoot:'D:\\Tong\\development\\tong-desktop-control',commit:exactCommit,releaseRoot,gitExecutable:join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'),pythonExecutable:'C:\\Program Files\\Python311\\python.exe'});
}
for(const [path,text] of Object.entries(source))assert.equal((await readFile(join(releaseRoot,'code/source',path),'utf8')).replaceAll('\r\n','\n'),text,'Reviewed working tree matches exact release');
const relocated={...source};
if(root===roots[1]){
 // Replay the measured production child costs as finite floors, while still
 // executing every real check/import/OAuth initializer. These test-only waits
 // stay inside the unchanged stage and child deadlines; no READY is injected.
 const path='scripts/TongRuntimeServer.mjs';
 let child=(await readFile(join(releaseRoot,'code/source',path),'utf8')).replaceAll('\r\n','\n');
 const replace=(from,to)=>{assert.equal(child.split(from).length,2,from);child=child.replace(from,()=>to);};
 replace("const [settings] = await once(process, 'message');","const [settings] = await once(process, 'message');\nlet measuredStageAt=Date.now();\nconst productionFloor=async ms=>{await new Promise(ok=>setTimeout(ok,Math.max(0,ms-(Date.now()-measuredStageAt))));measuredStageAt=Date.now();};");
 replace("stage('settings_received');","await productionFloor(12500);stage('settings_received');");
 replace("stage('approval_verified');","await productionFloor(7300);stage('approval_verified');");
 replace("stage('candidate_verified');","await productionFloor(8500);stage('candidate_verified');");
 replace("if(profile.mode==='production'){","if(profile.mode==='production'||profile.mode==='production-simulation'){");
 // Imports were 10.231s in production run 2; historical cold import reached
 // 18.9s. A 19s floor tests that observed slow import without crossing 30s.
 replace("const { createServer } = await import(","const measuredImportAt=Date.now();\n  const { createServer } = await import(");
 replace("const cpu=process.cpuUsage(importCpu);","await new Promise(ok=>setTimeout(ok,Math.max(0,19000-(Date.now()-measuredImportAt))));\n  const cpu=process.cpuUsage(importCpu);");
 relocated[path]=child;
}
for(const name of ['TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1']){
 const path='scripts/'+name;
 relocated[path]=relocated[path].replaceAll('D:\\Tong\\runtime\\releases\\manager\\scripts\\TongAgentDockRuntime.mjs',join(oldProfile.managerRoot,'scripts/TongAgentDockRuntime.mjs')).replaceAll('D:\\Tong\\runtime',root);
}
const protocol='scripts/TongStartupProtocol.ps1';
const wait='        while(-not $probe.Exited){Assert-TongStartupActive;Start-Sleep -Milliseconds 100}';
assert.equal(relocated[protocol].split(wait).length,2);
// Floor each real native preflight at 17s, after its actual checks succeed.
// The original deadline/abort checks continue throughout the added wait.
relocated[protocol]=relocated[protocol].replace(wait,wait+"\n        $script:tongStartup.preflight['validationElapsedMs']=$watch.ElapsedMilliseconds\n        while($watch.ElapsedMilliseconds -lt 17000){Assert-TongStartupActive;Start-Sleep -Milliseconds 100}\n        $script:tongStartup.preflight['controlledWaitMs']=$watch.ElapsedMilliseconds-$script:tongStartup.preflight.validationElapsedMs");
const testCommit=await commit(exactCommit,relocated,'024-startup-isolation-root-and-17s-floor');
const archive=join(trial,'fixture-source.tar');git(['archive','--format=tar','--output='+archive,testCommit]);
const extraction=spawnSync('C:\\Program Files\\Python311\\python.exe',['-I','-c','import tarfile,json,base64,sys\na=tarfile.open(sys.argv[1]);print(json.dumps({n:base64.b64encode(a.extractfile(n).read()).decode() for n in json.loads(sys.argv[2])}))',archive,JSON.stringify(Object.keys(relocated))],{encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});assert.equal(extraction.status,0);
const packaged=Object.fromEntries(Object.entries(JSON.parse(extraction.stdout)).map(([p,b])=>[p,Buffer.from(b,'base64')]));
for(const rel of ['profile.json','run/release-pin.json','run/manager-pin.json','seven-file-preparation.json'])await copyFile(join(root,rel),join(trial,rel.replaceAll('/','-')+'.before'));
for(const component of ['tong','releases/manager'])for(const path of Object.keys(packaged)){
 const target=join(root,component,path),saved=join(trial,component,path);await mkdir(dirname(saved),{recursive:true});await copyFile(target,saved);
}
const pin=structuredClone(release);pin.commit=testCommit;pin.releaseRoot=trial;
for(const f of pin.sourceFiles){if(packaged[f.path]){f.size=packaged[f.path].length;f.sha256=sha(packaged[f.path]);}}
for(const f of pin.files){if(f.path==='code/source.tar'){f.size=(await stat(archive)).size;f.sha256=sha(await readFile(archive));}else if(f.path.startsWith('code/source/')&&packaged[f.path.slice(12)]){const b=packaged[f.path.slice(12)];f.size=b.length;f.sha256=sha(b);}}
const pinBytes=JSON.stringify(pin,null,2)+'\n';await writeFile(join(trial,'fixture-manifest.json'),pinBytes,{flag:'wx'});
const profile=createProductionSimulationProfile({simulationId:oldProfile.simulationId,gatewayPort:oldProfile.gatewayPort,upstreamPort:oldProfile.upstreamPort,agentdockPort:oldProfile.agentdockPort,sourceDigest:pin.files.find(f=>f.path==='code/source.tar').sha256,releaseDigest:sha(pinBytes),agentdockEnabled:true});
for(const component of ['tong','releases/manager']){
 for(const [path,bytes] of Object.entries(packaged))await writeFile(join(root,component,path),bytes);
 for(const f of [...pin.sourceFiles,...pin.native]){const bytes=await readFile(join(root,component,f.path));assert.equal(bytes.length,f.size);assert.equal(sha(bytes),f.sha256);}
}
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),pinBytes);
await writeFile(join(root,'profile.json'),JSON.stringify(profile,null,2)+'\n');
await writeFile(join(root,'seven-file-preparation.json'),JSON.stringify({...marker,exactCommit,testCommit,startupRecovery:{trial,releaseRoot,preflightFloorMs:17000,originalMarker:join(trial,'seven-file-preparation.json.before')}},null,2)+'\n');
await preservation(trial,profile);
const output={root,trial,releaseRoot,exactCommit,testCommit,preflightFloorMs:17000,sourceFiles:pin.sourceFiles.length,nativeFiles:pin.native.length,releaseDigest:sha(await readFile(join(releaseRoot,'release-manifest.json'))),sourceDigest:release.files.find(f=>f.path==='code/source.tar').sha256,productionChanged:false};
await writeFile(join(trial,'prepared.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(output));
