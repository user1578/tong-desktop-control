import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2], mode = process.argv[3];
const staging = 'D:\\Tong\\state\\p27-autonomy-candidate-20261017';
if (!isAbsolute(root ?? '') || !/^b23-login-[a-f0-9]{32}$/.test(root.split(/[\\/]/).at(-1))
  || !['prepare-old','restore-new'].includes(mode)) throw Error('SIMULATION_SCOPE_DENIED');
const sha = b => createHash('sha256').update(b).digest('hex');
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const release = await json(join(staging, 'release', 'release-manifest.json'));
const pins = {
  app: 'D:\\Tong\\runtime\\run\\release-pin.json',
  manager: 'D:\\Tong\\runtime\\run\\manager-pin.json',
};
const dirs = {app: join(root, 'tong'), manager: join(root, 'releases', 'manager')};
const locked = await json(join(root, 'run', 'runtime.json'));
const {runtimeStatus} = await import(pathToFileURL(join(root,'releases','manager','scripts','TongAgentDockRuntime.mjs')).href);
const {revokeSimulationLoginRecovery} = await import(pathToFileURL(join(root,'releases','manager','scripts','TongLoginRecovery.mjs')).href);
const status = await runtimeStatus(root);
assert.equal(status.phase,'stopped');
assert.equal(status.supervisorAlive,false);
assert.equal(status.guardianAlive,false);
const cpSafe = (directory, rel) => {
  if(typeof rel!=='string'||!rel||rel.startsWith('/')||rel.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')))
    throw Error('INVALID_SOURCE_PATH');
  const full = join(directory, ...rel.split('/'));
  const sub=relative(directory,full);
  if(!sub||sub==='..'||sub.startsWith('..'+sep)||isAbsolute(sub))throw Error('OUTSIDE_SOURCE_TREE');
  return full;
};
const snapshotRoot=join(staging,'runtime-rollback-rehearsal');
await mkdir(snapshotRoot,{recursive:true});
const saved = join(snapshotRoot,'candidate-metadata.json');
const toCopy = async (from, to, expected) => {
  const bytes = await readFile(from);
  if (sha(bytes)!==expected.sha256)throw Error('SOURCE_HASH_MISMATCH:'+expected.path);
  await mkdir(join(to,'..'),{recursive:true});
  await writeFile(to,bytes);
};

if(mode==='prepare-old'){
  const oldPins={app:await readFile(pins.app),manager:await readFile(pins.manager)};
  assert.equal(release.commit,'bb234ec794c1d8180586781c92601f2eae95e750');
  assert.equal(JSON.parse(oldPins.app).commit,'3442cbb938dea887a55bf13a72a5213ae4c5dbe5');
  assert.equal(JSON.parse(oldPins.manager).commit,'1eac7502a9cf89be7daf63d59843ad9f49b61877');
  const original={oldRunId:locked.runId,schemaVersion:1,
    profile:await json(join(root,'profile.json')),
    appPin:(await readFile(join(root,'run','release-pin.json'))).toString('utf8'),
    managerPin:(await readFile(join(root,'run','manager-pin.json'))).toString('utf8'),
    previousMode:'candidate',prepareAt:new Date().toISOString()};
  assert.equal(original.profile.mode,'production-simulation');
  assert.equal(JSON.parse(original.appPin).commit,'c'.repeat(40));
  if (await stat(saved).then(()=>true,()=>false))throw Error('SNAPSHOT_ALREADY_EXISTS');
  await writeFile(saved,JSON.stringify(original,null,2)+'\n',{flag:'wx'});
  // Revoke current synthetic login grant before changing its pinned code.
  await revokeSimulationLoginRecovery(root);
  const summary=[];
  for (const part of ['app','manager']) {
    const old=JSON.parse(oldPins[part]);const files = new Map(old.sourceFiles.map(f=>[f.path,f]));
    const targetRoot=dirs[part], backupRoot=join(snapshotRoot,'candidate-retired',part);
    let removed=0;
    for(const f of release.sourceFiles)if(!files.has(f.path)) {
      const from=cpSafe(targetRoot,f.path);
      if(await stat(from).then(()=>true,()=>false)){
        const to=cpSafe(backupRoot,f.path);await mkdir(join(to,'..'),{recursive:true});await rename(from,to);removed++;
      }
    }
    for(const f of old.sourceFiles){
      const from=cpSafe(join(staging,'rollback-dryrun',part),f.path);
      await toCopy(from,cpSafe(targetRoot,f.path),f);
    }
    summary.push({part,commit:old.commit,verified:old.sourceFiles.length,retired:removed});
  }
  const oldApp=JSON.parse(oldPins.app);
  const newProfile={...original.profile,sourceDigest:oldApp.files.find(f=>f.path==='code/source.tar').sha256,
    releaseDigest:sha(oldPins.app)};
  const {validateProductionProfile}=await import(pathToFileURL(join(root,'releases','manager','scripts','TongProductionProfile.mjs')).href);
  validateProductionProfile(newProfile);
  await writeFile(join(root,'run','release-pin.json'),oldPins.app);
  await writeFile(join(root,'run','manager-pin.json'),oldPins.manager);
  await writeFile(join(root,'profile.json'),JSON.stringify(newProfile));
  console.log(JSON.stringify({prepared:true,synthetic:true,summary}));
}else{
  const original=await json(saved);
  assert.equal(original.previousMode,'candidate');
  await revokeSimulationLoginRecovery(root);
  const oldPins={app:await json(pins.app),manager:await json(pins.manager)};
  const summary=[];
  for(const part of ['app','manager']){
    const oldPaths=new Set(oldPins[part].sourceFiles.map(f=>f.path));
    const newPaths=new Map(release.sourceFiles.map(f=>[f.path,f]));
    const targetRoot=dirs[part],retiredRoot=join(snapshotRoot,'old-retired',part);
    let removed=0;
    for(const f of oldPins[part].sourceFiles)if(!newPaths.has(f.path)){
      const from=cpSafe(targetRoot,f.path);const to=cpSafe(retiredRoot,f.path);
      await mkdir(join(to,'..'),{recursive:true});await rename(from,to);removed++;
    }
    for(const f of release.sourceFiles){
      const srcRoot=join(staging,part==='app'?'staged-app':'staged-manager');
      await toCopy(cpSafe(srcRoot,f.path),cpSafe(targetRoot,f.path),f);
    }
    summary.push({part,commit:release.commit,verified:release.sourceFiles.length,retired:removed});
  }
  await writeFile(join(root,'run','release-pin.json'),original.appPin);
  await writeFile(join(root,'run','manager-pin.json'),original.managerPin);
  await writeFile(join(root,'profile.json'),JSON.stringify(original.profile));
  console.log(JSON.stringify({restored:true,synthetic:true,summary}));
}
