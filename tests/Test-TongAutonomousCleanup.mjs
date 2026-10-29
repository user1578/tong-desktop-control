import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';
const fixture=await createTongTestDirectory('tong-autonomous-cleanup-');
let passed=false;
try{
 const root=join(fixture.path,'root'),store=join(fixture.path,'store');
 await mkdir(root);await mkdir(store);
 const grant={id:'synthetic',root,enabled:true,revision:'one',scopes:[{relativeRoot:'.',categories:['cache']}]};
 await writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[grant]}));
 const access={listProjects:async()=>[{id:'synthetic',root,status:'enabled',available:true,effectiveCapabilities:['project.read','project.write']}]};
 const manager=new TongManagedCleanup({access,stateDir:store});
 const protectedNames=['AGENTS.md','agent.md','CLAUDE.md','my-agent-rules.MD','notes.md','Cookies','Login Data','token.json','api-key.txt','certificate.pem','business.sqlite','.env','NTUSER.DAT','id_rsa','id_ed25519','id_ecdsa','id_dsa','authorized_keys','kubeconfig','.npmrc','.netrc','.git-credentials','.config/settings','.git/config','.codex/sessions/native.json','.claude/settings.json','profile/Local Storage/login','config/settings.json','session/history.json'];
 let caseNumber=0;
 for(const name of ['__pycache__','node-compile-cache']){
  for(const rel of protectedNames){
   const cache=join(root,'case-'+(++caseNumber),name);await mkdir(cache,{recursive:true});
   const p=join(cache,rel);await mkdir(dirname(p),{recursive:true});await writeFile(p,'synthetic protected bytes');
   await assert.rejects(manager.plan({projectId:'synthetic',path:cache}),/CLEANUP_PROTECTED_CONTENT/,rel);
   assert.equal(await readFile(p,'utf8'),'synthetic protected bytes');
  }
  const cache=join(root,name);await mkdir(cache);
  await writeFile(join(cache,'AGENTS.md'),'synthetic protected bytes');
  await writeFile(join(cache,'safe.pyc'),'rebuildable');
  // The legacy Plan must reject mixed content before reading any protected body.
  await assert.rejects(manager.plan({projectId:'synthetic',path:cache}),/CLEANUP_PROTECTED_CONTENT/);
  assert.equal(await readFile(join(cache,'AGENTS.md'),'utf8'),'synthetic protected bytes');
 }
 const gitRoot=join(root,'git-project'),gitCache=join(gitRoot,'__pycache__');await mkdir(join(gitRoot,'.git'),{recursive:true});await mkdir(gitCache);await writeFile(join(gitCache,'uncommitted.pyc'),'retain Git state');
 await assert.rejects(manager.plan({projectId:'synthetic',path:gitCache}),/CLEANUP_GIT_WORKTREE_PROTECTED/);assert.equal(await readFile(join(gitCache,'uncommitted.pyc'),'utf8'),'retain Git state');
 console.log('PASS: mixed caches protect Agent rules, identities, Git, databases and sessions.');
 passed=true;
}finally{await fixture.finish(passed);}
