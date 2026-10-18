import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';

// DeepSeek Harness Python SDK contract. The injected trusted runner owns the
// SDK process, credentials, profile configuration, Job Object and cancellation.
// This module cannot spawn a model or a shell and cannot confer permissions.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const RUNTIME_VERSION = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/;
const MAX_RESPONSE = 256 * 1024;
const MAX_PROMPT = 16000;
const MAX_TIMEOUT = 3600000;

function fail(reason) { return new Error('DeepSeek Harness adapter: ' + reason); }
function validAbsolute(path) {
  return typeof path === 'string' && isAbsolute(path) && !/[\r\n\0]/.test(path);
}
function validSession(value) {
  return typeof value === 'string' && SESSION_ID.test(value);
}

export function prepareDshSdkTask(spec, { dshHome, runtimeVersion, newSessionId = randomUUID } = {}) {
  if (!validAbsolute(dshHome) || !RUNTIME_VERSION.test(runtimeVersion ?? ''))
    throw fail('explicit Harness home and pinned runtime version are required');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some(key => !['cwd','task','scope','sessionMode','sessionId','timeoutMs'].includes(key)) ||
      !validAbsolute(spec.cwd) ||
      typeof spec.task !== 'string' || !spec.task.trim() || spec.task.length > MAX_PROMPT || spec.task.includes('\0') ||
      typeof spec.scope !== 'string' || !spec.scope.trim() || spec.scope.length > 2000 || spec.scope.includes('\0') ||
      (spec.sessionMode !== undefined && !['new','existing'].includes(spec.sessionMode)) ||
      (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) ||
        spec.timeoutMs < 1000 || spec.timeoutMs > MAX_TIMEOUT))) throw fail('invalid task specification');
  const cwd = resolve(spec.cwd), home = resolve(dshHome);
  const fold = process.platform === 'win32' ? value => value.toLowerCase() : value => value;
  if (fold(home) === fold(cwd) || fold(home).startsWith(fold(cwd) + sep))
    throw fail('Harness state must be outside the project');
  const mode = spec.sessionMode ?? 'new';
  if ((mode === 'existing') !== (spec.sessionId !== undefined))
    throw fail('native session selection mismatch');
  const sessionId = mode === 'existing' ? spec.sessionId : newSessionId();
  if (!validSession(sessionId)) throw fail('invalid native session ID');
  const prompt = [
    'Tong-authorized DeepSeek Harness task. Operate only with permissions supplied by the verified runner.',
    'Do not use any capability outside the authorized scope. Stop when a tool needs new approval.',
    'Allowed scope: ' + spec.scope.trim(),
    'Task: ' + spec.task.trim(),
  ].join('\n\n');
  // Python runner MUST call resume_session(sessionId) for existing; calling
  // harness.run(..., session_id=id) does not prove a persisted resume.
  return Object.freeze({
    agent: 'dsh', api: 'deepseek-harness-python-sdk',
    profile: 'sdk', provider: 'deepseek-official', model: 'deepseek-v4-flash',
    runtimeVersion, dshHome: home, cwd,
    sessionMode: mode, sessionId, prompt,
    timeoutMs: spec.timeoutMs ?? 180000,
    requiresApprovedRunner: true, requiresProcessIsolation: true,
  });
}

export function parseDshSdkResult(reply, request) {
  if (!request || request.agent !== 'dsh' || !validSession(request.sessionId))
    throw fail('invalid prepared request');
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) ||
      reply.timedOut || reply.cancelled || reply.error || reply.exitCode !== 0 ||
      typeof reply.stdout !== 'string' || Buffer.byteLength(reply.stdout, 'utf8') > MAX_RESPONSE)
    throw fail('SDK execution failed');
  let data;
  try { data = JSON.parse(reply.stdout); }
  catch { throw fail('invalid SDK response'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      data.session_id !== request.sessionId || data.finish_reason !== 'completed' ||
      typeof data.final_response !== 'string' || data.final_response.length > MAX_PROMPT)
    throw fail('SDK result did not confirm a completed native session');
  return Object.freeze({
    agent: 'dsh', status: 'completed', sessionId: data.session_id,
    text: data.final_response, resumed: request.sessionMode === 'existing',
  });
}

export class TongDshSdkAdapter {
  constructor({ dshHome, runtimeVersion, execute } = {}) {
    if (typeof execute !== 'function') throw fail('approved SDK runner is required');
    if (!validAbsolute(dshHome) || !RUNTIME_VERSION.test(runtimeVersion ?? ''))
      throw fail('explicit Harness home and pinned runtime version are required');
    this.dshHome = dshHome;
    this.runtimeVersion = runtimeVersion;
    this.execute = execute;
  }

  async runTask(spec, { signal, onSessionId = () => {}, onLog = () => {} } = {}) {
    const request = prepareDshSdkTask(spec, {
      dshHome: this.dshHome, runtimeVersion: this.runtimeVersion,
    });
    signal?.throwIfAborted();
    const reply = await this.execute(request, { signal });
    signal?.throwIfAborted();
    const result = parseDshSdkResult(reply, request);
    await onSessionId(result.sessionId);
    await onLog(result.text, 'agent');
    return result;
  }
}
