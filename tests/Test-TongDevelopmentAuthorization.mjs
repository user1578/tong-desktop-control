import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TongProjectAccess} from '../scripts/TongProjectAccess.mjs';
import {TongTrustedPolicy, TongTrustedCodexBroker} from '../scripts/TongTrustedCodexBroker.mjs';

const root=await mkdtemp('D:\\Tong\\state\\development-auth-');
const projectRoot=join(root,'project'),state=join(root,'state');
await mkdir(projectRoot);await mkdir(state);
const access=new TongProjectAccess({registryPath:join(state,'projects.json'),agentAccessPath:join(state,'agent.json'),demoRoot:join(root,'demo')});
await access.addProject({id:'development',name:'Development',root:projectRoot,permission:'write'});
await access.grantAgentExecution('development');
const executable=join(root,'codex.exe');await writeFile(executable,'fixture executable');
const policy=new TongTrustedPolicy({policyPath:join(state,'trusted.json'),taskStatePath:join(state,'tasks.json')});
await policy.enable(executable);await policy.grant('development',access);
await policy.authorizeDevelopment('development',access,{gitCommit:true,gitPush:true});
const states=[],calls=[];
const broker=new TongTrustedCodexBroker({access,policy,pollMs:5,adapterFactory:()=>({async runTask(task){calls.push(task);return {turnStatus:'completed'};}})});
const task={taskId:'00000000-0000-4000-8000-000000000001',projectId:'development',cwd:projectRoot,task:'build and test',scope:'this project',prompt:'build and test',timeoutMs:1000};
try{
  // A restored broker/policy must use the root-bound grant repeatedly and on resume.
  for(const continuation of [undefined,'continue the existing session']){
    const result=await broker.runTask({...task,...(continuation?{threadId:'saved-session',continuationMessage:continuation,resumeCount:1}:{})},{onState:s=>states.push(s),signal:AbortSignal.timeout(2000)});
    assert.equal(result.turnStatus,'completed');
  }
  assert.deepEqual(states,['running','running']);assert.equal(calls.length,2);
  assert.ok((await new TongTrustedPolicy({policyPath:policy.policyPath}).status()).developmentGrants.some(g=>g.projectId==='development'));
  const high={...task,workType:'high-impact'};
  await assert.rejects(broker.runTask(high,{signal:AbortSignal.timeout(30)}),/abort|timeout/i);
  assert.equal(calls.length,2,'high impact must not use persistent development approval');
  await assert.rejects(broker.runTask({...task,requiredCapabilities:['system.admin']}),/capabilit|scope/i);
  const preflight=await broker.preflight({projectId:'development',projectRoot,requiredCapabilities:['git.push']});
  assert.equal(preflight.authorization.mode,'project-development');
  let entered;
  const launched=new Promise(done=>{entered=done;});
  const activeBroker=new TongTrustedCodexBroker({access,policy,pollMs:5,adapterFactory:()=>({async runTask(_task,{signal}){entered();return new Promise(done=>signal.addEventListener('abort',()=>done({turnStatus:'interrupted'}),{once:true}));}})});
  const active=activeBroker.runTask(task);
  await launched;await access.revokeAgentExecution('development');
  await assert.rejects(active,/authorized|disabled/i);await activeBroker.close();
  await access.grantAgentExecution('development');
  const moved=join(root,'changed-root');await mkdir(moved);
  const registry=await access.readRegistry();registry.projects[0].root=moved;await access.writeRegistry(registry);
  assert.equal((await broker.preflight({projectId:'development',projectRoot:moved})).authorization.mode,'local-task-confirmation','changing a registered root cannot inherit its old persistent grant');
  await assert.rejects(broker.runTask(task),/mismatched/i);
  await policy.revoke('development');
  await assert.rejects(broker.runTask(task),/grant|disabled/i);
  assert.equal((await policy.status()).developmentGrants.length,0);
  const audit=await readFile(policy.auditPath,'utf8');assert.match(audit,/authorize-development/);assert.match(audit,/project-authorization-used/);
}finally{await broker.close();}
console.log(JSON.stringify({passed:true,root,persistent:true,resume:true,highImpactWaits:true,revocable:true}));
