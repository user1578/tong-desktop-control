import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TongProjectAccess} from '../scripts/TongProjectAccess.mjs';
import {TongAgentTaskManager} from '../scripts/TongAgentTasks.mjs';
import {TongTrustedPolicy,TongTrustedCodexBroker,TongExecutorRouter} from '../scripts/TongTrustedCodexBroker.mjs';
import {authorizeAgentDockDevelopment} from '../scripts/TongAgentDockAuthorization.mjs';
import {resolveAgentDockProject} from '../scripts/TongAgentDockPolicy.mjs';

const root=await mkdtemp('D:\\Tong\\state\\development-tasks-'),projectRoot=join(root,'project'),state=join(root,'state');
await mkdir(projectRoot);await mkdir(state);
const access=new TongProjectAccess({registryPath:join(state,'projects.json'),agentAccessPath:join(state,'agent.json'),demoRoot:join(root,'demo')});
await access.addProject({id:'development',name:'Development',root:projectRoot,permission:'write'});await access.grantAgentExecution('development');
const policy=new TongTrustedPolicy({policyPath:join(state,'trusted.json'),taskStatePath:join(state,'tasks.json')});
const executable=join(root,'codex.exe');await writeFile(executable,'synthetic executable');await policy.enable(executable);await policy.grant('development',access);await policy.authorizeDevelopment('development',access);
const calls=[];
const trusted=new TongTrustedCodexBroker({access,policy,pollMs:5,adapterFactory:()=>({async selectSession(){return null;},async runTask(spec,{onSessionId}){calls.push(spec);await onSessionId(spec.threadId??'native-session');return {threadId:spec.threadId??'native-session',turnStatus:'completed'};}})});
const isolated={async preflight(){throw new Error('disabled');},async runTask(){throw new Error('disabled');},async close(){}};
const manager=new TongAgentTaskManager({access,statePath:policy.taskStatePath,workerBroker:new TongExecutorRouter({policy,isolated,trusted}),collectResult:async()=>({changedFiles:[]}),defaultTimeoutMs:3000,maxTaskRuntimeMs:5000});
const request={projectId:'development',agent:'codex',task:'build and test',scope:'this project only',sessionMode:'new',idempotencyKey:'development-start-0001',timeoutSeconds:3};
async function waitFor(id,status){const deadline=Date.now()+2000;while(Date.now()<deadline){const task=await manager.status(id);if(task.status===status)return task;await new Promise(r=>setTimeout(r,5));}throw new Error('Expected '+status);}
try{
  await manager.ready;
  await assert.rejects(manager.start({...request,workType:'unknown'}),/work type/i);
  await assert.rejects(manager.start({...request,requiredCapabilities:['git.push']}),/outside project authorization/i);
  assert.equal(calls.length,0);
  const task=await manager.start(request);assert.equal(task.authorization.mode,'project-development');
  await waitFor(task.taskId,'success');
  await manager.resume(task.taskId,{message:'continue normal development'});await waitFor(task.taskId,'success');
  assert.equal(calls.length,2);assert.equal(calls[1].threadId,'native-session');
  await policy.authorizeDevelopment('development',access,{gitPush:true});
  const withGit=await manager.start({...request,idempotencyKey:'development-previous-git-1'});await waitFor(withGit.taskId,'success');
  await policy.authorizeDevelopment('development',access,{gitPush:false});
  await manager.resume(withGit.taskId,{message:'continue without Git push'});await waitFor(withGit.taskId,'success');
  assert.ok(!(await manager.status(withGit.taskId)).authorization.capabilities.includes('git.push'));
  assert.ok(!calls.at(-1).prompt.includes('"git.push"'),'resumed prompt must use the narrowed live grant');
  const beforeHigh=calls.length;
  const high=await manager.start({...request,workType:'high-impact',requiredCapabilities:['git.push'],idempotencyKey:'development-high-impact-0001'});
  await waitFor(high.taskId,'waiting_user_action');assert.equal(calls.length,beforeHigh);
  const confirmation=await policy.taskForConfirmation(high.taskId);
  // A changed continuation/scope must invalidate the exact local confirmation.
  const saved=JSON.parse(await readFile(policy.taskStatePath,'utf8'));
  saved.tasks.find(t=>t.taskId===high.taskId).scope='changed workflow';await writeFile(policy.taskStatePath,JSON.stringify(saved));
  await assert.rejects(policy.approveTask(high.taskId,confirmation.fingerprint),/changed during confirmation/);
  saved.tasks.find(t=>t.taskId===high.taskId).scope=request.scope;await writeFile(policy.taskStatePath,JSON.stringify(saved));
  await policy.approveTask(high.taskId,confirmation.fingerprint);await waitFor(high.taskId,'success');assert.equal(calls.length,beforeHigh+1);
  const dockPolicy=join(state,'dock.json');await writeFile(dockPolicy,JSON.stringify({schemaVersion:1,projects:[],approvals:[]}));
  await authorizeAgentDockDevelopment(access,dockPolicy,'development',{trustedPolicyPath:policy.policyPath});
  assert.equal((await resolveAgentDockProject(access,dockPolicy,'development')).grant.scope,'project-development');
  await access.revokeAgentExecution('development');
  await assert.rejects(resolveAgentDockProject(access,dockPolicy,'development'),/authorized/i);
  await assert.rejects(manager.start({...request,idempotencyKey:'revoked-development-task'}),/authorized/i);
}finally{await manager.close();await trusted.close();}
console.log(JSON.stringify({passed:true,root,taskAndResume:true,preflight:true,scopedConfirmation:true,dockManagement:true,revocation:true}));
