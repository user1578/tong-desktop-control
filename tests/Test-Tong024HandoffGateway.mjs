import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateProductionProfile} from '../scripts/TongProductionProfile.mjs';
import {verifyRuntimeCandidate} from '../scripts/TongRuntimeCandidate.mjs';
import {readSecret} from '../scripts/TongRuntimeSecurity.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [root,commit]=process.argv.slice(2);
assert.match(root??'',/^D:\\Tong\\state\\b23-login-[a-f0-9]{32}$/);
assert.match(commit??'',/^[a-f0-9]{40}$/);
const profile=validateProductionProfile(JSON.parse(await readFile(join(root,'profile.json'),'utf8')));
assert.equal(profile.root,root);assert.equal(profile.mode,'production-simulation');
for(const manager of [false,true])assert.equal((await verifyRuntimeCandidate(profile,{manager,reviewedManagerProfile:{...profile,agentdockEnabled:false}})).commit,commit);
const record=JSON.parse(await readFile(join(root,'run/runtime.json'),'utf8'));
assert.equal(record.phase,'ready');assert.equal(record.sourceCommit,commit);
const source=await readFile(join(profile.codeRoot,'node_modules/@waishnav/devspace/dist/server.js'),'utf8');
const expected=JSON.parse(source.match(/const TONG_ALLOWED_TOOLS = new Set\((\[[^\n]+\])\);/)[1]).sort();
const owner=await readSecret(root,'oauth-owner'); // Isolated fixture only; never persisted or printed.
const origin=profile.publicOrigin,resource=origin+'/mcp',redirect=origin+'/handoff-callback';
const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)});
const discovery=await request(origin+'/.well-known/oauth-authorization-server');assert.equal(discovery.status,200);
const metadata=await discovery.json();assert.equal(metadata.issuer,origin+'/');
for(const endpoint of ['registration_endpoint','authorization_endpoint','token_endpoint'])assert.equal(new URL(metadata[endpoint]).origin,origin);
const registered=await request(metadata.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'024 handoff isolation',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']})});
assert.equal(registered.status,201);const info=await registered.json();
const verifier=randomUUID()+randomUUID(),challenge=createHash('sha256').update(verifier).digest('base64url');
const fields={response_type:'code',client_id:info.client_id,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'devspace',state:randomUUID(),resource};
const approved=await request(metadata.authorization_endpoint,{method:'POST',redirect:'manual',body:new URLSearchParams({...fields,owner_token:owner})});assert.equal(approved.status,302);
const location=new URL(approved.headers.get('location'));assert.equal(location.origin,origin);assert.equal(location.searchParams.get('state'),fields.state);await approved.body?.cancel();
const issued=await request(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:info.client_id,code:location.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource})});assert.equal(issued.status,200);
const tokens=await issued.json(),client=new Client({name:'024-native-handoff',version:'1'});
const transport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}},reconnectionOptions:{maxRetries:0}});
try{await client.connect(transport);const tools=(await client.listTools()).tools.map(tool=>tool.name).sort();assert.deepEqual(tools,expected);console.log(JSON.stringify({passed:true,root,commit,runId:record.runId,oauthPkce:true,mcpInitialize:true,toolsList:true,toolCount:tools.length}));}finally{await client.close();}
