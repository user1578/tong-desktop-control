import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
const root=await mkdtemp('D:\\Tong\\state\\startup-observation-');
await copyFile(new URL('../scripts/TongRuntimeSecurity.mjs',import.meta.url),join(root,'TongRuntimeSecurity.mjs'));
await writeFile(join(root,'TongRuntimeSecurity.ps1'),`param($Mode)\n[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'calls'),'call\\n')\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'probe.pid'),[string]$PID)\nStart-Sleep -Seconds 60\nWrite-Output 'null'`);
await writeFile(join(root,'worker.mjs'),`import assert from 'node:assert/strict';import {processIdentity,startupJobsState,assertProtectedPaths} from './TongRuntimeSecurity.mjs';
const controller=new AbortController(),began=Date.now();const timer=setTimeout(()=>controller.abort(),1200);
try{await assert.rejects(processIdentity(process.pid,'',{signal:controller.signal}),/SECURITY_UNAVAILABLE/);}finally{clearTimeout(timer);}
for(const operation of [()=>processIdentity(process.pid,'',{signal:controller.signal}),()=>startupJobsState('00000000-0000-0000-0000-000000000000',{signal:controller.signal}),()=>assertProtectedPaths([${JSON.stringify(root)}],{signal:controller.signal})])await assert.rejects(operation(),/SECURITY_UNAVAILABLE/);
console.log(JSON.stringify({cancelled:true,durationMs:Date.now()-began}));`);
const began=Date.now(),child=spawn(process.execPath,[join(root,'worker.mjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let out='',err='',timedOut=false;child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);
const timer=setTimeout(()=>{timedOut=true;child.kill();},5000);
const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);
const pid=await readFile(join(root,'probe.pid'),'utf8').then(Number).catch(()=>null);
let alive=false;if(pid)try{process.kill(pid,0);alive=true;}catch{}
if(alive){try{process.kill(pid);}catch{}}
assert.equal(timedOut,false,'an aborted metadata helper must not keep its Manager process alive');
assert.equal(code,0,err);assert.equal(alive,false,'the owned PowerShell observer must exit on cancellation');
assert.ok(Date.now()-began<5000);assert.equal((await readFile(join(root,'calls'),'utf8')).split('call').length-1,1,'already cancelled proof must not launch later observers');
console.log(JSON.stringify({passed:true,root,realCliExitBounded:true,observerTerminated:true,noLaterObservers:true,durationMs:Date.now()-began}));
