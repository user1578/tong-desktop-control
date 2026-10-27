import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,relative,sep,join,parse} from 'node:path';

export const cleanupCategories=Object.freeze(['cache','historical-candidate','quick-trust-candidate']);
const fail=code=>{const e=Error(code);e.code=code;throw e;};
export const cleanupContains=(root,target)=>{const r=relative(resolve(root),resolve(target));return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
export async function cleanupOrdinaryPath(path){
  let p=resolve(path);
  while(true){const s=await lstat(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1||(!s.isFile()&&!s.isDirectory())||(await realpath(p)).toLowerCase()!==p.toLowerCase())fail('CLEANUP_AUTHORIZATION_UNSAFE');const parent=resolve(p,'..');if(parent===p)break;p=parent;}
}
export function validateCleanupGrants(value){
  if(value?.schemaVersion!==1||!Array.isArray(value.grants)||value.grants.length>32)fail('CLEANUP_AUTHORIZATION_INVALID');
  const ids=new Set();
  for(const g of value.grants){
    if(!/^[a-z][a-z0-9-]{1,39}$/.test(g?.id??'')||ids.has(g.id)||!isAbsolute(g.root??'')||resolve(g.root)===parse(g.root).root||typeof g.enabled!=='boolean'||typeof g.revision!=='string'||!g.revision||!Array.isArray(g.scopes)||!g.scopes.length||g.scopes.length>64)fail('CLEANUP_AUTHORIZATION_INVALID');
    ids.add(g.id);
    for(const s of g.scopes){
      if(typeof s.relativeRoot!=='string'||!s.relativeRoot||isAbsolute(s.relativeRoot)||s.relativeRoot.split(/[\\/]/).some(p=>p==='..'||p.includes(':')||!p)||!cleanupContains(g.root,resolve(g.root,s.relativeRoot))||!Array.isArray(s.categories)||!s.categories.length||s.categories.some(c=>!cleanupCategories.includes(c)))fail('CLEANUP_AUTHORIZATION_INVALID');
    }
  }
  return value;
}
// Deliberately read-only. No MCP handler can create or renew a grant.
export class TongCleanupAuthorization{
  constructor(stateDir){if(!isAbsolute(stateDir??''))fail('CLEANUP_INVALID_CONFIGURATION');this.path=join(stateDir,'disk-cleanup-grants.json');}
  async read(){
    try{await cleanupOrdinaryPath(this.path);return validateCleanupGrants(JSON.parse(await readFile(this.path,'utf8')));}
    catch(e){if(e.code==='ENOENT')return {schemaVersion:1,grants:[]};if(e.code?.startsWith('CLEANUP_'))throw e;fail('CLEANUP_AUTHORIZATION_INVALID');}
  }
  async resolve(projectId,target,category){
    const g=(await this.read()).grants.find(x=>x.id===projectId&&x.enabled);
    if(!g||!cleanupContains(g.root,target)||resolve(g.root).toLowerCase()===resolve(target).toLowerCase())return null;
    if(!g.scopes.some(s=>cleanupContains(resolve(g.root,s.relativeRoot),target)&&s.categories.includes(category)))return null;
    await cleanupOrdinaryPath(g.root);
    return {root:resolve(g.root),revision:g.revision};
  }
}
