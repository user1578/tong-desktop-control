import {readFile,writeFile,lstat,realpath,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,isAbsolute,sep} from 'node:path';
import {verifyRelease} from './TongRuntimeRelease.mjs';
import {validateProductionProfile,loadApprovedProfile} from './TongProductionProfile.mjs';
import {assertProtectedPaths} from './TongRuntimeSecurity.mjs';
const fail=code=>new Error(code),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function member(root,name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[<>"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)))throw fail('CANDIDATE_DENIED');
  const path=resolve(root,...name.split('/'));if(path===root||!path.startsWith(resolve(root)+sep)||!isAbsolute(path))throw fail('CANDIDATE_DENIED');return path;
}
async function regularFile(path){const stat=await lstat(path);if(!stat.isFile()||stat.nlink!==1||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())throw fail('CANDIDATE_DENIED');return readFile(path);}
function bound(profile,manifest,bytes){
  if(manifest.schemaVersion!==1||hash(bytes)!==profile.releaseDigest||manifest.files?.find(f=>f.path==='code/source.tar')?.sha256!==profile.sourceDigest||!Array.isArray(manifest.sourceFiles)||!Array.isArray(manifest.native))throw fail('CANDIDATE_DENIED');
}
export async function pinRuntimeRelease(profile,releaseRoot,{replace=false,manager=false}={}){
  profile=validateProductionProfile(profile);const manifest=await verifyRelease({releaseRoot});
  const bytes=await regularFile(join(releaseRoot,'release-manifest.json'));bound(profile,manifest,bytes);
  const path=join(profile.root,'run',manager?'manager-pin.json':'release-pin.json');await assertProtectedPaths([profile.root,join(profile.root,'run')]);
  let previous;try{previous=await regularFile(path);await assertProtectedPaths([path]);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&!replace){if(hash(previous)!==hash(bytes))throw fail('CANDIDATE_DENIED');return manifest;}
  if(previous){const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,path);}
  else await writeFile(path,bytes,{flag:'wx'});
  await assertProtectedPaths([path]);return manifest;
}
export async function verifyRuntimeCandidate(profile,{manager=false}={}){
  profile=validateProductionProfile(profile);
  if(manager){const permission=await loadApprovedProfile(profile.root,'manager');if(permission.managerRoot!==profile.managerRoot)throw fail('CANDIDATE_DENIED');profile=permission;}
  const pin=join(profile.root,'run',manager?'manager-pin.json':'release-pin.json');await assertProtectedPaths([profile.root,join(profile.root,'run'),pin]);
  const bytes=await regularFile(pin),manifest=JSON.parse(bytes);bound(profile,manifest,bytes);
  if(manifest.node?.executable.toLowerCase()!==process.execPath.toLowerCase()||manifest.node.version!==process.version||manifest.node.abi!==process.versions.modules||manifest.node.platform!==process.platform||manifest.node.arch!==process.arch||hash(await regularFile(process.execPath))!==manifest.node.sha256)throw fail('CANDIDATE_DENIED');
  const seen=new Set(),targetRoot=manager?profile.managerRoot:profile.codeRoot;
  if(manager)await assertProtectedPaths([targetRoot,...manifest.sourceFiles.concat(manifest.native).map(file=>member(targetRoot,file.path))]);
  for(const file of [...manifest.sourceFiles,...manifest.native]){
    const name=file.path.toLowerCase();if(seen.has(name)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size))throw fail('CANDIDATE_DENIED');seen.add(name);
    const data=await regularFile(member(targetRoot,file.path));if(data.length!==file.size||hash(data)!==file.sha256)throw fail('CANDIDATE_DENIED');
  }
  for(const [name,digest] of Object.entries(manifest.expectedDevspaceHashes??{})){
    if(!['pi-tools.js','server.js','workspaces.js'].includes(name)||hash(await regularFile(join(targetRoot,'node_modules','@waishnav','devspace','dist',name)))!==digest)throw fail('CANDIDATE_DENIED');
  }
  if(Object.keys(manifest.expectedDevspaceHashes??{}).length!==3)throw fail('CANDIDATE_DENIED');
  for(const [name,version] of Object.entries(manifest.versions??{}))if(JSON.parse(await regularFile(member(targetRoot,'node_modules/'+name+'/package.json'))).version!==version)throw fail('CANDIDATE_DENIED');
  return {commit:manifest.commit,sourceDigest:profile.sourceDigest,releaseDigest:profile.releaseDigest,node:manifest.node,verified:true};
}
