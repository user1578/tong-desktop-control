import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TongAgentDockClient } from "../scripts/TongAgentDockClient.mjs";
import { TongAgentDockRouter, registerAgentDockTools } from "../scripts/TongAgentDockTools.mjs";
import { validateAllowedToolCall } from "../scripts/TongMcpGateway.mjs";

const root = await mkdtemp(join(tmpdir(), "tong-dock-execution-"));
const project = join(root, "project"), outside = join(root, "outside");
await mkdir(project); await mkdir(outside); await mkdir(join(project, ".git"));
const secondProject = join(root, "second-project"); await mkdir(secondProject); await writeFile(join(secondProject, "test_sample.py"), "def test_ok(): assert True\n");
await writeFile(join(project, "hello.txt"), "before\n");
await writeFile(join(outside, "canary.txt"), "OUTSIDE_CANARY\n");
const exe = join(outside, "synthetic-executable.exe"); await writeFile(exe, "SYNTHETIC_NOT_EXECUTED");
const policyPath = join(outside, "policy.json");
const executable = { path: exe, sha256: createHash("sha256").update("SYNTHETIC_NOT_EXECUTED").digest("hex") };
const approval = { approvalId: "local-approval", taskId: "task-one", projectId: "synthetic", capability: "project.write",
  operations: ["add", "replace", "patch"], paths: ["hello.txt", "new.txt", "second.txt"], expiresAt: new Date(Date.now() + 600000).toISOString() };
const commandApproval = { ...approval, approvalId: "command-approval", capability: "command.execute", operations: ["git_status", "git_diff", "pytest"], paths: [".", "hello.txt", "test_sample.py"] };
const policy = { schemaVersion: 1, projects: [{ projectId: "synthetic", root: project, scope: "synthetic", tools: ["read_file", "list_dir", "search_text"],
  commands: { git: executable, python: executable, pytestEntry: "test_sample.py", gitDiffPaths: ["hello.txt"] } }], approvals: [approval, commandApproval] };
