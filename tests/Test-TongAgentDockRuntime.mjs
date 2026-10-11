import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { initializeRuntime, startRuntime, runtimeStatus, runtimeDoctor, stopRuntime, redactedStream } from '../scripts/TongAgentDockRuntime.mjs';
import { readSecret, terminateOwnedProcess, processIdentity, sameProcess } from '../scripts/TongRuntimeSecurity.mjs';
import { TongAgentDockClient } from '../scripts/TongAgentDockClient.mjs';
const root = await mkdtemp('D:\\agentdock-poc-20261010\\isolated\\state\\b22-runtime-');
const tongRoot = fileURLToPath(new URL('../', import.meta.url));
await assert.rejects(initializeRuntime({root:'D:\\tong-agentdock-local',tongRoot}),/INVALID_ROOT/);
const redactor=redactedStream(['SYNTHETIC_SECRET_123456']);let redacted='';redactor.on('data',chunk=>{redacted+=chunk;});
redactor.write('prefix SYNTHETIC_');redactor.write('SECRET_123');redactor.end('456 suffix');await once(redactor,'end');assert.equal(redacted,'prefix [REDACTED] suffix');
await initializeRuntime({ root, tongRoot, withTong: true });
const occupied = createServer(); occupied.listen(18765, '127.0.0.1'); await once(occupied, 'listening');
try { await assert.rejects(startRuntime(root), /PORT_OCCUPIED/); assert.equal((await runtimeStatus(root)).phase, 'not_started'); }
finally { await new Promise(ok => occupied.close(ok)); }
await assert.rejects(startRuntime(root,{startupTimeoutMs:1}),/START_TIMEOUT/);
const aborted=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));
assert.equal(aborted.jobActiveAfterCleanup,0);assert.ok(aborted.finishedAt);
assert.equal(sameProcess(await processIdentity(aborted.pid),aborted),false);
assert.equal((await processIdentity(aborted.nodePid,aborted.runId))?.markerMatches??false,false);
try {
  const ready = await startRuntime(root); assert.equal(ready.phase, 'ready');
  await assert.rejects(startRuntime(root), /ALREADY_RUNNING/);
  assert.equal((await runtimeDoctor(root)).healthy, true);
  const wrong = new TongAgentDockClient({ tokenProvider: () => 'WRONG_SYNTHETIC_BEARER_TOKEN' });
  await assert.rejects(wrong.connect(), e => e.code === 'AUTH_FAILED'); await wrong.close();
  const record = JSON.parse(await readFile(join(root, 'run', 'runtime.json'), 'utf8'));
  assert.ok(record.children.some(c => c.role === 'gateway') && record.children.some(c => c.role === 'devspace'));
  assert.ok(record.children.every(c => !c.tokenInArgv));
  const stopped = await stopRuntime(root); assert.equal(stopped.phase, 'stopped');
  for (const identity of [...record.children, record.supervisor, ...(stopped.descendants ?? [])]) assert.equal(sameProcess(await processIdentity(identity.pid), identity), false);
  await startRuntime(root);
  const current = JSON.parse(await readFile(join(root, 'run', 'runtime.json'), 'utf8'));
  await terminateOwnedProcess(current.children.find(c => c.role === 'devspace'));
  for (let i = 0; i < 160; i++) { const status = await runtimeStatus(root); if (['abnormal_exit','cleanup_required'].includes(status.phase) && !status.supervisorAlive) break; await new Promise(ok => setTimeout(ok, 100)); }
  const exited = JSON.parse(await readFile(join(root, 'run', 'runtime.json'), 'utf8'));
  assert.equal(exited.phase, 'abnormal_exit'); assert.ok(exited.exits.some(e => e.role === 'devspace' && e.classification === 'abnormal_exit'));
  await stopRuntime(root); // Wait for private Job cleanup and guardian exit before restart.
  const backendRun=await startRuntime(root);
  const interrupted=new TongAgentDockClient({tokenProvider:()=>readSecret(root,'agentdock')});await interrupted.connect();
  await terminateOwnedProcess(backendRun.children.find(c=>c.role==='agentdock'));
  await assert.rejects(interrupted.callTool('list_dir',{path:join(root,'workspace')}),error=>['UNAVAILABLE','TIMEOUT'].includes(error.code));await interrupted.close();
  for(let i=0;i<200;i++){const g=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));if(g.runId===backendRun.runId&&g.finishedAt){break;}await new Promise(ok=>setTimeout(ok,100));}
  await stopRuntime(root);
  const supervisorRun=await startRuntime(root);
  await terminateOwnedProcess(supervisorRun.supervisor);
  for(let i=0;i<200;i++){const g=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));if(g.runId===supervisorRun.runId&&g.finishedAt){break;}await new Promise(ok=>setTimeout(ok,100));}
  const guardian=JSON.parse(await readFile(join(root,'run','guardian.json'),'utf8'));assert.equal(guardian.jobActiveAfterCleanup,0);assert.notEqual(guardian.nodeExitCode,0);
  await stopRuntime(root);
  for(const identity of supervisorRun.children)assert.equal(sameProcess(await processIdentity(identity.pid),identity),false);
  const previous = await readFile(join(root, 'run', 'runtime.json'), 'utf8');
  const fake = { ...exited, phase: 'ready', supervisor: { ...exited.supervisor, pid: process.pid, startTicks: '1' } };
  await writeFile(join(root, 'run', 'runtime.json'), JSON.stringify(fake));
  const fakeText = await readFile(join(root, 'run', 'runtime.json'), 'utf8');
  assert.equal((await runtimeStatus(root)).phase, 'stale_record');
  await assert.rejects(stopRuntime(root), /IDENTITY_MISMATCH/);
  assert.equal(await readFile(join(root, 'run', 'runtime.json'), 'utf8'), fakeText);
  await writeFile(join(root, 'run', 'runtime.json'), previous);
  const token = await readSecret(root, 'agentdock'), owner = await readSecret(root, 'oauth-owner');
  for (const name of await readdir(join(root, 'logs'))) { const output = await readFile(join(root, 'logs', name)); assert.ok(!output.includes(Buffer.from(token)) && !output.includes(Buffer.from(owner))); }
  console.log(JSON.stringify({ passed: true, root, portOccupiedRejected: true, wrongBearerRejected: true, cleanStop: true, nodeExitRecorded: true, stalePidRejected: true, noPlaintextLogs: true, startupAbortClean:true, backendDisconnect:true, supervisorCrashJobCleanup:true, scopeDenied:true, splitStreamRedaction:true }));
} finally { const status = await runtimeStatus(root); if (status.supervisorAlive) await stopRuntime(root); }
