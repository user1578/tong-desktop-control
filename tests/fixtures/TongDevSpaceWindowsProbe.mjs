// Run only against the synthetic directory supplied by the Windows probe.
import assert from 'node:assert/strict';
import {mkdirSync,chmodSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,packageRoot,label]=process.argv.slice(2);
assert.match(resolve(root),/^D:\\Tong\\state\\comm-chmod-[a-zA-Z0-9]+\\/);
const {openDatabase}=await import(pathToFileURL(join(packageRoot,'dist/db/client.js')));
const results=[];
for(const name of ['fresh','existing','acl-clone','deny-attributes','deny-data']){
  const path=join(root,name),dbPath=join(path,'devspace.sqlite');
  const before=existsSync(dbPath);
  try{
    mkdirSync(path,{recursive:true,mode:0o700});
    const db=openDatabase(path);
    try{
      db.sqlite.exec('CREATE TABLE IF NOT EXISTS probe(value TEXT)');
      db.sqlite.prepare('INSERT INTO probe(value) VALUES(?)').run('synthetic-only');
      results.push({name,ok:true,rows:db.sqlite.prepare('SELECT COUNT(*) AS n FROM probe').get().n,
        journal:db.sqlite.pragma('journal_mode',{simple:true}),databaseAlreadyExisted:before});
    }finally{db.close();}
    chmodSync(dbPath,0o600);
    const reopened=openDatabase(path);
    try{assert.equal(reopened.sqlite.prepare('SELECT COUNT(*) AS n FROM probe').get().n,1);}
    finally{reopened.close();}
  }catch(error){results.push({name,ok:false,code:error.code??null,stack:error.stack,databaseCreated:existsSync(dbPath)});}
}
const outcome={node:process.version,uv:process.versions.uv,pid:process.pid,label,root,results};
writeFileSync(join(root,'result.json'),JSON.stringify(outcome,null,2));
console.log(JSON.stringify(outcome));
for(const r of results){
  if(r.name==='deny-attributes'){assert.equal(r.ok,false);assert.equal(r.databaseCreated,false);assert.equal(r.code,'EPERM');}
  else if(r.name==='deny-data')assert.equal(r.ok,false);
  else{assert.equal(r.ok,true);assert.equal(r.journal,'wal');}
}
