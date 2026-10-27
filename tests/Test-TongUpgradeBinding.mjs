import assert from 'node:assert/strict';
import {validateUpgradeBinding} from '../scripts/TongUpgradeBinding.mjs';
const old='a'.repeat(40),next='b'.repeat(40);
const native=[{path:'node_modules/native.node',sha256:'c'.repeat(64),size:10}];
const pin={commit:old,native,versions:{locked:'1'}};
const manifest={commit:next,native,versions:{locked:'1'}};
assert.equal(validateUpgradeBinding({oldApp:pin,oldManager:pin,manifest,expectedOld:old,expectedNew:next}),true);
for(const change of [x=>x.oldManager.commit='d'.repeat(40),x=>x.manifest.native[0].sha256='e'.repeat(64),x=>x.manifest.versions.locked='2',x=>x.manifest.commit=old]){
  const x={oldApp:structuredClone(pin),oldManager:structuredClone(pin),manifest:structuredClone(manifest),expectedOld:old,expectedNew:next};change(x);
  assert.throws(()=>validateUpgradeBinding(x),/UPGRADE_BINDING_DENIED/);
}
console.log('PASS: exact baseline, candidate and unchanged dependency/native bindings.');
