import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer as netServer } from 'node:net';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, createServer } from '../node_modules/@waishnav/devspace/dist/server.js';
import { WorkspaceRegistry } from '../node_modules/@waishnav/devspace/dist/workspaces.js';
import { TongProjectAccess } from '../scripts/TongProjectAccess.mjs';
import { startMcpGateway } from '../scripts/TongMcpGateway.mjs';
import { issueOAuth } from './fixtures/TongProductionSwitchSupport.mjs';
import { registerTongWorkspaceTools } from '../scripts/TongWorkspaceTools.mjs';
import * as z from 'zod/v4';
import { closeTongMcpTools } from '../scripts/TongMcpTools.mjs';
import { createTongTestDirectory } from './fixtures/TongTestDirectory.mjs';

const temporary = await createTongTestDirectory('tong-p0-');
const state = temporary.path;
const demo = join(state, 'default');
const root = process.argv.slice(2).find(arg => arg !== '--http') ?? join(state, '工作目录');
const http = process.argv.includes('--http');
let server, client, gateway, upstream, passed = false;
try {
  await mkdir(demo); await mkdir(root, { recursive: true });
  Object.assign(process.env, { TONG_RESTRICTED_MCP: '1', TONG_RESTRICTED_ROOT: demo, TONG_LOCAL_STATE_DIR: state });
  const access = new TongProjectAccess({ registryPath: join(state, 'project-access.json'), agentAccessPath: join(state, 'agent-execution.json'), demoRoot: demo });
  await access.addProject({ id: 'acceptance', name: 'P0 acceptance', root, permission: 'write' });
  await access.grantAgentExecution('acceptance');
  const config = { allowedRoots: [demo], agentDir: demo, toolMode: 'minimal', widgets: 'off', skillsEnabled: false, artifactsEnabled: false, subagents: { enabled: false, providers: [] }, logging: { level: 'silent', format: 'json' } };
  config.publicBaseUrl = 'http://127.0.0.1:7677';
  if (http) {
    const reservation = netServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const gatewayPort = reservation.address().port; await new Promise(done => reservation.close(done));
    const ownerToken = randomUUID();
    config.publicBaseUrl = `http://127.0.0.1:${gatewayPort}`;
    Object.assign(config, { host: '127.0.0.1', port: 0, allowedHosts: ['127.0.0.1', 'localhost'], stateDir: join(state, 'oauth'), worktreeRoot: join(state, 'unused'), oauth: { ownerToken, accessTokenTtlSeconds: 3600, refreshTokenTtlSeconds: 7200, scopes: ['devspace'], allowedRedirectHosts: ['127.0.0.1'] } });
    server = createServer(config);
    upstream = server.app.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    gateway = startMcpGateway({ listenPort: gatewayPort, upstreamPort: upstream.address().port, workspaceRoot: demo, logSink: () => {} }); await once(gateway, 'listening');
    const oauth = await issueOAuth(config.publicBaseUrl, ownerToken);
    ({ client } = await oauth.connect(18));
  } else {
    server = createMcpServer(config, new WorkspaceRegistry(config), null, null, () => [], []);
    client = new Client({ name: 'tong-p0-windows', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right); await client.connect(left);
  }
  const call = async (name, args) => {
    try { return await client.callTool({ name, arguments: args }); }
    catch (error) { if (error.code === -32602) return { isError: true, error: error.message }; throw error; }
  };
  const ok = async (name, args) => { const result = await call(name, args); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
  const initialNames = (await readdir(root)).sort();
  assert.equal((await ok('open_workspace', {})).root, demo);
  const { workspaceId } = await ok('open_workspace', { path: root });
  const file = `tong-p0-${randomUUID()}.py`, moved = file.replace('.py', '-moved.py');
  await ok('write', { workspaceId, path: file, content: 'print("before")\n' });
  await ok('edit', { workspaceId, path: file, edits: [{ oldText: 'before', newText: 'Tong Windows P0 OK' }] });
  assert.match(JSON.stringify(await ok('read', { workspaceId, path: file })), /Tong Windows P0 OK/);
  const run = await ok('tong_run_command', { workspaceId, program: 'python', args: [file] });
  assert.equal(run.exitCode, 0); assert.equal(run.stdout.trim(), 'Tong Windows P0 OK'); assert.equal(run.stderr, '');
  assert.equal(run.fileChanges.complete, true);
  console.log(`Python stdout: ${run.stdout.trim()}; exitCode: ${run.exitCode}; cwd: ${run.cwd}`);
  await ok('tong_move_file', { workspaceId, path: file, destination: moved });
  await ok('tong_delete_file', { workspaceId, path: moved });
  const listing = await ok('tong_list_directory', { workspaceId });
  assert.ok(!listing.entries.some(entry => [file, moved].includes(entry.name)));
  assert.ok(!(await readdir(root)).some(name => [file, moved].includes(name)));
  const output = `${file}.txt`;
  const created = await ok('tong_run_command', { workspaceId, program: 'python', args: ['-c', `from pathlib import Path; Path(${JSON.stringify(output)}).write_text('before', encoding='utf-8')`] });
  assert.deepEqual(created.fileChanges.created, [output]);
  const modified = await ok('tong_run_command', { workspaceId, program: 'python', args: ['-c', `from pathlib import Path; Path(${JSON.stringify(output)}).write_text('after', encoding='utf-8')`] });
  assert.deepEqual(modified.fileChanges.modified, [output]);
  await ok('write', { workspaceId, path: file, content: 'keep source' });
  assert.equal((await call('tong_move_file', { workspaceId, path: file, destination: output })).isError, true);
  assert.match(JSON.stringify(await ok('read', { workspaceId, path: file })), /keep source/);
  await ok('tong_delete_file', { workspaceId, path: file });
  const deleted = await ok('tong_run_command', { workspaceId, program: 'python', args: ['-c', `from pathlib import Path; Path(${JSON.stringify(output)}).unlink()`] });
  assert.deepEqual(deleted.fileChanges.deleted, [output]);
  const failed = await call('tong_run_command', { workspaceId, program: 'python', args: ['-c', 'import sys; print("expected error", file=sys.stderr); sys.exit(7)'] });
  assert.equal(failed.isError, true); assert.equal(failed.structuredContent.exitCode, 7); assert.match(failed.structuredContent.stderr, /expected error/);
  const timed = await call('tong_run_command', { workspaceId, program: 'python', args: ['-c', 'import time; time.sleep(10)'], timeoutMs: 150 });
  assert.equal(timed.isError, true); assert.equal(timed.structuredContent.timedOut, true);
  const tree = await call('tong_run_command', { workspaceId, program: 'python', args: ['-c', 'import subprocess, sys; p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"]); print(p.pid, flush=True)'], timeoutMs: 4000 });
  assert.equal(tree.isError, true); assert.equal(tree.structuredContent.timedOut, true);
  const descendant = Number(tree.structuredContent.stdout.trim());
  assert.ok(Number.isInteger(descendant) && descendant > 0, 'Parent must actually start a descendant before timeout');
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' }, 'Job Object must terminate orphan descendants');
  const handlers = {};
  registerTongWorkspaceTools(null, (_server, name, _schema, handler) => { handlers[name] = handler; }, z, { getWorkspace: () => ({ root }) });
  const cancellation = new AbortController(); cancellation.abort();
  const cancelled = await handlers.tong_run_command({ workspaceId, program: 'python', args: ['-c', `from pathlib import Path; Path(${JSON.stringify(output)}).write_text('must not run')`] }, { signal: cancellation.signal });
  assert.equal(cancelled.isError, true); assert.equal(cancelled.structuredContent.code, 20);
  assert.ok(!(await readdir(root)).includes(output));
  for (const program of ['node', 'git', 'npm', 'pwsh']) {
    const version = await ok('tong_run_command', { workspaceId, program, args: ['--version'] });
    assert.equal(version.exitCode, 0); assert.ok(version.stdout.trim());
  }
  for (const name of ['read', 'tong_delete_file']) assert.equal((await call(name, { workspaceId, path: '../outside.txt' })).isError, true);
  assert.equal((await call('tong_list_directory', { workspaceId: 'unknown' })).isError, true);
  assert.equal((await call('open_workspace', { path: state })).isError, true);
  const readRoot = join(state, 'read-only'); await mkdir(readRoot); await writeFile(join(readRoot, 'canary.txt'), 'read-only');
  await access.addProject({ id: 'reader', name: 'Read only', root: readRoot, permission: 'read' });
  const reader = (await ok('open_workspace', { path: readRoot })).workspaceId;
  await ok('read', { workspaceId: reader, path: 'canary.txt' });
  for (const name of ['write', 'tong_delete_file']) assert.equal((await call(name, { workspaceId: reader, path: 'canary.txt', content: 'blocked' })).isError, true);
  await symlink(root, join(readRoot, 'redirect'), 'junction');
  assert.equal((await call('tong_list_directory', { workspaceId: reader, path: 'redirect' })).isError, true);
  assert.deepEqual((await readdir(root)).sort(), initialNames, 'Only test-created files may be removed; directory must be restored');
  await access.revokeAgentExecution('acceptance');
  assert.equal((await call('tong_run_command', { workspaceId, program: 'python', args: ['--version'] })).isError, true);
  await access.disableProject('acceptance');
  assert.equal((await call('read', { workspaceId, path: 'any.txt' })).isError, true);
  console.log(`PASS: real ${process.platform} ${http ? 'OAuth HTTP Gateway -> DevSpace' : 'MCP'} default/selected workspace, Python edit/read/run exit 0/7, command file changes, timeout, node/git/npm/pwsh, move/delete/list, boundaries and live revocation. Root: ${root}`);
  passed = true;
} finally {
  const closed = await Promise.allSettled([
    client?.close(),
    (async () => {
      if (gateway) { gateway.closeAllConnections(); await new Promise(done => gateway.close(done)); }
      await server?.close();
      if (upstream) { upstream.closeAllConnections(); await new Promise(done => upstream.close(done)); }
    })(),
  ]);
  // HTTP server.close owns task cleanup; await it before the idempotent final close.
  closed.push(...await Promise.allSettled([(async () => assert.equal((await closeTongMcpTools()).complete, true))()]));
  const failures = closed.filter(result => result.status === 'rejected');
  await temporary.finish(passed && failures.length === 0);
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Test resource shutdown failed');
}
