import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Only the named leaves beneath LocalAppData qualify for Windows cache handling.
// Removing AppData from the veto check does NOT remove other protected parts.
export function windowsCacheKind(path){
 const p=resolve(path);
 if(!/^[CD]:\\/i.test(p))return null;
 const match=p.match(/\\AppData\\Local\\(Temp|npm-cache|pip\\Cache)$/i);
 return !match?null:match[1].toLowerCase()==='temp'?'temporary':match[1].toLowerCase()==='npm-cache'?'npm':'pip';
}
export function windowsCacheBase(path){return resolve(path).replace(/\\(?:Temp|npm-cache|pip\\Cache)$/i,'');}
export function windowsCachePublicPath(path){return resolve(path).replace(/\\AppData\\Local(?=\\|$)/ig,'');}
export function windowsCacheDirectory(kind,path){
 const rel=path.replaceAll('\\','/');
 if(kind==='npm')return /^_cacache(?:\/(?:content-v2(?:\/sha(?:1|256|512)(?:\/[a-f0-9]+)*)?|index-v5(?:\/[a-f0-9]+)*))?$/i.test(rel);
 if(kind==='pip')return /^(?:http|http-v2|wheels)(?:\/[a-f0-9]+)*$/i.test(rel);
 return false;
}
export function windowsCacheFile(kind,path,info,now=Date.now()){
 const rel=path.replaceAll('\\','/');
 if(kind==='temporary')return !rel.includes('/')&&/\.(?:tmp|temp)$/i.test(rel)&&now-info.mtimeMs>=86400000&&info.mtimeMs>=0;
 if(kind==='npm')return /^_cacache\/(?:content-v2\/sha(?:1|256|512)|index-v5)\/[a-f0-9/]+$/i.test(rel);
 if(kind==='pip')return /^(?:http|http-v2)\/[a-f0-9/]+(?:\.body)?$/i.test(rel)||/^wheels\/[a-f0-9/]+\/[^/]+\.whl$/i.test(rel);
 return false;
}
export async function windowsCleanupRoots(){
 const helper=fileURLToPath(new URL('./TongWindowsCleanupRoots.ps1',import.meta.url));
 return new Promise((accept,reject)=>{
  const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',helper],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let out='';const timer=setTimeout(()=>{child.kill();reject(Error('CLEANUP_WINDOWS_ROOTS_UNAVAILABLE'));},10000);
  child.stdout.on('data',b=>{out+=b;if(out.length>4096)child.kill();});
  child.once('error',()=>{clearTimeout(timer);reject(Error('CLEANUP_WINDOWS_ROOTS_UNAVAILABLE'));});
  child.once('close',code=>{clearTimeout(timer);try{
   const roots=JSON.parse(out);if(code!==0||!Array.isArray(roots)||roots.length!==3||roots.some(r=>windowsCacheKind(r.path)!==r.kind))throw Error();accept(roots);
  }catch{reject(Error('CLEANUP_WINDOWS_ROOTS_UNAVAILABLE'));}});
 });
}
