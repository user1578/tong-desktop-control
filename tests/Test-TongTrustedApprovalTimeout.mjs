import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TongAgentTaskManager } from "../scripts/TongAgentTasks.mjs";
import { createTongTestDirectory } from "./fixtures/TongTestDirectory.mjs";

const fixture = await createTongTestDirectory("tong-trusted-approval-timeout-");
const projectRoot = join(fixture.path, "authorized-project");
await mkdir(projectRoot);
const access = {
  async authorize(action, projectId) { return action === "agent.execute" && projectId === "approval-test"; },
  async listProjects() { return [{
    id: "approval-test", root: projectRoot, status: "enabled", available: true,
    effectiveCapabilities: ["project.metadata", "project.read", "project.write", "agent.execute"],
  }]; },
};
let grantApproval;
const approved = new Promise(resolve => { grantApproval = resolve; });
let startedExecution = false;
const broker = {
  async preflight() { return { mode: "trusted-windows", authorization: { mode: "local-task-confirmation" } }; },
  async runTask(_task, { signal, onState, onSessionId }) {
    await onState("waiting_user_action");
    await approved;
    signal.throwIfAborted();
    await onState("running");
    startedExecution = true;
    await onSessionId("native-test-thread");
    await delay(90);
    signal.throwIfAborted();
    return { turnStatus: "completed", turnId: "native-test-turn", summary: "completed after approval" };
  },
};
const manager = new TongAgentTaskManager({
  access, workerBroker: broker, statePath: join(fixture.path, "tasks.json"),
  maxTaskRuntimeMs: 5_000, collectResult: async () => ({ changedFiles: [] }),
});
async function waitFor(id, status) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const task = await manager.status(id);
    if (task.status === status) return task;
    await delay(10);
  }
  throw Error("Expected " + status);
}
let passed = false;
try {
  const created = await manager.start({
    projectId: "approval-test", agent: "codex", task: "no-op",
    scope: "empty authorized project", idempotencyKey: "approval-timeout-smoke-001",
    timeoutSeconds: 1, sessionMode: "new",
  });
  const waiting = await waitFor(created.taskId, "waiting_user_action");
  assert.equal(waiting.startedAt, null, "approval waiting time is not execution runtime");
  assert.equal(waiting.pendingApproval, true);
  await delay(1250); // Longer than the task execution limit, without granting approval.
  const stillWaiting = await manager.status(created.taskId);
  assert.equal(stillWaiting.status, "waiting_user_action", "pending human approval must not trigger execution timeout");
  assert.equal(stillWaiting.startedAt, null);
  assert.equal(startedExecution, false);
  grantApproval();
  const completed = await waitFor(created.taskId, "success");
  assert.equal(completed.error, null);
  assert.equal(completed.codexSessionId, "native-test-thread");
  assert.equal(completed.codexTurnId, "native-test-turn");
  assert.ok(completed.startedAt);
  assert.ok(completed.runtimeMs < 1000, "runtime must exclude time spent waiting for human approval");
  passed = true;
  console.log("PASS: human approval wait does not consume execution timeout; same native task completes after approval.");
} finally {
  grantApproval();
  await manager.close();
  await fixture.finish(passed);
}
