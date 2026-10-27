import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const wrapper=await readFile(new URL('../scripts/Invoke-TongQuickTrustFullProduction.ps1',import.meta.url),'utf8');
for(const [field,file] of [['helperSha256','TongQuickTrustFullCutover.mjs'],['cleanupProbeSha256','TongCutoverStoppedRunProbe.mjs']]){
 const expected=wrapper.match(new RegExp('\\$'+field+"='([a-f0-9]{64})'"))[1];
 assert.equal(createHash('sha256').update(await readFile(new URL('../scripts/'+file,import.meta.url))).digest('hex'),expected,file+' must match reviewed wrapper binding');
}
assert.ok(wrapper.includes('Assert-ControlSourceBinding'),'New production controller must bind the entire archived scripts directory');
console.log('PASS: reviewed upgrade helper, stop proof and full controller binding.');
