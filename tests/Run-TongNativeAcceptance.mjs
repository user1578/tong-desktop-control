// Opt-in live test. Uses development state and the real MCP handlers + trusted broker.
// It never approves its own tasks or changes the production configuration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import * as z from 'zod/v4';
import { TongProjectAccess } from '../scripts/TongProjectAccess.mjs';
import { TongTrustedPolicy } from '../scripts/TongTrustedCodexBroker.mjs';
import { TongAgentTaskManager } from '../scripts/TongAgentTasks.mjs';
import { registerTongMcpTools } from '../scripts/TongMcpTools.mjs';
import { snapshotProject } from './fixtures/TongProjectSnapshot.mjs';

const argv = process.argv.slice(2);
const phase = argv[0];
const cwd = 'D:\\作业\\111';
const projectId = 'p0-homework-111';
const stateDir = fileURLToPath(new URL('../runtime/p1-native/state/', import.meta.url));
const evidencePath = join(stateDir, 'acceptance.json');
const access = new TongProjectAccess({registryPath:join(stateDir,'project-access.json'),
  agentAccessPath:join(stateDir,'agent-execution.json'),scanRoots:[]});
const policy = new TongTrustedPolicy({policyPath:join(stateDir,'trusted-codex.json'),
  taskStatePath:join(stateDir,'agent-tasks.json')});
