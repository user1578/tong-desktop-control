import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';
const fixture=await createTongTestDirectory('tong-quick-trust-cleanup-');
let passed=false;
try{
 const root=join(fixture.path,'registered');
 const group=join(root,'p27-autonomy-candidate-20261017');
 const short='5362210',commit=short+'c'.repeat(33);
 const candidate=join(group,'quick-trust-candidate-'+short);
 const release=join(group,'quick-trust-release-'+short);
 await mkdir(candidate,{recursive:true});
 const hash=data=>createHash('sha256').update(data).digest('hex');
 const src=[],archive=[];
 const local=async (name,data)=>{
  const p=join(candidate,...name.split('/'));await mkdir(dirname(p),{recursive:true});await writeFile(p,data);
  src.push({path:name,size:Buffer.byteLength(data),sha256:hash(data)});
 };
 const saved=async (name,data)=>{
  const p=join(release,...name.split('/'));await mkdir(dirname(p),{recursive:true});await writeFile(p,data);
  archive.push({path:name,size:Buffer.byteLength(data),sha256:hash(data)});
 };
 await local('package-lock.json','synthetic lock');
 await local('package.json','{"name":"synthetic"}');
 await local('scripts/main.mjs','export const x=1;');
 await saved('code/source.tar','synthetic source archive');
 await saved('code/source/package-lock.json','synthetic lock');
 for(let i=0;i<23;i++)await saved('native/node_modules/f'+i+'.bin','binary'+i);
 await writeFile(join(release,'release-manifest.json'),JSON.stringify({commit,sourceFiles:src,files:archive}));
 await writeFile(join(candidate,'release-restore-evidence.json'),JSON.stringify({commit,sourceFilesVerified:src.length,patchChecked:true,sqliteNativeLoaded:true,nativeRestore:'exact archived hashes'}));
 await mkdir(join(candidate,'node_modules'),{recursive:true});
 await writeFile(join(candidate,'node_modules','installed-dependency.js'),'rebuildable');
 let enabled=true;
 const access={listProjects:async()=>[{id:'synthetic',root,status:'enabled',available:true,effectiveCapabilities:enabled?['project.write','project.read']:['project.read']}]};
 const manager=new TongManagedCleanup({access,stateDir:join(fixture.path,'audit')});
 const plan=await manager.plan({projectId:'synthetic',path:candidate});
 assert.equal(plan.category,'quick-trust-candidate');
 // Unarchived business source must block.
 await local('independent-data.txt','do not lose me');
 await assert.rejects(manager.plan({projectId:'synthetic',path:candidate}),/CLEANUP_UNARCHIVED_SOURCE/);
 // Retain original bytes by replacing the unarchived file with the exact saved set in this synthetic fixture only.
 await import('node:fs/promises').then(fs=>fs.unlink(join(candidate,'independent-data.txt')));
 // A tampered preserved native artifact blocks even the read-only plan.
 await writeFile(join(release,'native','node_modules','f2.bin'),'tampered');
 await assert.rejects(manager.plan({projectId:'synthetic',path:candidate}),/CLEANUP_ARCHIVE_MISMATCH/);
 await writeFile(join(release,'native','node_modules','f2.bin'),'binary2');
 const newer=await manager.plan({projectId:'synthetic',path:candidate});
 assert.equal((await manager.execute({projectId:'synthetic',planId:newer.planId})).status,'deleted');
 await assert.rejects(stat(candidate),{code:'ENOENT'});
 assert.ok((await stat(release)).isDirectory());
 assert.equal((await readFile(join(release,'native','node_modules','f2.bin'),'utf8')),'binary2');
 const audit=await readFile(join(fixture.path,'audit','disk-cleanup-audit.jsonl'),'utf8');
 assert.ok(audit.includes('cleanup_deleted'));
 console.log('PASS: quick trust cleanup is archived, audited, bounded and rejects unique source/changed native.');
 passed=true;
}finally{await fixture.finish(passed);}
