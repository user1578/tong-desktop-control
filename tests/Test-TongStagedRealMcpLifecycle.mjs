import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = process.argv[2];
const expectedRunPrevious = process.argv[3];
if (!isAbsolute(root ?? '') || !/^b23-login-[a-f0-9]{32}$/.test(root.split(/[\\/]/).at(-1))
  || !/^[a-f0-9-]{36}$/.test(expectedRunPrevious ?? '')) throw Error('SYNTHETIC_SCOPE_DENIED');
const prior = JSON.parse(await readFile(join(root, 'run', 'runtime.json'), 'utf8'));
if (prior.runId !== expectedRunPrevious || prior.profileMode !== 'production-simulation') throw Error('SYNTHETIC_RUN_MISMATCH');
const moduleUrl = name => pathToFileURL(join(root, 'releases', 'manager', 'scripts', name)).href;
const { withLoginRecovery } = await import(moduleUrl('TongLoginRecovery.mjs'));
const { startRuntime, stopRuntime, runtimeStatus, runtimeDoctor } = await import(moduleUrl('TongAgentDockRuntime.mjs'));
const { readSecret } = await import(moduleUrl('TongRuntimeSecurity.mjs'));
const profile = JSON.parse(await readFile(join(root, 'profile.json'), 'utf8'));
if (profile.mode !== 'production-simulation'
  || profile.gatewayPort !== 17876 || profile.upstreamPort !== 17877 || profile.agentdockPort !== 18766)
  throw Error('TEST_PORT_SCOPE_DENIED');
const origin = 'http://127.0.0.1:17876';
const evidence = { schemaVersion: 1, syntheticOnly: true, origin, previousRun: expectedRunPrevious,
  beganAt: new Date().toISOString(), started: false, healthy: false, unauthenticatedRejected: false,
  authenticatedMcp: false, ownerMcpTools: null, projectListVerified: false,
  stopVerified: false, productionModified: false };
let runId = null, client = null;
const checkedFetch = async (url, options = {}) => fetch(url, {...options, signal: AbortSignal.timeout(7000)});
try {
  const before = await runtimeStatus(root);
  assert.ok(!before.supervisorAlive && before.phase === 'abnormal_exit','Previous synthetic run must be reconciled');
  const run = await withLoginRecovery(root, 'start', () => startRuntime(root));
  runId = run.runId;
  assert.equal(run.phase, 'ready'); assert.deepEqual(run.children.map(x=>x.role), ['agentdock','devspace','gateway']);
  evidence.started = true; evidence.runId = runId;
  const doctor = await runtimeDoctor(root);
  assert.equal(doctor.healthy, true, 'Synthetic doctor must pass while runtime lives');
  evidence.healthy = true;
  evidence.agentdockAuthenticated = doctor.health?.agentdock?.authenticatedMcp === true;
  evidence.discovery = doctor.health?.tong?.discovery === true;
  evidence.unauthenticatedRejected = doctor.health?.tong?.unauthenticatedRejected === true;
  assert.ok(evidence.agentdockAuthenticated && evidence.discovery && evidence.unauthenticatedRejected);
  const metadataRes = await checkedFetch(origin+'/.well-known/oauth-authorization-server');
  assert.equal(metadataRes.status, 200);
  const metadata = await metadataRes.json();
  const callback = origin+'/stage-synthetic-callback';
  const registration = await checkedFetch(metadata.registration_endpoint,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({client_name:'Tong isolated synthetic acceptance',redirect_uris:[callback],
      token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registration.status, 201);
  const registrationInfo = await registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(14).toString('hex');
  const resource=origin+'/mcp';
  const fields = {response_type:'code',client_id:registrationInfo.client_id,redirect_uri:callback,
    code_challenge:challenge,code_challenge_method:'S256',scope:'devspace',state,resource};
  const wrong = await checkedFetch(metadata.authorization_endpoint, {method:'POST',redirect:'manual',
    body:new URLSearchParams({...fields,owner_token:'INVALID_SYNTHETIC_OWNER'})});
  assert.equal(wrong.status, 401); await wrong.body?.cancel();
  const ownerToken = await readSecret(root,'oauth-owner');
  const authorized = await checkedFetch(metadata.authorization_endpoint,{method:'POST',redirect:'manual',
    body:new URLSearchParams({...fields,owner_token:ownerToken})});
  assert.equal(authorized.status, 302); await authorized.body?.cancel();
  const location = new URL(authorized.headers.get('location'));
  assert.equal(location.searchParams.get('state'),state);
  const issued = await checkedFetch(metadata.token_endpoint,{method:'POST',
    body:new URLSearchParams({grant_type:'authorization_code',client_id:registrationInfo.client_id,
      code:location.searchParams.get('code'),code_verifier:verifier,redirect_uri:callback,resource})});
  assert.equal(issued.status,200);
  const tokens = await issued.json();
  client = new Client({name:'tong-staged-real-mcp',version:'1'},{capabilities:{}});
  const transport = new StreamableHTTPClientTransport(new URL(resource),
    {requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}},reconnectionOptions:{maxRetries:0}});
  await client.connect(transport);
  const listed = (await client.listTools()).tools.map(t=>t.name);
  assert.ok(listed.includes('tong_list_projects')&&listed.includes('tong_agent_start'));
  assert.ok(!listed.includes('bash')&&!listed.includes('exec_command'));
  evidence.authenticatedMcp = true; evidence.ownerMcpTools = listed.length;
  evidence.mcpToolNames=listed;
  const projectResponse = await client.callTool({name:'tong_list_projects',arguments:{}},undefined,{timeout:7000});
  assert.ok(!projectResponse.isError && Array.isArray(projectResponse.structuredContent?.projects));
  evidence.projectListVerified=true;
  const refresh = await checkedFetch(metadata.token_endpoint,{method:'POST',
    body:new URLSearchParams({grant_type:'refresh_token',client_id:registrationInfo.client_id,refresh_token:tokens.refresh_token,resource})});
  assert.equal(refresh.status,200);
  evidence.refreshSucceeded=true;await refresh.body?.cancel();
} catch(error) {
  evidence.failure = String(error?.code || error?.message || error).slice(0,180);
} finally {
  await client?.close().catch(()=>{});
  if(runId) {
    try {
      const stopped = await withLoginRecovery(root,'stop-run',()=>stopRuntime(root,{expectedRunId:runId}));
      const actual=await runtimeStatus(root);
      assert.equal(actual.supervisorAlive,false);
      assert.equal(actual.guardianAlive,false);
      assert.equal(actual.phase,'stopped');
      evidence.stopVerified=true;
      evidence.stopPhase=stopped.phase;
    } catch(error){evidence.stopError=String(error?.code||error?.message||error).slice(0,140);}
  }
  evidence.finishedAt=new Date().toISOString();
  const path=join('D:\\Tong\\state\\p27-autonomy-candidate-20261017','staged-live-mcp-evidence.json');
  await writeFile(path,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
if(!(evidence.started && evidence.healthy && evidence.authenticatedMcp && evidence.projectListVerified && evidence.stopVerified && evidence.refreshSucceeded))process.exitCode=1;
