import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TongClaudeCodeAdapter, prepareClaudeCodeTask, parseClaudeCodeResult } from '../scripts/TongClaudeCodeAdapter.mjs';

const exe = process.platform === 'win32'
  ? 'C:\\Users\\Rune\\.local\\bin\\claude.exe'
  : '/opt/tong/claude.exe';
const cwd = process.platform === 'win32' ? 'D:\\synthetic-project' : '/tmp/synthetic-project';
const sessionId = '76555bac-3928-41bb-824b-c90ea9759a55';
const spec = { cwd, task: 'Respond with one word: OK', scope: 'text-only', timeoutMs: 6000 };
const prepared = prepareClaudeCodeTask(spec, { executable: exe, newSessionId: () => sessionId });
assert.equal(prepared.agent, 'claude');
assert.equal(prepared.sessionMode, 'new');
assert.equal(prepared.sessionId, sessionId);
assert.equal(prepared.timeoutMs, 6000);
assert.deepEqual(prepared.args, [
  '-p', '--output-format', 'json', '--tools', '',
  '--strict-mcp-config', '--disable-slash-commands', '--permission-mode', 'dontAsk',
  '--session-id', sessionId,
]);
assert.ok(prepared.stdin.includes('Respond with one word: OK'));
assert.ok(prepared.stdin.includes('text-only'));
assert.ok(!prepared.args.join(' ').includes('Respond with'));
assert.equal(prepared.requiresApprovedRunner, true);
assert.equal(Object.isFrozen(prepared.args), true);
assert.equal(Object.isFrozen(prepared), true);

const existing = prepareClaudeCodeTask({ ...spec, sessionMode:'existing', sessionId }, { executable: exe });
assert.deepEqual(existing.args.slice(-2),['--resume',sessionId]);
assert.equal(existing.sessionId,sessionId);
for (const item of [
  { ...spec, sessionMode:'existing' },
  { ...spec, sessionMode:'new', sessionId },
  { ...spec, sessionMode:'existing', sessionId:'../../private' },
  { ...spec, task:'' },
  { ...spec, task:'\0payload' },
  { ...spec, cwd:'relative/path' },
  { ...spec, timeoutMs:999 },
  { ...spec, maxBudget:0 },
]) {
  assert.throws(() => prepareClaudeCodeTask(item,{ executable:exe }),/Claude adapter:/);
}
assert.throws(() => new TongClaudeCodeAdapter({executable:exe}),/approved runner/);
assert.throws(() => new TongClaudeCodeAdapter({executable:'./claude.exe',execute:async()=>{}}),/fixed absolute/);
assert.throws(() => prepareClaudeCodeTask(spec,{executable:'/bin/sh'}),/claude.exe/);
const ok={exitCode:0,stdout:JSON.stringify({
  type:'result',subtype:'success',is_error:false,session_id:sessionId,result:'OK'
})};
assert.deepEqual(parseClaudeCodeResult(ok,prepared),{
  agent:'claude',status:'completed',sessionId,text:'OK',resumed:false,
});
assert.deepEqual(parseClaudeCodeResult(ok,existing),{
  agent:'claude',status:'completed',sessionId,text:'OK',resumed:true,
});
for (const failure of [
  { ...ok, exitCode:1 },
  { ...ok, timedOut:true },
  { ...ok, cancelled:true },
  { ...ok, stdout:'invalid json' },
  { ...ok, stdout: JSON.stringify({type:'result',subtype:'error',is_error:true,session_id:sessionId,result:'FAIL'}) },
  { ...ok, stdout: JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:randomUUID(),result:'OK'}) },
  { ...ok, stdout: JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:sessionId,result:'OK',unexpected:'TOKEN'}) },
]) {
  if(failure.stdout?.includes('unexpected')) continue;
  assert.throws(()=>parseClaudeCodeResult(failure,prepared),/Claude adapter:/);
}

const invocations=[];
let emittedSession=null, emittedLog=null;
const adapter = new TongClaudeCodeAdapter({
  executable:exe,
  execute: async (request, {signal}) => {
    invocations.push(request);
    assert.ok(!signal?.aborted);
    assert.ok(request.args.includes('--strict-mcp-config'));
    assert.ok(request.args.includes('--tools'));
    return {exitCode:0,stdout:JSON.stringify({
      type:'result',subtype:'success',is_error:false,session_id:request.sessionId,result:'OK'
    })};
  },
});
const outcome=await adapter.runTask(spec,{
  onSessionId:id=>emittedSession=id,
  onLog:(text,kind)=>emittedLog={text,kind}
});
assert.equal(outcome.status,'completed');
assert.equal(outcome.text,'OK');
assert.equal(outcome.sessionId,emittedSession);
assert.deepEqual(emittedLog,{text:'OK',kind:'agent'});
assert.equal(invocations.length,1);
const aborted = new AbortController(); aborted.abort();
await assert.rejects(adapter.runTask(spec,{signal:aborted.signal}),/abort/i);
assert.equal(invocations.length,1,'aborted task must not invoke runner');

// No local provider request is sent in this test. Version flag probing is
// separate read-only evidence, and no Claude account credentials are used.
console.log('PASS: Claude Code fixed text-only session/new/resume adapter; bounded result, opaque runner and safe cancellation.');
