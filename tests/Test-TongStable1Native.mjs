// Real native App Server, exact version-1 adapter, text-only new/resume probe.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a';
const commit='37dc649c46ad0e267c3471f750b97227cf106310';
const profile=JSON.parse(await readFile(join(root,'profile.json')));assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,root);
assert.equal((await verifyRuntimeCandidate(profile)).commit,commit);
const executable='C:\\Users\\Rune\\AppData\\Local\\OpenAI\\Codex\\bin\\a96ca4c1eee0cf35\\codex.exe';
const {CodexAppServerAdapter}=await import(pathToFileURL(join(profile.codeRoot,'scripts/TongCodexAppServer.mjs')));
const adapter=new CodexAppServerAdapter({executable,env:{...process.env}}),controller=new AbortController();
const resumeOnly=process.argv[2]==='resume';assert.ok(process.argv.length===2||process.argv.length===3&&resumeOnly);
const timer=setTimeout(()=>controller.abort(),120000),turns=[],events=[];let sessionId=null,error;
try{
 if(resumeOnly){
  const files=(await readdir(join(root,'stable1-20261025'))).filter(n=>/^native-\d+\.json$/.test(n)).sort();
  const previous=JSON.parse(await readFile(join(root,'stable1-20261025',files.at(-1))));
  assert.equal(previous.root,root);assert.equal(previous.commit,commit);assert.ok(previous.sessionId);sessionId=previous.sessionId;
  await adapter.selectSession({cwd:profile.demoRoot,sessionMode:'existing',codexSessionId:sessionId});
 }
 for(const [index,token] of ['TONG_STABLE1_NATIVE_NEW_OK','TONG_STABLE1_NATIVE_RESUME_OK'].entries()){
  if(resumeOnly&&index===0)continue;
  const began=new Date().toISOString();
  const result=await adapter.runTask({cwd:profile.demoRoot,prompt:'Reply with exactly '+token+'. Text only. Do not invoke tools, read files, change files, or start other agents.',...(index?{threadId:sessionId}:{})},{signal:controller.signal,onSessionId:id=>{if(sessionId)assert.equal(id,sessionId);sessionId=id;},onLog:(_text,kind)=>events.push({at:new Date().toISOString(),kind})});
  turns.push({began,finishedAt:new Date().toISOString(),threadId:result.threadId,turnId:result.turnId,turnStatus:result.turnStatus,summary:result.summary});
  assert.equal(result.turnStatus,'completed');assert.equal(result.summary.trim(),token);assert.equal(result.error,null);
 }
 const sessions=await adapter.listSessions({cwd:profile.demoRoot,limit:100});assert.ok(sessions.sessions.some(s=>s.id===sessionId));
}catch(caught){error={name:caught.name,message:caught.message};process.exitCode=1;}
finally{clearTimeout(timer);}
const result={at:new Date().toISOString(),passed:!error,resumeOnly,root,commit,executable,executableSha256:createHash('sha256').update(await readFile(executable)).digest('hex'),turns,sessionId,events,error,throughGatewayBroker:false,productionMutation:false};
await writeFile(join(root,'stable1-20261025','native-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
