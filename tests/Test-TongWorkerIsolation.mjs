import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWorkerIsolationSnapshot,
  createSignedWorkerEnvelope,
  createWorkerEnvironment,
  sanitizeWorkerLog,
  verifySignedWorkerEnvelope,
} from "../scripts/TongWorkerProtocol.mjs";
import { TongCodexWorker } from "../scripts/TongCodexWorker.mjs";
import { TongWorkerBroker } from "../scripts/TongWorkerBroker.mjs";
import { serveTongCodexWorker, TongWorkerStdioSession } from "../scripts/TongWorkerStdio.mjs";

const tempRoot = await mkdtemp(join(tmpdir(), "tong-worker-isolation-"));
const projectRoot = join(tempRoot, "authorized-project");
const otherProject = join(tempRoot, "other-project");
await mkdir(projectRoot);
await mkdir(otherProject);

const project = { id: "authorized", root: projectRoot, status: "enabled", available: true,
  effectiveCapabilities: ["project.metadata", "agent.execute"] };
let authorized = true;
const access = {
  async authorize(capability, projectId) {
    return capability === "agent.execute" && projectId === project.id && authorized;
  },
  async listProjects() { return [project]; },
};
const taskId = randomUUID();
const ipcSecret = randomBytes(32);
const payload = {
  taskId, projectId: project.id, projectRoot, task: "inspect the synthetic project",
  scope: "project files only", prompt: "Inspect the project without leaving its root.", timeoutMs: 10_000,
};

function isolationSnapshot(overrides = {}) {
  return {
    ready: true,
    gatewaySid: "S-1-5-21-100-200-300-1001",
    workerSid: "S-1-5-21-100-200-300-1002",
    restrictingSid: "S-1-5-21-100-200-300-19001",
    appContainerSid: "S-1-15-2-19001",
    ipcPeerSid: "S-1-5-21-100-200-300-1001",
    taskId,
    projectId: project.id,
    projectRoot,
    restrictedToken: true,
    taskAclVerified: true,
    credentialsSeparated: true,
    cleanEnvironment: true,
    jobObjectKillOnClose: true,
    privateIpcAuthenticated: true,
    appContainerBoundary: true,
    ...overrides,
  };
}

async function workerSpec(overrides = {}) {
  return { taskId, projectId: project.id, cwd: projectRoot, task: payload.task,
    scope: payload.scope, prompt: payload.prompt, timeoutMs: payload.timeoutMs, ...overrides };
}

