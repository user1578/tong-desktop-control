// Real OAuth + MCP + file operations against one already running simulation.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const [root,runId,evidenceDir]=process.argv.slice(2);
const phase=process.argv[5]??'';assert.ok(['','recovered'].includes(phase));
assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
assert.equal(resolve(evidenceDir,'..'),root);
assert.match(basename(evidenceDir),/^task-originals-[a-f0-9]{32}$/);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const profile=await json(join(root,'profile.json')),record=await json(join(root,'run/runtime.json'));
assert.equal(profile.mode,'production-simulation');assert.equal(record.runId,runId);assert.equal(record.phase,'ready');
assert.deepEqual([profile.gatewayPort,profile.upstreamPort,profile.agentdockPort],[29676,29677,29675]);
const origin=profile.publicOrigin,resource=origin+'/mcp';
const {readSecret}=await import(pathToFileURL(join(profile.managerRoot,'scripts/TongRuntimeSecurity.mjs')));
const fetchChecked=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(7000)});
const evidence={syntheticOnly:true,runId,startedAt:new Date().toISOString(),productionChanged:false};
let client;
try{
 // A read-only AgentDock grant for the implicit synthetic demo project lets
 // this acceptance traverse the backend as well as DevSpace's direct tools.
 const policyPath=join(root,'tong-policy/agentdock-access.json'),policy=await json(policyPath);
 const readGrant={projectId:'demo',root:profile.demoRoot,scope:'synthetic',tools:['list_dir','read_file','search_text']};
 assert.equal(policy.schemaVersion,1);assert.equal(policy.backendWorkspaceRoot,join(root,'workspace'));assert.deepEqual(policy.approvals,[]);
 if(policy.projects.length===0){policy.projects=[readGrant];await writeFile(policyPath,JSON.stringify(policy));}
 else assert.deepEqual(policy.projects,[readGrant]);
 const fixture=await json(join(root,'seven-file-preparation.json'));
 const preservationPath=fixture.startupRecovery?join(fixture.startupRecovery.trial,'communication-preservation.json'):join(root,'communication-preservation.json');
 const protectedFiles=[join(profile.configDir,'config.json'),join(profile.configDir,'auth.json'),join(root,'profile.json'),join(root,'run/release-pin.json'),join(root,'run/manager-pin.json'),join(root,'secrets/agentdock.dpapi'),join(root,'secrets/oauth-owner.dpapi')];
 const currentHashes=Object.fromEntries(await Promise.all(protectedFiles.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
 let priorHashes;
 try{priorHashes=await json(preservationPath);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(preservationPath,JSON.stringify(currentHashes),{flag:'wx'});}
 if(priorHashes){assert.deepEqual(currentHashes,priorHashes);evidence.configPinsAndSecretsPreserved=true;}
 const unauth=await fetchChecked(resource,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});
 assert.equal(unauth.status,401);await unauth.body?.cancel();evidence.unauthenticatedRejected=true;
 const metadata=await (await fetchChecked(origin+'/.well-known/oauth-authorization-server')).json();
 const callback=origin+'/synthetic-callback';
 const clientRecord=join(root,'communication-oauth-client.json');let info;
 try{info=await json(clientRecord);assert.equal(info.redirect_uri,callback);evidence.existingOAuthClientLoaded=true;}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  const registration=await fetchChecked(metadata.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Synthetic recovery acceptance',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registration.status,201);const registered=await registration.json();info={client_id:registered.client_id,redirect_uri:callback};
  await writeFile(clientRecord,JSON.stringify(info),{flag:'wx'});
 }
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(16).toString('hex');
 const fields={response_type:'code',client_id:info.client_id,redirect_uri:callback,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope:'devspace',state,resource};
 const wrong=await fetchChecked(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:'INVALID_SYNTHETIC_OWNER'})});
 assert.equal(wrong.status,401);await wrong.body?.cancel();evidence.invalidOwnerRejected=true;
 const authorized=await fetchChecked(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:await readSecret(root,'oauth-owner')})});
 assert.equal(authorized.status,302);await authorized.body?.cancel();const location=new URL(authorized.headers.get('location'));assert.equal(location.searchParams.get('state'),state);
 const issued=await fetchChecked(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:info.client_id,code:location.searchParams.get('code'),code_verifier:verifier,redirect_uri:callback,resource})});
 assert.equal(issued.status,200);const tokens=await issued.json();
 if(evidence.existingOAuthClientLoaded)evidence.existingOAuthClientStillAuthorized=true;
 async function connect(){
  client=new Client({name:'tong-communication-fixture',version:'1'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}},reconnectionOptions:{maxRetries:0}}));
 }
 await connect();
 const names=(await client.listTools()).tools.map(t=>t.name);
 for(const name of ['open_workspace','read','write','edit','tong_list_directory','tong_list_projects','tong_windows_inspect','tong_agentdock_read_file'])assert.ok(names.includes(name),name);
 assert.ok(!names.includes('bash'));evidence.toolCount=names.length;
 const call=(name,args)=>client.callTool({name,arguments:args},undefined,{timeout:7000});
 const ok=result=>{assert.ok(!result.isError,JSON.stringify(result));return result;};
 const projectResult=ok(await call('tong_list_projects',{}));
 const projects=projectResult.structuredContent??JSON.parse(projectResult.content.find(c=>c.type==='text').text);
 assert.ok(projects.projects.some(p=>p.id==='demo'&&p.root===profile.demoRoot&&p.available));evidence.projectMetadata=true;
 ok(await call('tong_windows_inspect',{kind:'processes',name:'node.exe',limit:1}));evidence.windowsMetadata=true;
 const opened=ok(await call('open_workspace',{path:profile.demoRoot,mode:'checkout'}));
 const workspaceId=opened.structuredContent?.workspaceId??JSON.parse(opened.content.find(c=>c.type==='text').text).workspaceId;
 assert.equal(typeof workspaceId,'string');
 const tag=basename(evidenceDir)+(phase?'-'+phase:''),filename=tag+'.txt',original='synthetic before '+runId,edited='synthetic after '+runId;
 await writeFile(join(profile.demoRoot,filename),original,{flag:'wx'});
 assert.ok(JSON.stringify(ok(await call('read',{workspaceId,path:filename}))).includes(original));evidence.realFileRead=true;
 assert.ok(JSON.stringify(ok(await call('tong_agentdock_read_file',{projectId:'demo',path:filename}))).includes(original));evidence.agentDockRead=true;
 ok(await call('write',{workspaceId,path:tag+'-created.txt',content:original}));
 ok(await call('edit',{workspaceId,path:tag+'-created.txt',edits:[{oldText:original,newText:edited}]}));
 assert.equal(await readFile(join(profile.demoRoot,tag+'-created.txt'),'utf8'),edited);
 assert.ok(JSON.stringify(ok(await call('read',{workspaceId,path:tag+'-created.txt'}))).includes(edited));evidence.createEditRead=true;
 const listed=ok(await call('tong_list_directory',{workspaceId,path:'.',limit:100}));assert.ok(JSON.stringify(listed).includes(filename));evidence.directoryListed=true;
 const outside=join(evidenceDir,'outside');await mkdir(outside);await writeFile(join(outside,'canary.txt'),'OUTSIDE_SYNTHETIC_CANARY');
 const junction=tag+'-junction';await symlink(outside,join(profile.demoRoot,junction),'junction');
 for(const path of ['../outside.txt',join(outside,'canary.txt'),junction+'/canary.txt']){
  let response;
  try{response=await call('read',{workspaceId,path});}
  catch(error){
   // Gateway schema/path validation is a protocol error; the upstream path
   // guard returns an error tool result. Both must deny the requested path.
   assert.equal(error.code,-32602,path);assert.match(error.message,/relative to the authorized workspace/);
   response={isError:true,message:error.message};
  }
  assert.equal(response.isError,true,path);assert.ok(!JSON.stringify(response).includes('OUTSIDE_SYNTHETIC_CANARY'));
 }
 evidence.traversalAndJunctionDenied=true;
 await client.close();client=null;await connect();
 const reopened=ok(await call('open_workspace',{path:profile.demoRoot,mode:'checkout'}));
 const reId=reopened.structuredContent?.workspaceId??JSON.parse(reopened.content.find(c=>c.type==='text').text).workspaceId;
 assert.ok(JSON.stringify(ok(await call('read',{workspaceId:reId,path:filename}))).includes(original));evidence.reconnectedRead=true;
 assert.ok(JSON.stringify(ok(await call('tong_agentdock_read_file',{projectId:'demo',path:filename}))).includes(original));evidence.reconnectedAgentDockRead=true;
 const refreshed=await fetchChecked(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:info.client_id,refresh_token:tokens.refresh_token,resource})});
 assert.equal(refreshed.status,200);await refreshed.body?.cancel();evidence.refreshSucceeded=true;
 evidence.passed=true;
}catch(error){evidence.passed=false;evidence.failure=String(error.stack??error);process.exitCode=1;}
finally{
 await client?.close();evidence.finishedAt=new Date().toISOString();
 await writeFile(join(evidenceDir,'communication'+(phase?'-'+phase:'')+'.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify(evidence));
}
