import assert from 'node:assert/strict';
import { isolateClaudeAuthDifference } from '../scripts/TongClaudeAuthDifferential.mjs';

const base={PATH:'C:\\Windows\\System32',USERPROFILE:'C:\\Users\\Example'};
const source={...base,LANG:'zh_CN.UTF-8',SPECIAL_FEATURE:'yes',
  ANTHROPIC_API_KEY:'SYNTHETIC_TEST_ONLY_DO_NOT_EXPOSE',
  NODE_OPTIONS:'--require synthetic-malicious.js',
  OTHER:'irrelevant'};
let calls=0;
let sawSecret=false;
const result=await isolateClaudeAuthDifference({baseline:base,source,
  check:async env=>{calls++;if(env.ANTHROPIC_API_KEY)sawSecret=true;
    return env.SPECIAL_FEATURE==='yes'?'authenticated':'not-authenticated';}});
assert.equal(result.status,'single-variable-candidate');
assert.deepEqual(result.variableNames,['SPECIAL_FEATURE']);
assert.equal(result.requiresManualReview,false);
assert.ok(calls<=16);
assert.ok(!JSON.stringify(result).includes('SYNTHETIC_TEST_ONLY_DO_NOT_EXPOSE'));
assert.equal(sawSecret,true,'diagnostic may transiently probe read-only auth with inherited values');

// A credential or preloader must never be silently recommended as a safe
// production environment variable. Only reveal its NAME, never its value.
const privateResult=await isolateClaudeAuthDifference({baseline:base,source,
  check:async env=>env.ANTHROPIC_API_KEY?'authenticated':'not-authenticated'});
assert.equal(privateResult.status,'single-variable-candidate');
assert.deepEqual(privateResult.variableNames,['ANTHROPIC_API_KEY']);
assert.equal(privateResult.requiresManualReview,true);
assert.ok(!JSON.stringify(privateResult).includes('SYNTHETIC_TEST_ONLY_DO_NOT_EXPOSE'));

const combined=await isolateClaudeAuthDifference({baseline:base,source,
  check:async env=>env.LANG && env.SPECIAL_FEATURE?'authenticated':'not-authenticated'});
assert.equal(combined.status,'multiple-variables-needed');
assert.deepEqual(combined.variableNames,[]);

const unchanged=await isolateClaudeAuthDifference({baseline:source,source,
  check:async()=>{throw Error('Must not inspect when no difference exists')}});
assert.equal(unchanged.status,'no-excluded-variables');

const fullMismatch=await isolateClaudeAuthDifference({baseline:base,source,
  check:async()=> 'not-authenticated'});
assert.equal(fullMismatch.status,'execution-modifiers-excluded');
assert.deepEqual(fullMismatch.blockedVariableNames,['NODE_OPTIONS']);

const blockedOnly=await isolateClaudeAuthDifference({baseline:base,
  source:{...base,NODE_OPTIONS:'--require synthetic.js'},
  check:async()=>{throw Error('Execution selectors are never launched in probes')}});
assert.equal(blockedOnly.status,'execution-modifiers-excluded');
assert.equal(blockedOnly.tested,0);
assert.deepEqual(blockedOnly.blockedVariableNames,['NODE_OPTIONS']);

const limited=await isolateClaudeAuthDifference({baseline:base,source,
  maxProbes:1,check:async env=>env.SPECIAL_FEATURE?'authenticated':'not-authenticated'});
assert.equal(limited.status,'probe-limit');
assert.equal(limited.tested,1);

const oversized={...base};
for(let i=0;i<130;i++)oversized['DIAG_TEST_'+i]='v';
const bounded=await isolateClaudeAuthDifference({baseline:base,source:oversized,
  check:async()=>{throw Error('No process should be started')}});
assert.equal(bounded.status,'too-many-variables');
assert.equal(bounded.tested,0);

await assert.rejects(isolateClaudeAuthDifference({baseline:base,source,
  check:async()=> 'SECRET_UNSAFE_STATUS'}),/Invalid authentication diagnostic result/);
for(const invalid of [0,-1,17,1.2]){
  await assert.rejects(isolateClaudeAuthDifference({baseline:base,source,
    maxProbes:invalid,check:async()=> 'authenticated'}),/Invalid authentication diagnostic/);
}
console.log('PASS: read-only environment difference isolation, bounded probes, combination detection, names-only redaction, no model authorization.');