try {
  const envelope = createSignedWorkerEnvelope(payload, ipcSecret);
  assert.deepEqual(verifySignedWorkerEnvelope(envelope, ipcSecret, { expectedTaskId: taskId }), payload);
  assert.throws(() => verifySignedWorkerEnvelope(envelope, randomBytes(32)), /IPC authentication/i,
    "a client without the per-worker bootstrap key must not submit a task");
  assert.throws(() => createSignedWorkerEnvelope({ ...payload, executable: "powershell.exe" }, ipcSecret), /unsupported|invalid/i,
    "the worker protocol must reject arbitrary executable and launch parameters");
  assert.throws(() => verifySignedWorkerEnvelope({ ...envelope, payload: { ...payload, projectRoot: otherProject } }, ipcSecret), /IPC authentication/i,
    "the signed authorized root must not be replaceable in transit");

  assertWorkerIsolationSnapshot(isolationSnapshot(), { ...payload, requireTaskAcl: true });
  for (const badSnapshot of [
    isolationSnapshot({ workerSid: isolationSnapshot().gatewaySid }),
    isolationSnapshot({ restrictedToken: false }),
    isolationSnapshot({ appContainerBoundary: false }),
    isolationSnapshot({ appContainerSid: undefined }),
    isolationSnapshot({ taskAclVerified: false }),
    isolationSnapshot({ ipcPeerSid: "S-1-5-21-100-200-300-9999" }),
    isolationSnapshot({ projectRoot: otherProject }),
  ]) {
    assert.throws(() => assertWorkerIsolationSnapshot(badSnapshot, { ...payload, requireTaskAcl: true }), /isolation|identity|ACL|IPC/i);
  }

  const environment = createWorkerEnvironment({
    systemRoot: "C:\\Windows",
    profileRoot: join(tempRoot, "worker-profile"),
    tempRoot: join(tempRoot, "worker-temp"),
    toolDirectories: ["D:\\node", "C:\\Program Files\\Git\\cmd", "C:\\Program Files\\Python311"],
  });
  assert.equal(environment.USERPROFILE, join(tempRoot, "worker-profile"));
  assert.equal(environment.CODEX_HOME, join(tempRoot, "worker-profile", ".codex"));
  assert.equal(environment.TEMP, join(tempRoot, "worker-temp"));
  for (const secretName of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "GH_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(Object.hasOwn(environment, secretName), false, `${secretName} must not be inherited by a Worker`);
  }
  assert.throws(() => createWorkerEnvironment({ systemRoot: "C:\\Windows", profileRoot: "relative",
    tempRoot: join(tempRoot, "worker-temp"), toolDirectories: [] }), /absolute/i);

  const redacted = sanitizeWorkerLog("Authorization: Bearer synthetic-token\nAPI_KEY=synthetic-key");
  assert.ok(!redacted.includes("synthetic-token"));
  assert.ok(!redacted.includes("synthetic-key"));
  assert.ok(Buffer.byteLength(sanitizeWorkerLog("x".repeat(20_000))) <= 8 * 1024);

  const executablePath = join(tempRoot, "codex.exe");
  const executableBytes = Buffer.from("synthetic fixed Codex executable marker");
  await writeFile(executablePath, executableBytes);
  const workerCalls = [];
  const worker = new TongCodexWorker({
    policy: { codexExecutablePath: executablePath, codexExecutableSha256: createHash("sha256").update(executableBytes).digest("hex"),
      environment },
    inspectIsolation: async () => isolationSnapshot(),
    appServerFactory: () => ({
      async runTask(spec, callbacks) {
        workerCalls.push(spec);
        callbacks.onLog("Authorization: Bearer worker-test-secret", "stderr");
        return { threadId: "thread-worker-test", turnStatus: "completed", summary: "Synthetic worker completed.",
          tests: [{ command: "node tests", exitCode: 0, status: "passed", evidence: "API_KEY=stdio-test-secret" }] };
      },
    }),
  });
  const workerLogs = [];
  const result = await worker.runTask(envelope, ipcSecret, { onLog: (text, kind) => workerLogs.push({ text, kind }) });
  assert.equal(result.turnStatus, "completed");
  assert.equal(workerCalls[0].cwd, projectRoot);
  assert.equal(workerCalls[0].executable, undefined, "the task message must never choose the executable");
  assert.ok(!workerLogs[0].text.includes("worker-test-secret"));
  const wrongHashWorker = new TongCodexWorker({
    policy: { codexExecutablePath: executablePath, codexExecutableSha256: "0".repeat(64), environment },
    inspectIsolation: async () => isolationSnapshot(),
    appServerFactory: () => { throw new Error("an unverified Codex executable must never be launched"); },
  });
  await assert.rejects(wrongHashWorker.runTask(envelope, ipcSecret), /fixed|hash|executable/i);

  const controlPipe = new PassThrough();
  const outputPipe = new PassThrough();
  const workerServer = serveTongCodexWorker({ worker, bootstrapSecret: ipcSecret, input: controlPipe, output: outputPipe });
  const stdioSession = new TongWorkerStdioSession({ input: outputPipe, output: controlPipe,
    terminateJobObject: async () => {}, closeProcess: async () => {} });
  const stdioResult = await stdioSession.runTask(envelope, ipcSecret, { onLog: (text, kind) => workerLogs.push({ text, kind }) });
  assert.equal(stdioResult.turnStatus, "completed");
  assert.equal(stdioResult.tests[0].evidence, "API_KEY=[REDACTED]", "Worker result evidence must be redacted before returning over IPC");
  await stdioSession.close();
  await workerServer;

  let stdioCancelObserved = false;
  const cancelInput = new PassThrough();
  const cancelOutput = new PassThrough();
  const cancelServer = serveTongCodexWorker({
    worker: { async runTask(_envelope, _secret, { signal }) {
      return new Promise((resolve) => {
        const finish = () => { stdioCancelObserved = true; resolve({ turnStatus: "interrupted" }); };
        if (signal.aborted) finish();
        else signal.addEventListener("abort", finish, { once: true });
      });
    } },
    bootstrapSecret: ipcSecret, input: cancelInput, output: cancelOutput,
  });
  const cancelSession = new TongWorkerStdioSession({ input: cancelOutput, output: cancelInput,
    terminateJobObject: async () => {}, closeProcess: async () => {} });
  const cancelledRoundtrip = cancelSession.runTask(envelope, ipcSecret);
  await new Promise((resolve) => setImmediate(resolve));
  await cancelSession.interrupt(taskId);
  assert.equal((await cancelledRoundtrip).turnStatus, "interrupted");
  assert.equal(stdioCancelObserved, true, "only the authenticated task cancellation should abort the Worker signal");
  await cancelSession.close();
  await cancelServer;

  const attackInput = new PassThrough();
  const attackOutput = new PassThrough();
  let unauthorizedWorkerCalls = 0;
  const unauthorizedServer = serveTongCodexWorker({
    worker: { async runTask() { unauthorizedWorkerCalls += 1; return { turnStatus: "completed" }; } },
    bootstrapSecret: ipcSecret, input: attackInput, output: attackOutput,
  });
  const unauthorizedServerRejected = assert.rejects(unauthorizedServer, /IPC authentication/i);
  const unauthorizedSession = new TongWorkerStdioSession({ input: attackOutput, output: attackInput,
    terminateJobObject: async () => {}, closeProcess: async () => {} });
  const attackerSecret = randomBytes(32);
  const attackerEnvelope = createSignedWorkerEnvelope(payload, attackerSecret);
  await assert.rejects(unauthorizedSession.runTask(attackerEnvelope, attackerSecret), /IPC authentication/i,
    "a client that supplies its own signing key must not authenticate to the Worker");
  await unauthorizedServerRejected;
  assert.equal(unauthorizedWorkerCalls, 0);
  await unauthorizedSession.close();

  const defaultBroker = new TongWorkerBroker({ access });
  await assert.rejects(defaultBroker.preflight({ projectId: project.id, projectRoot }), /disabled|isolation|worker/i,
    "missing isolation inspection or launcher must fail closed");

  const launches = [];
  const broker = new TongWorkerBroker({
    access,
    inspectIsolation: async () => isolationSnapshot({ taskId: null, restrictingSid: undefined, taskAclVerified: undefined }),
    launchWorker: async (launchRequest) => {
      launches.push(launchRequest);
      return {
        async runTask(workerEnvelope, workerSecret, callbacks) {
          assert.deepEqual(verifySignedWorkerEnvelope(workerEnvelope, workerSecret), {
            taskId: payload.taskId, projectId: payload.projectId, projectRoot, task: payload.task,
            scope: payload.scope, prompt: payload.prompt, timeoutMs: payload.timeoutMs,
          });
          callbacks.onSessionId("thread-broker-test");
          return { threadId: "thread-broker-test", turnStatus: "completed", summary: "Synthetic broker completed." };
        },
        async interrupt() {},
        async terminateJobObject() { this.terminated = true; },
        async close() { this.closed = true; },
      };
    },
  });
  await broker.preflight({ projectId: project.id, projectRoot });
  authorized = false;
  await assert.rejects(broker.runTask(await workerSpec(), { signal: new AbortController().signal }), /authorized|agent.execute/i,
    "a revoked grant must be rechecked immediately before Worker launch");
  assert.equal(launches.length, 0);
  authorized = true;

  const rejectedRequests = [
    workerSpec({ cwd: otherProject }),
    workerSpec({ executable: "powershell.exe" }),
    workerSpec({ environment: { OPENAI_API_KEY: "synthetic-secret" } }),
    workerSpec({ taskId: "not-a-uuid" }),
  ];
  for (const request of rejectedRequests) {
    await assert.rejects(broker.runTask(await request, { signal: new AbortController().signal }), /invalid|project|unsupported|path/i);
  }
  assert.equal(launches.length, 0);
  let brokerSessionId;
  const brokerResult = await broker.runTask(await workerSpec(), {
    signal: new AbortController().signal,
    onSessionId: (id) => { brokerSessionId = id; },
  });
  assert.equal(brokerResult.turnStatus, "completed");
  assert.equal(brokerSessionId, "thread-broker-test");
  assert.deepEqual(Object.keys(launches[0]).sort(), ["bootstrapSecret", "taskId", "timeoutMs"]);
  assert.match(launches[0].bootstrapSecret, /^[A-Za-z0-9_-]{43}$/,
    "the one-time IPC key is supplied only to the private Worker startup channel");
  assert.equal(Object.hasOwn(launches[0], "projectRoot"), false);
  assert.equal(Object.hasOwn(launches[0], "executable"), false);

  let partialJobTerminated = false;
  let partialSessionClosed = false;
  const incompleteBroker = new TongWorkerBroker({
    access,
    inspectIsolation: async () => isolationSnapshot({ taskId: null, restrictingSid: undefined, taskAclVerified: undefined }),
    launchWorker: async () => ({
      async terminateJobObject() { partialJobTerminated = true; },
      async close() { partialSessionClosed = true; },
    }),
  });
  await assert.rejects(incompleteBroker.runTask(await workerSpec(), { signal: new AbortController().signal }), /session is incomplete/i);
  assert.equal(partialJobTerminated, true, "a partially created Worker job must be stopped if its session contract is incomplete");
  assert.equal(partialSessionClosed, true, "partial Worker handles must be closed after termination");
  await incompleteBroker.close();

  const activeSessions = new Map();
  const cancellationBroker = new TongWorkerBroker({
    access: {
      async authorize(capability, id) { return capability === "agent.execute" && ["authorized", "second"].includes(id); },
      async listProjects() { return [project, { id: "second", root: otherProject, status: "enabled", available: true }]; },
    },
    inspectIsolation: async ({ taskId: activeTaskId, projectId, projectRoot: activeRoot }) => isolationSnapshot({
      taskId: activeTaskId, projectId, projectRoot: activeRoot,
    }),
    cancelGraceMs: 10,
    launchWorker: async ({ taskId: launchedTaskId }) => {
      const session = {
        interrupted: false, terminated: false,
        runTask() {
          return new Promise(() => {});
        },
        async interrupt() { this.interrupted = true; },
        async terminateJobObject() { this.terminated = true; },
        async close() {},
      };
      activeSessions.set(launchedTaskId, session);
      return session;
    },
  });
  const firstController = new AbortController();
  const secondTaskId = randomUUID();
  const secondController = new AbortController();
  const firstRun = cancellationBroker.runTask(await workerSpec(), { signal: firstController.signal });
  const secondRun = cancellationBroker.runTask({ ...(await workerSpec()), taskId: secondTaskId,
    projectId: "second", cwd: otherProject }, { signal: secondController.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  firstController.abort(new Error("cancel first synthetic task"));
  await assert.rejects(firstRun, /terminated|cancelled|interrupted/i);
  assert.equal(activeSessions.get(taskId).interrupted, true);
  assert.equal(activeSessions.get(taskId).terminated, true);
  assert.equal(activeSessions.get(secondTaskId).terminated, false,
    "cancelling one task must only terminate its own Job Object");
  secondController.abort(new Error("clean up second synthetic task"));
  await assert.rejects(secondRun);

  await broker.close();
  await defaultBroker.close();
  await incompleteBroker.close();
  await cancellationBroker.close();
  console.log("PASS: Worker protocol authentication, exact project authorization, restricted-identity checks, clean environment, fixed executable, redacted logs, and per-task cancellation.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
