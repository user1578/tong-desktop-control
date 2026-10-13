import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {stopRuntime} from '../scripts/TongAgentDockRuntime.mjs';
import {processIdentity} from '../scripts/TongRuntimeSecurity.mjs';
const root=await mkdtemp('D:\\Tong\\state\\stop-identity-test-');
for(const name of ['backend-state','workspace','workspace/demo','tong-state','tong-state/config','tong-policy','tong-policy/agentdock-operations','secrets','run','logs','temp','home'])await mkdir(join(root,name),{recursive:true});
await writeFile(join(root,'profile.json'),JSON.stringify({schemaVersion:1,root,tongRoot:root,host:'127.0.0.1',agentdockPort:18765}));
await writeFile(join(root,'runtime-synthetic.json'),JSON.stringify({scope:'synthetic-only'}));
const current=randomUUID(),old=randomUUID(),actor=join(root,'actor.mjs');
await writeFile(actor,`import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const [root,runId]=process.argv.slice(2);
setInterval(()=>{
  const stop=join(root,'run','stop.json');
  if(!existsSync(stop)||JSON.parse(readFileSync(stop,'utf8')).runId!==runId)return;
  const path=join(root,'run','runtime.json'),record=JSON.parse(readFileSync(path,'utf8'));record.phase='stopped';
  writeFileSync(path,JSON.stringify(record));
  writeFileSync(join(root,'run','guardian.json'),JSON.stringify({runId,pid:2147483647,exe:process.execPath,startTicks:'1',finishedAt:new Date().toISOString(),jobActiveAfterCleanup:0}));
  process.exit(0);
},50);
`);
const child=spawn(process.execPath,[actor,root,current],{windowsHide:true,stdio:'ignore'});
try{
const identity=await processIdentity(child.pid,current);assert.equal(identity.markerMatches,true);
// A live replacement run is already present when stop enters the real manager.
const record=JSON.stringify({runId:current,phase:'ready',supervisor:identity,children:[],descendants:[]});
await writeFile(join(root,'run','runtime.json'),record);
await assert.rejects(stopRuntime(root,{expectedRunId:old}),/IDENTITY_MISMATCH/);
await assert.rejects(readFile(join(root,'run','stop.json')),{code:'ENOENT'});
assert.equal(await readFile(join(root,'run','runtime.json'),'utf8'),record);
await assert.rejects(stopRuntime(root,{expectedRunId:'invalid'}),/INVALID_RUN/);
console.log(JSON.stringify({passed:true,root,replacementRunUntouched:true,noStopRequest:true}));
}finally{if(child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}}
