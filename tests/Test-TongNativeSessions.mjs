import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexAppServerAdapter } from '../scripts/TongCodexAppServer.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTongTestDirectory } from './fixtures/TongTestDirectory.mjs';
import { snapshotProject } from './fixtures/TongProjectSnapshot.mjs';

const cwd = 'D:\\synthetic\\project';
const thread = (id, overrides = {}) => ({ id, cwd, source: 'appServer', name: 'Test session',
  createdAt: 10, updatedAt: 20, status: { type: 'notLoaded' }, ephemeral: false, parentThreadId: null,
  canAcceptDirectInput: null, preview: 'PRIVATE_HISTORY', path: 'PRIVATE_ROLLOUT', ...overrides });
class ProtocolProcess extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); killed = false;
  constructor({ pages = [{ data: [], nextCursor: null }], stored = thread('saved'), turnStatus = 'completed', onRead = () => {} } = {}) {
    super(); this.requests = []; this.page = 0;
    this.stdin = new Writable({ write: (chunk, _, done) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const m = JSON.parse(line); this.requests.push(m);
        if (!m.id) continue;
        let result = {};
        if (m.method === 'initialize') result = { userAgent: 'local-schema' };
        if (m.method === 'thread/list') result = pages[this.page++];
        if (m.method === 'project/list') result = { data: [{ id: 'desktop-project', roots: [{ path: cwd }] }], nextCursor: null };
        if (m.method === 'thread/read') { onRead(); result = { thread: stored }; }
        if (m.method === 'thread/resume') result = { thread: stored };
        if (m.method === 'thread/start') result = { thread: thread('new', { projectId: m.params.projectId }) };
        if (m.method === 'turn/start') result = { turn: { id: 'turn-1', status: 'inProgress' } };
        this.stdout.write(JSON.stringify({ id: m.id, result })+'\n');
        if (m.method === 'turn/start') queueMicrotask(() => {
          const params = { threadId: m.params.threadId, turnId: 'turn-1' };
          this.stdout.write(JSON.stringify({method:'item/completed', params:{...params,
            item:{type:'agentMessage',id:'final',text:'Full final answer',phase:'final_answer'}}})+'\n');
          this.stdout.write(JSON.stringify({method:'turn/completed',params:{...params,turn:{id:'turn-1',
            status:turnStatus,items:[],error:turnStatus==='failed'?{message:'Model failed password=private-token'}:null}}})+'\n');
        });
      } done();
    }, final: done => {this.exit(); done();} });
  }
  exit() { if(this.exited)return; this.exited=true; this.stdout.end();this.stderr.end();this.emit('close',0); }
  kill() {this.killed=true;this.exit();}
}
function adapter(options) {
  const process = new ProtocolProcess(options);
  return { process, client: new CodexAppServerAdapter({ executable:'C:\\fixed\\codex.exe',
    spawnProcess:()=>process, requestTimeoutMs:500, shutdownTimeoutMs:10 }) };
}

// Catches unfiltered cross-project metadata, history leakage and wrong source/sort filters.
const listed = adapter({ pages:[{data:[thread('saved'),thread('outside',{cwd:'D:\\other'}),
  thread('child',{parentThreadId:'parent'}),thread('ephemeral',{ephemeral:true})],nextCursor:'page-two'}] });
const page = await listed.client.listSessions({cwd,limit:10,searchTerm:'Test'});
assert.deepEqual(page.sessions.map(t=>t.id),['saved']);
assert.equal(page.nextCursor,'page-two');
assert.doesNotMatch(JSON.stringify(page),/PRIVATE_HISTORY|PRIVATE_ROLLOUT/);
const listRequest=listed.process.requests.find(m=>m.method==='thread/list');
assert.equal(listRequest.params.cwd,cwd);
assert.equal(listRequest.params.sortKey,'updated_at');
assert.ok(listRequest.params.sourceKinds.includes('appServer'));
assert.equal(listRequest.params.useStateDbOnly,true);

