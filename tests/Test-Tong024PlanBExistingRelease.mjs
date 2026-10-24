import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, cp, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { validateProductionProfile } from '../scripts/TongProductionProfile.mjs';
import { verifyRuntimeCandidate } from '../scripts/TongRuntimeCandidate.mjs';
import { processIdentity, sameProcess, startupJobsState, readSecret, safeEnvironment } from '../scripts/TongRuntimeSecurity.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Reuse a previously stopped, exact-release fixture. No dependency copy,
// installation, production task/service, real OAuth account or ngrok change.
const root = 'D:\\Tong\\state\\b23-login-8e32da332608430bb4971bc668ef4ace';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const profile = validateProductionProfile(await readJson(join(root, 'profile.json')));
assert.equal(profile.mode, 'production-simulation'); assert.equal(profile.root, root);
const commit = '34e26801876d8b1a2fc874dddce72b0939924e87';
const app = await verifyRuntimeCandidate(profile);
const managerBinding = await verifyRuntimeCandidate(profile, { manager: true, reviewedManagerProfile: { ...profile, agentdockEnabled: false } });
assert.equal(app.commit, commit); assert.equal(managerBinding.commit, commit);
assert.equal(app.sourceDigest, 'd38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9');
assert.equal(app.releaseDigest, '160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062');
const previous = await readJson(join(root, 'run/runtime.json')), guardian = await readJson(join(root, 'run/guardian.json'));
assert.equal(previous.phase, 'stopped'); assert.ok(guardian.finishedAt);
assert.ok(Object.values(await startupJobsState(previous.runId)).every(value => value === 0));
for (const expected of [guardian, previous.supervisor, ...previous.children, ...previous.descendants]) {
  const actual = await processIdentity(expected.pid);
  assert.ok(!actual || actual.exe && /^\d+$/.test(actual.startTicks), 'unknown previous process');
  assert.equal(sameProcess(actual, expected), false, 'previous fixture still running');
}
await assert.rejects(lstat(join(root, 'run/backup.freeze')), { code: 'ENOENT' });
const evidence = join(root, 'logs/planb-independent-' + randomUUID()); await mkdir(evidence);
await cp(join(root, 'run'), join(evidence, 'previous-run'), { recursive: true, errorOnExist: true, force: false });
const login = await import(pathToFileURL(join(profile.managerRoot, 'scripts/TongLoginRecovery.mjs')));
const manager = join(profile.managerRoot, 'scripts/TongAgentDockRuntime.mjs'), env = safeEnvironment(root);
const owner = await readSecret(root, 'oauth-owner');
// Derive the exact allowlist from the already hash-verified DevSpace patch.
// The older production-switch helper assumes a historical 25-tool release.
const serverSource = await readFile(join(profile.codeRoot, 'node_modules/@waishnav/devspace/dist/server.js'), 'utf8');
const expectedTools = JSON.parse(serverSource.match(/const TONG_ALLOWED_TOOLS = new Set\((\[[^\n]+\])\);/)[1]).sort();
assert.equal(expectedTools.length, 38);
async function authenticatedGateway() {
  const origin = profile.publicOrigin, resource = origin + '/mcp', redirect = origin + '/planb-callback';
  const request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const metadataResponse = await request(origin + '/.well-known/oauth-authorization-server'); assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json(); assert.equal(metadata.issuer, origin + '/');
  const registered = await request(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'PlanB isolated review', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) });
  assert.equal(registered.status, 201); const info = await registered.json();
  const verifier = randomUUID() + randomUUID(), challenge = createHash('sha256').update(verifier).digest('base64url');
  const fields = { response_type: 'code', client_id: info.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', scope: 'devspace', state: randomUUID(), resource };
  const approved = await request(metadata.authorization_endpoint, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...fields, owner_token: owner }) }); assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get('location')); assert.equal(location.searchParams.get('state'), fields.state); await approved.body?.cancel();
  const issued = await request(metadata.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: info.client_id, code: location.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, resource }) }); assert.equal(issued.status, 200);
  const tokens = await issued.json();
  const client = new Client({ name: 'planb-isolated-review', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: 'Bearer ' + tokens.access_token } }, reconnectionOptions: { maxRetries: 0 } });
  try {
    await client.connect(transport); const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, expectedTools); assert.ok(!tools.includes('exec_command') && !tools.includes('file_edit'));
    return { tools };
  } finally { await client.close(); }
}
const commandResults = [];
async function command(action, args = []) {
  const child = spawn(process.execPath, [manager, action, '--root', root, '--login-recovery', '--error-json', ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
  const timer = setTimeout(() => child.kill(), 180000);
  const code = await new Promise((ok, reject) => { child.once('error', reject); child.once('close', ok); }); clearTimeout(timer);
  assert.ok(!out.includes(owner) && !err.includes(owner), 'isolated owner token leaked');
  commandResults.push({ action, code });
  await writeFile(join(evidence, String(commandResults.length).padStart(2, '0') + '-' + action + '.json'), JSON.stringify({ code, stdout: out, stderr: err }), { flag: 'wx' });
  assert.equal(code, 0, action + ': ' + err);
  return JSON.parse(out);
}
let monitor, monitorClosed, activeRunId, grantIssued = false;
try {
  await login.issueSimulationLoginRecovery(profile); grantIssued = true;
  console.log(JSON.stringify({ event: 'verified_existing_fixture', root, evidence, commit, sourceDigest: app.sourceDigest, releaseDigest: app.releaseDigest }));
  const started = await command('start'); activeRunId = started.runId;
  assert.ok(activeRunId);
  const status = await command('status'); assert.equal(status.phase, 'ready'); assert.equal(status.runId, activeRunId);
  const doctor = await command('doctor'); assert.equal(doctor.healthy, true);
  assert.equal(doctor.health.agentdock.authenticatedMcp, true); assert.equal(doctor.health.tong.unauthenticatedRejected, true);
  const connection = await authenticatedGateway();
  console.log(JSON.stringify({ event: 'gateway_oauth_initialize_tools_list_passed', toolCount: connection.tools.length, runId: activeRunId }));

  // Production Host fixes PS5.1. This isolated copy changes only root and mutex
  // names; the pinned installed runner and production task are untouched.
  const runnerSource = await readFile(join(profile.managerRoot, 'scripts/TongLoginRuntime.ps1'), 'utf8');
  const runner = join(evidence, 'TongLoginRuntime.ps1');
  const isolatedRunner = runnerSource.replace("$runtime='D:\\Tong\\runtime'", "$runtime='" + root + "'").replace('Local\\TongLoginRuntime-', 'Local\\TongPlanBIsolation-' + randomUUID() + '-');
  assert.ok(isolatedRunner !== runnerSource && !isolatedRunner.includes("$runtime='D:\\Tong\\runtime'"));
  await writeFile(runner, isolatedRunner, { flag: 'wx' });
  monitor = spawn(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', runner, '-Mode', 'run'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let monitorOut = '', monitorErr = ''; monitor.stdout.on('data', data => { monitorOut += data; }); monitor.stderr.on('data', data => { monitorErr += data; });
  monitorClosed = new Promise((ok, reject) => { monitor.once('error', reject); monitor.once('close', ok); });
  const began = Date.now(); let healthyEvent;
  while (Date.now() - began < 90000) {
    assert.equal(monitor.exitCode, null, 'isolated monitor exited: ' + monitorErr);
    try { healthyEvent = (await readFile(join(root, 'logs/login-management.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse).find(event => event.runnerPid === monitor.pid && event.event === 'runtime_healthy' && event.runId === activeRunId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (healthyEvent && Date.now() - Date.parse(healthyEvent.at) >= 35000) break;
    await new Promise(ok => setTimeout(ok, 500));
  }
  assert.ok(healthyEvent && Date.now() - Date.parse(healthyEvent.at) >= 35000, 'monitor health observation missing');
  const observed = await command('status'); assert.equal(observed.runId, activeRunId); assert.equal(observed.supervisorAlive, true);
  assert.equal((await command('doctor')).healthy, true);
  await command('stop-run', ['--run-id', activeRunId]); activeRunId = null;
  let stopTimer;
  const monitorCode = await Promise.race([monitorClosed, new Promise((_, reject) => { stopTimer = setTimeout(() => reject(Error('MONITOR_STOP_OBSERVATION_TIMEOUT')), 30000); })]).finally(() => clearTimeout(stopTimer));
  assert.equal(monitorCode, 0, monitorErr);
  assert.ok((await readFile(join(root, 'logs/login-management.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse).some(event => event.runnerPid === monitor.pid && event.event === 'requested_stop_observed'));
  assert.ok(!monitorOut.includes(owner) && !monitorErr.includes(owner));
  await writeFile(join(evidence, 'monitor-result.json'), JSON.stringify({ code: monitorCode, stdout: monitorOut, stderr: monitorErr }), { flag: 'wx' });
  await assert.rejects(lstat(join(root, 'run/backup.freeze')), { code: 'ENOENT' });
  const restart = await command('start'); activeRunId = restart.runId;
  assert.ok(activeRunId);
  const restarted = await command('status'); assert.equal(restarted.runId, activeRunId);
  assert.equal(restarted.phase, 'ready'); assert.notEqual(restarted.runId, observed.runId); assert.equal((await command('doctor')).healthy, true);
  await command('stop-run', ['--run-id', activeRunId]); activeRunId = null;
  await assert.rejects(lstat(join(root, 'run/backup.freeze')), { code: 'ENOENT' });
  const stopped = await command('status'); const jobs = await startupJobsState(stopped.runId);
  assert.ok(Object.values(jobs).every(value => value === 0));
  console.log(JSON.stringify({ passed: true, root, evidence, commit, gatewayOAuthInitialize: true, gatewayOAuthToolsList: true, toolCount: connection.tools.length, firstRunId: observed.runId, restartedRunId: restarted.runId, isolatedRunnerInitialHealthy: true, runnerAliveAfter35Seconds: true, periodicHealthLoopObserved: false, scheduledTaskTakeoverTested: false, monitorCode, normalRestart: true, noResidualFreeze: true, jobs, commandResults, productionExecutionAllowed: false, recoveryExecutorTested: false }));
} finally {
  const cleanupErrors = [];
  try { if (activeRunId) await command('stop-run', ['--run-id', activeRunId]); } catch (error) { cleanupErrors.push(error); }
  try { if (monitor && monitor.exitCode === null && monitor.signalCode === null) { monitor.kill(); await monitorClosed; } } catch (error) { cleanupErrors.push(error); }
  try { if (grantIssued) await login.revokeSimulationLoginRecovery(root); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'ISOLATED_CLEANUP_FAILED');
}
