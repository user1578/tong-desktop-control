import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {rename,unlink,rmdir} from 'node:fs/promises';
let child,reader,pending,queue=Promise.resolve(),idle,leases=0,lockLost=false;
function fail(code){const e=Error(code);e.code=code;return e;}
function connect(){
 if(child)return;
 child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./TongCleanupNative.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 const launched=child;
 reader=createInterface({input:child.stdout});
 reader.on('line',line=>{const request=pending;pending=null;if(!request)return;clearTimeout(request.timer);try{const response=JSON.parse(line);response.ok?request.accept(response):request.reject(fail(response.code));}catch{request.reject(fail('CLEANUP_NATIVE_PROTOCOL_FAILED'));}});
 const closed=()=>{if(child!==launched)return;if(leases)lockLost=true;if(pending){clearTimeout(pending.timer);pending.reject(fail(leases?'CLEANUP_JOB_LOCK_LOST':'CLEANUP_NATIVE_UNAVAILABLE'));pending=null;}child=null;};
 child.once('error',closed);child.once('close',closed);child.stdin.on('error',()=>{});
}
async function request(value){
 const run=async()=>{
  if(lockLost)throw fail('CLEANUP_JOB_LOCK_LOST');
  clearTimeout(idle);connect();
  try{return await new Promise((accept,reject)=>{const timer=setTimeout(()=>{pending=null;child?.kill();reject(fail('CLEANUP_NATIVE_TIMEOUT'));},10000);pending={accept,reject,timer};child.stdin.write(JSON.stringify(value)+'\n');});}
  finally{if(!leases){idle=setTimeout(()=>closeCleanupNative(),1000);idle.unref();}}
 };
 const result=queue.then(run);queue=result.catch(()=>{});return result;
}
export async function cleanupAtomicReplace(from,to){if(process.platform==='win32')await request({action:'replace',from,to});else await rename(from,to);}
export async function acquireCleanupLock(path){
 if(process.platform!=='win32')throw fail('CLEANUP_NATIVE_WINDOWS_REQUIRED');
 const key=createHash('sha256').update(path.toLowerCase()).digest('hex');
 leases++;try{await request({action:'acquire',key});}catch(e){leases--;throw e;}
 let released=false;return async()=>{if(released)return;released=true;try{if(!lockLost)await request({action:'release',key});}finally{leases--;if(!leases){lockLost=false;idle=setTimeout(()=>closeCleanupNative(),1000);idle.unref();}}};
}
export async function cleanupHandleDelete(path,file){
 if(process.platform!=='win32')throw fail('CLEANUP_NATIVE_WINDOWS_REQUIRED');
 const stamp=file?.stamp.split(':').map(Number);
 await request({action:'delete',path,directory:!file,inode:stamp?.[1]??0,bytes:file?.size??0,modified:stamp?.[3]??0,changed:stamp?.[4]??0});
}
export async function cleanupHandleRead(path,file,{body=false}={}){
 if(process.platform!=='win32')throw fail('CLEANUP_NATIVE_WINDOWS_REQUIRED');
 const stamp=file.stamp.split(':').map(Number);
 const response=await request({action:'read',path,body,inode:stamp[1],bytes:file.size,modified:stamp[3],changed:stamp[4]});
 return body?Buffer.from(response.body,'base64'):response.digest;
}
export async function cleanupHandleList(path){
 if(process.platform!=='win32')throw fail('CLEANUP_NATIVE_WINDOWS_REQUIRED');
 const response=await request({action:'list',path});
 if(!Array.isArray(response.entries)||response.entries.some(n=>typeof n!=='string'||!n||n==='.'||n==='..'||/[\\/\0]/.test(n)))throw fail('CLEANUP_NATIVE_PROTOCOL_FAILED');
 return response.entries;
}
export async function closeCleanupNative(){if(leases)return;clearTimeout(idle);if(child){const process=child;child=null;reader?.close();process.stdin.end();}}
