import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// This is a local user interaction boundary, not a signature on ordinary chat.
// No MCP tool exposes a confirmer or accepts an "approved" argument.
export async function confirmLocally(descriptor) {
  if(process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in a local interactive terminal for user confirmation');
  const shell=join(process.env.ProgramFiles ?? 'C:\\Program Files','PowerShell','7','pwsh.exe');
  const helper=fileURLToPath(new URL('./TongLocalConfirmation.ps1',import.meta.url));
  const code=await new Promise((done,reject)=>{
    const child=spawn(shell,['-NoLogo','-NoProfile','-File',helper,'-DescriptorBase64',Buffer.from(JSON.stringify(descriptor)).toString('base64')],{shell:false,stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',(code)=>done(code));
  });
  if(code !== 0) throw new Error('Local confirmation declined or unavailable');
}
