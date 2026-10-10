import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TongAgentDockRouter } from "../scripts/TongAgentDockTools.mjs";
import { checkedAgentDockPath } from "../scripts/TongAgentDockPaths.mjs";
const root = await mkdtemp(join(tmpdir(), "tong-dock-lifecycle-")), project = join(root, "project"), state = join(root, "state");
await mkdir(project); await mkdir(state); await writeFile(join(project, "test_ok.py"), "def test_ok(): assert True\n");
const exe = join(state, "synthetic.exe"); await writeFile(exe, "synthetic"); const policyPath = join(state, "policy.json");
await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, projects: [{ projectId: "synthetic", root: project, scope: "synthetic", tools: [], commands: { python: { path: exe, sha256: createHash("sha256").update("synthetic").digest("hex") }, pytestEntry: "test_ok.py" } }],
  approvals: [{ approvalId: "local-command", taskId: "one-task", projectId: "synthetic", capability: "command.execute", operations: ["pytest"], paths: ["test_ok.py"], expiresAt: new Date(Date.now() + 600000).toISOString() }] }));
const access = { listProjects: async () => [{ id: "synthetic", root: project, status: "enabled", available: true, permission: "read" }] };
let time = 100, gate, entered; const calls = [];
function makeClient() { return { generation: 1, connect: async () => {}, close: async () => { calls.push("close"); }, callTool: async (name) => {
  calls.push(name); if (name === "exec_command" && gate) { entered(); await gate; }
  return { structuredContent: { status: name === "session_act" ? "killed" : "running", session_id: "backend-test", stdout: "", stderr: "" } };
} }; }
const firstClient = makeClient(), secondClient = makeClient();
const first = new TongAgentDockRouter({ client: firstClient, access, policyPath, now: () => time, maxOwnedSessions: 1, audit: () => {} });
const second = new TongAgentDockRouter({ client: secondClient, access, policyPath, now: () => time, maxOwnedSessions: 1, audit: () => {} });
const base = { projectId: "synthetic", taskId: "one-task", approvalId: "local-command" };
const command = router => router.call("command", { ...base, idempotencyKey: randomUUID(), operation: "pytest", timeoutMs: 100, async: true });
try {
  const executableCheck = await checkedAgentDockPath(state, "synthetic.exe");
  await writeFile(join(state, "sibling.json"), "{}");
  await executableCheck.recheck({ ignoreDirectoryTimes: true });
  await writeFile(exe, "changed-executable");
  await assert.rejects(executableCheck.recheck({ ignoreDirectoryTimes: true }), error => error.code === "ACCESS_DENIED");
  await writeFile(exe, "synthetic");
  const started = await command(first);
  await assert.rejects(command(second), error => error.code === "SESSION_DENIED");
  await assert.rejects(second.call("session_cancel", { ...base, sessionId: started.sessionId }), error => error.code === "SESSION_DENIED");
  firstClient.generation++;
  await assert.rejects(first.call("session_cancel", { ...base, sessionId: started.sessionId }), error => error.code === "SESSION_DENIED");
  assert.equal(calls.includes("session_act"), false, "old backend ID must not be killed in a new connection generation");
  time += 5101;
  const fresh = await command(second); await second.call("session_cancel", { ...base, sessionId: fresh.sessionId });
  assert.equal(calls.filter(name => name === "exec_command").length, 2, "expired unknown sessions no longer permanently occupy capacity");
  let release; gate = new Promise(resolve => { release = resolve; }); const reached = new Promise(resolve => { entered = resolve; });
  const inflight = command(first); await reached;
  let closed = false; const close = first.close().then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(closed, false);
  release(); await inflight; await close;
  assert.equal(calls.at(-2), "session_act"); assert.equal(calls.at(-1), "close");
  console.log("PASS: capacity spans Routers, stale sessions expire without unsafe kill, shutdown awaits in-flight launch and owned cancellation.");
} finally { await first.close(); await second.close(); assert.ok(root.startsWith(join(tmpdir(), "tong-dock-lifecycle-"))); await rm(root, { recursive: true, force: true }); }
