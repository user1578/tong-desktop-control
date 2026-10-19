import assert from 'node:assert/strict';
import { childEnv, argumentsForUser, selectClaudeAuthEnvironment } from '../scripts/Run-TongP3LocalAcceptance.mjs';
import { win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepareLocalProviderAcceptance, findLocalAcceptanceBinary,
  verifyLocalAcceptanceVersion, summarizeAcceptanceResult,
  checkClaudeFirstPartyOAuth, checkClaudeLocalAuth, classifyLocalAcceptanceFailure,
  claudeEnvironmentHints, summarizeClaudeProcessFailure,
} from '../scripts/TongP3LocalAcceptance.mjs';

const localAppData='C:\\Users\\Example\\AppData\\Local';
const userProfile='C:\\Users\\Example';
const create = provider => prepareLocalProviderAcceptance({
  provider, userProfile, localAppData,
  newSessionId:()=> 'a3aa3171-7121-4f1e-8ef3-c47bdf9d8042',
});
const claude = create('claude');
const dsh = create('dsh');
assert.equal(claude.provider,'claude');
assert.equal(claude.sessionId,'a3aa3171-7121-4f1e-8ef3-c47bdf9d8042');
assert.equal(claude.expectedVersion,'2.1.236');
assert.equal(dsh.expectedVersion,'0.2.0-rc.2');
assert.equal(dsh.desktopVisibility,'unverified');
assert.equal(dsh.sessionId,null);
assert.ok(claude.args.includes('--tools'));
assert.ok(claude.args.includes(''));
assert.ok(claude.args.includes('--strict-mcp-config'));
assert.ok(claude.args.includes('--session-id'));
assert.ok(dsh.args.includes('--profile'));
assert.ok(dsh.args.includes('headless'));
assert.ok(!dsh.args.includes('--session-id'));
assert.equal(claude.isolation,'NOT_OS_SANDBOXED');
assert.ok(claude.prompt.includes('TONG_P3_CLAUDE_TEXT_OK'));
assert.equal(Object.isFrozen(claude.args),true);
assert.equal(Object.isFrozen(claude),true);
assert.deepEqual(verifyLocalAcceptanceVersion(claude,'2.1.236 (Claude Code)\r\n'),'2.1.236');
assert.equal(verifyLocalAcceptanceVersion(dsh,'0.2.0-rc.2\r\n'),'0.2.0-rc.2');
for(const s of ['2.1.237 (Claude Code)','2.1.236 (unknown)','invalid'])
  assert.throws(()=>verifyLocalAcceptanceVersion(claude,s),/Provider acceptance:/);
assert.throws(()=>verifyLocalAcceptanceVersion(dsh,'0.2.0-rc.3'),/version changed/);

const resumed=prepareLocalProviderAcceptance({
  provider:'claude',userProfile,localAppData,
  sessionMode:'existing',sessionId:claude.sessionId,
});
assert.deepEqual(resumed.args.slice(-2),['--resume',claude.sessionId]);
const resumedDsh=prepareLocalProviderAcceptance({
  provider:'dsh',userProfile,localAppData,
  sessionMode:'existing',sessionId:'session_abc-123',
});
assert.ok(resumedDsh.args.includes('--session-id'));
assert.equal(resumedDsh.desktopVisibility,'unverified');
for(const input of [
  {provider:'bad'}, {provider:'claude',sessionMode:'existing'},
  {provider:'claude',sessionMode:'new',sessionId:randomUUID()},
  {provider:'dsh',sessionMode:'existing',sessionId:'../private'},
  {provider:'claude',userProfile:'relative'},
  {provider:'claude',localAppData:'relative'},
]) assert.throws(
  ()=>prepareLocalProviderAcceptance({...{userProfile,localAppData},...input}),
  /Provider acceptance:/);

