import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
const tmp=await createTongTestDirectory('release-long-path-');let passed=false;
try{
 const source=await readFile(new URL('../scripts/TongRuntimeRelease.mjs',import.meta.url),'utf8');
 const literal=source.match(/const extractScript = (`[\s\S]*?`);/)[1],extract=new Function('return '+literal)();
 const python='C:\\Program Files\\Python311\\python.exe',archive=join(tmp.path,'source.tar'),dest=join(tmp.path,'target-'+'x'.repeat(140)),commit='a'.repeat(40),name='nested/'+'y'.repeat(80)+'.txt';
 const make=spawnSync(python,['-I','-c',"import tarfile,io,sys; a=tarfile.open(sys.argv[1],'w',format=tarfile.PAX_FORMAT,pax_headers={'comment':sys.argv[2]});m=tarfile.TarInfo(sys.argv[3]);m.size=5;a.addfile(m,io.BytesIO(b'hello'));a.close()",archive,commit,name],{encoding:'utf8',windowsHide:true});
 assert.equal(make.status,0,make.stderr);
 const r=spawnSync(python,['-I','-c',extract,archive,dest,commit],{encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,r.stderr);assert.equal(await readFile(join(dest,...name.split('/')),'utf8'),'hello');
 passed=true;console.log(JSON.stringify({passed,longPathChars:join(dest,name).length,systemPolicyChanged:false}));
}finally{await tmp.finish(passed);}
