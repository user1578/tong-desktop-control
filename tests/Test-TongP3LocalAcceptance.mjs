import assert from 'node:assert/strict';
import { childEnv, argumentsForUser } from '../scripts/Run-TongP3LocalAcceptance.mjs';
import { win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepareLocalProviderAcceptance, findLocalAcceptanceBinary,
  verifyLocalAcceptanceVersion, summarizeAcceptanceResult,
  checkClaudeLocalAuth, classifyLocalAcceptanceFailure,
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
};
assert.deepEqual(argumentsForUser(['--provider','claude','--auth-check']),{
  provider:'claude',mode:'auth-check',sessionId:undefined,
});
assert.deepEqual(argumentsForUser(['--provider','claude','--run']),{
  provider:'claude',mode:'run',sessionId:undefined,
});
for(const argv of [
  ['--provider','dsh','--auth-check'],
  ['--provider','claude','--auth-check','--run'],
  ['--provider','claude','--auth-check','--session-id','synthetic-session'],
  ['--provider','claude','--diagnose'],
]){
  assert.throws(()=>argumentsForUser(argv),/acceptance|Unknown|Authentication|Select one/i);
}
const env=childEnv('claude','C:\\Temp\\separate',parentEnv);
assert.equal(env.CLAUDE_CONFIG_DIR,parentEnv.CLAUDE_CONFIG_DIR);
assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,parentEnv.CLAUDE_CODE_OAUTH_TOKEN);
assert.equal(env.XDG_CONFIG_HOME,parentEnv.XDG_CONFIG_HOME);
assert.equal(env.USERPROFILE,parentEnv.USERPROFILE);
assert.equal(env.ANTHROPIC_API_KEY,undefined);
assert.equal(env.GITHUB_TOKEN,undefined);
assert.equal(env.NODE_OPTIONS,undefined);
assert.equal(env.DSH_HOME,undefined);
const dshEnv=childEnv('dsh','C:\\Temp\\separate',parentEnv);
assert.equal(dshEnv.DSH_HOME,'C:\\Temp\\separate');
assert.equal(dshEnv.CLAUDE_CONFIG_DIR,undefined);
assert.equal(dshEnv.CLAUDE_CODE_OAUTH_TOKEN,undefined);
assert.throws(()=>childEnv('unknown','C:\\Temp',parentEnv),/Unknown local provider/);
console.log('PASS: opt-in CLI acceptance, selective OAuth env inheritance, preflight login, categorical diagnostics, no secret disclosure.');
