import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TongAgentTaskManager } from "../scripts/TongAgentTasks.mjs";

const root = await mkdtemp(join(tmpdir(), "tong-desktop-visibility-"));
const projectRoot = join(root, "project");
await mkdir(projectRoot);
const ids = [
  "01a15947-8cc6-7353-93a9-5daa57f83706",
  "01a15948-8cc6-7353-93a9-5daa57f83707",
];
const opened = [];
let next = 0;
let failToOpen = false;
const manager = new TongAgentTaskManager({
  statePath: join(root, "state.json"),
  access: {
    authorize: async (capability, projectId) => capability === "agent.execute" && projectId === "travelguard",
    listProjects: async () => [{ id: "travelguard", root: projectRoot, status: "enabled", available: true }],
  },
  workerBroker: {
    preflight: async () => ({
      mode: "trusted-windows",
      authorization: { mode: "project-development", capabilities: ["codex.session"] },
    }),
    selectSession: async ({ codexSessionId }) => codexSessionId,
    runTask: async (spec, { onSessionId, onLog }) => {
      const threadId = spec.threadId ?? ids[next++];
      await onSessionId(threadId);
      await onLog("正在检查 SQLite 状态", "agent");
      await onLog(JSON.stringify({type:"commandExecution",event:"started"}), "progress_event");
      return { threadId, turnId: "turn-synthetic", turnStatus: "completed", summary: "Read-only synthetic test." };
    },
    close: async () => {},
  },
  openDesktopThread: async (threadId) => {
    opened.push(threadId);
    if (failToOpen) throw new Error("No interactive Desktop handler");
    return true;
  },
  collectResult: async () => ({ changedFiles: [], diffSummary: "", gitAvailable: true }),
});

async function until(callback, maxMs = 5000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for test state");
}
async function run(mode, key, sessionId) {
  const started = await manager.start({
    projectId: "travelguard", agent: "codex", task: "synthetic read only", scope: "no changes",
    idempotencyKey: key, sessionMode: mode,
    ...(sessionId ? { codexSessionId: sessionId } : {}),
  });
  return until(async () => {
    const status = await manager.status(started.taskId);
    return status.status === "success" ? status : null;
  });
}

try {
  const fresh = await run("new", "desktop-opening-test-new-001");
  await until(() => opened.length === 1);
  assert.equal(fresh.codexSessionId, ids[0]);
  assert.equal(fresh.progress.phase, "success");
  assert.match(fresh.progress.message, /SQLite/);
  assert.deepEqual({kind:fresh.progress.activity.kind,state:fresh.progress.activity.state},
    {kind:"commandExecution",state:"started"});
  assert.deepEqual(opened, [ids[0]], "new trusted session must open in Desktop");

  const continued = await run("existing", "desktop-opening-test-existing-002", ids[0]);
  assert.equal(continued.codexSessionId, ids[0]);
  assert.deepEqual(opened, [ids[0]], "existing session must not steal Desktop focus");

  failToOpen = true;
  const failedOpen = await run("new", "desktop-opening-test-fallback-003");
  await until(() => opened.length === 2);
  assert.equal(failedOpen.codexSessionId, ids[1]);
  assert.equal((await manager.status(failedOpen.taskId)).status, "success",
    "a failed UI dispatch must not fail the Codex turn");
  await until(async () => (await manager.logs({ taskId: failedOpen.taskId, limit: 100 })).entries
    .some((entry) => entry.kind === "desktop" && entry.message.includes("auto-open unavailable")));
  console.log("Trusted Codex desktop auto-open manager tests passed.");
} finally {
  await manager.close();
  await rm(root, { recursive: true, force: true });
}
