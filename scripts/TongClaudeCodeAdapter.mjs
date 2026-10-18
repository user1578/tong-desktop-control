import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

// This adapter only constructs fixed CLI requests and verifies output. The
// caller must provide an independently authorized, Job-backed Windows runner.
// It deliberately cannot spawn Claude or grant task permissions by itself.
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8a-f][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 16_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;

const VALID_FLAGS = Object.freeze([
  '-p', '--output-format', 'json', '--tools', '',
  '--strict-mcp-config', '--disable-slash-commands',
  '--permission-mode', 'dontAsk',
]);

function fail(message) {
  return new Error('Claude adapter: ' + message);
}

function safeSessionId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('invalid native session ID');
  return value;
}

export function prepareClaudeCodeTask(spec, { executable, newSessionId = randomUUID } = {}) {
  if (typeof executable !== 'string' || !isAbsolute(executable) ||
      !/claude\.exe$/i.test(executable) || /[\r\n\0]/.test(executable)) {
    throw fail('a fixed absolute claude.exe is required');
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some(key => !['cwd','task','scope','sessionMode','sessionId','timeoutMs'].includes(key))) {
    throw fail('invalid request');
  }
  if (typeof spec.cwd !== 'string' || !isAbsolute(spec.cwd) || /[\r\n\0]/.test(spec.cwd) ||
      typeof spec.task !== 'string' || !spec.task.trim() || spec.task.length > MAX_TEXT_CHARS || spec.task.includes('\0') ||
      typeof spec.scope !== 'string' || !spec.scope.trim() || spec.scope.length > 2000 || spec.scope.includes('\0') ||
      (spec.sessionMode !== undefined && !['new','existing'].includes(spec.sessionMode)) ||
      (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1000 || spec.timeoutMs > MAX_TIMEOUT_MS))) {
    throw fail('invalid task specification');
  }
  const mode = spec.sessionMode ?? 'new';
  if ((mode === 'existing') !== (spec.sessionId !== undefined)) throw fail('native session selection mismatch');
  const sessionId = mode === 'existing' ? safeSessionId(spec.sessionId) : safeSessionId(newSessionId());
  const args = [...VALID_FLAGS, mode === 'new' ? '--session-id' : '--resume', sessionId];
  const prompt = [
    'You are executing an authorized Tong text-only Claude Code task.',
    'Do not use any tools, access files, install dependencies, or modify the system.',
    'Allowed scope: ' + spec.scope.trim(),
    'Task: ' + spec.task.trim(),
  ].join('\n\n');
  return Object.freeze({
    agent: 'claude',
    executable,
    args: Object.freeze(args),
    cwd: resolve(spec.cwd),
    stdin: prompt,
    timeoutMs: spec.timeoutMs ?? 180000,
    sessionId,
    sessionMode: mode,
    // The caller is responsible for an allowlisted environment, authorization,
    // process-tree cancellation and stdout/stderr bounds.
    requiresApprovedRunner: true,
  });
}

export function parseClaudeCodeResult(response, request) {
  if (!request || request.agent !== 'claude' || !UUID.test(request.sessionId ?? '')) {
    throw fail('invalid prepared request');
  }
  // Stderr is not returned to the user: it can contain provider diagnostics,
  // credentials, OAuth failures or paths.
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      response.timedOut || response.cancelled || response.error || response.exitCode !== 0 ||
      typeof response.stdout !== 'string' || Buffer.byteLength(response.stdout) > MAX_JSON_BYTES) {
    throw fail('CLI execution failed');
  }
  let data;
  try { data = JSON.parse(response.stdout); }
  catch { throw fail('invalid CLI JSON result'); }
  if (!data || data.type !== 'result' || data.is_error !== false ||
      data.subtype !== 'success' || typeof data.session_id !== 'string' ||
      data.session_id !== request.sessionId || typeof data.result !== 'string' ||
      data.result.length > MAX_TEXT_CHARS) {
    throw fail('CLI result did not confirm the requested native session');
  }
  return Object.freeze({
    agent: 'claude',
    status: 'completed',
    sessionId: data.session_id,
    text: data.result,
    resumed: request.sessionMode === 'existing',
  });
}

export class TongClaudeCodeAdapter {
  constructor({ executable, execute } = {}) {
    if (typeof execute !== 'function') throw fail('an approved runner is required');
    if (typeof executable !== 'string' || !isAbsolute(executable) || !/claude\.exe$/i.test(executable)) {
      throw fail('a fixed absolute claude.exe is required');
    }
    this.executable = executable;
    this.execute = execute;
  }

  async runTask(spec, { signal, onSessionId = () => {}, onLog = () => {} } = {}) {
    const request = prepareClaudeCodeTask(spec, { executable: this.executable });
    signal?.throwIfAborted();
    // No task runs without explicit execution capability supplied by a trusted
    // manager. Never quietly fall back to child_process.spawn.
    const response = await this.execute(request, { signal });
    signal?.throwIfAborted();
    const result = parseClaudeCodeResult(response, request);
    onSessionId(result.sessionId);
    onLog(result.text, 'agent');
    return result;
  }
}
