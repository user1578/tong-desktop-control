import assert from 'node:assert/strict';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TongWorkflowJournal } from '../scripts/TongWorkflowJournal.mjs';
import { TongAgentProviderRegistry } from '../scripts/TongAgentProviders.mjs';
import { TongMultiAgentOrchestrator } from '../scripts/TongMultiAgentOrchestrator.mjs';

// GitHub Windows runner temp paths may traverse managed junctions; use the
// canonical parent so the journal's strict root-path guard stays unchanged.
const temporary = await mkdtemp(join(tmpdir(), 'tong-p3-journal-'));
const tmp = await realpath(temporary);
const root = join(tmp,'private-state');
const project = join(tmp,'project');
const registry=new TongAgentProviderRegistry().register({
  id:'fake',sessionModes:['new'],
  preflight:async()=>({mode:'trusted-windows'}),
  normalizeResult:raw=>({completed:raw.status==='completed',sessionId:raw.sessionId,summary:raw.text}),
  runTask:async ({task})=>({status:task==='fail'?'failed':'completed',
    sessionId:'native-test-'+randomUUID(),text:'synthetic secret=NOT_SAVED_TO_JOURNAL'}),
});
const journal = new TongWorkflowJournal({rootDir:root});
const make = (workflowId,tasks=['stage one','stage two']) => ({
  workflowId, projectId:'synthetic',projectRoot:project,
  steps:tasks.map(task=>({agent:'fake',task,scope:'synthetic only'})),
});

try {
  const id='p3-journal-success-test-0001';
  const orchestrator=new TongMultiAgentOrchestrator({registry,journal});
  const finished=await orchestrator.runWorkflow(make(id));
  assert.equal(finished.status,'completed');
  const state=await journal.read(id);
  assert.equal(state.schemaVersion,1);
  assert.equal(state.status,'completed');
  assert.deepEqual(state.events.map(e=>e.type),[
    'step-started','step-completed','step-started','step-completed']);
  assert.equal(state.events[0].agent,'fake');
  assert.equal(state.events[1].sessionId,finished.steps[0].sessionId);
  assert.equal(state.projectRootDigest.length,64);
  assert.ok(!JSON.stringify(state).includes('NOT_SAVED_TO_JOURNAL'));
  assert.ok(!JSON.stringify(state).includes('stage one'));
  assert.ok(!JSON.stringify(state).includes(project),'persist a digest, not local project root');
  assert.deepEqual(await readdir(join(root,'locks')),[],'normal exit releases project lock');
  await assert.rejects(orchestrator.runWorkflow(make(id)),/already exists/);

  const denied='p3-journal-failed-stage-0001';
  await assert.rejects(orchestrator.runWorkflow(make(denied,['stage one','fail'])),/stopped at step 2/);
  const badState=await journal.read(denied);
  assert.equal(badState.status,'failed');
  assert.deepEqual(badState.events.slice(-1).map(e=>e.type),['step-failed']);
  assert.deepEqual(await readdir(join(root,'locks')),[]);

  let release;
  const latch=new Promise(done=>{release=done});
  let started;
  const waiting=new Promise(done=>{started=done});
  const longRegistry=new TongAgentProviderRegistry().register({
    id:'fake',sessionModes:['new'],
    preflight:async()=>({mode:'trusted-windows'}),
    normalizeResult:raw=>({completed:true,sessionId:'session',summary:raw.summary}),
    runTask:async()=>{started();await latch;return{summary:'ok'}},
  });
  const busy=new TongMultiAgentOrchestrator({registry:longRegistry,journal});
  const first=busy.runWorkflow(make('p3-journal-running-00001'));
  await waiting;
  await assert.rejects(new TongMultiAgentOrchestrator({registry,journal}).runWorkflow(
    make('p3-journal-other-run-01')),/project workflow lock exists/);
  assert.equal((await journal.read('p3-journal-running-00001')).status,'running');
  release();await first;
  assert.equal((await journal.read('p3-journal-running-00001')).status,'completed');

  // Unfinished workflow lock blocks new runs; never infer safe recovery.
  const manual=await journal.start({workflowId:'p3-journal-incomplete-001',projectId:'synthetic',projectRoot:project});
  await manual.record({type:'step-started',index:0,agent:'fake',taskId:'synthetic-id'});
  await assert.rejects(new TongMultiAgentOrchestrator({registry,journal}).runWorkflow(
    make('p3-journal-recovery-no-autostart')),/project workflow lock exists/);
  assert.equal((await journal.read('p3-journal-incomplete-001')).status,'running');
  await manual.finish('cancelled');
  assert.equal((await journal.read('p3-journal-incomplete-001')).status,'cancelled');
  await assert.rejects(manual.record({type:'step-failed',index:0,agent:'fake'}),/already finished/);
  const entries=await readdir(root);
  assert.ok(entries.length>=4);
} finally { await rm(temporary,{recursive:true,force:true}); }
console.log('PASS: durable journal, stage IDs, failure/cancel records, cross-instance lock and no automatic recovery.');