if (phase === 'prepare') {
  if (argv.length !== 2 || !isAbsolute(argv[1])) throw new Error('Usage: node tests/Run-TongNativeAcceptance.mjs prepare ABSOLUTE_CODEX_EXE');
  const lock=await lstat(join(stateDir,'agent-tasks.json.manager.lock')).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  assert.equal(lock,null,'Stop the development acceptance manager before preparing its policy');
  const existing=(await access.listProjects()).find(project=>project.id===projectId);
  if(existing) {
    assert.equal(resolve(existing.root).toLowerCase(),resolve(cwd).toLowerCase());
    assert.equal(existing.permission,'write');assert.equal(existing.status,'enabled');assert.equal(existing.available,true);
  } else await access.addProject({id:projectId,name:'P1 native acceptance only',root:cwd,permission:'write'});
  assert.ok((await policy.status()).projects.every(id=>id===projectId),'Acceptance state must not grant other projects');
  await access.grantAgentExecution(projectId);
  await policy.enable(argv[1]);
  await policy.grant(projectId,access);
  console.log(JSON.stringify({stateDir,policy:await policy.status()}));
} else if (phase === 'text' || phase === 'code') {
  assert.equal(argv.length,1);
  const configured = await policy.status();
  assert.equal(configured.enabled,true,'Run prepare for the development state first');
  assert.deepEqual(configured.projects,[projectId]);
  let evidence = {schemaVersion:1,projectId,cwd,transport:'MCP InMemoryTransport (development handlers, not production connector)',tasks:[]};
  if (phase === 'code') evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  if (phase === 'code') assert.equal(evidence.textPassed,true,'Both text turns must pass before file testing');
  const baseline = await snapshotProject(cwd);
  const tasks = new TongAgentTaskManager({access,statePath:join(stateDir,'agent-tasks.json')});
  const server = new McpServer({name:'tong-p1-native-acceptance',version:'1'});
  process.env.TONG_RESTRICTED_MCP='1';
  registerTongMcpTools(server,registerAppTool,z,access,tasks);
  const client = new Client({name:'tong-p1-live-client',version:'1'},{capabilities:{}});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  async function call(name,args) {
    const response=await client.callTool({name,arguments:args});
    assert.ok(!response.isError,JSON.stringify(response.content));
    return response.structuredContent;
  }
  async function turn(request) {
    const task=await call('tong_agent_start',{projectId,agent:'codex',timeoutSeconds:600,
      idempotencyKey:`p1-native-${randomUUID()}`,...request});
    let announced=false;
    for (;;) {
      const {task:status}=await call('tong_agent_status',{taskId:task.taskId});
      if(status.pendingApproval&&!announced){
        console.log(JSON.stringify({event:'local_approval_required',taskId:task.taskId,
          codexSessionId:status.codexSessionId,task:request.task,scope:request.scope,stateDir}));
        console.log(`node scripts/TongTrustedControl.mjs --state-dir "${stateDir}" task ${task.taskId}`);
        console.log(`node scripts/TongTrustedControl.mjs --state-dir "${stateDir}" approve ${task.taskId}`);
        announced=true;
      }
      if(['success','failed','cancelled'].includes(status.status)){
        const result=await call('tong_agent_result',{taskId:task.taskId});
        const logs=await call('tong_agent_logs',{taskId:task.taskId,limit:100});
        evidence.tasks.push({result,logs});
        await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
        console.log(JSON.stringify({event:'task_result',...result}));
        assert.equal(status.status,'success',JSON.stringify(result));
        assert.ok(result.codexSessionId&&result.codexTurnId);
        return result;
      }
      await delay(500);
    }
  }
  try {
    await server.connect(st);await client.connect(ct);
    if(phase==='text'){
      const nonce=`TONG_P1_TEXT_1_${randomUUID().slice(0,8)}`;
      const scope='Text reply only. Do not invoke tools, read files, or modify files.';
      const first=await turn({sessionMode:'new',scope,
        task:`Reply with exactly ${nonce}. Do not invoke any tools or read or modify any files.`});
      assert.equal(first.agentSummary.trim(),nonce);
      const sessions=await call('tong_agent_sessions',{projectId,limit:100});
      assert.ok(sessions.sessions.some(t=>t.id===first.codexSessionId));
      const second=await turn({sessionMode:'existing',codexSessionId:first.codexSessionId,scope,
        task:'Recall the exact verification string requested in the preceding user turn. Reply with that same string followed by |TONG_P1_TEXT_2. Do not invoke tools or read or modify files.'});
      assert.equal(second.codexSessionId,first.codexSessionId);
      assert.notEqual(second.codexTurnId,first.codexTurnId);
      assert.equal(second.agentSummary.trim(),`${nonce}|TONG_P1_TEXT_2`);
      assert.deepEqual(await snapshotProject(cwd),baseline);
      evidence.textPassed=true;evidence.codexSessionId=first.codexSessionId;
    } else {
      const name=`tong-p1-acceptance-${randomUUID()}.mjs`;
      const path=join(cwd,name);
      assert.ok(!baseline.some(([path])=>path===name));
      const expected='export const tongP1Acceptance = 42;\n';
      try {
      await turn({sessionMode:'existing',codexSessionId:evidence.codexSessionId,
        scope:`Create only the new test file ${name} in the authorized root. Do not edit or delete any other files.`,
        task:`Create ${name} with exactly this JavaScript (and a final newline): export const tongP1Acceptance = 42; Then reply TONG_P1_CODE_OK. Do not modify any other files.`});
      const info=await lstat(path);
      assert.ok(info.isFile()&&!info.isSymbolicLink());
      assert.equal(await readFile(path,'utf8'),expected);
      assert.equal((await import(`file:///${resolve(path).replaceAll('\\','/')}`)).tongP1Acceptance,42);
      } finally {
        const info=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
        if(info){
          assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);
          await unlink(path); // Only this run's previously absent UUID file; never recursively removes files.
        }
      }
      assert.deepEqual(await snapshotProject(cwd),baseline);
      evidence.codePassed=true;
    }
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify({event:'acceptance_passed',phase,evidencePath,codexSessionId:evidence.codexSessionId}));
  } finally {
    await tasks.close();await tasks.workerBroker.close();await client.close();await server.close();
    delete process.env.TONG_RESTRICTED_MCP;
  }
} else throw new Error('Usage: node tests/Run-TongNativeAcceptance.mjs prepare ABSOLUTE_CODEX_EXE | text | code');
