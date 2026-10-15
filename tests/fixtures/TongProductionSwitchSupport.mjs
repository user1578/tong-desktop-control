import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, copyFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { safeEnvironment } from '../../scripts/TongRuntimeSecurity.mjs';

export const STATE_ROOT = 'D:\\agentdock-poc-20261010\\isolated\\state';
export const GIT = 'C:\\Users\\Rune\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe';
export const PYTHON = join(STATE_ROOT, 'p244-python-runtime', 'Scripts', 'python.exe');
export const OLD_COMMIT = '58786f601ceb8c7f3842225697adfb5e4034a73f';
export const CANDIDATE_COMMIT = '9589698864e70a61299e839c34ab5ab1b8677bf9';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const fileHash = async path => sha(await readFile(path));
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const save = async (path, value) => { await mkdir(dirname(path), { recursive:true }); await writeFile(path, JSON.stringify(value, null, 2)+'\n'); };
export const delay = ms => new Promise(ok => setTimeout(ok, ms));
export function isolatedPath(path) {
  assert.ok(isAbsolute(path), 'test path must be absolute');
  const part = relative(resolve(STATE_ROOT), resolve(path));
  assert.ok(part && !isAbsolute(part) && part !== '..' && !part.startsWith('..'+sep), 'test path must remain under protected PoC state');
  return resolve(path);
}
export async function localCommand(executable, args, cwd, timeoutMs=30000) {
  isolatedPath(cwd);
  return new Promise((ok, fail) => {
    const child = spawn(executable,args,{cwd,windowsHide:true,env:safeEnvironment(cwd),stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',bytes=0;
    const timer=setTimeout(()=>child.kill(),timeoutMs);
    for (const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']]) stream.on('data',chunk=>{ bytes+=chunk.length; if(bytes>1048576) child.kill(); else if(key==='stdout') stdout+=chunk; else stderr+=chunk; });
    child.once('error',()=>{ clearTimeout(timer); fail(new Error('SYNTHETIC_TOOL_UNAVAILABLE')); });
    child.once('close',(exitCode,signal)=>{ clearTimeout(timer); if(exitCode!==0||bytes>1048576) fail(new Error(`SYNTHETIC_TOOL_FAILED:${exitCode}:${signal??''}`)); else ok({exitCode,stdout,stderr}); });
  });
}
// Only release-manifest source files and locked node_modules are copied. Legacy
// runtime/demo/home/OAuth paths remain in place during both switch directions.
export async function deployVerifiedRelease(releaseRoot, stagedRoot, codeRoot, verifyRelease, {previousReleaseRoot}={}) {
  [releaseRoot,stagedRoot,codeRoot].forEach(isolatedPath);
  const manifest=await verifyRelease({releaseRoot});
  await mkdir(codeRoot,{recursive:true});
  if(previousReleaseRoot) {
    const previous=await verifyRelease({releaseRoot:previousReleaseRoot}),currentNames=new Set(manifest.sourceFiles.map(f=>f.path));
    const obsolete=previous.sourceFiles.filter(file=>!currentNames.has(file.path));
    const {rename}=await import('node:fs/promises');
    const retired=join(dirname(codeRoot),'releases','retired-source-'+randomUUID());
    for(const file of obsolete) {
      assert.ok(!/^(runtime|demo-workspace|home|oauth|node_modules)\//.test(file.path),'retirement must preserve legacy state');
      const from=join(codeRoot,...file.path.split('/')),to=join(retired,...file.path.split('/'));
      assert.equal(await fileHash(from),file.sha256,'candidate source changed before rollback');
      await mkdir(dirname(to),{recursive:true});await rename(from,to);
    }
  }
  for (const file of manifest.sourceFiles) {
    const name=file.path;
    assert.ok(!name.split('/').some(p=>['runtime','home','oauth','node_modules'].includes(p)), 'release must not overwrite legacy state');
    const from=join(stagedRoot,...name.split('/')),to=join(codeRoot,...name.split('/'));
    assert.equal(await fileHash(from),file.sha256,'staged source hash mismatch');
    if(name.startsWith('demo-workspace/')) {
      try {assert.equal(await fileHash(to),file.sha256,'tracked demo asset cannot overwrite legacy content');continue;}
      catch(error) {if(error.code!=='ENOENT')throw error;}
    }
    await mkdir(dirname(to),{recursive:true}); await copyFile(from,to);
    assert.equal(await fileHash(to),file.sha256);
  }
  // Destination starts with the exact earlier locked dependency installation.
  // Keep every old dependency byte as a named release backup instead of deleting it.
  const { rename }=await import('node:fs/promises');
  try { await lstat(join(codeRoot,'node_modules')); await rename(join(codeRoot,'node_modules'),join(codeRoot,'node_modules-retired-'+randomUUID())); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  const { cp }=await import('node:fs/promises');
  await cp(join(stagedRoot,'node_modules'),join(codeRoot,'node_modules'),{recursive:true,errorOnExist:true,force:false});
  return {commit:manifest.commit,sourceFilesVerified:manifest.sourceFiles.length,nativeFiles:manifest.native.length};
}
export async function connectMcp(origin,accessToken,expectedTools) {
  const client=new Client({name:'b23-production-switch',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${accessToken}`}},reconnectionOptions:{maxRetries:0}});
  try {
    await client.connect(transport);
    const tools=(await client.listTools()).tools.map(tool=>tool.name);
    assert.equal(tools.length,expectedTools);
    assert.ok(tools.includes('tong_agent_start')&&tools.includes('tong_agent_status')&&tools.includes('tong_agent_list'));
    assert.ok(!tools.includes('exec_command')&&!tools.includes('file_edit'));
    assert.equal(tools.includes('tong_agentdock_file_edit'),[21,25].includes(expectedTools));
    return {client,transport,tools};
  } catch(error) { await client.close().catch(()=>{}); throw error; }
}
export async function issueOAuth(origin,ownerToken) {
  const metadataResponse=await fetch(origin+'/.well-known/oauth-authorization-server'); assert.equal(metadataResponse.status,200);
  const metadata=await metadataResponse.json(); assert.equal(metadata.issuer,origin+'/');
  const resource=origin+'/mcp',redirect=origin+'/b23-callback';
  const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'b23-boundary',version:'1'}}};
  for(const bearer of [null,'WRONG_SYNTHETIC_ACCESS_TOKEN']) {
    const response=await fetch(resource,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(initialize)});
    assert.equal(response.status,401); await response.body?.cancel();
  }
  const registered=await fetch(metadata.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'B2.3 synthetic preserved OAuth',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registered.status,201); const info=await registered.json();
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const fields={response_type:'code',client_id:info.client_id,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'devspace',state:randomUUID(),resource};
  const denied=await fetch(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:'WRONG_SYNTHETIC_OWNER'})}); assert.equal(denied.status,401); await denied.body?.cancel();
  const approved=await fetch(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:ownerToken})}); assert.equal(approved.status,302);
  const location=new URL(approved.headers.get('location')); assert.equal(location.searchParams.get('state'),fields.state); await approved.body?.cancel();
  const issued=await fetch(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:info.client_id,code:location.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource})}); assert.equal(issued.status,200);
  const tokens=await issued.json();
  // Secrets exist only in this closure. Evidence receives their hashes.
  const secrets=[ownerToken,tokens.access_token,tokens.refresh_token];
  return {
    async connect(count) { return connectMcp(origin,tokens.access_token,count); },
    async refresh() {
      const response=await fetch(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:info.client_id,refresh_token:tokens.refresh_token,resource})}); assert.equal(response.status,200);
      const value=await response.json(); secrets.push(value.access_token,value.refresh_token); Object.assign(tokens,value);
      return {accessHash:sha(value.access_token),refreshHash:sha(value.refresh_token),clientHash:sha(info.client_id)};
    },
    evidence() { return {clientHash:sha(info.client_id),accessHash:sha(tokens.access_token),refreshHash:sha(tokens.refresh_token),origin}; },
    assertRedacted(value) { const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)); for(const secret of secrets) assert.ok(!bytes.includes(Buffer.from(secret)),'synthetic OAuth secret persisted in evidence/logs'); },
  };
}
export async function toolCall(client,name,args,records,oauth) {
  const input=['tong_agentdock_file_edit','tong_agentdock_command'].includes(name)?{idempotencyKey:randomUUID(),...args}:args;
  const startedAt=new Date().toISOString(),result=await client.callTool({name,arguments:input},undefined,{timeout:30000});
  oauth.assertRedacted(result);
  records.push({name,startedAt,finishedAt:new Date().toISOString(),isError:result.isError===true,code:result.structuredContent?.code,status:result.structuredContent?.status,exitCode:result.structuredContent?.exitCode,idempotencyHash:input.idempotencyKey?sha(input.idempotencyKey):undefined});
  return result;
}
export async function scopedCommand(client,args,records,oauth) {
  let result=await toolCall(client,'tong_agentdock_command',args,records,oauth); assert.ok(!result.isError);
  let value=result.structuredContent,stdout=value.stdout??'',stderr=value.stderr??'';
  const sessionId=value.sessionId;
  for(let i=0;value.status==='running'&&i<200;i++) { await delay(100); result=await toolCall(client,'tong_agentdock_session_status',{projectId:args.projectId,taskId:args.taskId,approvalId:args.approvalId,sessionId},records,oauth); assert.ok(!result.isError); value=result.structuredContent; stdout=value.outputMode==='snapshot'?value.stdout??'':stdout+(value.stdout??''); stderr=value.outputMode==='snapshot'?value.stderr??'':stderr+(value.stderr??''); }
  assert.notEqual(value.status,'running'); return {...value,stdout,stderr};
}
export function sqliteEvidence(codeRoot,path) {
  isolatedPath(path); const require=createRequire(join(codeRoot,'package.json')),Database=require('better-sqlite3');
  const db=new Database(path,{readonly:true,fileMustExist:true});
  try {
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
    const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const data=[]; for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) data.push([name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(r=>JSON.stringify(r)).sort()]);
    return {integrity:'ok',schemaHash:sha(JSON.stringify(schema)),logicalHash:sha(JSON.stringify(data)),tables:data.map(([name,rows])=>({name,rows:rows.length}))};
  } finally { db.close(); }
}
export function holdOAuthWal(codeRoot,path) {
  isolatedPath(path); const require=createRequire(join(codeRoot,'package.json')),Database=require('better-sqlite3'),db=new Database(path,{readonly:true,fileMustExist:true});
  db.exec('BEGIN'); db.prepare('SELECT count(*) AS n FROM oauth_clients').get();
  return {close(){db.exec('ROLLBACK');db.close();}};
}
export async function inspectRedactedLogs(profile,oauth,agentToken) {
  for(const name of await readdir(join(profile.root,'logs'))) {
    const path=join(profile.root,'logs',name); if(!(await lstat(path)).isFile()) continue;
    const bytes=await readFile(path); oauth.assertRedacted(bytes); if(agentToken) assert.ok(!bytes.includes(Buffer.from(agentToken)),'synthetic backend token persisted in logs');
  }
}
