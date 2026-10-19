import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { SDK_021_RC2_IDS,DISABLED_SDK_S1_IDS,
 prepareDshS1Policy,verifyDshS1ComposedConfig }
 from '../scripts/TongDshS1Policy.mjs';

const defaultText=SDK_021_RC2_IDS.map(id=>
  ['- id: '+id,"  name: '@deepseek-ai/dsh-mock'",
   ...(id==='sandbox-policy'?["  config:","    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'"]:[]),
   ...(id==='approval'?["  config:","    policy: ask"]:[]),
  ].join('\n')).join('\n')+'\n';
assert.equal(SDK_021_RC2_IDS.length,98);
const syntheticFixtureSha256=createHash('sha256').update(defaultText).digest('hex');
const prepareFixture=(text,options={})=>prepareDshS1Policy(text,{syntheticFixtureSha256,...options});
assert.throws(()=>prepareDshS1Policy(defaultText),/definitions changed/);
const policy=prepareFixture(defaultText);
assert.equal(policy.baseSha256,syntheticFixtureSha256);
assert.equal(policy.profile,'sdk');
assert.equal(policy.version,'0.2.0-rc.2');
assert.equal(policy.baseCount,98);
assert.equal(policy.mode,'configuration-only');
assert.match(policy.overlay,/mode: read-only/);
for(const id of ['tool-pwsh','tool-fs','tool-web','tool-workflow',
 'tool-subagent','tool-skill','mcp-resources','subprocess','plugin-manager',
 'skill','web','tool-jobs','workspace-dependencies','skill-office']){
 assert.ok(policy.disabledIds.includes(id),'Expected deny: '+id);
 assert.ok(policy.overlay.includes('- id: '+id+'\n  disabled: true'));
}
assert.ok(!policy.disabledIds.includes('sdk-jsonrpc-server'));
assert.ok(!policy.disabledIds.includes('llm'));
assert.ok(!policy.disabledIds.includes('session'));
assert.equal(DISABLED_SDK_S1_IDS.length,policy.disabledIds.length);
assert.ok(Object.isFrozen(policy));

function composed({missing=[],overrides={}}={}){
  return SDK_021_RC2_IDS.filter(id=>!missing.includes(id)).map(id=>
    ['- id: '+id,"  name: '@deepseek-ai/dsh-mock'",
     ...(id==='sandbox-policy'?['  config:','    mode: '+(overrides.mode??'read-only')]:[]),
     ...(id==='approval'?['  config:','    policy: '+(overrides.approval??'ask')]:[]),
     ...(policy.disabledIds.includes(id)&&id!==overrides.enabled?
        ['  disabled: true']:[]),
     ].join('\n')).join('\n')+'\n';
}
const sealed=verifyDshS1ComposedConfig(composed(),policy);
assert.deepEqual({verified:sealed.verified,configurationOnly:sealed.configurationOnly,
 entries:sealed.entries,disabledTools:sealed.disabledTools,
 readOnly:sealed.readOnly,approvalAsk:sealed.approvalAsk},{
 verified:true,configurationOnly:true,entries:98,
 disabledTools:policy.disabledIds.length,readOnly:true,approvalAsk:true});
for(const text of [
 composed({overrides:{mode:'danger-full-access'}}),
 composed({overrides:{mode:'workspace-write'}}),
 composed({overrides:{approval:'never'}}),
 composed({overrides:{enabled:'tool-fs'}}),
 composed({overrides:{enabled:'mcp-resources'}}),
 composed({overrides:{enabled:'tool-subagent'}}),
 composed({missing:['sdk-jsonrpc-server']}),
 composed()+'- id: future-unreviewed-extension\n  name: future',
 composed()+'- id: tool-pwsh\n  disabled: true',
]){
 assert.throws(()=>verifyDshS1ComposedConfig(text,policy),/DSH S1/);
}
for(const text of [
 defaultText.replace('- id: tool-pwsh','- id: future-psh'),
 defaultText.replace('- id: sdk-jsonrpc-server','- id: sdk-jsonrpc-server-renamed'),
 defaultText+'- id: new-tool-plugin',
 defaultText.replace('- id: tool-fs','- id: tool-pwsh')
]) assert.throws(()=>prepareFixture(text),/DSH S1/);
assert.throws(()=>prepareFixture(defaultText,{installedVersion:'0.2.0-rc.3'}),/version/);
assert.throws(()=>prepareFixture(defaultText.replace("'@deepseek-ai/dsh-mock'","'@unknown/changed-implementation'")),/definitions changed/);
assert.throws(()=>verifyDshS1ComposedConfig(composed(),{
 ...policy,overlay:policy.overlay+'\n# dangerous injected patch',
}),/policy is absent or altered/);
assert.throws(()=>prepareFixture('x'.repeat(2200000)),/DSH S1/);
console.log('PASS DSH S1: exact 98 plugin manifest, deny-list, override SHA256, sdk transport & fail-closed composed config.');
