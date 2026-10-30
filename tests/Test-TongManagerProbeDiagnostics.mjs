import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createManagerProbeDiagnostic} from '../scripts/TongManagerProbeDiagnostic.mjs';

// Small isolated files; no runtime, task, grant or credentials are touched.
const root=await mkdtemp('D:\\Tong\\development\\test-temp\\manager-probe-');
await mkdir(join(root,'logs'));
const id=randomUUID(), path=join(root,'logs','login-manager-probe.json');
const probe=createManagerProbeDiagnostic(root,id,'doctor');
probe('envelope_unseal');
let record=JSON.parse(await readFile(path,'utf8'));
assert.equal(record.invocationId,id);assert.equal(record.pid,process.pid);
assert.equal(record.stage,'envelope_unseal');assert.equal(record.action,'doctor');
probe('secret-token-and-private-error');
assert.equal(JSON.parse(await readFile(path,'utf8')).stage,'unspecified');
assert.throws(()=>createManagerProbeDiagnostic(root,'../escape','doctor'),/INVALID_DIAGNOSTIC/);
assert.throws(()=>createManagerProbeDiagnostic(root,id,'stop-run'),/INVALID_DIAGNOSTIC/);
await rename(path,path+'.retained');await mkdir(path);
for(let n=0;n<3;n++)createManagerProbeDiagnostic(root,randomUUID(),'doctor')('entry');
assert.equal((await readdir(join(root,'logs'))).filter(name=>name.endsWith('.tmp')).length,0,'failed replace cannot accumulate one scratch file per probe');
const originalWrite=fs.writeFileSync;
try{
  fs.writeFileSync=(fd)=>{originalWrite(fd,'partial');throw Object.assign(Error('simulated write failure'),{code:'ENOSPC'});};syncBuiltinESMExports();
  createManagerProbeDiagnostic(root,randomUUID(),'doctor')('entry');
}finally{fs.writeFileSync=originalWrite;syncBuiltinESMExports();}
assert.equal((await readdir(join(root,'logs'))).filter(name=>name.endsWith('.tmp')).length,0,'partial writes cannot accumulate scratch files');
// An actual Windows child returns the original 32-bit status, not exit=1.
const child=spawnSync(process.execPath,['-e','process.exit(-1073740791)'],{windowsHide:true});
assert.equal(child.status>>>0,0xC0000409);
console.log(JSON.stringify({passed:true,root,nativeExitSimulated:true,productionAcceptance:false}));
