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
  async authorize(capability, projectId) { return ["agent.execute", "project.read"].includes(capability) && projectId === "synthetic"; },
  async listProjects() { return [{ id: "synthetic", root: projectRoot, status: "enabled", available: true }]; },
};
const policy = new TongTrustedPolicy({ policyPath: join(root, "trusted.json"), taskStatePath: statePath });
const calls = [];
let releaseSelection;
let enteredSelection;
const selectionEntered = new Promise((done) => { enteredSelection = done; });
const selectionGate = new Promise((done) => { releaseSelection = done; });
const trusted = new TongTrustedCodexBroker({ access, policy, pollMs: 5, adapterFactory: () => ({
  async runTask(spec, { onSessionId, onLog }) {
    calls.push(spec);
    const threadId = spec.threadId ?? `thread-${calls.length}`;
    await onSessionId(threadId);
    onLog("synthetic run");
    return { threadId, turnId: `turn-${calls.length}`, turnStatus: spec.task === "resume" && !spec.threadId ? "interrupted" : "completed",
      summary: "synthetic result", tests: [{ command: "node --test", status: "passed" }] };
  },
  async listSessions() { return { sessions: [{ id: "desktop-thread", usable: true }], nextCursor: null }; },
  async selectSession({ sessionMode, codexSessionId, searchTerm }) {
    if (searchTerm === "hold") { enteredSelection(); await selectionGate; }
    return sessionMode === "existing" ? codexSessionId : "desktop-thread";
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
  idempotencyKey: "trusted-request-0001", timeoutSeconds: 2, sessionMode: "new" };
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
  const slowSelection = manager.start({...request,sessionMode:"latest",sessionSearch:"hold",idempotencyKey:"trusted-slow-selection"});
  await selectionEntered;
  try {
    await Promise.race([manager.status(created.taskId),new Promise((_,reject)=>setTimeout(()=>reject(new Error("metadata blocked status")),100))]);
  } finally { releaseSelection(); }
  const slow = await slowSelection;
  await manager.cancel(slow.taskId);
  await waitFor(slow.taskId,"cancelled");

  const native = await manager.start({ ...request, sessionMode: "latest", idempotencyKey: "trusted-native-latest-1" });
  assert.equal(native.codexSessionId, "desktop-thread", "the selected session must be fixed before local approval");
  await waitFor(native.taskId, "waiting_user_action");
  assert.equal(calls.length, 1, "native selection cannot execute before local approval");
  assert.equal((await manager.sessions({projectId:"synthetic"})).sessions[0].id, "desktop-thread");
  await assert.rejects(manager.sessions({projectId:"ungranted"}),/authorized/);
  await assert.rejects(manager.sessions({projectId:"synthetic",cursor:Buffer.from(JSON.stringify({
    projectId:"other",cursor:"server-cursor",searchTerm:null})).toString("base64url")}),/query/);
  await policy.approveTask(native.taskId);
  assert.equal((await waitFor(native.taskId, "success")).codexSessionId, "desktop-thread");
  assert.equal((await manager.result(native.taskId)).codexTurnId, "turn-2");
  const existing = await manager.start({ ...request, sessionMode: "existing", codexSessionId: "desktop-thread",
    task: "second message", idempotencyKey: "trusted-native-existing-2" });
  await waitFor(existing.taskId, "waiting_user_action");
  assert.equal((await manager.result(existing.taskId)).agentSummary, null);
  await policy.approveTask(existing.taskId);
  assert.equal((await waitFor(existing.taskId, "success")).codexSessionId, "desktop-thread");
  await assert.rejects(manager.start({...request,sessionMode:"existing"}),/session/i);
  await assert.rejects(manager.start({...request,codexSessionId:"arbitrary"}),/session/i);
  await assert.rejects(manager.start({...request,sessionMode:"new",sessionSearch:"Test"}),/session/i);
  await manager.resume(native.taskId, {message:"Third message in the same session"});
  await assert.rejects(manager.resume(native.taskId,{message:"duplicate continuation"}),/resumable/);
  await waitFor(native.taskId,"waiting_user_action");
  assert.equal((await manager.result(native.taskId)).agentSummary,null,"a queued continuation must not expose the previous result as current");
  await policy.approveTask(native.taskId);
  await waitFor(native.taskId,"success");
  assert.equal(calls.at(-1).threadId,"desktop-thread");

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
  assert.equal((await waitFor(interrupted.taskId, "success")).codexSessionId, "thread-5");
  assert.equal(calls.at(-1).threadId, "thread-5");

  const timed = await manager.start({ ...request, idempotencyKey: "trusted-request-timeout", timeoutSeconds: 1 });
  assert.match((await waitFor(timed.taskId, "failed")).error.message, /timed out/i);
  assert.equal(calls.length, 6, "approval timeout must not launch Codex");

  const cancelled = await manager.start({ ...request, idempotencyKey: "trusted-request-0003" });
  await waitFor(cancelled.taskId, "waiting_user_action");
  await manager.cancel(cancelled.taskId);
  await waitFor(cancelled.taskId, "cancelled");
  assert.equal(calls.length, 6);
  console.log("PASS: trusted task create, idempotency, local approval, logs, result, resume, and cancel.");
} finally {
  releaseSelection();
  await manager.close();
  await trusted.close();
  await rm(root, { recursive: true, force: true });
}
