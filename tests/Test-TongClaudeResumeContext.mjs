import assert from 'node:assert/strict';
import { validateClaudeResumeContext, loadClaudeResumeContext } from '../scripts/TongClaudeResumeContext.mjs';
import { prepareLocalProviderAcceptance } from '../scripts/TongP3LocalAcceptance.mjs';
import { argumentsForUser } from '../scripts/Run-TongP3LocalAcceptance.mjs';

const tempRoot='C:\\Users\\Example\\AppData\\Local\\Temp';
const base=tempRoot+'\\tong-p3-local-acceptance-aB12cX';
const reportPath=base+'\\acceptance-result.json';
const sessionId='d9d4c771-572a-457b-ba07-4410f8798e44';
const binarySha256='647e736f20c9ff0553c754624cbf8a6dcac196e8595509d8f63dce8bbe818757';
const receipt={provider:'claude',status:'passed',sessionId,markerConfirmed:true,
  expectedVersion:'2.1.236',binarySha256,
  environment:'local-interactive-unisolated'};
const opts={tempRoot,reportPath,sessionId,expectedVersion:'2.1.236',binarySha256};
const result=validateClaudeResumeContext({...opts,receipt});
assert.equal(result.workdir,base+'\\empty-workdir');
assert.equal(result.reportPath,reportPath);
assert.equal(result.sessionId,sessionId);
assert.ok(Object.isFrozen(result));
for(const badPath of [
  'C:\\Elsewhere\\acceptance-result.json',
  base+'\\..\\acceptance-result.json',
  base+'\\nested\\acceptance-result.json',
  tempRoot+'\\other-prefix-aB12cX\\acceptance-result.json',
  base+'\\acceptance-result.js',
  '..\\acceptance-result.json',
])assert.throws(()=>validateClaudeResumeContext({...opts,reportPath:badPath,receipt}),
  /directory|invalid/i);
for(const extra of [
  {receipt:{...receipt,sessionId:'a3aa3171-7121-4f1e-8ef3-c47bdf9d8042'}},
  {receipt:{...receipt,binarySha256:'0'.repeat(64)}},
  {receipt:{...receipt,status:'failed'}},
  {receipt:{...receipt,provider:'dsh'}},
  {expectedVersion:'2.1.235'},
])assert.throws(()=>validateClaudeResumeContext({...opts,receipt,...extra}),
  /does not match/i);

const fs={
  inspect:async path=>({
    isSymbolicLink:()=>false,
    isFile:()=>path===reportPath,
    isDirectory:()=>path===base||path===result.workdir,
    size:400,
  }),
  canonicalize:async path=>path,
  read:async()=>JSON.stringify(receipt),
};
assert.deepEqual(await loadClaudeResumeContext(opts,fs),result);
await assert.rejects(loadClaudeResumeContext(opts,{
  ...fs,canonicalize:async path=>path===result.workdir?'C:\\Wrong\\workdir':path,
}),/redirected/);
await assert.rejects(loadClaudeResumeContext(opts,{
  ...fs,inspect:async path=>({
    isSymbolicLink:()=>path===reportPath,
    isFile:()=>path===reportPath,
    isDirectory:()=>path!==reportPath,
    size:400,
  }),
}),/redirected/);
await assert.rejects(loadClaudeResumeContext(opts,{
  ...fs,inspect:async path=>({
    isSymbolicLink:()=>false,
    isFile:()=>path===reportPath,
    isDirectory:()=>path!==reportPath,
    size:path===reportPath?50000:400,
  }),
}),/size/);
await assert.rejects(loadClaudeResumeContext(opts,{...fs,read:async()=>'{ invalid'}),
  /not valid JSON/);

const argv=['--provider','claude','--run','--session-id',sessionId,
  '--resume-from-report',reportPath,
  '--inherit-anthropic-auth-token','--inherit-claude-routing'];
assert.equal(argumentsForUser(argv).resumeFromReport,reportPath);
assert.equal(argumentsForUser(argv).sessionId,sessionId);
for(const invalidArgv of [
  ['--provider','claude','--run','--session-id',sessionId],
  ['--provider','claude','--run','--resume-from-report',reportPath],
  ['--provider','claude','--auth-check','--session-id',sessionId,'--resume-from-report',reportPath],
  ['--provider','dsh','--run','--session-id',sessionId,'--resume-from-report',reportPath],
])assert.throws(()=>argumentsForUser(invalidArgv),/resume|session|Authentication/i);

const old=prepareLocalProviderAcceptance({provider:'claude',
  userProfile:'C:\\Users\\Example',localAppData:'C:\\Users\\Example\\AppData\\Local',
  sessionMode:'existing',sessionId});
assert.deepEqual(old.args.slice(-2),['--resume',sessionId]);
assert.ok(!old.prompt.includes('TONG_P3_CLAUDE_TEXT_OK'));
assert.match(old.prompt,/previous assistant message/i);
console.log('PASS: Claude same-session resume requires verified temp receipt, original workdir and historical context.');