const mockFs={
  inspect:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),
  realpath:async p=>p,
};
assert.equal(await findLocalAcceptanceBinary(claude,mockFs),claude.executable);
await assert.rejects(findLocalAcceptanceBinary(claude,{...mockFs,realpath:async()=>'C:\\Other\\claude.exe'}),/canonical/);
await assert.rejects(findLocalAcceptanceBinary(claude,{
  inspect:async()=>({isFile:()=>true,isSymbolicLink:()=>true}),
  realpath:async p=>p,
}),/canonical/);
const stubDsh={
  discover:async options=>{
    assert.equal(options.platform,'win32');
    assert.equal(options.localAppData,localAppData);
    return{cliExecutable:dsh.executable};
  },
};
assert.equal(await findLocalAcceptanceBinary(dsh,stubDsh),dsh.executable);
await assert.rejects(findLocalAcceptanceBinary(dsh,{discover:async()=>({cliExecutable:'C:\\Other\\dsh.cmd'})}),/install changed/);

const cliOutput={exitCode:0,stdout:JSON.stringify({
  type:'result',subtype:'success',is_error:false,
  session_id:claude.sessionId,result:claude.marker,
})};
assert.deepEqual(summarizeAcceptanceResult(claude,cliOutput),{
  provider:'claude',status:'passed',sessionId:claude.sessionId,
  markerConfirmed:true,desktopVisibility:'not-applicable',
});
for(const receipt of [
  {...cliOutput,exitCode:1}, {...cliOutput,timedOut:true},
  {...cliOutput,stdout:'not JSON'},
  {...cliOutput,stdout:JSON.stringify({
    type:'result',subtype:'success',is_error:false,
    session_id:randomUUID(),result:claude.marker})},
]) assert.throws(()=>summarizeAcceptanceResult(claude,receipt),/Provider acceptance:/);
const jsonl={exitCode:0,stdout:'{"kind":"session"}\n{"kind":"turn/end"}\n'};
assert.deepEqual(summarizeAcceptanceResult(dsh,jsonl),{
  provider:'dsh',status:'needs-native-session-inspection',sessionId:null,
  markerConfirmed:false,desktopVisibility:'unverified',events:2,
});
assert.throws(()=>summarizeAcceptanceResult(dsh,{exitCode:0,stdout:'some log without JSON'}),/JSONL/);
assert.equal(checkClaudeLocalAuth({
  exitCode:1,stdout:JSON.stringify({
    loggedIn:false,authMethod:'none',email:'private@example.test',
  }),
}), 'not-authenticated');
assert.equal(checkClaudeLocalAuth({
  exitCode:0,stdout:JSON.stringify({
    loggedIn:true,authMethod:'claude.ai',accountUuid:'private-id',
  }),
}), 'authenticated');
assert.equal(checkClaudeFirstPartyOAuth({
  exitCode:0,stdout:JSON.stringify({
    loggedIn:true,authMethod:'oauth_token',apiProvider:'firstParty',
    accountUuid:'SYNTHETIC_PRIVATE_ACCOUNT'
  })
}),'first-party-oauth');
assert.equal(checkClaudeFirstPartyOAuth({
  exitCode:0,stdout:JSON.stringify({
    loggedIn:true,authMethod:'api_key',apiProvider:'thirdParty'
  })
}),'other-authentication');
assert.equal(checkClaudeFirstPartyOAuth({
  exitCode:1,stdout:JSON.stringify({loggedIn:false,authMethod:'none'})
}),'not-authenticated');
assert.equal(checkClaudeFirstPartyOAuth({exitCode:1,stdout:'invalid json'}),'unavailable');
assert.equal(checkClaudeLocalAuth({
  exitCode:1,stdout:'unparseable private error',
}), 'unavailable');
assert.equal(checkClaudeLocalAuth({
  exitCode:0,stdout:'x'.repeat(9000),
}), 'unavailable');
const cases=[
  [{timedOut:true,exitCode:null},'timeout'],
  [{overflow:true,exitCode:null},'output-limit'],
  [{exitCode:1,stderrPreview:'Error: Please log in to Claude Code'},'authentication'],
  [{exitCode:1,stderrPreview:'HTTP 429 rate limit exceeded'},'rate-limit'],
  [{exitCode:1,stderrPreview:'ECONNREFUSED network error'},'network'],
  [{exitCode:1,stderrPreview:'Unknown option --no-such-flag'},'cli-arguments'],
  [{exitCode:1,stderrPreview:'session already exists'},'session'],
  [{exitCode:1,stderrPreview:'secret user info: TOKEN-PRIVATE'},'cli-exit-nonzero'],
  [{exitCode:0,stdout:''},'empty-output'],
  [{exitCode:0,stdout:'{"type":"result","is_error":true,"error":"hidden"}'},'provider-reported-error'],
  [{exitCode:0,stdout:'invalid json from provider'},'unexpected-output'],
];
for (const [receipt,category] of cases) {
  assert.equal(classifyLocalAcceptanceFailure(receipt),category);
}
for (const receipt of [{exitCode:1,stderrPreview:'Authorization: Bearer very-secret-token'},
                       {exitCode:1,stdout:'{"error":"SECRET","type":"result","is_error":true}'}]) {
  const category=classifyLocalAcceptanceFailure(receipt);
  assert.ok(!category.includes('secret'));
  assert.ok(!category.includes('token'));
}
const parentEnv={
  SystemRoot:'C:\\Windows',
  PATH:'C:\\Windows\\System32',
  USERPROFILE:'C:\\Users\\Example',
  APPDATA:'C:\\Users\\Example\\AppData\\Roaming',
  LOCALAPPDATA:'C:\\Users\\Example\\AppData\\Local',
  CLAUDE_CONFIG_DIR:'C:\\Users\\Example\\.claude-personal',
  CLAUDE_CODE_OAUTH_TOKEN:'SYNTHETIC_NEVER_REAL_OAUTH_TOKEN',
  XDG_CONFIG_HOME:'C:\\Users\\Example\\xdg',
  ANTHROPIC_API_KEY:'SYNTHETIC_API_KEY_MUST_NOT_BE_USED',
  GITHUB_TOKEN:'SYNTHETIC_GITHUB_TOKEN_MUST_NOT_BE_USED',
  NODE_OPTIONS:'--require malicious.js',
  ANTHROPIC_AUTH_TOKEN:'SYNTHETIC_CREDENTIAL_DO_NOT_DISPLAY',
  USERNAME:'Example',
  HOMEDRIVE:'C:',
  HOMEPATH:'\\Users\\Example',
  USERDOMAIN:'EXAMPLE-DOMAIN',
  HTTPS_PROXY:'http://127.0.0.1:8899',
  NODE_EXTRA_CA_CERTS:'C:\\Certs\\org-ca.pem',
};
assert.deepEqual(argumentsForUser(['--provider','claude','--auth-check']),{
  provider:'claude',mode:'auth-check',sessionId:undefined,
});
assert.deepEqual(argumentsForUser(['--provider','claude','--run']),{
  provider:'claude',mode:'run',sessionId:undefined,
});
assert.deepEqual(argumentsForUser(['--provider','claude','--auth-check','--inherit-anthropic-auth-token']),{
  provider:'claude',mode:'auth-check',sessionId:undefined,inheritAnthropicAuthToken:true,
});
assert.deepEqual(argumentsForUser(['--provider','claude','--run','--inherit-anthropic-auth-token']),{
  provider:'claude',mode:'run',sessionId:undefined,inheritAnthropicAuthToken:true,
});
for(const argv of [
  ['--provider','dsh','--auth-check'],
  ['--provider','claude','--auth-check','--run'],
  ['--provider','claude','--auth-check','--session-id','synthetic-session'],
  ['--provider','claude','--diagnose'],
  ['--provider','claude','--auth-isolate','--inherit-anthropic-auth-token'],
  ['--provider','dsh','--run','--inherit-anthropic-auth-token'],
  ['--provider','claude','--dry-run','--inherit-anthropic-auth-token'],
  ['--provider','claude','--run','--inherit-anthropic-auth-token','--inherit-anthropic-auth-token'],
]){
  assert.throws(()=>argumentsForUser(argv),/acceptance|Unknown|Authentication|Select one|Explicit Anthropic token|Duplicate explicit token/i);
}
const env=childEnv('claude','C:\\Temp\\separate',parentEnv);
assert.equal(env.CLAUDE_CONFIG_DIR,parentEnv.CLAUDE_CONFIG_DIR);
assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,parentEnv.CLAUDE_CODE_OAUTH_TOKEN);
assert.equal(env.XDG_CONFIG_HOME,parentEnv.XDG_CONFIG_HOME);
assert.equal(env.USERPROFILE,parentEnv.USERPROFILE);
assert.equal(env.ANTHROPIC_API_KEY,undefined);
assert.equal(env.ANTHROPIC_AUTH_TOKEN,undefined);
assert.equal(env.GITHUB_TOKEN,undefined);
assert.equal(env.NODE_OPTIONS,undefined);
assert.equal(env.DSH_HOME,undefined);
assert.equal(env.USERNAME,undefined);
assert.equal(env.HTTPS_PROXY,undefined);
const withIdentity=childEnv('claude','C:\\Temp\\separate',parentEnv,'windows-context');
assert.equal(withIdentity.USERNAME,parentEnv.USERNAME);
assert.equal(withIdentity.HOMEDRIVE,parentEnv.HOMEDRIVE);
assert.equal(withIdentity.HTTPS_PROXY,undefined);
const withExplicitToken=childEnv('claude','C:\\Temp\\separate',parentEnv,'network-context',{
  inheritAnthropicAuthToken:true,
});
assert.equal(withExplicitToken.ANTHROPIC_AUTH_TOKEN,parentEnv.ANTHROPIC_AUTH_TOKEN);
assert.equal(withExplicitToken.ANTHROPIC_API_KEY,undefined);
assert.equal(withExplicitToken.NODE_OPTIONS,undefined);
assert.equal(withExplicitToken.GITHUB_TOKEN,undefined);
const withNetwork=childEnv('claude','C:\\Temp\\separate',parentEnv,'network-context');
assert.equal(withNetwork.USERNAME,parentEnv.USERNAME);
assert.equal(withNetwork.HTTPS_PROXY,parentEnv.HTTPS_PROXY);
assert.equal(withNetwork.NODE_EXTRA_CA_CERTS,parentEnv.NODE_EXTRA_CA_CERTS);
for (const candidate of [env,withIdentity,withNetwork]) {
  for (const disallowed of ['ANTHROPIC_API_KEY','GITHUB_TOKEN','NODE_OPTIONS']) {
    assert.equal(candidate[disallowed],undefined);
  }
}
const calls=[];
const selected=await selectClaudeAuthEnvironment({source:parentEnv,check:async (candidate,tier)=>{
  calls.push(tier);
  return candidate.HTTPS_PROXY ? 'authenticated':'not-authenticated';
}});
assert.deepEqual(calls,['base','windows-context','network-context']);
assert.equal(selected.tier,'network-context');
assert.equal(selected.status,'authenticated');
assert.equal(selected.env.HTTPS_PROXY,parentEnv.HTTPS_PROXY);
assert.equal(selected.env.ANTHROPIC_API_KEY,undefined);
const selectedIdentity=await selectClaudeAuthEnvironment({source:parentEnv,
  check:async candidate=>candidate.USERNAME?'authenticated':'not-authenticated'});
