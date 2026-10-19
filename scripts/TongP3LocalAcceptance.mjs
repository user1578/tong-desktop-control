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
  const prompt = provider==='claude' && sessionMode==='existing'
    ? [
        'This is a native-session memory test.',
        'Reply with exactly your immediately previous assistant message in this conversation.',
        'Do not infer or invent previous content if no earlier turn is available.',
        'Do not use tools, inspect files, run commands, or change settings.',
      ].join('\n')
    : [
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

// This check is local and read-only. Claude prints extra account metadata in
// auth status; return only a status enum, never an account, token or provider ID.
export function checkClaudeLocalAuth(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.timedOut ||
      typeof receipt.stdout !== 'string' ||
      Buffer.byteLength(receipt.stdout, 'utf8') > 8192) {
    return 'unavailable';
  }
  try {
    const data = JSON.parse(receipt.stdout);
    if (data?.loggedIn === false) return 'not-authenticated';
    if (data?.loggedIn === true && receipt.exitCode === 0) return 'authenticated';
  } catch {}
  return 'unavailable';
}

// The sensitive ANTHROPIC_AUTH_TOKEN is only eligible for an opt-in local
// acceptance if the same CLI reports first-party OAuth authentication. The
// status does not disclose its value or prove any particular billing outcome.
export function checkClaudeFirstPartyOAuth(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.timedOut ||
      typeof receipt.stdout !== 'string' ||
      Buffer.byteLength(receipt.stdout, 'utf8') > 8192) return 'unavailable';
  try {
    const data=JSON.parse(receipt.stdout);
    if (data?.loggedIn === false) return 'not-authenticated';
    if (data?.loggedIn === true && receipt.exitCode === 0) {
      return data.authMethod === 'oauth_token' && data.apiProvider === 'firstParty'
        ? 'first-party-oauth' : 'other-authentication';
    }
  } catch {}
  return 'unavailable';
}

// Expose only coarse, presence-only configuration hints, never values.
// ANTHROPIC_BASE_URL and model selectors are intentionally not inherited
// by the local acceptance runner unless a separate approval path is designed.
export function claudeEnvironmentHints(source = {}) {
  if (!source || typeof source !== 'object') throw invalid('invalid CLI environment');
  const names = Object.keys(source);
  const has = key => names.some(item =>
    item.toLowerCase() === key.toLowerCase() &&
    typeof source[item] === 'string' && source[item].trim().length > 0);
  return Object.freeze({
    customApiEndpointConfigured: has('ANTHROPIC_BASE_URL'),
    modelOverrideConfigured: [
      'ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL',
    ].some(has),
    anthropicAuthTokenConfigured: has('ANTHROPIC_AUTH_TOKEN'),
    anthropicApiKeyConfigured: has('ANTHROPIC_API_KEY'),
  });
}

// Diagnostics are deliberately categorical. Never show raw stderr, stdout,
// account metadata, command arguments, or bearer tokens to the caller.
export function classifyLocalAcceptanceFailure(receipt) {
  if (!receipt || typeof receipt !== 'object') return 'no-process-result';
  if (receipt.timedOut) return 'timeout';
  if (receipt.overflow) return 'output-limit';
  const diagnostic = (typeof receipt.stderrPreview === 'string'
    ? receipt.stderrPreview.slice(0, 16384) : '') + '\n' +
    (typeof receipt.stdout === 'string' ? receipt.stdout.slice(0, 8192) : '');
  if (/authentication|not logged in|login required|please log in|unauthori[sz]ed|invalid api key|invalid.?token|oauth.*expired|401\b/i.test(diagnostic)) return 'authentication';
  if (/rate.?limit|429\b/i.test(diagnostic)) return 'rate-limit';
  if (/billing|insufficient.?(?:credit|balance)|quota|payment required|402\b/i.test(diagnostic)) return 'billing-or-quota';
  if (/ETIMEDOUT|ECONN|ENOTFOUND|network|fetch failed|proxy|connection refused|TLS|certificate/i.test(diagnostic)) return 'network';
  if (/unknown option|unknown argument|invalid option|Usage:|Missing required|invalid.?flag/i.test(diagnostic)) return 'cli-arguments';
  if (/session.*(?:not found|invalid|already exists)|duplicate session/i.test(diagnostic)) return 'session';
  if (receipt.exitCode !== 0) return 'cli-exit-nonzero';
  if (typeof receipt.stdout !== 'string' || !receipt.stdout.trim()) return 'empty-output';
  try {
    const data = JSON.parse(receipt.stdout);
    if (data?.is_error === true) return 'provider-reported-error';
    if (data?.type === 'result') return 'unexpected-result';
  } catch { return 'unexpected-output'; }
  return 'unexpected-result';
}

