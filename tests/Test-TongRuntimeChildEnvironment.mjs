import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeRuntime, runtimeStatus, stopRuntime } from '../scripts/TongAgentDockRuntime.mjs';
import { safeEnvironment, readSecret, processIdentity, sameProcess } from '../scripts/TongRuntimeSecurity.mjs';
import { TongAgentDockClient } from '../scripts/TongAgentDockClient.mjs';

const root=await mkdtemp('D:\\agentdock-poc-20261010\\isolated\\state\\b22-child-env-');
const tongRoot=fileURLToPath(new URL('../',import.meta.url));
await initializeRuntime({root,tongRoot,withTong:true});
const probe=join(root,'workspace','demo','probe.py');
const evidence=join(root,'workspace','demo','child-environment.json');
await writeFile(probe,`import os,json,sys,time\nfrom pathlib import Path\nkeys=['AGENTDOCK_AUTH_TOKEN','TONG_AGENTDOCK_TOKEN','OAUTH_OWNER_TOKEN']\nPath(sys.argv[1]).write_text(json.dumps({'pid':os.getpid(),'secretVariablesPresent':[k for k in keys if k in os.environ]}))\ntime.sleep(25)\n`);
const client=new TongAgentDockClient({tokenProvider:()=>readSecret(root,'agentdock'),controlledExecution:true});
try {
  // The invoking CLI exits while the owned guardian and runtime remain alive.
  await new Promise((ok,reject)=>{
    const cli=spawn(process.execPath,[join(tongRoot,'scripts','TongAgentDockRuntime.mjs'),'start','--root',root],{cwd:tongRoot,env:{...safeEnvironment(root),USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA},windowsHide:true,stdio:'ignore'});
    cli.once('error',reject);cli.once('close',code=>code===0?ok():reject(Error('CLI_START_FAILED')));
  });
  assert.equal((await runtimeStatus(root)).supervisorAlive,true);
  // Fixed synthetic diagnostic only; no generic command interface is exported.
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const result=await client.callTool('exec_command',{cmd:`& ${quote('C:\\Program Files\\Python311\\python.exe')} -I ${quote(probe)} ${quote(evidence)}`,runtime:'windows',workdir:join(root,'workspace','demo'),env:{},timeout_ms:30000,execution_mode:'async',yield_time_ms:500,max_output_bytes:4096,tty:false});
  assert.equal(result.structuredContent.status,'running');
  let child;
  for(let n=0;n<100;n++){try{child=JSON.parse(await readFile(evidence,'utf8'));break;}catch{await new Promise(ok=>setTimeout(ok,100));}}
  assert.ok(child);assert.deepEqual(child.secretVariablesPresent,[]);
  const identity=await processIdentity(child.pid);assert.ok(identity);
  await stopRuntime(root);
  assert.equal(sameProcess(await processIdentity(child.pid),identity),false);
  const guardian=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));assert.equal(guardian.jobActiveAfterCleanup,0);
  await writeFile(join(root,'test-evidence.json'),JSON.stringify({passed:true,cliParentExited:true,secretFreeBackendChild:true,inflightChildGone:true,jobActiveAfterCleanup:0})+'\n');
  console.log(JSON.stringify({passed:true,root,cliParentExited:true,secretFreeBackendChild:true,inflightChildGone:true}));
} finally {await client.close();if((await runtimeStatus(root)).supervisorAlive)await stopRuntime(root);}
