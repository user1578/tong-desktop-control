// Read-only, fail-closed checkpoint between stopping the old runtime and
// installing a new production release. Never stops processes or modifies state.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';

const ROOT = 'D:\\Tong\\runtime';
const expected = process.argv[2];
const runIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
if (!runIdPattern.test(expected ?? '')) throw Error('EXPECTED_RUN_ID_REQUIRED');

const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const record = await load(join(ROOT, 'run', 'runtime.json'));
const guardian = await load(join(ROOT, 'run', 'guardian.json'));
const failures = [];
if (record.runId !== expected || guardian.runId !== expected) failures.push('RUN_ID_MISMATCH');
if (record.phase !== 'stopped' || !guardian.finishedAt || guardian.jobAssigned !== true
    || guardian.jobActiveAfterCleanup !== 0) failures.push('GUARDIAN_STOP_NOT_PROVEN');
if (guardian.jobName !== 'Local\\TongRuntime-' + expected || guardian.killOnJobClose !== true)
  failures.push('JOB_IDENTITY_MISMATCH');
if (record.supervisor?.pid !== guardian.nodePid) failures.push('SUPERVISOR_IDENTITY_MISMATCH');

const securityPath = join(ROOT, 'releases', 'manager', 'scripts', 'TongRuntimeSecurity.mjs');
const security = await import(pathToFileURL(securityPath).href);
const identities = [guardian, record.supervisor, ...(record.children ?? []), ...(record.descendants ?? [])]
  .filter((value) => Number.isInteger(value?.pid) && value.pid > 0);
let live = 0;
let same = 0;
for (const identity of identities) {
  const current = await security.processIdentity(identity.pid);
  if (current) {
    live += 1;
    if (security.sameProcess(current, identity)) same += 1;
  }
}
if (live) failures.push('RECORDED_PID_STILL_IN_USE');
let jobActive = null;
try {
  const state = await security.runtimeJobState(expected);
  jobActive = state?.activeProcesses;
  if (jobActive !== 0) failures.push('JOB_STILL_ACTIVE');
} catch {
  failures.push('JOB_STATUS_UNAVAILABLE');
}

async function inspectPort(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const finish = (state) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(state);
    };
    const timer = setTimeout(() => finish('UNCHECKABLE'), 1000);
    socket.once('connect', () => finish('LISTENING'));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED' ? 'FREE' : 'UNCHECKABLE'));
  });
}
const ports = [7676, 7677, 18765];
const blockedPorts = [];
for (const port of ports) if (await inspectPort(port) !== 'FREE') blockedPorts.push(port);
if (blockedPorts.length) failures.push('PORT_BUSY_OR_UNCHECKABLE');

console.log(JSON.stringify({
  schemaVersion: 1,
  readOnly: true,
  expectedRunId: expected,
  identityCount: identities.length,
  liveRecordedPids: live,
  matchingOwnedPids: same,
  jobActive,
  blockedPortCount: blockedPorts.length,
  ok: failures.length === 0,
  failures,
}));
if (failures.length) process.exitCode = 2;
