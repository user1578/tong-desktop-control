import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createTongTestDirectory } from './fixtures/TongTestDirectory.mjs';

const run = promisify(execFile);
const candidate = 'scripts/TongCutoverStoppedRunProbe.mjs';
const temp = await createTongTestDirectory('tong-cleanup-probe-');
let passed = false;
try {
  const root = temp.path;
  const runId = randomUUID();
  const securityDir = join(root, 'releases', 'manager', 'scripts');
  await mkdir(securityDir, { recursive: true });
  await mkdir(join(root, 'run'), { recursive: true });
  const original = await readFile(candidate, 'utf8');
  const rootDeclaration = "const ROOT = 'D:\\\\Tong\\\\runtime';";
  assert.ok(original.includes(rootDeclaration));
  assert.ok(original.includes('const ports = [7676, 7677, 18765];'));

  const servers = [];
  for (let i = 0; i < 3; i++) {
    const s = createServer();
    await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
    servers.push(s);
  }
  const ports = servers.map((server) => server.address().port);
  for (const server of servers) await new Promise((done) => server.close(done));
  const testProbe = join(root, 'probe.mjs');
  const content = original.replace(rootDeclaration, 'const ROOT = ' + JSON.stringify(root) + ';')
    .replace('const ports = [7676, 7677, 18765];', 'const ports = ' + JSON.stringify(ports) + ';');
  await writeFile(testProbe, content);
  const mock = [
    "import { readFile } from 'node:fs/promises';",
    'const file = ' + JSON.stringify(join(root, 'mock-state.json')) + ';',
    "const read = async () => JSON.parse(await readFile(file, 'utf8'));",
    "export async function processIdentity(pid) {return (await read()).processes[pid] ?? null;}",
    "export async function runtimeJobState() {return {activeProcesses:(await read()).jobActive};}",
    "export function sameProcess(actual, expected) {return actual?.pid===expected?.pid && actual?.startTicks===expected?.startTicks;}",
  ].join('\n');
  await writeFile(join(securityDir, 'TongRuntimeSecurity.mjs'), mock);
  const record = { runId, phase: 'stopped',
    supervisor: { pid: 90, exe: 'synthetic-node', startTicks: '1000' },
    children: [{ pid: 91, exe: 'synthetic-child', startTicks: '1001' }], descendants: [] };
  const guardian = { runId, pid: 89, exe: 'synthetic-guardian', startTicks: '999',
    nodePid: 90, jobAssigned: true, finishedAt: new Date().toISOString(),
    jobActiveAfterCleanup: 0, jobName: 'Local\\TongRuntime-' + runId, killOnJobClose: true };
  const state = { processes: {}, jobActive: 0 };
  const setCase = async (r = record, g = guardian, s = state) => {
    await writeFile(join(root, 'run', 'runtime.json'), JSON.stringify(r));
    await writeFile(join(root, 'run', 'guardian.json'), JSON.stringify(g));
    await writeFile(join(root, 'mock-state.json'), JSON.stringify(s));
  };
  const invoke = async () => {
    try {
      const result = await run(process.execPath, [testProbe, runId], { timeout: 10000 });
      return { code: 0, ...JSON.parse(result.stdout) };
    } catch (error) {
      assert.equal(error.code, 2, 'Unexpected probe failure: ' + error.message);
      return { code: 2, ...JSON.parse(error.stdout) };
    }
  };
  await setCase();
  assert.deepEqual((await invoke()).failures, [], 'valid Guardian/job exit must pass');
  await setCase(record, guardian, { processes: {}, jobActive: 1 });
  assert.ok((await invoke()).failures.includes('JOB_STILL_ACTIVE'));
  await setCase(record, guardian, { processes: {
    91: { pid: 91, exe: 'unrelated process', startTicks: '5000' },
  }, jobActive: 0 });
  assert.ok((await invoke()).failures.includes('RECORDED_PID_STILL_IN_USE'),
    'reused PID must still fail closed');
  await setCase(record, { ...guardian, finishedAt: null });
  assert.ok((await invoke()).failures.includes('GUARDIAN_STOP_NOT_PROVEN'));
  await setCase(record, { ...guardian, jobName: 'wrong-job' });
  assert.ok((await invoke()).failures.includes('JOB_IDENTITY_MISMATCH'));
  await setCase();
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(ports[0], '127.0.0.1', resolve));
  try { assert.ok((await invoke()).failures.includes('PORT_BUSY_OR_UNCHECKABLE')); }
  finally { await new Promise((done) => listener.close(done)); }
  passed = true;
  console.log('PASS: stopped-run proof accepts complete cleanup and rejects live/recycled PID, active Job, invalid Guardian, occupied port.');
} finally {
  await temp.finish(passed);
}
