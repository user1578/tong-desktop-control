import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Windows listener inventory plus SO_EXCLUSIVEADDRUSE; never infer absence
// from a TCP timeout, or send a connection to an occupying service.
export async function assertPortUnused(port){
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT_CHECK_FAILED');
 const child=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('TongRuntimePort.ps1',import.meta.url)),'-Port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',b=>{out+=b;if(out.length>4096)child.kill();});child.stderr.resume();
 const timer=setTimeout(()=>child.kill(),10000);let code;try{code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});}catch{throw Error('PORT_CHECK_FAILED');}finally{clearTimeout(timer);}
 let result;try{result=JSON.parse(out);}catch{throw Error('PORT_CHECK_FAILED');}
 if(code!==0||result.port!==port||result.free!==true)throw Error(result.error==='PORT_OCCUPIED'?'PORT_OCCUPIED':'PORT_CHECK_FAILED');
 return result;
}
