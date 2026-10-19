import assert from 'node:assert/strict';
import { prepareExplicitClaudeRouting } from '../scripts/TongClaudeExplicitRouting.mjs';
import { argumentsForUser, childEnv } from '../scripts/Run-TongP3LocalAcceptance.mjs';

const endpoint='https://private.example.test/proxy/v1';
const model='custom-model-2026';
const parent={
  USERPROFILE:'C:\\Users\\Example',
  ANTHROPIC_BASE_URL:endpoint,
  ANTHROPIC_MODEL:model,
  ANTHROPIC_DEFAULT_SONNET_MODEL:'sonnet-proxy-model',
  ANTHROPIC_AUTH_TOKEN:'PRIVATE_TOKEN_DO_NOT_PRINT',
  ANTHROPIC_API_KEY:'PRIVATE_API_KEY_DO_NOT_PRINT',
  GITHUB_TOKEN:'PRIVATE_GITHUB_TOKEN_DO_NOT_PRINT',
  NODE_OPTIONS:'--require private-loader.js',
};
const prepared=prepareExplicitClaudeRouting(parent);
assert.deepEqual(prepared,{
  env:{ANTHROPIC_BASE_URL:endpoint,ANTHROPIC_MODEL:model,
    ANTHROPIC_DEFAULT_SONNET_MODEL:'sonnet-proxy-model'},
  endpointInherited:true,
  modelSelectorsInherited:['ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL'],
});
assert.ok(Object.isFrozen(prepared));
assert.ok(Object.isFrozen(prepared.env));
assert.ok(Object.isFrozen(prepared.modelSelectorsInherited));
assert.equal(prepared.env.ANTHROPIC_AUTH_TOKEN,undefined);
assert.equal(prepared.env.ANTHROPIC_API_KEY,undefined);
assert.equal(prepared.env.GITHUB_TOKEN,undefined);
assert.equal(prepared.env.NODE_OPTIONS,undefined);
const safeMetadata={endpointInherited:prepared.endpointInherited,
  modelSelectorsInherited:prepared.modelSelectorsInherited};
assert.ok(!JSON.stringify(safeMetadata).includes('private.example'));
assert.ok(!JSON.stringify(safeMetadata).includes('custom-model'));
const inherited={
  ...childEnv('claude','C:\\Temp\\test-home',parent,'network-context',
      {inheritAnthropicAuthToken:true}),
  ...prepared.env,
};
assert.equal(inherited.ANTHROPIC_AUTH_TOKEN,parent.ANTHROPIC_AUTH_TOKEN);
assert.equal(inherited.ANTHROPIC_BASE_URL,endpoint);
assert.equal(inherited.ANTHROPIC_MODEL,model);
assert.equal(inherited.ANTHROPIC_API_KEY,undefined);
assert.equal(inherited.NODE_OPTIONS,undefined);

const accepted=argumentsForUser(['--provider','claude','--auth-check',
  '--inherit-anthropic-auth-token','--inherit-claude-routing']);
assert.equal(accepted.mode,'auth-check');
assert.equal(accepted.inheritClaudeRouting,true);
assert.equal(accepted.inheritAnthropicAuthToken,true);
assert.equal(argumentsForUser(['--provider','claude','--run',
  '--inherit-anthropic-auth-token','--inherit-claude-routing']).inheritClaudeRouting,true);
for(const args of [
  ['--provider','dsh','--run','--inherit-claude-routing'],
  ['--provider','claude','--dry-run','--inherit-claude-routing'],
  ['--provider','claude','--auth-isolate','--inherit-claude-routing'],
  ['--provider','claude','--run','--inherit-claude-routing','--inherit-claude-routing'],
]) assert.throws(()=>argumentsForUser(args),/routing|Duplicate/i);

for(const url of [
  'ftp://private.example.test',
  'http://private.example.test',
  'https://name:password@private.example.test',
  'https://private.example.test/path?token=abc',
  'https://private.example.test/path#token',
  'https://private.example.test\n',
  '',
]) assert.throws(()=>prepareExplicitClaudeRouting({
  ANTHROPIC_BASE_URL:url}),/endpoint|HTTPS|credentials/i);
assert.equal(prepareExplicitClaudeRouting({
  ANTHROPIC_BASE_URL:'http://127.0.0.1:8787/v1',
}).endpointInherited,true);
assert.equal(prepareExplicitClaudeRouting({
  ANTHROPIC_BASE_URL:'http://localhost:8787',
}).endpointInherited,true);
assert.equal(prepareExplicitClaudeRouting({
  ANTHROPIC_BASE_URL:'http://[::1]:8787',
}).endpointInherited,true);
for(const modelName of ['one two','\nmalicious','', 'm'.repeat(257)])
  assert.throws(()=>prepareExplicitClaudeRouting({
    ANTHROPIC_MODEL:modelName}),/model override/i);
assert.deepEqual(prepareExplicitClaudeRouting({}),{
  env:{},endpointInherited:false,modelSelectorsInherited:[],
});
console.log('PASS: explicit local Claude API/model routing, blocked insecure URLs, secret isolation, no model execution.');
