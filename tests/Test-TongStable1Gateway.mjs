// Version 1's exact Gateway contract differs from its upstream tool registry.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {readSecret} from '../scripts/TongRuntimeSecurity.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const root='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a',commit='37dc649c46ad0e267c3471f750b97227cf106310';
assert.ok(process.argv.length===2||process.argv.length===4&&process.argv[2]===root&&process.argv[3]===commit,'fixed isolation binding required');
const profile=JSON.parse(await readFile(join(root,'profile.json')));assert.equal(profile.mode,'production-simulation');assert.equal(profile.root,root);
for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,commit);
const run=JSON.parse(await readFile(join(root,'run/runtime.json')));assert.equal(run.phase,'ready');
const owner=await readSecret(root,'oauth-owner'),origin=profile.publicOrigin,resource=origin+'/mcp',redirect=origin+'/stable1-callback';
const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)});
const unauthorized=await request(resource,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'unauthorized',version:'1'}}})});assert.equal(unauthorized.status,401);await unauthorized.body?.cancel();
const discovery=await request(origin+'/.well-known/oauth-authorization-server');assert.equal(discovery.status,200);const metadata=await discovery.json();
assert.equal(metadata.issuer,origin+'/');for(const name of ['registration_endpoint','authorization_endpoint','token_endpoint'])assert.equal(new URL(metadata[name]).origin,origin);
const registered=await request(metadata.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'stable1 isolation',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']})});assert.equal(registered.status,201);const info=await registered.json();
const verifier=randomUUID()+randomUUID(),challenge=createHash('sha256').update(verifier).digest('base64url');
const fields={response_type:'code',client_id:info.client_id,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'devspace',state:randomUUID(),resource};
const approved=await request(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:owner})});assert.equal(approved.status,302);const location=new URL(approved.headers.get('location'));assert.equal(location.origin,origin);assert.equal(location.searchParams.get('state'),fields.state);await approved.body?.cancel();
const issued=await request(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:info.client_id,code:location.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource})});assert.equal(issued.status,200);const tokens=await issued.json();
const client=new Client({name:'stable1-isolation',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}},reconnectionOptions:{maxRetries:0}});
const expected=['edit','open_workspace','read','tong_agent_cancel','tong_agent_list','tong_agent_logs','tong_agent_result','tong_agent_resume','tong_agent_sessions','tong_agent_start','tong_agent_status','tong_agentdock_command','tong_agentdock_file_edit','tong_agentdock_list_dir','tong_agentdock_read_file','tong_agentdock_search_text','tong_agentdock_session_cancel','tong_agentdock_session_status','tong_delete_file','tong_dev_environment','tong_list_directory','tong_list_drives','tong_list_projects','tong_move_file','tong_run_command','tong_scan_directory','tong_windows_inspect','write'].sort();
function value(result){assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);}
try{
 await client.connect(transport);const tools=(await client.listTools()).tools.map(t=>t.name).sort();assert.deepEqual(tools,expected);
 const projects=value(await client.callTool({name:'tong_list_projects',arguments:{}}));
 const opened=value(await client.callTool({name:'open_workspace',arguments:{path:profile.demoRoot,mode:'checkout'}}));assert.equal(opened.root,profile.demoRoot);
 const path='stable1-'+randomUUID()+'.txt',content='Tong version 1 isolated MCP read/write acceptance\n';
 const written=await client.callTool({name:'write',arguments:{workspaceId:opened.workspaceId,path,content}});assert.ok(!written.isError,JSON.stringify(written));
 assert.equal(await readFile(join(profile.demoRoot,path),'utf8'),content);
 const read=await client.callTool({name:'read',arguments:{workspaceId:opened.workspaceId,path}});assert.ok(!read.isError);assert.ok(JSON.stringify(read).includes(content.trim()));
 const result={passed:true,at:new Date().toISOString(),root,commit,runId:run.runId,unauthenticatedRejected:true,oauthPkce:true,mcpInitialize:true,tools,toolCount:tools.length,upstreamOnlyTool:'tong_project_prepare',mcpFileWrite:true,mcpFileRead:true,retainedTestFile:join(profile.demoRoot,path),chatgptUiConnectionTested:false,codexSessionTested:false};
 await writeFile(join(root,'stable1-20261025','gateway-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}finally{await client.close();}
