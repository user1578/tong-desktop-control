import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { TongAgentTaskManager } from "../scripts/TongAgentTasks.mjs";
import { TongWorkerBroker } from "../scripts/TongWorkerBroker.mjs";
import { verifySignedWorkerEnvelope } from "../scripts/TongWorkerProtocol.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-agent-tasks-"));
const projectRoot = join(temporaryRoot, "authorized-project");
const statePath = join(temporaryRoot, "tasks.json");
await mkdir(projectRoot);

const projects = new Map([["authorized", {
  id: "authorized", root: projectRoot, status: "enabled", available: true,
  effectiveCapabilities: ["project.metadata", "agent.execute"],
}]]);
const access = {
  async authorize(capability, projectId) {
    return capability === "agent.execute" && projects.get(projectId)?.effectiveCapabilities.includes(capability) === true;
  },
  async listProjects() { return [...projects.values()]; },
};

class SimulatedCodexAdapter {
  calls = [];
  resumes = [];
  cancellations = 0;

  async runTask(spec, { signal, onSessionId, onLog }) {
    this.calls.push(spec);
    const threadId = spec.threadId ?? `thread-${this.calls.length}`;
    await onSessionId(threadId);
    const persistedState = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persistedState.tasks.find((task) => task.taskId === spec.taskId)?.codexSessionId, threadId,
      "the saved Codex session ID must be durable before the first turn starts");
    onLog("Agent started with Bearer synthetic-secret-token");
    if (spec.task === "hang" && !signal.aborted) {
      return new Promise((resolve) => signal.addEventListener("abort", () => {
        this.cancellations += 1;
        resolve({ threadId, turnStatus: "interrupted", summary: "Stopped by task manager" });
      }, { once: true }));
    }
    if (spec.task === "resume-check" && !spec.threadId) {
      return { threadId, turnStatus: "interrupted", summary: "Interrupted before completion" };
    }
    if (spec.task === "agent-failed") return { threadId, turnStatus: "failed", summary: "Synthetic failure." };
    if (spec.task === "large-log") {
      for (let i = 0; i < 33; i += 1) onLog("x".repeat(8 * 1024));
    }
    if (spec.threadId) this.resumes.push(spec.threadId);
    onLog("API_KEY=synthetic-example-key");
    return { threadId, turnStatus: "completed", summary: "Finished the requested project change." };
  }
}

function makeWorkerBroker(adapter, options = {}) {
  return new TongWorkerBroker({
    access,
    cancelGraceMs: 20,
    inspectIsolation: async ({ projectId, projectRoot }) => ({
      ready: true,
      gatewaySid: "S-1-5-21-100-200-300-1001",
      workerSid: "S-1-5-21-100-200-300-1002",
      ipcPeerSid: "S-1-5-21-100-200-300-1001",
      projectId,
      projectRoot,
      restrictedToken: true,
      credentialsSeparated: true,
      cleanEnvironment: true,
      jobObjectKillOnClose: true,
      privateIpcAuthenticated: true,
      appContainerBoundary: true,
      ...options.isolation,
    }),
    launchWorker: async ({ taskId, timeoutMs }) => {
      if (options.launchWorker) return options.launchWorker({ taskId, timeoutMs });
      const controller = new AbortController();
      return {
        async runTask(envelope, secret, callbacks) {
          const request = verifySignedWorkerEnvelope(envelope, secret, { expectedTaskId: taskId });
          return adapter.runTask({ taskId: request.taskId, projectId: request.projectId,
            cwd: request.projectRoot, task: request.task, scope: request.scope, prompt: request.prompt,
            timeoutMs: request.timeoutMs, threadId: request.threadId,
            continuationMessage: request.continuationMessage }, { ...callbacks, signal: controller.signal });
        },
        async interrupt() { controller.abort(new Error("simulated Worker interrupt")); },
        async terminateJobObject() { controller.abort(new Error("simulated Job Object termination")); },
        async close() {},
      };
    },
  });
}

const adapter = new SimulatedCodexAdapter();
const managerOptions = {
  access, workerBroker: makeWorkerBroker(adapter), statePath,
  defaultTimeoutMs: 40, maxTaskRuntimeMs: 5_000, maxConcurrent: 1,
  collectResult: async () => ({
    changedFiles: ["src/example.mjs"], diffSummary: "1 file changed",
    tests: [{ command: "node --test", status: "agent_reported" }],
  }),
};
const manager = new TongAgentTaskManager(managerOptions);
const idleStatePath = join(temporaryRoot, "idle.json");
const idleManager = new TongAgentTaskManager({ access, statePath: idleStatePath });
await idleManager.close();
await assert.rejects(readFile(idleStatePath), { code: "ENOENT" },
  "starting an empty restricted task manager must not write a runtime state artifact");

