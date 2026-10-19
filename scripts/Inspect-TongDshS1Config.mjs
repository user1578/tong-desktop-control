import { createHash } from 'node:crypto';
import { lstat,mkdtemp,mkdir,realpath,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,win32 } from 'node:path';
import { spawn } from 'node:child_process';
import {prepareDshS1Policy,verifyDshS1ComposedConfig} from './TongDshS1Policy.mjs';

const MAX=2*1024*1024;
const VALID_PATH=/^[A-Za-z]:\\[A-Za-z0-9 _.,\\-]+$/;
function checkWindowsPath(path){
  if(typeof path!=='string'||path.length>600||!VALID_PATH.test(path)||
     path.includes('..')||/[\r\n"%'&|<>^()]/.test(path))
    throw Error('DSH S1 verified local path required');
}
async function controlledReadOnlyDump(cli,args,{cwd,env}){
  // DSH's Windows bundle uses dsh.cmd. Only fixed --dump-* subcommands;
  // never accept a task, SDK start command or model input from the caller.
  if(!['--dump-default-config','--dump-config'].includes(args.at(-1)))
    throw Error('DSH S1 only supports configuration dumps');
  for(const arg of [cli,cwd,...args.filter(x=>x.endsWith('.yml'))])checkWindowsPath(arg);
  // pwsh avoids cmd.exe /s /c quoting ambiguity for the installed .cmd.
  const words=[cli,...args].map(item=>"'"+item+"'").join(' ');
  return await new Promise((resolveDone,reject)=>{
    const p=spawn('pwsh',
      ['-NoProfile','-NonInteractive','-Command','& '+words],
      {cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,tooBig=false;
    const timer=setTimeout(()=>{p.kill();reject(Error('DSH S1 dump timed out'));},15000);
    p.stdout.on('data',bytes=>{
      size+=bytes.length;
      if(size>MAX){tooBig=true;p.kill();}
      else stdout+=bytes.toString('utf8');
    });
    // Do not return or log arbitrary stderr (can include private paths).
    p.stderr.resume();
    p.once('error',()=>{clearTimeout(timer);reject(Error('DSH S1 CLI did not start'));});
    p.once('close',code=>{
      clearTimeout(timer);
      if(code!==0||tooBig)reject(Error('DSH S1 no-model config dump rejected'));
      else resolveDone(stdout);
    });
  });
}

export async function inspectInstalledDshS1({
  userLocalAppData=process.env.LOCALAPPDATA,
  temporaryRoot=tmpdir(),
}={}){
  if(process.platform!=='win32')throw Error('DSH S1 local installed inspection requires Windows');
  checkWindowsPath(userLocalAppData);checkWindowsPath(temporaryRoot);
  const cli=win32.join(userLocalAppData,'Programs','DeepSeek Harness',
    'resources','runtime','cli','bin','dsh.cmd');
  const actual=await realpath(cli);
  const metadata=await lstat(cli);
  if(!metadata.isFile()||metadata.isSymbolicLink()||
     win32.normalize(cli).toLowerCase()!==win32.normalize(actual).toLowerCase())
    throw Error('DSH S1 bundled executable path changed');
  const home=await mkdtemp(join(temporaryRoot,'tong-dsh-s1-config-'));
  try{
    const isolated=join(home,'dsh-home');
    const working=join(home,'empty-workdir');
    await mkdir(isolated);await mkdir(working);
    const whitelist=['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','USERPROFILE',
      'APPDATA','LOCALAPPDATA','TEMP','TMP'];
    const env={DSH_HOME:isolated,DSH_PERMISSION_MODE:'read-only'};
    for(const key of whitelist){if(typeof process.env[key]==='string')env[key]=process.env[key];}
    const defaultText=await controlledReadOnlyDump(cli,
      ['--profile','sdk','--dump-default-config'],{cwd:working,env});
    const policy=prepareDshS1Policy(defaultText);
    const patchPath=join(home,'s1-restricted.yml');
    await writeFile(patchPath,policy.overlay,{flag:'wx',mode:0o600});
    const composed=await controlledReadOnlyDump(cli,
      ['--profile','sdk','--patch',patchPath,'--dump-config'],{cwd:working,env});
    const verified=verifyDshS1ComposedConfig(composed,policy);
    return Object.freeze({
      status:'configuration-only-passed',
      runtimeVersion:policy.version,
      entries:verified.entries,
      defaultSdkSha256:createHash('sha256').update(defaultText).digest('hex'),
      disabledEntries:verified.disabledTools,
      sandbox:'read-only',approval:'ask',
      overlaySha256:policy.overlaySha256,
      composedSha256:verified.sha256,
      modelCalled:false,
      sdkRuntimeStarted:false,
      windowsJobIsolationVerified:false,
      productionDeployment:false,
    });
  } finally {
    // Dedicated root is generated under temp; do not remove caller-owned paths.
    await rm(home,{recursive:true,force:true});
  }
}

if(process.argv[1] && process.argv[1].endsWith('Inspect-TongDshS1Config.mjs')){
  inspectInstalledDshS1().then(result=>console.log(JSON.stringify(result,null,2)),
    error=>{console.error('DSH S1 config audit stopped: '+error.message+'; no model called');process.exitCode=1});
}
