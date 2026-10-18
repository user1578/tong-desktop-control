import { randomUUID } from 'node:crypto';
import { win32 } from 'node:path';
import { discoverDshDesktopRuntime } from './TongDshDesktopRuntime.mjs';

const CLAUDE_VERSION = '2.1.236';
const DSH_VERSION = '0.2.0-rc.2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
function invalid(message) { return new Error('Provider acceptance: ' + message); }

// This is a LOCAL INTERACTIVE acceptance recipe, NOT Tong's trusted executor.
// No project repository or production Tong state is part of an acceptance run.
export function prepareLocalProviderAcceptance({
  provider, userProfile, localAppData,
  sessionMode = 'new', sessionId,
  newSessionId = randomUUID,
} = {}) {
  if (!['claude', 'dsh'].includes(provider) ||
      typeof userProfile !== 'string' || !win32.isAbsolute(userProfile) ||
      /[\r\n\0]/.test(userProfile) ||
      typeof localAppData !== 'string' || !win32.isAbsolute(localAppData) ||
      /[\r\n\0]/.test(localAppData) ||
      !['new', 'existing'].includes(sessionMode) ||
      ((sessionMode === 'existing') !== (sessionId !== undefined))) {
    throw invalid('invalid acceptance request');
  }
  const chosenSession = provider === 'claude'
    ? sessionMode === 'existing' ? sessionId : newSessionId() : sessionId ?? null;
  if (provider === 'claude' && !UUID.test(chosenSession ?? '')) throw invalid('invalid Claude session');
  if (provider === 'dsh' && sessionMode === 'existing' && !SESSION.test(sessionId ?? '')) {
    throw invalid('invalid DSH session');
  }
  const exe = provider === 'claude'
    ? win32.join(userProfile, '.local', 'bin', 'claude.exe')
    : win32.join(localAppData, 'Programs', 'DeepSeek Harness',
      'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  const args = provider === 'claude' ?
    ['-p','--output-format','json','--tools','','--strict-mcp-config',
      '--disable-slash-commands','--permission-mode','dontAsk',
      sessionMode === 'new' ? '--session-id' : '--resume', chosenSession]
    : ['--profile','headless','--json',
      ...(sessionMode === 'existing' ? ['--session-id', chosenSession] : []), '-'];
  const marker = provider === 'claude' ? 'TONG_P3_CLAUDE_TEXT_OK' : 'TONG_P3_DSH_TEXT_OK';
  const prompt = [
    'Respond with exactly the text ' + marker + '.',
    'This is a text-only native session acceptance test.',
    'Do not use tools, inspect files, run commands, or change settings.',
    'Do not begin any additional task.',
  ].join('\n');
  return Object.freeze({
    provider, sessionMode, sessionId: chosenSession,
    localAppData, executable: exe, expectedVersion: provider === 'claude' ? CLAUDE_VERSION : DSH_VERSION,
    marker, prompt, args: Object.freeze(args),
    timeoutMs: 120000, desktopVisibility: provider === 'dsh' ? 'unverified' : 'not-applicable',
    approval: 'local-interactive-console-only',
    isolation: 'NOT_OS_SANDBOXED',
  });
}

export async function findLocalAcceptanceBinary(plan, {
  inspect, realpath, discover = discoverDshDesktopRuntime,
} = {}) {
  if (!plan || !['claude','dsh'].includes(plan.provider) ||
      typeof plan.executable !== 'string') throw invalid('invalid plan');
  if (plan.provider === 'dsh') {
    const install = await discover({
      platform: 'win32', localAppData: plan.localAppData,
      ...(inspect ? {inspect}:{}), ...(realpath ? {canonicalize:realpath}:{}),
    });
    if (win32.normalize(install.cliExecutable).toLowerCase() !==
        win32.normalize(plan.executable).toLowerCase()) throw invalid('DSH install changed');
    return install.cliExecutable;
  }
  if (typeof inspect !== 'function' || typeof realpath !== 'function') {
    throw invalid('filesystem verification is required');
  }
  const meta = await inspect(plan.executable);
  const physical = await realpath(plan.executable);
  if (!meta.isFile() || meta.isSymbolicLink() ||
      win32.normalize(physical).toLowerCase() !== win32.normalize(plan.executable).toLowerCase()) {
    throw invalid('Claude binary is not a canonical regular file');
  }
  return physical;
}

export function verifyLocalAcceptanceVersion(plan, response) {
  if (!plan || !['claude','dsh'].includes(plan.provider) ||
      typeof response !== 'string' || response.length > 160) throw invalid('bad version response');
  const v = response.trim();
  const parsed = plan.provider === 'claude'
    ? /^([\d.]+) \(Claude Code\)$/.exec(v)?.[1]
    : /^([\d.]+(?:-[A-Za-z0-9.-]+)?)$/.exec(v)?.[1];
  if (parsed !== plan.expectedVersion) throw invalid('installed version changed; review required');
  return parsed;
}

export function summarizeAcceptanceResult(plan, receipt) {
  if (!plan || !['claude','dsh'].includes(plan.provider) ||
      !receipt || typeof receipt !== 'object' || receipt.exitCode !== 0 ||
      receipt.timedOut || receipt.cancelled ||
      typeof receipt.stdout !== 'string' ||
      Buffer.byteLength(receipt.stdout) > 262144) throw invalid('provider run unsuccessful');
  if (plan.provider === 'claude') {
    let data;
    try { data = JSON.parse(receipt.stdout); }
    catch { throw invalid('Claude JSON response invalid'); }
    if (data.type !== 'result' || data.is_error !== false ||
        data.subtype !== 'success' || data.session_id !== plan.sessionId ||
        typeof data.result !== 'string' ||
        data.result.trim() !== plan.marker) throw invalid('Claude native session response mismatch');
    return Object.freeze({provider:'claude',status:'passed',sessionId:plan.sessionId,
      markerConfirmed:true,desktopVisibility:'not-applicable'});
  }
  // DSH uses NDJSON and is not a Desktop-profile session. Never infer desktop
  // membership or session ID from an unverified event grammar.
  const lines = receipt.stdout.split(/\r?\n/).filter(Boolean);
  if (!lines.length || lines.length > 1000 ||
      lines.some(line => { try { JSON.parse(line); return false; } catch { return true; } })) {
    throw invalid('DSH JSONL events invalid');
  }
  return Object.freeze({provider:'dsh',status:'needs-native-session-inspection',
    sessionId:null,markerConfirmed:false,desktopVisibility:'unverified',
    events:lines.length});
}
