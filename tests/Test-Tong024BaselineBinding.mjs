import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire(import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const baseline='024d5b0920d9ad8f1a2baf2e55640a5666ad4739';
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const startup=['TongAgentDockRuntime.mjs','TongLoginRecovery.mjs','TongRuntimeLaunch.ps1','TongRuntimeGuardian.ps1','TongRuntimeSecurity.mjs','TongRuntimeSecurity.ps1','TongStartupProtocol.ps1'];
// The new exact candidate authorizes only the five-file native handoff delta.
// Existing branch-specific maintenance changes retain their prior narrow scope.
const handoffCandidate='90e3bc872989e63a6efe5bcef214e0489d54e052';
assert.deepEqual(git(['diff','--name-only','34e26801876d8b1a2fc874dddce72b0939924e87',handoffCandidate,'--','scripts']).split(/\r?\n/).sort(),['Tong024Handoff.mjs','Tong024Handoff.ps1','TongAgentDockRuntime.mjs','TongRuntimeLaunch.ps1','TongStartupProtocol.ps1'].map(name=>'scripts/'+name).sort());
const allowed=[...startup,'Tong024Handoff.mjs','Tong024Handoff.ps1','Tong024LegacyRecovery.mjs','Tong024ProductionMaintenance.mjs','TongLifecycleFreeze.mjs','TongLifecycleFreeze.ps1','TongMaintenanceTransaction.mjs','TongProductionState.mjs'].map(name=>'scripts/'+name).sort();
const changed=[...new Set((git(['diff','--name-only',baseline,'--','scripts'])+'\n'+git(['ls-files','--others','--exclude-standard','scripts'])).split(/\r?\n/).filter(Boolean))].sort();
assert.deepEqual(changed,allowed,'only dependency-closed startup and incident recovery product files may differ');
for(const name of startup){
  const reviewed=['TongRuntimeLaunch.ps1','TongStartupProtocol.ps1'].includes(name)?handoffCandidate:'34e26801876d8b1a2fc874dddce72b0939924e87';
  if(!['TongAgentDockRuntime.mjs','TongRuntimeSecurity.mjs','TongRuntimeSecurity.ps1'].includes(name))assert.equal(git(['diff',reviewed,'--','scripts/'+name]),'','exact reviewed startup core: '+name);
  assert.ok(!(await readFile(join(process.cwd(),'scripts',name),'utf8')).includes('Tong024ProductionMaintenance'),'ordinary startup must not import maintenance');
}
for(const file of ['scripts/TongLoginRuntime.ps1','scripts/TongRuntimeServer.mjs','scripts/TongRuntimeCandidate.mjs','scripts/TongProductionProfile.mjs','scripts/TongProductionApproval.ps1','scripts/TongRuntimeRelease.mjs','package.json','package-lock.json'])assert.equal(git(['diff',baseline,'--',file]),'','024 baseline kept: '+file);
// Read only the non-secret production release inventory. No production command,
// credential read, task/ACL operation, install or production write occurs here.
const pin=JSON.parse(await readFile('D:\\Tong\\runtime\\run\\release-pin.json','utf8'));
assert.equal(pin.commit,baseline);assert.equal(pin.sourceFiles.length,283);assert.equal(pin.native.length,23);
const archive=join(process.cwd(),'artifacts/024-recovery/baseline-024d5b0.tar');
assert.equal(sha(await readFile(archive)),pin.files.find(file=>file.path==='code/source.tar').sha256,'exact historical archive binding');
const python=spawnSync('C:\\Program Files\\Python311\\python.exe',['-I','-c',`import tarfile,hashlib,json,sys\na=tarfile.open(sys.argv[1]);print(json.dumps([dict(path=m.name,size=m.size,sha256=hashlib.sha256(a.extractfile(m).read()).hexdigest()) for m in a.getmembers() if m.isfile()]))`,archive],{encoding:'utf8',windowsHide:true});
assert.equal(python.status,0,python.stderr);const files=JSON.parse(python.stdout);
assert.equal(files.length,pin.sourceFiles.length);for(const file of pin.sourceFiles)assert.ok(files.some(found=>found.path===file.path&&found.size===file.size&&found.sha256===file.sha256),'baseline source mismatch: '+file.path);
for(const file of pin.native){const value=await readFile(join(process.cwd(),file.path));assert.equal(value.length,file.size);assert.equal(sha(value),file.sha256,'native unchanged: '+file.path);}
assert.equal(sha(await readFile(process.execPath)),pin.node.sha256);assert.equal(process.version,pin.node.version);assert.equal(process.versions.modules,pin.node.abi);
const Database=require('better-sqlite3'),db=new Database(':memory:');assert.equal(db.prepare('PRAGMA integrity_check').pluck().get(),'ok');db.close();
const conpty=require('../node_modules/node-pty/prebuilds/win32-x64/conpty.node');assert.equal(typeof conpty.startProcess,'function');
console.log(JSON.stringify({passed:true,baseline,productFiles:changed,baselineSourceFiles:files.length,nativeFiles:pin.native.length,nodeBound:true,sqliteNativeLoaded:true,conptyNativeLoaded:true,productionReadOnly:true}));
