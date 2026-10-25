import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loginFixture,sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {childLifecycle} from './fixtures/ChildLifecycle.mjs';
import {safeEnvironment,startupJobsState,processIdentity,sameProcess} from '../scripts/TongRuntimeSecurity.mjs';
import {minimalStartupSources,startupBase} from './fixtures/TongMinimalStartupCandidate.mjs';

// Exercise the production-only Launcher branch, NOT the simulation skip path.
// Only its fixed root/Supervisor literals are relocated in a private test copy.
// The real preflight-login code, pin checks, native ACL and synthetic DPAPI
// authorization run unchanged. Stop before any Guardian can be created.
const minimal=process.argv.includes('--minimal-candidate');
const overrides=minimal?await minimalStartupSources():{};
const v2=startupBase;
const selected=process.argv.find(arg=>arg.startsWith('--cases='))?.slice(8).split(',');
const cases=(minimal?[['minimal-valid',false],['minimal-denied',true],['minimal-slow',false],['minimal-timeout',false]]:[['original-v2',false],['candidate',false],['candidate-denied',true]]).filter(([name])=>!selected||selected.includes(name));
assert.ok(cases.length,'at least one known case required');
const results=[];
for(const [name,denied] of cases){
  const sourceRef=minimal||name==='original-v2'?v2:undefined;
  const fixture=await loginFixture({sourceRef,sourceOverrides:overrides});
  const {root,profile}=fixture,manager=join(profile.managerRoot,'scripts');
  await symlink(join(fixture.project,'node_modules'),join(root,'node_modules'),'junction');
  const recovery=await import(pathToFileURL(join(manager,'TongLoginRecovery.mjs')));
  const issued=await recovery.issueSimulationLoginRecovery(profile);
  assert.equal(issued.enabled,true);
  const runId=randomUUID(),grantId=denied?randomUUID():issued.grantId;
  const privateDir=join(root,'preflight-test');await mkdir(privateDir);
  let launcher=await readFile(join(manager,'TongRuntimeLaunch.ps1'),'utf8');
  launcher=launcher.replaceAll('D:\\Tong\\runtime\\releases\\manager\\scripts\\TongAgentDockRuntime.mjs',join(manager,'TongAgentDockRuntime.mjs')).replaceAll('D:\\Tong\\runtime',root);
  // Resolve protocol beside the unmodified, pinned candidate, not the test copy.
  launcher=launcher.replace("(Join-Path $PSScriptRoot 'TongStartupProtocol.ps1')",`'${join(manager,'TongStartupProtocol.ps1')}'`);
  if(name==='minimal-slow'){
    const loader=join(privateDir,'slow-loader.mjs');await writeFile(loader,'await new Promise(resolve=>setTimeout(resolve,9000));');
    // Controlled delay inside the owned Node preflight, then the unchanged
    // preflight-login implementation. This is not measured production latency.
    const before=`Invoke-TongStartupPreflight ('"'+$Supervisor`;
    assert.equal(launcher.split(before).length,3);
    launcher=launcher.replaceAll(before,`Invoke-TongStartupPreflight ('--import "${pathToFileURL(loader).href}" "'+$Supervisor`);
  }
  const boundary="    $arguments='-NoLogo";
  assert.equal(launcher.split(boundary).length,2,'unique pre-Guardian stop boundary');
  launcher=launcher.replace(boundary,"    [Console]::Out.WriteLine('TEST_PREFLIGHT_COMPLETE');throw 'TEST_PREFLIGHT_STOP'\n"+boundary);
  const launcherFile=join(privateDir,'launcher.ps1');await writeFile(launcherFile,launcher);
  const timeout=name==='minimal-timeout';
  await writeFile(join(root,'run','request.json'),JSON.stringify({runId,startupDeadline:Date.now()+(timeout?3500:120000)}));
  const env={...safeEnvironment(root),USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA};
  const started=Date.now();
  const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',launcherFile,'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',join(manager,'TongAgentDockRuntime.mjs'),'-RecoveryGrantId',grantId],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4096);});
  const owner=childLifecycle(child,{timeoutMs:135000});
  const exit=await owner.close(),elapsedMs=Date.now()-started;
  await writeFile(join(privateDir,'stderr.local.txt'),exit.stderr??'');
  if(exit.code!==2){await writeFile(join(privateDir,'unexpected-stderr.local.txt'),exit.stderr??'');throw Error(`${name}: unexpected exit ${exit.code}; inspect ${privateDir}`);}
  assert.equal(exit.code,2,'private boundary or rejected preflight must refuse launch');
  const passed=output.includes('TEST_PREFLIGHT_COMPLETE');
  assert.equal(passed,!denied&&!timeout,`${name}: real preflight approval result`);
  if(name==='minimal-slow')assert.ok(elapsedMs>15000,'controlled slow path must actually cross the old fixed wait');
  const jobs=await startupJobsState(runId);
  assert.deepEqual(jobs,{owner:0,launcher:0,guardian:0,runtime:0});
  let receipt=null;
  if(minimal||!sourceRef){
    receipt=JSON.parse(await readFile(join(root,'run',`launcher.${runId}.json`),'utf8'));
    assert.equal(receipt.guardianCreated,false);assert.equal(receipt.preflightClean,true);
    assert.equal(receipt.stage,denied||timeout?'preflight':'preflight_complete');
    assert.equal(receipt.preflight.exitCode,timeout?null:denied?1:0);
    if(timeout){assert.equal(receipt.preflight.failure.code,'START_TIMEOUT');assert.equal(receipt.failure.code,'START_TIMEOUT');assert.ok(elapsedMs<14000);}
    assert.ok(receipt.preflight.elapsedMs>0);
    assert.equal(receipt.preflight.child.exe,process.execPath);
    assert.match(receipt.preflight.child.startTicks,/^\d+$/);
    assert.equal(sameProcess(await processIdentity(receipt.preflight.child.pid),receipt.preflight.child),false);
    assert.equal(receipt.preflight.jobActiveAfterCleanup,0);
  }
  // Receipts and private synthetic credentials stay local. Public output is
  // metadata only, including the native identity, never stderr or grant bytes.
  const result={name,sourceRef:sourceRef??'working-tree',minimalOverlay:minimal,runId,isolatedRoot:root,productionBranchExecuted:true,syntheticAuthorization:true,stoppedBeforeGuardian:true,elapsedMs,controlledDelayMs:name==='minimal-slow'?9000:0,exitCode:exit.code,preflightPassed:passed,launcherCopySha256:sha(launcher),jobs,...(receipt?{preflight:receipt.preflight,failure:receipt.failure}:{}),limitation:'Relocated root with synthetic pins/grant; not an exact production latency reproduction.'};
  results.push(result);console.log(JSON.stringify(result));
  if(process.env.TONG_PREFLIGHT_REPORT)await writeFile(process.env.TONG_PREFLIGHT_REPORT,JSON.stringify({passed:results.length===cases.length,results},null,2)+'\n');
}
