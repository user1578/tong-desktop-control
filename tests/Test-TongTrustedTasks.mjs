import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TongAgentTaskManager } from "../scripts/TongAgentTasks.mjs";
import { TongTrustedPolicy, TongTrustedCodexBroker, TongExecutorRouter } from "../scripts/TongTrustedCodexBroker.mjs";

const root = await mkdtemp(join(tmpdir(), "tong-trusted-tasks-"));
const projectRoot = join(root, "project");
const executable = join(root, "codex.exe");
const statePath = join(root, "tasks.json");
await mkdir(projectRoot);
await writeFile(executable, "synthetic executable");
const access = {
  async authorize(capability, projectId) { return capability === "agent.execute" && projectId === "synthetic"; },
  async listProjects() { return [{ id: "synthetic", root: projectRoot, status: "enabled", available: true }]; },
};
const policy = new TongTrustedPolicy({ policyPath: join(root, "trusted.json"), taskStatePath: statePath });
const calls = [];
const trusted = new TongTrustedCodexBroker({ access, policy, pollMs: 5, adapterFactory: () => ({
  async runTask(spec, { onSessionId, onLog }) {
    calls.push(spec);
    const threadId = spec.threadId ?? `thread-${calls.length}`;
    await onSessionId(threadId);
    onLog("synthetic run");
    return { threadId, turnStatus: spec.task === "resume" && !spec.threadId ? "interrupted" : "completed",
      summary: "synthetic result", tests: [{ command: "node --test", status: "passed" }] };
  },
}) });
const isolated = {
  async preflight() { throw new Error("isolated mode disabled"); },
  async runTask() { throw new Error("isolated mode disabled"); },
  async close() {},
};
const manager = new TongAgentTaskManager({ access,
  workerBroker: new TongExecutorRouter({ policy, isolated, trusted }), statePath,
  collectResult: async () => ({ changedFiles: ["src/example.mjs"], diffSummary: "1 file changed", gitAvailable: true }),
  defaultTimeoutMs: 2_000, maxTaskRuntimeMs: 5_000 });
const request = { projectId: "synthetic", agent: "codex", task: "change", scope: "synthetic only",
  idempotencyKey: "trusted-request-0001", timeoutSeconds: 2 };
async function waitFor(taskId, status) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const task = await manager.status(taskId);
    if (task.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${status}`);
}
try {
  await manager.ready;
  const competing = new TongAgentTaskManager({ access, workerBroker: new TongExecutorRouter({ policy, isolated, trusted }),
    statePath });
  await assert.rejects(competing.ready, /already owned/i,
    "a second Gateway must not overwrite the same task document");
  await assert.rejects(manager.start(request), /isolated mode disabled/);
  await policy.enable(executable);
  await assert.rejects(manager.start(request), /grant/i);
  await policy.grant("synthetic", access);
  await assert.rejects(manager.start({ ...request, shell: "powershell.exe" }), /unsupported/i);
  const created = await manager.start(request);
  assert.equal((await manager.start(request)).taskId, created.taskId);
  await waitFor(created.taskId, "waiting_user_action");
  assert.equal(calls.length, 0);
  await policy.approveTask(created.taskId);
  const done = await waitFor(created.taskId, "success");
  assert.equal(done.codexSessionId, "thread-1");
  assert.deepEqual((await manager.result(created.taskId)).changedFiles, ["src/example.mjs"]);
  assert.ok((await manager.logs({ taskId: created.taskId })).entries.some((item) => item.message.includes("synthetic run")));

  const interrupted = await manager.start({ ...request, task: "resume", idempotencyKey: "trusted-request-0002" });
  await waitFor(interrupted.taskId, "waiting_user_action");
  await policy.approveTask(interrupted.taskId);
  for (let attempt = 0; attempt < 400 && !(await manager.status(interrupted.taskId)).resumeAvailable; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal((await manager.status(interrupted.taskId)).resumeAvailable, true);
  await manager.resume(interrupted.taskId, { message: "continue" });
  await waitFor(interrupted.taskId, "waiting_user_action");
  await policy.approveTask(interrupted.taskId);
  assert.equal((await waitFor(interrupted.taskId, "success")).codexSessionId, "thread-2");
  assert.equal(calls.at(-1).threadId, "thread-2");

  const timed = await manager.start({ ...request, idempotencyKey: "trusted-request-timeout", timeoutSeconds: 1 });
  assert.match((await waitFor(timed.taskId, "failed")).error.message, /timed out/i);
  assert.equal(calls.length, 3, "approval timeout must not launch Codex");

  const cancelled = await manager.start({ ...request, idempotencyKey: "trusted-request-0003" });
  await waitFor(cancelled.taskId, "waiting_user_action");
  await manager.cancel(cancelled.taskId);
  await waitFor(cancelled.taskId, "cancelled");
  assert.equal(calls.length, 3);
  console.log("PASS: trusted task create, idempotency, local approval, logs, result, resume, and cancel.");
} finally {
  await manager.close();
  await trusted.close();
  await rm(root, { recursive: true, force: true });
}