async function waitForTask(taskId, predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await manager.status(taskId);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const logPage = await manager.logs({ taskId, limit: 20 }).catch(() => ({ entries: [] }));
  throw new Error(`Timed out waiting for task ${taskId}; status=${latest?.status}; error=${latest?.error?.message}; logs=${JSON.stringify(logPage.entries)}`);
}

const request = {
  projectId: "authorized", agent: "codex", task: "add a small feature", scope: "project files and focused tests",
  idempotencyKey: "client-request-0001", timeoutSeconds: 1,
};

try {
  const unsafeTogglePath = join(temporaryRoot, "unsafe-toggle.json");
  const unsafeToggleManager = new TongAgentTaskManager({ access, adapter, statePath: unsafeTogglePath, executionEnabled: true });
  try {
    await assert.rejects(unsafeToggleManager.start({
      projectId: "authorized", agent: "codex", task: "must stay disabled", scope: "synthetic project only",
      idempotencyKey: "unsafe-toggle-request-0001",
    }), /worker|isolation/i, "a boolean execution option must not bypass the Worker isolation broker");
    assert.equal(adapter.calls.length, 0, "the Gateway must never fall back to spawning Codex under its own identity");
  } finally { await unsafeToggleManager.close(); }
  await assert.rejects(readFile(unsafeTogglePath), { code: "ENOENT" });

  await assert.rejects(manager.start({ ...request, projectId: "missing" }), /project/i,
    "unknown project IDs must be rejected");
  projects.get("authorized").effectiveCapabilities = ["project.metadata"];
  await assert.rejects(manager.start(request), /agent.execute|execution permission/i,
    "read/write registration must not grant execution");
  projects.get("authorized").effectiveCapabilities = ["project.metadata", "agent.execute"];

  await assert.rejects(manager.start({ ...request, executable: "powershell.exe" }), /invalid|unsupported/i,
    "task requests must not accept executable or arbitrary CLI parameters");
  const started = await manager.start(request);
  const duplicate = await manager.start(request);
  assert.equal(duplicate.taskId, started.taskId, "an idempotent retry must return the original task");
  await assert.rejects(manager.start({ ...request, task: "different task" }), /idempotency/i,
    "reusing an idempotency key for a different request must fail");

  const completed = await waitForTask(started.taskId, (task) => task.status === "success");
  assert.equal(completed.codexSessionId, "thread-1");
  assert.equal(completed.startedAt !== null, true);
  assert.equal(completed.finishedAt !== null, true);
  assert.deepEqual((await manager.result(started.taskId)).changedFiles, ["src/example.mjs"]);
  assert.equal(adapter.calls.length, 1);

  const pagedLogs = await manager.logs({ taskId: started.taskId, limit: 1 });
  assert.equal(pagedLogs.entries.length, 1);
  assert.ok(pagedLogs.nextCursor);
  const restLogs = await manager.logs({ taskId: started.taskId, limit: 10, cursor: pagedLogs.nextCursor });
  const allLogs = [...pagedLogs.entries, ...restLogs.entries].map(({ message }) => message).join("\n");
  assert.ok(!allLogs.includes("synthetic-secret-token"));
  assert.ok(!allLogs.includes("synthetic-example-key"));
  assert.ok(allLogs.includes("[REDACTED]"));

  const interrupted = await manager.start({ ...request, task: "resume-check", idempotencyKey: "client-request-0002" });
  await waitForTask(interrupted.taskId, (task) => task.status === "waiting_user_action");
  await assert.rejects(manager.resume(interrupted.taskId, { message: "invalid\u0000message" }), /invalid resume/i);
  await manager.resume(interrupted.taskId, { message: "Continue the same session." });
  const resumed = await waitForTask(interrupted.taskId, (task) => task.status === "success");
  assert.equal(resumed.codexSessionId, "thread-2", "resume must preserve the Codex thread ID");
  assert.deepEqual(adapter.resumes, ["thread-2"]);

  const failed = await manager.start({ ...request, task: "agent-failed", idempotencyKey: "client-request-0004" });
  const failedTask = await waitForTask(failed.taskId, (task) => task.status === "failed");
  assert.equal(failedTask.error.message, "Codex task did not complete successfully.");
  const largeLog = await manager.start({ ...request, task: "large-log", idempotencyKey: "client-request-0005" });
  await waitForTask(largeLog.taskId, (task) => task.status === "success");
  const bounded = await manager.logs({ taskId: largeLog.taskId, limit: 100 });
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.entries.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.message), 0) <= bounded.maxBytes,
    "task logs must remain bounded after truncation");

  const timeout = await manager.start({ ...request, task: "hang", idempotencyKey: "client-request-0003" });
  const timedOut = await waitForTask(timeout.taskId, (task) => task.status === "failed");
  assert.match(timedOut.error.message, /timed out/i);
  assert.equal(adapter.cancellations, 1, "timeout must interrupt the adapter and release its slot");

  await manager.close();
  const reopened = new TongAgentTaskManager(managerOptions);
  const persisted = await reopened.status(started.taskId);
  assert.equal(persisted.status, "success", "task state must survive manager restart");
  assert.equal((await reopened.list({ limit: 20 })).tasks.length, 5);
  const taskPage = await reopened.list({ limit: 1 });
  assert.equal(taskPage.tasks.length, 1);
  assert.ok(taskPage.nextCursor);
  assert.equal((await reopened.list({ limit: 1, cursor: taskPage.nextCursor })).tasks.length, 1);
  const logDocument = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(logDocument.schemaVersion, 1);
  await reopened.close();

  const secondProjectRoot = join(temporaryRoot, "second-project");
  await mkdir(secondProjectRoot);
  projects.set("second-project", {
    id: "second-project", root: secondProjectRoot, status: "enabled", available: true,
    effectiveCapabilities: ["project.metadata", "agent.execute"],
  });
  class GateAdapter {
    active = new Map();
    maxActive = 0;
    async runTask(spec, { signal, onSessionId }) {
      const threadId = `gate-${spec.taskId}`;
      await onSessionId(threadId);
      this.maxActive = Math.max(this.maxActive, this.active.size + 1);
      return new Promise((resolve) => {
        const finish = (turnStatus) => {
          if (!this.active.has(spec.taskId)) return;
          this.active.delete(spec.taskId);
          resolve({ threadId, turnStatus, summary: `Gate ${turnStatus}` });
        };
        this.active.set(spec.taskId, finish);
        signal.addEventListener("abort", () => finish("interrupted"), { once: true });
        if (signal.aborted) finish("interrupted");
      });
    }
    releaseAll() { for (const finish of [...this.active.values()]) finish("completed"); }
  }
  const gateAdapter = new GateAdapter();
  const parallel = new TongAgentTaskManager({ ...managerOptions, workerBroker: makeWorkerBroker(gateAdapter),
    statePath: join(temporaryRoot, "parallel.json"), maxConcurrent: 2, defaultTimeoutMs: 10_000 });
  const parallelWait = async (taskId, predicate) => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const current = await parallel.status(taskId);
      if (predicate(current)) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for parallel task ${taskId}`);
  };
  try {
    const firstParallel = await parallel.start({ ...request, task: "blocked-1", idempotencyKey: "parallel-request-0001" });
    const secondParallel = await parallel.start({ ...request, projectId: "second-project", task: "blocked-2", idempotencyKey: "parallel-request-0002" });
    const queuedParallel = await parallel.start({ ...request, task: "queued-same-project", idempotencyKey: "parallel-request-0003" });
    await parallelWait(firstParallel.taskId, (task) => task.status === "running");
    await parallelWait(secondParallel.taskId, (task) => task.status === "running");
    const activeDeadline = Date.now() + 2_000;
    while (gateAdapter.active.size < 2 && Date.now() < activeDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(gateAdapter.active.size, 2);
    assert.equal(gateAdapter.maxActive, 2, "the configured concurrency limit should be filled");
    assert.equal((await parallel.status(queuedParallel.taskId)).status, "queued",
      "the scheduler must not run two tasks against one project simultaneously");
    assert.equal((await parallel.cancel(queuedParallel.taskId)).status, "cancelled");
    gateAdapter.releaseAll();
    await parallelWait(firstParallel.taskId, (task) => task.status === "success");
    await parallelWait(secondParallel.taskId, (task) => task.status === "success");
    const cancelled = await parallel.start({ ...request, task: "cancel-active", idempotencyKey: "parallel-request-0004" });
    await parallelWait(cancelled.taskId, (task) => task.status === "running");
    await parallel.cancel(cancelled.taskId);
    await parallelWait(cancelled.taskId, (task) => task.status === "cancelled");
  } finally { await parallel.close(); }

  const recoveryPath = join(temporaryRoot, "recovery.json");
  await (await import("node:fs/promises")).writeFile(recoveryPath, JSON.stringify({ schemaVersion: 1, tasks: [{
    taskId: "recovery-task", projectId: "authorized", agent: "codex", status: "running",
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    codexSessionId: "saved-thread", logs: [],
  }] }), "utf8");
  const recovered = new TongAgentTaskManager({ access, statePath: recoveryPath });
  const recoveredStatus = await recovered.status("recovery-task");
  assert.equal(recoveredStatus.status, "waiting_user_action");
  assert.equal(recoveredStatus.resumeAvailable, true,
    "restart recovery must preserve the saved session and must not report process liveness as success");
  await recovered.close();
  console.log("PASS: task authorization, idempotency, persistence, bounded redacted logs, results, resume, and timeout cleanup.");
} finally {
  await manager.close();
  const actual = await realpath(temporaryRoot);
  assert.ok(actual.startsWith(join(tmpdir(), "tong-agent-tasks-")));
  await rm(actual, { recursive: true, force: true });
}