// Safe-to-share process summary for failed CLI runs. Never surface raw
// stdout/stderr, user prompts, account IDs, endpoint URLs, or credential data.
export function summarizeClaudeProcessFailure(receipt) {
  if(!receipt || typeof receipt !== 'object') {
    return Object.freeze({category:'no-process-result',exitCode:null,
      elapsedMs:null,stdoutKind:'unknown',stderrPresent:false,
      resultType:null,resultSubtype:null,structuredErrorCount:0});
  }
  const stdout=typeof receipt.stdout==='string'?receipt.stdout:'';
  let stdoutKind=stdout.trim()?'text':'empty';
  let resultType=null, resultSubtype=null, structuredErrorCount=0;
  let category=classifyLocalAcceptanceFailure(receipt);
  let parsed=null;
  if(stdout && Buffer.byteLength(stdout,'utf8')<=262144) {
    try { parsed=JSON.parse(stdout); } catch {}
  }
  if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) {
    stdoutKind='json';
    if(['result','error','system'].includes(parsed.type)) resultType=parsed.type;
    if(['success','error_during_execution','error_max_turns',
         'error_max_budget_usd','error_max_structured_output_retries'].includes(parsed.subtype))
      resultSubtype=parsed.subtype;
    const errors=Array.isArray(parsed.errors)?parsed.errors.slice(0,8):[];
    structuredErrorCount=errors.length;
    const messages=[
      ...errors.filter(x=>typeof x==='string'),
      typeof parsed.error?.message==='string'?parsed.error.message:'',
      typeof parsed.error==='string'?parsed.error:'',
      typeof parsed.result==='string'&&parsed.is_error===true?parsed.result:'',
    ];
    // Pattern matching is transient. Raw strings are never returned or logged.
    const internal=messages.join('\n').slice(0,16384);
    if(/(?:401|403)\b|authentication|unauthori[sz]ed|invalid.?token|invalid.?api.?key|expired.?oauth|please log in/i.test(internal)) category='authentication';
    else if(/(?:429)\b|rate.?limit|overloaded/i.test(internal)) category='rate-limit';
    else if(/model.*(?:not found|unavailable|invalid|unsupported)|invalid.*model/i.test(internal)) category='model';
    else if(/(?:billing|credits?|insufficient.?balance|quota|payment required)/i.test(internal)) category='billing-or-quota';
    else if(/(?:ENOTFOUND|ECONN|ETIMEDOUT|network|fetch failed|proxy|certificate|TLS)/i.test(internal)) category='network';
    else if(parsed.is_error===true || parsed.type==='error') category='provider-reported-error';
  }
  // Only exact metadata from the process result is returned, never arbitrary
  // values such as error.message, commandline, URL, or stderr snippet.
  return Object.freeze({
    category,
    exitCode:Number.isInteger(receipt.exitCode)?receipt.exitCode:null,
    elapsedMs:Number.isFinite(receipt.elapsedMs)?Math.max(0,Math.round(receipt.elapsedMs)):null,
    stdoutKind,
    stderrPresent:!!(receipt.stderrBytes || receipt.stderrPreview),
    resultType,resultSubtype,structuredErrorCount,
    timedOut:receipt.timedOut===true,
  });
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
