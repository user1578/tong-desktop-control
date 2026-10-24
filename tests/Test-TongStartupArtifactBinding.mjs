import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loginFixture,sha} from './fixtures/TongLoginRecoveryFixture.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const {root,profile:original,managerProfile:originalManager}=await loginFixture();
const pin=JSON.parse(await readFile(join(root,'run/release-pin.json'),'utf8'));
async function natives(prefix){
 const result=[];for(const item of await readdir(join(project,prefix),{withFileTypes:true})){
   const path=prefix+'/'+item.name;
   if(item.isDirectory())result.push(...await natives(path));
   else if(/\.(node|dll|exe)$/i.test(path)){const bytes=await readFile(join(project,path));result.push({path,size:bytes.length,sha256:sha(bytes)});}
 }return result;
}
pin.native=[...await natives('node_modules/better-sqlite3'),...await natives('node_modules/node-pty')];
assert.ok(pin.native.some(file=>file.path.endsWith('better_sqlite3.node')));
assert.ok(pin.native.some(file=>file.path.endsWith('conpty.node')));
for(const file of pin.native)for(const target of [original.codeRoot,original.managerRoot]){const path=join(target,file.path);await mkdir(dirname(path),{recursive:true});await copyFile(join(project,file.path),path);}
const bytes=Buffer.from(JSON.stringify(pin)),releaseDigest=sha(bytes),profile={...original,releaseDigest},managerProfile={...originalManager,releaseDigest};
for(const name of ['release-pin.json','manager-pin.json'])await writeFile(join(root,'run',name),bytes);
const verify=manager=>verifyRuntimeCandidate(profile,manager?{manager:true,reviewedManagerProfile:managerProfile}:{});
assert.deepEqual((await verify(false)).commit,(await verify(true)).commit);
assert.equal((await verify(true)).releaseDigest,releaseDigest);
const native=join(profile.managerRoot,pin.native[0].path),originalNative=await readFile(native);
await writeFile(native,'tampered');await assert.rejects(verify(true),/CANDIDATE_DENIED/);await writeFile(native,originalNative);
const helper=join(profile.managerRoot,'scripts/TongStartupProtocol.ps1'),originalHelper=await readFile(helper);
await writeFile(helper,'tampered');await assert.rejects(verify(true),/CANDIDATE_DENIED/);await writeFile(helper,originalHelper);
const otherPin=Buffer.from(JSON.stringify({...pin,commit:'d'.repeat(40)}));await writeFile(join(root,'run/manager-pin.json'),otherPin);
await assert.rejects(verify(true),/CANDIDATE_DENIED/);await writeFile(join(root,'run/manager-pin.json'),bytes);
await verify(false);await verify(true);
console.log(JSON.stringify({passed:true,root,sourceFiles:pin.sourceFiles.length,nativeFiles:pin.native.length,releaseDigest,appManagerBound:true,nativeTamperRejected:true,helperTamperRejected:true,managerPinMismatchRejected:true,syntheticCommitOnly:true}));