assert.equal(selectedIdentity.tier,'windows-context');
assert.equal(selectedIdentity.checks.length,2);
const notAuthenticated=await selectClaudeAuthEnvironment({source:parentEnv,
  check:async ()=>'not-authenticated'});
assert.equal(notAuthenticated.env,null);
assert.equal(notAuthenticated.checks.length,3);
await assert.rejects(selectClaudeAuthEnvironment({source:parentEnv,
  check:async ()=>'secret error from CLI'}),/Invalid Claude authentication status/);
const dshEnv=childEnv('dsh','C:\\Temp\\separate',parentEnv);
assert.equal(dshEnv.DSH_HOME,'C:\\Temp\\separate');
assert.equal(dshEnv.CLAUDE_CONFIG_DIR,undefined);
assert.equal(dshEnv.CLAUDE_CODE_OAUTH_TOKEN,undefined);
assert.equal(dshEnv.ANTHROPIC_AUTH_TOKEN,undefined);
assert.throws(()=>childEnv('dsh','C:\\Temp',parentEnv,'base',{
  inheritAnthropicAuthToken:true,
}),/Invalid local provider environment/);
assert.throws(()=>childEnv('unknown','C:\\Temp',parentEnv),/Invalid local provider environment/);
assert.throws(()=>childEnv('dsh','C:\\Temp',parentEnv,'network-context'),/Invalid local provider environment/);
const hints=claudeEnvironmentHints({
  ANTHROPIC_BASE_URL:'https://private-internal.example.test/secret',
  ANTHROPIC_AUTH_TOKEN:'TOKEN_VALUE_NEVER_SHOW',
  ANTHROPIC_MODEL:'my-private-model',
  ANTHROPIC_API_KEY:'KEY_VALUE_NEVER_SHOW',
});
assert.deepEqual(hints,{
  customApiEndpointConfigured:true,modelOverrideConfigured:true,
  anthropicAuthTokenConfigured:true,anthropicApiKeyConfigured:true,
});
assert.ok(!JSON.stringify(hints).includes('private'));
assert.ok(!JSON.stringify(hints).includes('TOKEN_VALUE'));
assert.ok(Object.isFrozen(hints));
assert.deepEqual(claudeEnvironmentHints({}),{
  customApiEndpointConfigured:false,modelOverrideConfigured:false,
  anthropicAuthTokenConfigured:false,anthropicApiKeyConfigured:false,
});

