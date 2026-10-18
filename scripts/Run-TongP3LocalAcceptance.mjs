import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  checkClaudeLocalAuth, classifyLocalAcceptanceFailure,
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
  let stdout=Buffer.alloc(0),stderrBytes=0,stderrPreview='',timedOut=false,overflow=false;
  const startedAt=Date.now();
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
    child.stderr.on('data',part=>{
      stderrBytes+=part.length;
      if(stderrPreview.length<16384){
        stderrPreview+=part.toString('utf8').slice(0,16384-stderrPreview.length);
      }
    });
    child.once('error',err=>{clearTimeout(timer);reject(new Error('CLI could not start'));});
    child.once('close',exitCode=>{
      clearTimeout(timer);
      resolve({exitCode,stdout:stdout.toString('utf8'),timedOut,overflow,
        stderrBytes,stderrPreview,elapsedMs:Date.now()-startedAt});
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
  console.log('The CLI uses the local user profile; no repository files are requested.');
  console.log('Timeout cancellation is best-effort and is not Windows Job isolation.');
  console.log('Native session mode: '+plan.sessionMode+'; target: '+plan.sessionId);
  const base=await mkdtemp(join(tmpdir(),'tong-p3-local-acceptance-'));
  let keepResult=false;
  try {
    const work=join(base,'empty-workdir'),profile=join(base,'separate-dsh-home');
    await mkdir(work);await mkdir(profile);
    const env=childEnv(provider,profile);
    const firstHash=createHash('sha256').update(await readFile(binary)).digest('hex');
    const versionReply=await runBounded(binary,['--version'],
      {cwd:work,env,timeoutMs:15000});
    if(versionReply.exitCode!==0||versionReply.timedOut||versionReply.overflow)
      throw new Error('CLI version check failed: '+classifyLocalAcceptanceFailure(versionReply));
    verifyLocalAcceptanceVersion(plan,versionReply.stdout);

    // In the EXACT environment we will use for the model call, check whether
    // the CLI has a working login. Do not copy API keys or OAuth credentials.
    const authReply=await runBounded(binary,['auth','status'],{
      cwd:work,env,timeoutMs:15000,
    });
    const auth=checkClaudeLocalAuth(authReply);
    console.log('Claude authentication preflight: '+auth);
    if(auth==='not-authenticated') {
      throw new Error('Claude CLI is not logged in in this execution environment. '+
        'Use your OWN PowerShell 7 window to check `claude auth status` and sign in if needed. '+
        'No model request was sent.');
    }
    if(auth!=='authenticated') {
      throw new Error('Claude authentication status could not be confirmed. '+
        'Check `claude auth status` in your own PowerShell 7 window. No model request was sent.');
    }
    const secondHash=createHash('sha256').update(await readFile(binary)).digest('hex');
    if(firstHash!==secondHash)throw new Error('Provider executable changed before execution');

    const reader=createInterface({input:process.stdin,output:process.stdout});
    let decision;
    try { decision=await reader.question('Approve ONE text-only Claude test? Type Y: '); }
    finally { reader.close(); }
    if(decision.trim()!=='Y')throw new Error('User declined local acceptance');
    const receipt=await runBounded(binary,plan.args,{
      cwd:work,env,stdin:plan.prompt+'\n',timeoutMs:plan.timeoutMs,
    });
    if(receipt.overflow || receipt.timedOut || receipt.exitCode!==0) {
      const category=classifyLocalAcceptanceFailure(receipt);
      throw new Error('Claude test failed: category='+category+
        '; exitCode='+String(receipt.exitCode)+
        '; elapsedMs='+String(receipt.elapsedMs)+'. No raw provider output was displayed.');
    }
    let result;
    try { result=summarizeAcceptanceResult(plan,receipt); }
    catch {
      const category=classifyLocalAcceptanceFailure(receipt);
      throw new Error('Claude response verification failed: category='+category+
        '; elapsedMs='+String(receipt.elapsedMs)+'. No raw provider output was displayed.');
    }
    const report={
      ...result,expectedVersion:plan.expectedVersion,
      time:new Date().toISOString(),
      environment:'local-interactive-unisolated',
      binarySha256:firstHash,
      elapsedMs:receipt.elapsedMs,
    };
    const resultFile=join(base,'acceptance-result.json');
    await writeFile(resultFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    keepResult=true;
    console.log(safePrint({report,resultFile}));
    return 0;
  } finally {
    if(!keepResult) await rm(base,{recursive:true,force:true});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().then(code=>{process.exitCode=code}).catch(error=>{
    console.error('Local acceptance stopped: '+error.message);
    process.exitCode=1;
  });
}
