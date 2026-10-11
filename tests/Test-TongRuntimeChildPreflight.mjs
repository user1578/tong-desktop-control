import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {safeEnvironment,readSecret} from '../scripts/TongRuntimeSecurity.mjs';
import {validateProductionProfile} from '../scripts/TongProductionProfile.mjs';
const root=process.env.TONG_B23_CHILD_PROBE_ROOT;
if(!root)console.log('SKIP: isolated approved child preflight probe.');
else {
  const profile=validateProductionProfile(JSON.parse(await readFile(join(root,'profile.json'),'utf8')));
  assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,resolve(root));
  const secret=await readSecret(root,'oauth-owner'),began=Date.now(),stages=[];
  const child=fork(new URL('../scripts/TongRuntimeServer.mjs',import.meta.url),[],{cwd:profile.codeRoot,env:safeEnvironment(root),windowsHide:true,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  child.on('message',message=>{if(message.event==='stage')stages.push({stage:message.stage,ms:Date.now()-began});else if(message.event==='logging_secret'){assert.equal(message.ownerToken,secret);child.send({event:'logging_ready'});}});
  const timer=setTimeout(()=>child.kill(),30000);
  child.send({schemaVersion:1,role:'devspace',root,profile,tongRoot:profile.codeRoot,gatewayPort:profile.gatewayPort,upstreamPort:profile.upstreamPort,ownerToken:secret,preflightOnly:true});
  const code=await new Promise(ok=>child.once('close',ok));clearTimeout(timer);
  assert.ok(!output.includes(secret));
  await writeFile(join(root,'logs','child-preflight.json'),JSON.stringify({code,stages,outputBytes:Buffer.byteLength(output)},null,2));
  console.log(JSON.stringify({code,stages,outputBytes:Buffer.byteLength(output)}));
  assert.equal(code,0);assert.ok(stages.some(s=>s.stage==='preflight_complete'));
}
