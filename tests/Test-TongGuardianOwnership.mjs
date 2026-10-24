import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {processIdentity,sameProcess,terminateOwnedProcess,startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';
const scripts=new URL('../scripts/',import.meta.url),roots=[];
for(const mode of ['adoption_failure','compiler_descendant']){
  const root=await mkdtemp('D:\\Tong\\state\\guardian-ownership-');roots.push(root);
  for(const dir of ['scripts','run','logs'])await mkdir(join(root,dir));
  for(const name of ['TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1','TongStartupProtocol.ps1'])await copyFile(new URL(name,scripts),join(root,'scripts',name));
  const runId=randomUUID();await writeFile(join(root,'run/request.json'),JSON.stringify({runId,startupDeadline:Date.now()+30000}));
  const guardianPath=join(root,'scripts/TongRuntimeGuardian.ps1');
  if(mode==='adoption_failure'){
    await writeFile(guardianPath,'param($Root,$RunId,$NodeExe,$Supervisor,$RecoveryGrantId,$OwnerJobName)\nexit 37\n');
    const launcherPath=join(root,'scripts/TongRuntimeLaunch.ps1'),source=await readFile(launcherPath,'utf8');
    await writeFile(launcherPath,source.replace("Initialize-TongStartup 'launcher'","Initialize-TongStartup 'launcher'\n    $script:tongStartup['preflightExitCode']=0"));
  }
  else{
    const source=await readFile(guardianPath,'utf8');
    // CodeDom uses the .NET Framework process path with handle inheritance.
    // A long-lived equivalent child must NOT inherit the lifetime Job handle.
    const hook=`[TongStartupPreflight]::AdoptGuardian($OwnerJobName)
        $compilerInfo=[Diagnostics.ProcessStartInfo]::new('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 60"')
        $compilerInfo.UseShellExecute=$false;$compilerInfo.CreateNoWindow=$true
        $compiler=[Diagnostics.Process]::Start($compilerInfo)
        [IO.File]::WriteAllText((Join-Path $Root 'compiler.pid'),[string]$compiler.Id)
        Start-Sleep -Seconds 60`;
    assert.ok(source.includes('[TongStartupPreflight]::AdoptGuardian($OwnerJobName)'));
    await writeFile(guardianPath,source.replace('[TongStartupPreflight]::AdoptGuardian($OwnerJobName)',hook));
  }
  const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File',join(root,'scripts/TongRuntimeLaunch.ps1'),'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',join(root,'unused.mjs')],{encoding:'utf8',windowsHide:true,timeout:35000});
  assert.equal(result.status,mode==='adoption_failure'?2:0,result.stderr);
  const receipt=JSON.parse(await readFile(join(root,`run/launcher.${runId}.json`),'utf8'));
  assert.equal(receipt.guardianCreated,true,'created-and-cleaned is distinct from never-created');
  if(mode==='adoption_failure'){
    assert.equal(receipt.failure.childExitCode,37);assert.equal(receipt.failure.code,'GUARDIAN_EXIT_BEFORE_ADOPTION');
    assert.equal(receipt.failure.preflightExitCode,0);
    assert.equal(receipt.guardianTreeCleanup.proven,true);
  }else{
    let pid;for(let n=0;n<100;n++){pid=await readFile(join(root,'compiler.pid'),'utf8').then(Number).catch(()=>null);if(pid)break;await new Promise(ok=>setTimeout(ok,50));}
    assert.ok(pid);const child=await processIdentity(pid);assert.ok(child);
    await terminateOwnedProcess(receipt.guardian);
    for(let n=0;n<100;n++){if(!sameProcess(await processIdentity(pid),child))break;if(n===99)throw Error('Compiler descendant kept the lifetime Job alive');await new Promise(ok=>setTimeout(ok,50));}
  }
  assert.deepEqual(await startupJobsState(runId),{owner:0,launcher:0,guardian:0,runtime:0});
}
console.log(JSON.stringify({passed:true,roots,adoptionFailureExitPreserved:true,createdVersusCleanedDistinct:true,noInheritedOwnerHandle:true,compilerDescendantTerminated:true}));
