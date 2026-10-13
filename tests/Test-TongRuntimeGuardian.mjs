import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {processIdentity,sameProcess} from '../scripts/TongRuntimeSecurity.mjs';
const shell=process.argv[2]??'powershell.exe';
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const roots=[];
for(const entry of ['TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1']){
const root=await mkdtemp('D:\\Tong\\state\\guardian-test-');roots.push(root);
await mkdir(join(root,'run'));await mkdir(join(root,'logs'));
const supervisor=join(root,'supervisor.mjs');
await writeFile(supervisor,`import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[process.argv.indexOf('--root')+1];
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
writeFileSync(join(root,'child.json'),JSON.stringify({pid:child.pid}));
setTimeout(()=>process.exit(23),5000);
`);
const runId=randomUUID();await writeFile(join(root,'run','request.json'),JSON.stringify({runId}));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
// Direct guardian testing waits for completion; record its descendant's exact
// identity before that wait in the fixture, without depending on polling speed.
await writeFile(supervisor,(await readFile(supervisor,'utf8')).replace("import {join} from 'node:path';","import {join} from 'node:path';\nimport {processIdentity} from "+JSON.stringify(new URL('../scripts/TongRuntimeSecurity.mjs',import.meta.url).href)+";").replace("JSON.stringify({pid:child.pid})","JSON.stringify(await processIdentity(child.pid))"));
const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',join(scripts,entry),'-Root',root,'-RunId',runId,'-NodeExe',process.execPath,'-Supervisor',supervisor],{env,encoding:'utf8',windowsHide:true,timeout:20000});
assert.equal(result.status,0,result.stderr);
let guardian,childIdentity;
for(let i=0;i<100;i++){
  const child=await readFile(join(root,'child.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(child&&!childIdentity)childIdentity=child;
  guardian=await readFile(join(root,'run','guardian.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(guardian?.finishedAt)break;
  await new Promise(ok=>setTimeout(ok,100));
}
assert.ok(childIdentity,'fixture descendant must have been observed alive');
assert.ok(guardian?.finishedAt,'guardian cleanup must finish');
if(entry==='TongRuntimeLaunch.ps1')assert.match(guardian.exe,/WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
assert.equal(guardian.nodeExitCode,23);assert.equal(guardian.jobActiveAfterCleanup,0);
assert.equal(sameProcess(await processIdentity(childIdentity.pid),childIdentity),false);
assert.equal(sameProcess(await processIdentity(guardian.pid),guardian),false);
assert.equal(JSON.parse((await readFile(join(root,'logs','guardian.jsonl'),'utf8')).trim()).classification,'abnormal_exit');
}
console.log(JSON.stringify({passed:true,shell,roots,hiddenLauncher:true,directGuardian:true,privateJobCleanup:true,exitEvidence:true}));