const safeFailure=summarizeClaudeProcessFailure({
  exitCode:1,elapsedMs:2123,stderrBytes:18,
  stderrPreview:'Auth token SECRET_SUPER_PRIVATE_DO_NOT_PRINT',
  stdout:JSON.stringify({
    type:'result',subtype:'error_during_execution',is_error:true,
    result:'API Error: 404 model not found for https://private.example.test?token=SECRET',
    errors:['model unavailable: SECRET_PRIVATE_KEY'],
    session_id:'SENSITIVE_SESSION_ID',
  }),
});
assert.deepEqual(safeFailure,{
  category:'model',exitCode:1,elapsedMs:2123,
  stdoutKind:'json',stderrPresent:true,resultType:'result',
  resultSubtype:'error_during_execution',structuredErrorCount:1,
  timedOut:false,
});
for(const privateValue of ['SECRET_SUPER_PRIVATE','SECRET_PRIVATE_KEY',
  'private.example.test','SENSITIVE_SESSION_ID']) {
  assert.ok(!JSON.stringify(safeFailure).includes(privateValue));
}
const networkFailure=summarizeClaudeProcessFailure({
  exitCode:1,stdout:JSON.stringify({
    type:'result',subtype:'error_during_execution',is_error:true,
    errors:['fetch failed ECONNRESET to internal.gateway'],
  }),stderrBytes:0,
});
assert.equal(networkFailure.category,'network');
const authFailure=summarizeClaudeProcessFailure({
  exitCode:1,stdout:JSON.stringify({
    type:'result',subtype:'error_during_execution',is_error:true,
    errors:['HTTP 401 unauthorized'],
  }),
});
assert.equal(authFailure.category,'authentication');
assert.deepEqual(summarizeClaudeProcessFailure(null),{
  category:'no-process-result',exitCode:null,elapsedMs:null,
  stdoutKind:'unknown',stderrPresent:false,resultType:null,
  resultSubtype:null,structuredErrorCount:0,
});
console.log('PASS: local Claude acceptance, no-secret endpoint hints, structured failures and OAuth environment tests.');