// "latest" preserves the newest matching native thread even if another
// surface holds it; never silently switch the user's task to an older thread.
const latest=adapter({pages:[{data:[thread('busy',{status:{type:'active'}})],nextCursor:'second'},
  {data:[thread('older')],nextCursor:null}]});
assert.equal(await latest.client.selectSession({cwd,sessionMode:'latest'}),'busy');
assert.equal(latest.process.requests.filter(m=>m.method==='thread/list').length,1);
assert.equal(page.sessions[0].writerOwnershipVerified,false);
const mismatch=adapter({stored:thread('saved',{cwd:'D:\\other'})});
await assert.rejects(mismatch.client.runTask({cwd,prompt:'Continue',threadId:'saved'}),/project|mismatch/i);
assert.ok(!mismatch.process.requests.some(m=>m.method==='thread/resume'||m.method==='turn/start'));
const busy=adapter({stored:thread('saved',{status:{type:'active'}})});
await assert.rejects(busy.client.runTask({cwd,prompt:'Continue',threadId:'saved'}),error=>{
  assert.equal(error.code,'CODEX_SESSION_NOT_READY');
  assert.match(error.message,/busy/i);
  return true;
});
assert.ok(!busy.process.requests.some(m=>['thread/resume','thread/start','turn/start'].includes(m.method)));
const cancelledController=new AbortController();
const cancelled=adapter({onRead:()=>cancelledController.abort(new Error('cancelled during metadata read'))});
await assert.rejects(cancelled.client.runTask({cwd,prompt:'Must not append',threadId:'saved'},
  {signal:cancelledController.signal}),/cancelled during metadata read/);
assert.ok(!cancelled.process.requests.some(m=>m.method==='thread/resume'||m.method==='turn/start'));
const sessionController=new AbortController();
const cancelledSession=adapter();
await assert.rejects(cancelledSession.client.runTask({cwd,prompt:'Must not append'},
  {signal:sessionController.signal,onSessionId:()=>sessionController.abort(new Error('cancelled before turn'))}),/cancelled before turn/);
assert.ok(!cancelledSession.process.requests.some(m=>m.method==='turn/start'));
for (const stored of [thread('different-id'),thread('saved',{ephemeral:true}),
  thread('saved',{path:'C:\\local\\archived_sessions\\saved.jsonl'})]) {
  const invalid=adapter({stored});
  await assert.rejects(invalid.client.runTask({cwd,prompt:'Continue',threadId:'saved'}),/mismatch|unavailable/i);
  assert.ok(!invalid.process.requests.some(m=>m.method==='thread/resume'||m.method==='thread/start'));
}
const failed=adapter({turnStatus:'failed'});
const result=await failed.client.runTask({cwd,prompt:'test'});
assert.equal(result.turnStatus,'failed');
assert.equal(result.turnId,'turn-1');
assert.equal(result.summary,'Full final answer','item/completed must supply the answer when turn items are omitted');
assert.match(result.error.message,/Model failed/);
assert.doesNotMatch(result.error.message,/private-token/);
const temporary=await createTongTestDirectory('tong-native-snapshot-');
let passed=false;
try {
  await mkdir(join(temporary.path,'nested'));
  await writeFile(join(temporary.path,'nested','existing.txt'),'original');
  const before=await snapshotProject(temporary.path);
  await writeFile(join(temporary.path,'nested','existing.txt'),'modified');
  assert.notDeepEqual(await snapshotProject(temporary.path),before,'same file names must not conceal content changes');
  await writeFile(join(temporary.path,'nested','existing.txt'),'original');
  assert.deepEqual(await snapshotProject(temporary.path),before);
  passed=true;
} finally { await temporary.finish(passed); }
console.log('PASS: project-scoped native discovery, newest exact-session selection, safe resume and final/error evidence.');
