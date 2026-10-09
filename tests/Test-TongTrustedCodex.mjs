import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TongTrustedPolicy, TongTrustedCodexBroker } from "../scripts/TongTrustedCodexBroker.mjs";

const root = await mkdtemp(join(tmpdir(), "tong-trusted-"));
const projectRoot = join(root, "project");
const executable = join(root, "codex.exe");
const policyPath = join(root, "trusted.json");
const taskStatePath = join(root, "tasks.json");
await mkdir(projectRoot);
await writeFile(executable, "synthetic executable");
const access = {
  async authorize(capability, id) { return capability === "agent.execute" && id === "project-one"; },
  async listProjects() { return [{ id: "project-one", root: projectRoot, status: "enabled", available: true }]; },
};
const adapterCalls = [];
const policy = new TongTrustedPolicy({ policyPath, taskStatePath });
const broker = new TongTrustedCodexBroker({ access, policy, adapterFactory: (path) => ({
  async runTask(spec, callbacks) {
    adapterCalls.push({ path, spec });
    await callbacks.onSessionId("synthetic-thread");
    callbacks.onLog("synthetic output");
    return { threadId: "synthetic-thread", turnStatus: "completed", summary: "done" };
  },
}), pollMs: 5 });
const task = { taskId: "00000000-0000-4000-8000-000000000001", projectId: "project-one", cwd: projectRoot,
  task: "make a synthetic change", scope: "synthetic project", prompt: "synthetic instructions", timeoutMs: 1000 };
try {
  await assert.rejects(broker.preflight({ projectId: "project-one", projectRoot }), /disabled/i);
  await policy.enable(executable);
  await assert.rejects(broker.preflight({ projectId: "project-one", projectRoot }), /grant/i);
  await policy.grant("project-one", access);
  await broker.preflight({ projectId: "project-one", projectRoot });
  await assert.rejects(broker.preflight({ projectId: "missing", projectRoot }), /authorized|grant|project/i);
  await assert.rejects(broker.runTask({ ...task, executable: "powershell.exe" }), /unsupported/i);
  await writeFile(taskStatePath, JSON.stringify({ schemaVersion: 1, tasks: [{
    ...task, projectRoot, status: "waiting_user_action", pendingApproval: true,
    continuationMessage: null, resumeCount: 0,
  }] }));
  const controller = new AbortController();
  const states = [];
  const run = broker.runTask(task, { signal: controller.signal, onState: (state) => states.push(state) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(states, ["waiting_user_action"]);
  assert.equal(adapterCalls.length, 0);
  await policy.approveTask(task.taskId);
  assert.equal((await run).turnStatus, "completed");
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].path, executable);
  assert.deepEqual(states, ["waiting_user_action", "running"]);
  await assert.rejects(broker.runTask(task, { signal: AbortSignal.timeout(30) }), /abort|cancel|timeout/i,
    "approval must be single use");
  const secondTask = { ...task, taskId: "00000000-0000-4000-8000-000000000002" };
  await writeFile(taskStatePath, JSON.stringify({ schemaVersion: 1, tasks: [task, secondTask].map((item) => ({
    ...item, projectRoot, status: "waiting_user_action", pendingApproval: true,
  })) }));
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const gateCalls = [];
  const gatedFactory = () => ({ async runTask(spec) {
    gateCalls.push(spec.taskId);
    if (spec.taskId === task.taskId) await firstGate;
    return { turnStatus: "completed" };
  } });
  const gateA = new TongTrustedCodexBroker({ access, policy, adapterFactory: gatedFactory, pollMs: 5 });
  const gateB = new TongTrustedCodexBroker({ access, policy, adapterFactory: gatedFactory, pollMs: 5 });
  try {
    const firstRun = assert.rejects(gateA.runTask(task), /disabled/i);
    await policy.approveTask(task.taskId);
    for (let i = 0; i < 100 && gateCalls.length < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(gateCalls, [task.taskId]);
    const secondRun = assert.rejects(gateB.runTask(secondTask), /disabled/i);
    await policy.approveTask(secondTask.taskId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(gateCalls, [task.taskId], "a second Gateway must wait for the same-project lock");
    await policy.emergencyStop();
    await policy.enable(executable);
    releaseFirst();
    await Promise.all([firstRun, secondRun]);
    assert.deepEqual(gateCalls, [task.taskId], "old approval cannot launch after stop and re-enable");
  } finally { releaseFirst(); await gateA.close(); await gateB.close(); }
  const stopTask = { ...task, taskId: "00000000-0000-4000-8000-000000000003" };
  await writeFile(taskStatePath, JSON.stringify({ schemaVersion: 1, tasks: [{
    ...stopTask, projectRoot, status: "waiting_user_action", pendingApproval: true,
  }] }));
  let entered;
  const enteredRun = new Promise((resolve) => { entered = resolve; });
  const stopBroker = new TongTrustedCodexBroker({ access, policy, pollMs: 5, adapterFactory: () => ({
    async runTask(_spec, { signal }) {
      entered();
      return new Promise((resolve) => signal.addEventListener("abort", () =>
        resolve({ turnStatus: "interrupted" }), { once: true }));
    },
  }) });
  try {
    const stopping = stopBroker.runTask(stopTask);
    await policy.approveTask(stopTask.taskId);
    await enteredRun;
    await writeFile(policy.lockPath, "stale synthetic lock");
    await policy.emergencyStop();
    await unlink(policy.lockPath);
    await assert.rejects(stopping, /disabled/i, "emergency stop must fail an active trusted turn");
  } finally { await stopBroker.close(); }
  await policy.revoke("project-one");
  assert.deepEqual((await policy.status()).projects, []);
  await assert.rejects(broker.preflight({ projectId: "project-one", projectRoot }), /disabled/i);
  assert.equal((await policy.status()).enabled, false);
  assert.ok((await readFile(join(root, "trusted-audit.jsonl"), "utf8")).includes("emergency-stop"));
} finally {
  await broker.close();
  await rm(root, { recursive: true, force: true });
}
console.log("PASS: trusted execution is locally gated, project scoped, approved per task, auditable, and stoppable.");
