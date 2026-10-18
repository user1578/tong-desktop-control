import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  findLocalAcceptanceBinary, prepareLocalProviderAcceptance,
  summarizeAcceptanceResult, verifyLocalAcceptanceVersion,
} from './TongP3LocalAcceptance.mjs';

const MAX_BUFFER = 262144;
const safePrint = value => JSON.stringify(value, null, 2);
function argumentsForUser(argv) {
  const choices = argv.filter(x => x.startsWith('--'));
  if (choices.some(x => !['--provider','--dry-run','--run','--session-id'].includes(x))) {
    throw new Error('Unknown acceptance option');
  }
  let provider = null, mode = 'dry-run', sessionId;
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--provider') {
      if(provider!==null || !['claude','dsh'].includes(argv[i+1])) throw new Error('Choose claude or dsh');
      provider = argv[++i];
    } else if (argv[i]==='--session-id') {
      if (sessionId!==undefined || !argv[i+1] || argv[i+1].startsWith('--'))
        throw new Error('An exact native session ID is required');
      sessionId=argv[++i];
    } else if (argv[i]==='--run') mode = 'run';
    else if (argv[i]!=='--dry-run') throw new Error('Unknown acceptance option');
  }
  if(!provider) throw new Error('Required: --provider claude|dsh');
  return {provider,mode,sessionId};
}
function childEnv(provider, stateHome) {
  const env = {};
  const allowed=['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','USERPROFILE',
    'APPDATA','LOCALAPPDATA','TEMP','TMP','HOME'];
  for(const key of allowed) {
    const match=Object.keys(process.env).find(x=>x.toLowerCase()===key.toLowerCase());
    if(match)env[key]=process.env[match];
  }
  // A new profile avoids modifying or consuming the Desktop-owned DSH profile.
  if(provider==='dsh')env.DSH_HOME=stateHome;
  return env;
}
async function runBounded(executable,args,{cwd,env,stdin='',timeoutMs=10000}={}) {
  const windowsCmd=executable.toLowerCase().endsWith('.cmd');
  const cmdline=windowsCmd
    ? '"' + executable + '" ' + args.join(' ')
    : null;
  const child=spawn(windowsCmd ? (process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe') : executable,
    windowsCmd ? ['/d','/s','/c',cmdline] : args,
    {cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let stdout=Buffer.alloc(0),stderrBytes=0,timedOut=false,overflow=false;
  const stop=()=>{
    try { child.kill(); } catch {}
    if(process.platform==='win32' && Number.isInteger(child.pid)){
      try { spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
        {stdio:'ignore',windowsHide:true}).unref(); } catch {}
    }
  };
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{timedOut=true;stop()},timeoutMs);
    child.stdout.on('data',part=>{
      if(stdout.length+part.length>MAX_BUFFER){overflow=true;stop();}
      else stdout=Buffer.concat([stdout,part]);
    });
    child.stderr.on('data',part=>{stderrBytes+=part.length;});
    child.once('error',err=>{clearTimeout(timer);reject(new Error('CLI could not start'));});
    child.once('close',exitCode=>{
      clearTimeout(timer);
      resolve({exitCode,stdout:stdout.toString('utf8'),timedOut,overflow,stderrBytes});
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(stdin);
  });
}

export async function main(argv=process.argv.slice(2)) {
  const {provider,mode,sessionId}=argumentsForUser(argv);
  if(process.platform!=='win32') throw new Error('Local provider acceptance requires Windows');
  const userProfile=process.env.USERPROFILE??homedir();
  const localAppData=process.env.LOCALAPPDATA??join(userProfile,'AppData','Local');
  const plan=prepareLocalProviderAcceptance({provider,userProfile,localAppData,
    ...(sessionId!==undefined ? {sessionMode:'existing',sessionId} : {})});
  const binary=await findLocalAcceptanceBinary(plan,{inspect:lstat,realpath});
  console.log(safePrint({
    provider,mode,binary,expectedVersion:plan.expectedVersion,
    sessionMode:plan.sessionMode,plannedSessionId:plan.sessionId,
    marker:plan.marker,desktopVisibility:plan.desktopVisibility,
    isolation:plan.isolation,
    note:'Only run --run in a local interactive PowerShell 7 window.',
  }));
  if(mode==='dry-run')return 0;
  if(!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive local console is required; MCP and CI cannot approve this run');
  }
  if(provider==='dsh') {
    throw new Error('DSH live execution is not yet enabled: headless default tools need a reviewed restricted profile');
  }
  console.log('This is NOT a production Tong worker or an OS sandbox.');
  console.log('The installed CLI uses the signed-in user profile. No repository files will be requested.');
  console.log('A timeout will attempt to stop the CLI process tree; Windows Job isolation is not claimed.');
  console.log('Native session mode: '+plan.sessionMode+'; target: '+plan.sessionId);
  const reader=createInterface({input:process.stdin,output:process.stdout});
  let decision;
  try { decision=await reader.question('Approve ONE text-only Claude test? Type Y: '); }
  finally { reader.close(); }
  if(decision.trim()!=='Y')throw new Error('User declined local acceptance');
  const base=await mkdtemp(join(tmpdir(),'tong-p3-local-acceptance-'));
  const work=join(base,'empty-workdir'),profile=join(base,'separate-dsh-home');
  await mkdir(work);await mkdir(profile);
  const env=childEnv(provider,profile);
  // Check the selected CLI version and executable integrity before any prompt.
  const firstHash=createHash('sha256').update(await readFile(binary)).digest('hex');
  const versionReply=await runBounded(binary,['--version'],
    {cwd:work,env,timeoutMs:15000});
  if(versionReply.exitCode!==0||versionReply.timedOut||versionReply.overflow)
    throw new Error('Cannot verify provider version');
  verifyLocalAcceptanceVersion(plan,versionReply.stdout);
  const secondHash=createHash('sha256').update(await readFile(binary)).digest('hex');
  if(firstHash!==secondHash)throw new Error('Provider executable changed before execution');
  const receipt=await runBounded(binary,plan.args,{
    cwd:work,env,stdin:plan.prompt+'\n',timeoutMs:plan.timeoutMs,
  });
  if(receipt.overflow)throw new Error('CLI exceeded output limit');
  const result=summarizeAcceptanceResult(plan,receipt);
  const report={
    ...result,expectedVersion:plan.expectedVersion,
    time:new Date().toISOString(),
    environment:'local-interactive-unisolated',
    binarySha256:firstHash,
  };
  const resultFile=join(base,'acceptance-result.json');
  await writeFile(resultFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(safePrint({report,resultFile}));
  return 0;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().then(code=>{process.exitCode=code}).catch(error=>{
    console.error('Local acceptance stopped: '+error.message);
    process.exitCode=1;
  });
}
