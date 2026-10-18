import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, relative, isAbsolute} from 'node:path';

const BASE='D:\\Tong\\state\\native-codex-acceptance-20261018\\persistent-proxy-candidate';
const NEW='cc9c04dc6b0731f0d199c09372acfab83e0a2c11';
const OLD='bb234ec794c1d8180586781c92601f2eae95e750';
const PROD='D:\\Tong\\runtime';
const PROD_APP='D:\\Tong\\app';
const PROD_MANAGER=join(PROD,'releases','manager');
const hex=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const manifest=await json(join(BASE,'release','release-manifest.json'));
const old={app:await json(join(PROD,'run','release-pin.json')),
  manager:await json(join(PROD,'run','manager-pin.json'))};
assert.equal(manifest.commit,NEW);
assert.equal(manifest.sourceFiles.length,189);
for(const key of ['app','manager'])assert.equal(old[key].commit,OLD);
function checked(root,relativeName) {
  assert.equal(typeof relativeName,'string');
  assert.ok(!isAbsolute(relativeName)&&relativeName&&!relativeName.includes('\\'));
  assert.ok(relativeName.split('/').every(p=>p&&!['.','..'].includes(p)&&!p.includes(':')));
  const result=join(root,...relativeName.split('/'));
  const tail=relative(root,result);
  assert.ok(tail && tail!=='..'&&!tail.startsWith('..\\'));
  return result;
}
async function exact(path,file) {
  const bytes=await readFile(path);
  assert.equal(bytes.length,file.size,'size mismatch: '+file.path);
  assert.equal(hex(bytes),file.sha256,'SHA mismatch: '+file.path);
  return bytes;
}
const paths={app:PROD_APP,manager:PROD_MANAGER};
for(const key of ['app','manager']){
  for(const f of old[key].sourceFiles) await exact(checked(paths[key],f.path),f);
  for(const f of manifest.sourceFiles) await exact(checked(join(BASE,'staged-'+key),f.path),f);
}
const oldRunner=old.manager.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
const newRunner=manifest.sourceFiles.find(f=>f.path==='scripts/TongLoginRuntime.ps1');
assert.ok(oldRunner && newRunner);
await exact(join(PROD,'login-management','TongLoginRuntime.ps1'),oldRunner);

const results=[];
async function scenario(name,partialFiles) {
  const temp=await mkdtemp(join(BASE,'rollback-rehearsal-'));
  // Entire mutation happens under a brand-new dedicated rehearsal directory.
  // Production sources, state and login runner are only READ and hash-verified.
  const original=join(temp,'snapshot'),trial=join(temp,'trial'),retired=join(temp,'retired-new');
  const pinOld={app:await readFile(join(PROD,'run','release-pin.json')),manager:await readFile(join(PROD,'run','manager-pin.json'))};
  const profileOld=await readFile(join(PROD,'profile.json'));
  const runnerOld=await readFile(join(PROD,'login-management','TongLoginRuntime.ps1'));
  try {
    for(const key of ['app','manager'])for(const f of old[key].sourceFiles) {
      const to=checked(join(original,key),f.path);
      await mkdir(dirname(to),{recursive:true});
      await copyFile(checked(paths[key],f.path),to);
      await exact(to,f);
      const dst=checked(join(trial,key),f.path);
      await mkdir(dirname(dst),{recursive:true});await copyFile(to,dst);
    }
    await mkdir(join(original,'metadata'),{recursive:true});
    await mkdir(join(trial,'metadata'),{recursive:true});
    for(const [filename,bytes] of [['release-pin.json',pinOld.app],['manager-pin.json',pinOld.manager],
      ['profile.json',profileOld],['login-runner.ps1',runnerOld]]) {
      await writeFile(join(original,'metadata',filename),bytes);
      await writeFile(join(trial,'metadata',filename),bytes);
    }
    const changed=partialFiles??manifest.sourceFiles.length;
    for(const key of ['app','manager']) {
      for(const f of manifest.sourceFiles.slice(0,changed)) {
        const src=checked(join(BASE,'staged-'+key),f.path),dst=checked(join(trial,key),f.path);
        await mkdir(dirname(dst),{recursive:true});
        await copyFile(src,dst);await exact(dst,f);
      }
    }
    if(changed===manifest.sourceFiles.length) {
      for(const key of ['app','manager'])for(const f of manifest.sourceFiles)
        await exact(checked(join(trial,key),f.path),f);
      const updated=await readFile(join(BASE,'release','release-manifest.json'));
      await writeFile(join(trial,'metadata','release-pin.json'),updated);
      await writeFile(join(trial,'metadata','manager-pin.json'),updated);
      await writeFile(join(trial,'metadata','login-runner.ps1'),
        await exact(checked(join(BASE,'staged-manager'),newRunner.path),newRunner));
      const readBack=await json(join(trial,'metadata','release-pin.json'));
      assert.equal(readBack.commit,NEW);
    }

    // Precisely restore baseline, and move all candidate-only files aside.
    const deleted={app:0,manager:0};
    for(const key of ['app','manager']) {
      const originalNames=new Set(old[key].sourceFiles.map(f=>f.path));
      for(const f of manifest.sourceFiles) {
        if(originalNames.has(f.path))continue;
        const candidate=checked(join(trial,key),f.path);
        try{await stat(candidate);}catch(e){if(e.code==='ENOENT')continue;throw e;}
        const target=checked(join(retired,key),f.path);
        await mkdir(dirname(target),{recursive:true});await rename(candidate,target);deleted[key]++;
      }
      for(const f of old[key].sourceFiles){
        const dst=checked(join(trial,key),f.path);
        await mkdir(dirname(dst),{recursive:true});
        await copyFile(checked(join(original,key),f.path),dst);
        await exact(dst,f);
      }
    }
    for(const filename of ['release-pin.json','manager-pin.json','profile.json','login-runner.ps1']) {
      const data=await readFile(join(original,'metadata',filename));
      await copyFile(join(original,'metadata',filename),join(trial,'metadata',filename));
      assert.deepEqual(await readFile(join(trial,'metadata',filename)),data);
    }
    assert.equal((await json(join(trial,'metadata','release-pin.json'))).commit,OLD);
    assert.equal((await json(join(trial,'metadata','manager-pin.json'))).commit,OLD);
    for(const key of ['app','manager']) {
      const expectedOnly=manifest.sourceFiles.filter(f=>!old[key].sourceFiles.some(q=>q.path===f.path)).length;
      assert.equal(deleted[key],partialFiles===undefined?expectedOnly:
        manifest.sourceFiles.slice(0,partialFiles).filter(f=>!old[key].sourceFiles.some(q=>q.path===f.path)).length);
    }
    results.push({name,installedFilesPerComponent:changed,baselineRestored:true,retiredNew:deleted});
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
}
await scenario('complete-install-then-rollback');
await scenario('interrupted-install-then-rollback',Math.floor(manifest.sourceFiles.length/3));
console.log(JSON.stringify({passed:true,productionWritten:false,oldCommit:OLD,newCommit:NEW,
  sourceFiles:manifest.sourceFiles.length,results}));
