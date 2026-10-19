import assert from 'node:assert/strict';
import {HIGH_RISK_DSH_IDS,inspectDshComposition,
        verifyDshCompositionRestriction} from '../scripts/TongDshS0Audit.mjs';

const base=[
  '# == @deepseek-ai/dsh-base',
  '- id: sandbox-policy',
  "  name: '@deepseek-ai/dsh-sandbox-policy'",
  "  config:",
  "    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
  '- id: permission',
  "  name: '@deepseek-ai/dsh-permission-presets'",
  '- id: approval',
  "  name: '@deepseek-ai/dsh-user-approval'",
  '- id: tool-pwsh',
  "  name: '@deepseek-ai/dsh-tool-pwsh'",
  "  disabled: !!js process.platform !== 'win32'",
  '- id: tool-fs',
  "  name: '@deepseek-ai/dsh-tool-fs'",
  '- id: tool-web',
  "  name: '@deepseek-ai/dsh-tool-web'",
  '# == @deepseek-ai/dsh-headless',
  '- id: headless-runner',
  "  name: '@deepseek-ai/dsh-headless'",
].join('\n');
const scanned=inspectDshComposition(base);
assert.equal(scanned.profile,'headless');
assert.equal(scanned.entries,7);
assert.equal(scanned.hasApproval,true);
assert.equal(scanned.hasPermissionPresets,true);
assert.equal(scanned.hasHeadlessRunner,true);
assert.equal(scanned.hasSdkJsonRpc,false);
assert.ok(scanned.sandboxMode.includes('workspace-write'));
assert.equal(scanned.highRisk.find(x=>x.id==='tool-pwsh').disabled,false);
assert.ok(HIGH_RISK_DSH_IDS.includes('persistent-pwsh'));
assert.deepEqual(verifyDshCompositionRestriction(scanned,['tool-pwsh','tool-fs','tool-web']),{
  compositionOnly:true,sandboxReadOnly:false,
  requiredToolEntriesDisabled:false,
  missingOrEnabled:['tool-pwsh','tool-fs','tool-web'],
  passed:false,
});
const modified=base.replace("!!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",'read-only')
  .replace("  disabled: !!js process.platform !== 'win32'","  disabled: true")
  .replace("- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'","- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n  disabled: true")
  .replace("- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'","- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  disabled: true");
const verified=verifyDshCompositionRestriction(inspectDshComposition(modified),
  ['tool-pwsh','tool-fs','tool-web']);
assert.equal(verified.passed,true);
assert.deepEqual(verified.missingOrEnabled,[]);
assert.equal(verified.compositionOnly,true);
const absent=verifyDshCompositionRestriction(inspectDshComposition(modified),
  ['tool-pwsh','tool-jobs']);
assert.equal(absent.passed,false);
assert.deepEqual(absent.missingOrEnabled,['tool-jobs']);
assert.throws(()=>inspectDshComposition(base+'\n- id: tool-fs\n  disabled: true'),
  /duplicate/i);
assert.throws(()=>inspectDshComposition('- id: sandbox-policy\n  mode: read-only'),
  /incomplete/i);
assert.throws(()=>inspectDshComposition(base,{profile:'desktop'}),/Invalid/);
assert.throws(()=>inspectDshComposition(base+'x'.repeat(2100000)),/Invalid/);
assert.throws(()=>verifyDshCompositionRestriction(scanned,['../../project']),/Invalid/);
const sdk=inspectDshComposition([
  '- id: sdk-jsonrpc-server',"  name: 'mock'",
  '- id: sandbox-policy','  config:','    mode: danger-full-access',
  '- id: persistent-pwsh',"  name: 'mock'",
].join('\n'),{profile:'sdk-minimal'});
assert.equal(sdk.hasSdkJsonRpc,true);
assert.equal(sdk.sandboxMode,'danger-full-access');
assert.equal(sdk.highRisk.find(x=>x.id==='persistent-pwsh').disabled,false);
assert.equal(verifyDshCompositionRestriction(sdk,['persistent-pwsh']).passed,false);
console.log('PASS: DSH S0 read-only composition inventory, explicit read-only overlays, and fail-closed unverified-tool guards.');
