import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, opendir, unlink } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTongSafeFilePath, checkedRoot } from './TongSafeFilePath.mjs';

export const WORKSPACE_TOOLS = ['tong_list_directory', 'tong_move_file', 'tong_delete_file', 'tong_run_command'];
const programs = ['python', 'node', 'git', 'npm', 'pwsh'];
const excluded = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
const maxOutput = 64 * 1024;
const running = new Map();
export async function closeTongWorkspaceTools() {
  for (const controller of running.keys()) controller.abort();
  await Promise.allSettled([...running.values()]);
}
const result = (value, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) });

// Observations are bounded; an incomplete scan is explicitly reported, never treated as no changes.
async function snapshot(root) {
  const files = new Map(), skipped = [];
  let visited = 0, bytes = 0, complete = true;
  const deadline = Date.now() + 3000;
  async function walk(directory) {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (++visited > 2000 || Date.now() > deadline) { complete = false; break; }
      const path = join(directory, entry.name), name = relative(root, path).replaceAll('\\', '/');
      if (excluded.has(entry.name) || entry.isSymbolicLink()) { complete = false; skipped.push(name); continue; }
      try {
        await assertTongSafeFilePath(path, { root, cwd: root }, entry.isDirectory() ? 'directory' : 'read');
        if (entry.isDirectory()) { await walk(path); continue; }
        const info = await lstat(path);
        bytes += info.size;
        if (bytes > 32 * 1024 * 1024) { complete = false; skipped.push(name); continue; }
        const hash = createHash('sha256');
        let readBytes = 0;
        for await (const chunk of createReadStream(path)) {
          readBytes += chunk.length;
          if (readBytes > info.size || Date.now() > deadline) throw new Error('Snapshot limit exceeded');
          hash.update(chunk);
        }
        files.set(name, hash.digest('hex'));
      } catch { complete = false; skipped.push(name); }
    }
  }
  await walk(root);
  return { files, complete, skipped };
}
function changes(before, after) {
  return {
    created: [...after.files.keys()].filter(path => !before.files.has(path) && before.complete),
    modified: [...after.files.keys()].filter(path => before.files.has(path) && before.files.get(path) !== after.files.get(path)),
    deleted: [...before.files.keys()].filter(path => !after.files.has(path) && after.complete),
    complete: before.complete && after.complete,
    scope: 'workspace files; bounded to 2000 entries, 32 MiB and 3 seconds per scan',
    skipped: [...new Set([...before.skipped, ...after.skipped])].slice(0, 100),
  };
}
function childEnvironment() {
  // Do not propagate Tong/OAuth tokens, provider keys or arbitrary service environment.
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'systemdrive', 'comspec', 'temp', 'tmp', 'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programdata']);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
}
async function executable(program, env, root) {
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const filename = process.platform === 'win32' ? `${program === 'npm' ? 'node' : program}.exe` : program;
  for (const directory of pathValue.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const rel = relative(root, resolve(directory));
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) continue;
    const path = join(directory, filename);
    try {
      if (!(await lstat(path)).isFile()) continue;
      if (program === 'npm' && process.platform === 'win32') {
        const cli = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (!(await lstat(cli)).isFile()) continue;
        return { path, prefix: [cli] };
      }
      return { path, prefix: [] };
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  throw new Error(`Executable unavailable on service PATH: ${program}`);
}
async function runCommand(root, input, signal) {
  signal?.throwIfAborted();
  await checkedRoot(root, 'project.write');
  await checkedRoot(root, 'agent.execute');
  const env = childEnvironment();
  const command = await executable(input.program, env, root);
  const host = process.platform === 'win32' ? await executable('pwsh', env, root) : null;
  const before = await snapshot(root);
  await checkedRoot(root, 'agent.execute');
  signal?.throwIfAborted();
  const started = Date.now();
  const execution = await new Promise(resolveRun => {
    const args = [...command.prefix, ...(input.args ?? [])];
    const child = spawn(host?.path ?? command.path, host ? ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./TongRunCommand.ps1', import.meta.url))] : args,
      { cwd: root, env, shell: false, windowsHide: true, stdio: [host ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), truncated = false, timedOut = false, cancelled = false, error = null, stopping = false;
    const append = (previous, chunk) => { if (previous.length + chunk.length > maxOutput) truncated = true; return Buffer.concat([previous, chunk.subarray(0, Math.max(0, maxOutput - previous.length))]); };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const stop = () => {
      if (stopping || !child.pid) return; stopping = true;
      // Killing the Windows host closes its private Job Object and kills every descendant.
      if (!child.kill('SIGKILL')) error = 'Command host termination failed';
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutMs ?? 30000);
    const abort = () => { cancelled = true; stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', failure => { error = `${failure.code ?? 'SPAWN_ERROR'}: ${failure.message}`; });
    if (host) {
      child.stdin.on('error', failure => { if (!timedOut && !cancelled) error = `Command host input failed: ${failure.code}`; });
      child.stdin.end(JSON.stringify({ executable: command.path, arguments: args, cwd: root }) + '\n');
    }
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolveRun({ exitCode, signal: exitSignal, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), error, timedOut, cancelled, outputTruncated: truncated });
    });
  });
  let fileChanges;
  try { fileChanges = changes(before, await snapshot(root)); }
  catch (error) { fileChanges = { complete: false, error: error.message }; }
  return { ...execution, cwd: root, durationMs: Date.now() - started, fileChanges };
}

export function registerTongWorkspaceTools(server, register, z, workspaces) {
  if (process.env.TONG_RESTRICTED_MCP !== '1') return;
  const workspaceId = z.string().min(1), path = z.string().min(1).max(4096);
  const registerWorkspace = (name, description, schema, handler, readOnlyHint = false) => register(server, name, {
    title: name, description, inputSchema: { workspaceId, ...schema }, _meta: {}, annotations: { readOnlyHint, destructiveHint: !readOnlyHint },
  }, async (input, extra) => {
    try {
      const workspace = workspaces.getWorkspace(input.workspaceId);
      const root = await checkedRoot(workspace.root);
      const value = await handler(root, input, extra);
      return result(value, name === 'tong_run_command' && (value.exitCode !== 0 || value.timedOut || value.cancelled || Boolean(value.error)));
    } catch (error) { return result({ error: error.message, code: error.code ?? error.name }, true); }
  });
  registerWorkspace('tong_list_directory', 'List a directory in an authorized workspace. Paths are relative; results are bounded.', { path: path.optional(), limit: z.number().int().min(1).max(1000).optional() }, async (root, input) => {
    const target = resolve(root, input.path ?? '.');
    await assertTongSafeFilePath(target, { root, cwd: root }, 'directory');
    const entries = []; let truncated = false;
    for await (const entry of await opendir(target)) {
      if (entries.length >= (input.limit ?? 200)) { truncated = true; break; }
      entries.push({ name: entry.name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' });
    }
    return { path: target, entries, truncated };
  }, true);
  registerWorkspace('tong_delete_file', 'Delete one regular file in an authorized writable workspace. No recursive directory deletion.', { path }, async (root, input) => {
    await assertTongSafeFilePath(input.path, { root, cwd: root }, 'delete');
    await unlink(resolve(root, input.path));
    return { deleted: input.path, fileChanges: { created: [], modified: [], deleted: [input.path], complete: true } };
  });
  registerWorkspace('tong_move_file', 'Move one regular file within a writable workspace. Destination must not exist; parent directory must exist.', { path, destination: path }, async (root, input) => {
    await assertTongSafeFilePath(input.path, { root, cwd: root }, 'move');
    await assertTongSafeFilePath(input.destination, { root, cwd: root }, 'write');
    await copyFile(resolve(root, input.path), resolve(root, input.destination), constants.COPYFILE_EXCL);
    try {
      await assertTongSafeFilePath(input.path, { root, cwd: root }, 'delete');
      await unlink(resolve(root, input.path));
    } catch (error) { throw new Error(`Destination created but source retained: ${error.message}`); }
    return { moved: { from: input.path, to: input.destination }, fileChanges: { created: [input.destination], modified: [], deleted: [input.path], complete: true } };
  });
  registerWorkspace('tong_run_command', 'Run Python, Node, Git, npm or PowerShell 7 with an argv array in the workspace. Requires project.write plus existing agent.execute grant. Trusted local execution, not an OS sandbox. Returns exit code, separate stdout/stderr, timeout status and observed workspace changes.', {
    program: z.enum(programs), args: z.array(z.string().max(8192).refine(value => !value.includes('\0'))).max(128).optional(),
    timeoutMs: z.number().int().min(100).max(120000).optional(),
  }, async (root, input, extra) => {
    const controller = new AbortController();
    const promise = runCommand(root, input, extra.signal ? AbortSignal.any([controller.signal, extra.signal]) : controller.signal);
    running.set(controller, promise);
    try { return await promise; } finally { running.delete(controller); }
  });
}