policy.projects.push({ ...policy.projects[0], projectId: "synthetic-two", root: secondProject });
policy.approvals.push({ ...commandApproval, approvalId: "command-two", projectId: "synthetic-two" });
await writeFile(join(project, "test_sample.py"), "def test_ok(): assert True\n");
await writeFile(policyPath, JSON.stringify(policy));
let permission = "write", mode = "normal";
const access = { listProjects: async () => [{ id: "synthetic", root: project, permission, status: "enabled", available: true }, { id: "synthetic-two", root: secondProject, permission, status: "enabled", available: true }] };
let launchGate, launchEntered;
const token = "SYNTHETIC_ONLY_01234567890123456789", calls = [], audits = [], transports = new Set();
const descriptors = ["read_file", "list_dir", "search_text", "file_edit", "exec_command", "session_observe", "session_act"].map(name => ({ name, inputSchema: { type: "object", additionalProperties: true } }));
const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  if (mode === "disconnect") { res.destroy(); return; }
  const server = new Server({ name: "execution-mock", version: "1.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    calls.push({ name, args });
    if (mode === "hang") await new Promise(() => {});
    if (mode === "error") return { isError: true, content: [{ type: "text", text: "synthetic backend failure" }] };
    let data;
    if (name === "file_edit") {
      if (!args.dry_run) {
        if (args.action === "add") await writeFile(args.path, args.content);
        if (args.action === "replace") await writeFile(args.path, (await readFile(args.path, "utf8")).replace(args.old, () => args.new));
        if (args.action === "patch") { await writeFile(join(args.workdir, "hello.txt"), "patched\n"); await writeFile(join(args.workdir, "second.txt"), "second\n"); }
      }
      data = { action: args.action, dry_run: args.dry_run, changed: true, diff_preview: "synthetic preview", ...(args.action !== "patch" ? { path: args.path } : { affected_files: [{ path: "hello.txt", operation: "update" }, { path: "second.txt", operation: "add" }] }) };
      if (mode === "wrong-write" && !args.dry_run) await writeFile(args.path, "unexpected\n");
      if (mode === "escape-preview") data.affected_files = [{ path: "../outside/canary.txt", operation: "update" }];
      if (mode === "revoke" && args.dry_run) await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [] }));
    } else if (name === "exec_command") {
      if (mode === "running-delay") { launchEntered(); await launchGate; }
      data = ["running", "running-delay", "revoke-command", "revoke-cleanup", "malformed-session"].includes(mode) ? { status: "running", session_id: "backend-1", stdout: "", stderr: "" }
      : { status: mode === "timeout" ? "timeout" : "exited", exit_code: mode === "nonzero" ? 1 : 0, timed_out: mode === "timeout", stdout: "synthetic command output", stderr: "" };
      if (["revoke-command", "revoke-cleanup"].includes(mode)) await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [] }));
      if (mode === "malformed-session") delete data.stdout;
    }
    else data = { status: name === "session_act" && mode !== "revoke-cleanup" ? "killed" : "running", session_id: args.session_id, stdout: "", stderr: "" };
    return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); transports.add(transport);
  res.on("close", () => { transports.delete(transport); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
http.listen(0, "127.0.0.1"); await once(http, "listening");
const client = new TongAgentDockClient({ url: `http://127.0.0.1:${http.address().port}/mcp`, tokenProvider: () => token, controlledExecution: true, timeoutMs: 300 });
const router = new TongAgentDockRouter({ client, access, policyPath, maxOwnedSessions: 1, audit: event => audits.push(event) });
const invoke = (tool, input) => router.call(tool, ["file_edit", "command"].includes(tool) ? { idempotencyKey: randomUUID(), ...input } : input);
const base = { projectId: "synthetic", taskId: "task-one", approvalId: "local-approval" };
const cmdBase = { ...base, approvalId: "command-approval" };
const denied = code => error => { assert.equal(error.code, code); return true; };
try {
  const preview = await invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "new\n", dryRun: true });
  assert.equal(preview.dryRun, true); await assert.rejects(readFile(join(project, "new.txt")));
  const added = await invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "new\n" });
  assert.equal(added.verified, true); assert.equal(await readFile(join(project, "new.txt"), "utf8"), "new\n");
  await invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "before", new: "after" });
  assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "after\n");
  const patch = "*** Begin Patch\n*** Update File: hello.txt\n@@\n-after\n+patched\n*** Add File: second.txt\n+second\n*** End Patch";
  await invoke("file_edit", { ...base, action: "patch", patch });
  assert.equal(await readFile(join(project, "second.txt"), "utf8"), "second\n");
  assert.equal(calls.find(x => x.args.action === "patch").args.workdir, project);
  await invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "patched", new: "$&literal" });
  assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "$&literal\n");
  await invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "$&literal", new: "patched" });
  let before = calls.length;
  for (const input of [
    { ...base, projectId: "missing", action: "add", path: "new.txt", content: "x" },
    { ...base, approvalId: "missing", action: "add", path: "new.txt", content: "x" },
    { ...base, taskId: "other-task", action: "replace", path: "hello.txt", old: "x", new: "y" },
    { ...base, action: "add", path: "new.txt", content: "overwrite" },
    { ...base, action: "add", path: "../outside/canary.txt", content: "escape" },
    { ...base, action: "patch", patch: patch.replace("second.txt", "../outside/canary.txt") },
    { ...base, action: "patch", patch: patch.replace("second.txt", join(outside, "canary.txt")) },
    { ...base, action: "patch", patch: patch.replace("@@", "*** Move to: ../outside/moved.txt\n@@") },
    { ...base, action: "patch", patch: "diff --git a/x b/x\n" },
  ]) await assert.rejects(invoke("file_edit", input));
  assert.equal(calls.length, before, "all unsafe writes rejected before MCP");
  await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [{ ...approval, expiresAt: "2000-01-01T00:00:00Z" }, commandApproval] }));
  await assert.rejects(invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "x" }), denied("APPROVAL_DENIED"));
  await writeFile(policyPath, JSON.stringify(policy));
  await assert.rejects(invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "overwrite", overwrite: true }), denied("APPROVAL_DENIED"));
  await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [{ ...approval, allowOverwrite: true }, commandApproval] }));
  await invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "explicit overwrite\n", overwrite: true });
  assert.equal(await readFile(join(project, "new.txt"), "utf8"), "explicit overwrite\n");
  // Put linked paths in the approval to prove path checks themselves reject them.
  await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [{ ...approval, paths: [...approval.paths, "redirect/escape.txt", "hard.txt"] }, commandApproval] }));
  permission = "read"; await assert.rejects(invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "patched", new: "x" }), denied("APPROVAL_DENIED")); permission = "write";
  await symlink(outside, join(project, "redirect"), "junction");
  await assert.rejects(invoke("file_edit", { ...base, action: "add", path: "redirect/escape.txt", content: "x" })); await rm(join(project, "redirect"));
  await link(join(outside, "canary.txt"), join(project, "hard.txt"));
  await assert.rejects(invoke("file_edit", { ...base, action: "replace", path: "hard.txt", old: "x", new: "y" })); await rm(join(project, "hard.txt"));
  await writeFile(policyPath, JSON.stringify(policy));
  assert.equal(await readFile(join(outside, "canary.txt"), "utf8"), "OUTSIDE_CANARY\n");
  await link(join(outside, "canary.txt"), join(project, "escape-command.txt"));
  await assert.rejects(invoke("command", { ...cmdBase, operation: "git_diff" }), denied("ACCESS_DENIED"));
  await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest" }), denied("ACCESS_DENIED"));
  await rm(join(project, "escape-command.txt"));
  await writeFile(join(project, ".git", "config"), '[include]\n path = ../../outside/canary.txt\n');
  await assert.rejects(invoke("command", { ...cmdBase, operation: "git_status" }), denied("ACCESS_DENIED"));
  await rm(join(project, ".git", "config"));
  const status = await invoke("command", { ...cmdBase, operation: "git_status" }); assert.equal(status.exitCode, 0); assert.equal(status.commandOk, true);
  await invoke("command", { ...cmdBase, operation: "git_diff" });
  await invoke("command", { ...cmdBase, operation: "pytest" });
  before = calls.length;
  await assert.rejects(invoke("command", { ...base, operation: "git_status" }), denied("APPROVAL_DENIED"));
  await assert.rejects(invoke("command", { ...cmdBase, operation: "shell", cmd: "whoami" }), denied("INVALID_ARGUMENT"));
  await assert.rejects(invoke("exec_command", { ...cmdBase, cmd: "whoami" }), denied("TOOL_DENIED"));
  await assert.rejects(invoke("session_status", { ...cmdBase, sessionId: "backend-1" }), denied("SESSION_DENIED"));
  assert.equal(calls.length, before);
  const badHash = { ...policy, projects: [{ ...policy.projects[0], commands: { ...policy.projects[0].commands, git: { ...executable, sha256: "0".repeat(64) } } }] };
  await writeFile(policyPath, JSON.stringify(badHash)); await assert.rejects(invoke("command", { ...cmdBase, operation: "git_status" }), denied("EXECUTABLE_DENIED"));
  await writeFile(policyPath, JSON.stringify(policy));
  const execArgs = calls.find(x => x.name === "exec_command").args;
  assert.equal(execArgs.workdir, project); assert.ok(execArgs.timeout_ms > 0 && execArgs.max_output_bytes <= 65536); assert.ok(!execArgs.cmd.includes("whoami"));
  const pytestArgs = calls.find(x => x.name === "exec_command" && x.args.cmd.includes("pytest")).args;
  assert.ok(pytestArgs.cmd.includes("--noconftest") && pytestArgs.cmd.includes("-c NUL") && pytestArgs.cmd.includes("-o addopts="));
  assert.ok(calls.find(x => x.name === "exec_command" && x.args.cmd.includes("diff --")).args.cmd.includes(":(literal)hello.txt"));
  mode = "nonzero"; assert.equal((await invoke("command", { ...cmdBase, operation: "pytest" })).commandOk, false);
  mode = "timeout"; assert.equal((await invoke("command", { ...cmdBase, operation: "pytest", timeoutMs: 100 })).status, "timeout");
  mode = "running"; const running = await invoke("command", { ...cmdBase, operation: "pytest", async: true }); assert.notEqual(running.sessionId, "backend-1");
  before = calls.length;
  await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest", async: true }), denied("SESSION_DENIED"));
  assert.equal(calls.length, before, "session capacity must reject before starting backend command");
  await assert.rejects(invoke("session_cancel", { ...cmdBase, taskId: "other-task", sessionId: running.sessionId }), denied("SESSION_DENIED"));
  assert.equal((await invoke("session_status", { ...cmdBase, sessionId: running.sessionId })).status, "running");
  await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [] }));
  await assert.rejects(invoke("session_status", { ...cmdBase, sessionId: running.sessionId }), denied("APPROVAL_DENIED"));
  assert.equal((await invoke("session_cancel", { ...cmdBase, sessionId: running.sessionId })).status, "killed");
  await writeFile(policyPath, JSON.stringify(policy));
  mode = "revoke-command"; before = calls.filter(x => x.name === "session_act").length;
  await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest", async: true }), denied("APPROVAL_DENIED"));
  assert.equal(calls.filter(x => x.name === "session_act").length, before + 1, "post-launch revocation cancels the started process");
  await writeFile(policyPath, JSON.stringify(policy));
  mode = "malformed-session"; before = calls.filter(x => x.name === "session_act").length;
  await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest", async: true }), denied("INVALID_RESULT"));
  assert.equal(calls.filter(x => x.name === "session_act").length, before + 1);
  mode = "revoke-cleanup";
  let cleanupError;
  await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest", async: true }), error => { cleanupError = error; return error.code === "APPROVAL_DENIED"; });
  assert.ok(cleanupError.sessionId && cleanupError.effect === "unknown", "failed cleanup retains a cancel handle and uncertain effect");
  await writeFile(policyPath, JSON.stringify(policy)); mode = "normal";
  assert.equal((await invoke("session_cancel", { ...cmdBase, sessionId: cleanupError.sessionId })).status, "killed");
  mode = "running-delay";
  client.timeoutMs = 5000; // Keep the launch in-flight; this case tests capacity, not transport timeout.
  let releaseLaunch; launchGate = new Promise(resolve => { releaseLaunch = resolve; });
  const entered = new Promise(resolve => { launchEntered = resolve; });
  before = calls.filter(x => x.name === "exec_command").length;
  const firstLaunch = invoke("command", { ...cmdBase, operation: "pytest", async: true }); await entered;
  const secondLaunch = invoke("command", { ...cmdBase, projectId: "synthetic-two", approvalId: "command-two", operation: "pytest", async: true });
  const releaseTimer = setTimeout(releaseLaunch, 3000);
  const concurrent = await Promise.allSettled([firstLaunch, secondLaunch]); clearTimeout(releaseTimer); releaseLaunch();
  assert.equal(concurrent.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(calls.filter(x => x.name === "exec_command").length, before + 1, "launch reservation applies across projects");
  mode = "normal";
  await invoke("session_cancel", { ...cmdBase, sessionId: concurrent[0].value.sessionId });
  client.timeoutMs = 300;
  mode = "escape-preview"; await assert.rejects(invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "patched", new: "x" }), denied("INVALID_RESULT"));
  assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "patched\n");
  mode = "revoke"; await assert.rejects(invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "patched", new: "revoked" }), denied("APPROVAL_DENIED"));
  assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "patched\n"); await writeFile(policyPath, JSON.stringify(policy));
  mode = "wrong-write"; await assert.rejects(invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "patched", new: "wanted" }), denied("VERIFY_FAILED"));
  mode = "error"; await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest" }), denied("TOOL_FAILED"));
  mode = "normal";
  const auditFailure = new TongAgentDockRouter({ client, access, policyPath, audit: () => { throw new Error("synthetic unavailable audit"); } });
  before = calls.length;
  await assert.rejects(auditFailure.call("command", { idempotencyKey: randomUUID(), ...cmdBase, operation: "pytest" }), denied("AUDIT_UNAVAILABLE"));
  await assert.rejects(auditFailure.call("file_edit", { ...base, action: "add", path: "second.txt", content: "x", dryRun: true }));
  assert.equal(calls.length, before);
  const expiryRouter = new TongAgentDockRouter({ client, access, policyPath, audit: async event => {
    if (event.phase === "commit" || event.tool === "command" && event.phase === "started") await writeFile(policyPath, JSON.stringify({ ...policy, approvals: policy.approvals.map(entry => ({ ...entry, expiresAt: "2000-01-01T00:00:00Z" })) }));
  } });
  mode = "normal"; before = calls.filter(x => x.name === "exec_command").length;
  await assert.rejects(expiryRouter.call("command", { idempotencyKey: randomUUID(), ...cmdBase, operation: "pytest" }), denied("APPROVAL_DENIED"));
  assert.equal(calls.filter(x => x.name === "exec_command").length, before);
  await writeFile(policyPath, JSON.stringify(policy));
  before = calls.filter(x => x.name === "file_edit" && !x.args.dry_run).length;
  await assert.rejects(expiryRouter.call("file_edit", { idempotencyKey: randomUUID(), ...base, action: "add", path: "new.txt", content: "expire", overwrite: true }));
  // Use an approved replacement so denial occurs after preview, at the commit audit boundary.
  await assert.rejects(expiryRouter.call("file_edit", { idempotencyKey: randomUUID(), ...base, action: "replace", path: "hello.txt", old: "unexpected", new: "expire" }), denied("APPROVAL_DENIED"));
  assert.equal(calls.filter(x => x.name === "file_edit" && !x.args.dry_run).length, before);
  assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "unexpected\n");
  await writeFile(policyPath, JSON.stringify(policy));
  mode = "hang"; await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest", timeoutMs: 100 }), denied("TIMEOUT"));
  mode = "disconnect"; await assert.rejects(invoke("command", { ...cmdBase, operation: "pytest" }), denied("UNAVAILABLE")); mode = "normal";
  const registrations = []; registerAgentDockTools({}, (_s, name, definition) => registrations.push({ name, definition }), await import("zod/v4"), router);
  for (const name of ["tong_agentdock_file_edit", "tong_agentdock_command", "tong_agentdock_session_status", "tong_agentdock_session_cancel"]) assert.ok(registrations.some(x => x.name === name));
  assert.equal(await validateAllowedToolCall({ params: { name: "tong_agentdock_command", arguments: { ...cmdBase, idempotencyKey: randomUUID(), operation: "pytest" } } }), null);
  assert.ok(await validateAllowedToolCall({ params: { name: "tong_agentdock_command", arguments: { ...cmdBase, operation: "pytest", cmd: "whoami" } } }));
  assert.ok(audits.some(x => x.approvalId === "local-approval" && x.phase === "started"));
  assert.ok(!JSON.stringify(audits).includes(token) && !JSON.stringify(audits).includes("OUTSIDE_CANARY") && !JSON.stringify(audits).includes("synthetic command output"));
  console.log("PASS: controlled writes, all patch paths, separate task approvals, fixed commands, result verification, sessions, audit and failure classification.");
} finally {
  await router.close(); await Promise.allSettled([...transports].map(t => t.close())); http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  assert.ok(root.startsWith(join(tmpdir(), "tong-dock-execution-"))); await rm(root, { recursive: true, force: true });
}
