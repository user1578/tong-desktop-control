// One finite, stopped-fixture install/rollback rehearsal, not an installer.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {processIdentity,sameProcess,startupJobsState} from '../scripts/TongRuntimeSecurity.mjs';
import {sha} from './fixtures/TongLoginRecoveryFixture.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8')),project=fileURLToPath(new URL('../',import.meta.url));
const {root}=await json(join(project,'artifacts/024-recovery/seven-file-prep-current.local.json'));
assert.match(root,/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
const outcome=await json(join(root,'task-outcome.json'));assert.equal(outcome.passed,true);assert.equal(outcome.testTaskDisabled,true);
const profile=await json(join(root,'profile.json')),r=await json(join(root,'run/runtime.json')),g=await json(join(root,'run/guardian.json'));
assert.equal(profile.codeRoot,join(root,'tong'));assert.equal(profile.managerRoot,join(root,'releases/manager'));
const profileHash=sha(await readFile(join(root,'profile.json')));
const baselinePin=await json(join('D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a','run/release-pin.json'));
assert.equal(r.phase,'stopped');for(const p of [g,r.supervisor,...r.children,...r.descendants])assert.equal(sameProcess(await processIdentity(p.pid),p),false);
assert.deepEqual(await startupJobsState(r.runId),{owner:0,launcher:0,guardian:0,runtime:0});
const evidence=join(root,'install-rollback');await mkdir(evidence);
const held=await open(join(root,'run/backup.freeze'),'wx');
const saved=[];
try{
  for(const target of [profile.codeRoot,profile.managerRoot])for(const item of (await json(join(root,'seven-file-preparation.json'))).seven){
    const path=join(target,item.path),bytes=await readFile(path),key=String((await stat(path,{bigint:true})).ino),name=(target===profile.codeRoot?'app-':'manager-')+item.path.slice(8);
    await rename(path,join(evidence,name));saved.push({path,name,sha256:sha(bytes),fileKey:key});
    // Place original-v2 bytes for a deliberately interrupted transition. The
    // protocol was absent in v2, so leave it absent rather than deleting it.
    if(item.originalSha256){const original=await readFile(join('D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a',target===profile.codeRoot?'tong':'releases/manager',item.path));assert.equal(sha(original),baselinePin.sourceFiles.find(f=>f.path===item.path).sha256);await writeFile(path,original,{flag:'wx'});}
    if(target===profile.codeRoot&&item.path.endsWith('TongAgentDockRuntime.mjs'))await assert.rejects(verifyRuntimeCandidate(profile),/CANDIDATE_DENIED/,'partial App install must fail binding');
    if(target===profile.managerRoot&&item.path.endsWith('TongAgentDockRuntime.mjs'))await assert.rejects(verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}}),/CANDIDATE_DENIED/,'partial Manager install must fail binding');
  }
}finally{
  for(const item of saved){try{await stat(item.path);await rename(item.path,join(evidence,'interrupted-'+item.name));}catch(error){if(error.code!=='ENOENT')throw error;}await rename(join(evidence,item.name),item.path);assert.equal(sha(await readFile(item.path)),item.sha256);assert.equal(String((await stat(item.path,{bigint:true})).ino),item.fileKey);}
  await held.close();await rename(join(root,'run/backup.freeze'),join(evidence,'completed-maintenance.freeze'));
}
const app=await verifyRuntimeCandidate(profile),manager=await verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}});
assert.equal(app.commit,outcome.testCommit);assert.equal(manager.commit,outcome.testCommit);
const pin=await readFile(join(root,'run/manager-pin.json'));
const mismatched=JSON.stringify({...JSON.parse(pin),commit:'0'.repeat(40)});
await writeFile(join(root,'run/manager-pin.json'),mismatched);
try{await assert.rejects(verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}}),/CANDIDATE_DENIED/);}finally{await writeFile(join(root,'run/manager-pin.json'),pin);}
await verifyRuntimeCandidate(profile,{manager:true,reviewedManagerProfile:{...profile,agentdockEnabled:false}});
assert.equal(sha(await readFile(join(root,'profile.json'))),profileHash);
const result={passed:true,partialAppRejected:true,partialManagerRejected:true,mismatchedPinRejected:true,all14PhysicalSourceOriginalsRestored:true,appManagerSameCommit:true,profileUnchanged:true,productionMutation:false};
await writeFile(join(root,'install-rollback-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
