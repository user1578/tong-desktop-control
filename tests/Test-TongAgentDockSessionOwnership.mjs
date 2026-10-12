import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { TongAgentDockClient } from "../scripts/TongAgentDockClient.mjs";
import { TongAgentDockRouter, registerAgentDockTools } from "../scripts/TongAgentDockTools.mjs";
import { closeTongMcpTools } from "../scripts/TongMcpTools.mjs";

// Catches private-Router ownership, trusting caller metadata, consuming completed
// output twice, reconnecting an owned backend ID, or transport-close cancellation.
const root = await mkdtemp(join(tmpdir(), "tong-session-ownership-"));
const project = join(root, "project"), otherProject = join(root, "other-project"), state = join(root, "state");
await mkdir(project); await mkdir(otherProject); await mkdir(state);
await writeFile(join(project, "test_ok.py"), "def test_ok(): assert True\n");
const exe = join(state, "synthetic.exe"); await writeFile(exe, "synthetic");
const policyPath = join(state, "policy.json");
const approval = { projectId: "synthetic", taskId: "task-one", approvalId: "local-command", capability: "command.execute", operations: ["pytest"], paths: ["test_ok.py"], expiresAt: new Date(Date.now() + 600000).toISOString() };
const grant = { projectId: "synthetic", root: project, scope: "synthetic", tools: [], commands: {
  python: { path: exe, sha256: createHash("sha256").update("synthetic").digest("hex") }, pytestEntry: "test_ok.py",
} };
const policy = { schemaVersion: 1, projects: [grant, { ...grant, projectId: "other-project", root: otherProject }], approvals: [approval, { ...approval, projectId: "other-project", approvalId: "other-project-command" }] };
await writeFile(policyPath, JSON.stringify(policy));
const otherPolicyPath = join(state, "other-policy.json"); await writeFile(otherPolicyPath, JSON.stringify(policy));
const access = { listProjects: async () => [{ id: "synthetic", root: project, permission: "write", status: "enabled", available: true }, { id: "other-project", root: otherProject, permission: "write", status: "enabled", available: true }] };
const backend = new Map(), calls = [], transports = new Set();
let finish = false, disconnect = false, time = 0, failAudit = false, bootStamp = "2026-10-12T00:00:00.000Z";
const token = "SYNTHETIC_BACKEND_ONLY_0123456789";
const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  if (disconnect) { res.destroy(); return; }
  if (req.method === "GET" && req.url === "/internal/runtime/analytics") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, source: "agentdock-api", started_at: bootStamp })); return;
  }
  const server = new Server({ name: "consuming-session-fixture", version: "1.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ["read_file", "list_dir", "search_text", "file_edit", "exec_command", "session_observe", "session_act"].map(name => ({ name, inputSchema: { type: "object" } })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    calls.push({ name, args }); let data;
    if (name === "exec_command") {
      if (args.execution_mode === "sync") data = { status: "exited", exit_code: 0, stdout: "sync final\n", stderr: "" };
      else { const id = randomUUID(); backend.set(id, true); data = { status: "running", session_id: id, stdout: "start\n", stderr: "" }; }
    } else {
      assert.ok(backend.has(args.session_id), "completed backend record was already consumed");
      const terminal = finish || name === "session_act";
      data = { status: terminal ? "exited" : "running", session_id: args.session_id, stdout: terminal ? "final\n" : "", stderr: "", ...(terminal ? { exit_code: name === "session_act" ? 1 : 0 } : {}) };
      if (terminal) backend.delete(args.session_id);
    }
    return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  transports.add(transport); res.on("close", () => { transports.delete(transport); void server.close(); });
  await server.connect(transport); await transport.handleRequest(req, res);
});
http.listen(0, "127.0.0.1"); await once(http, "listening");
const clients = [], routers = [];
function route(path = policyPath) {
  const client = new TongAgentDockClient({ url: `http://127.0.0.1:${http.address().port}/mcp`, tokenProvider: () => token, controlledExecution: true }); clients.push(client);
  const router = new TongAgentDockRouter({ client, access, policyPath: path, now: () => time, audit: event => { if (failAudit && event.phase === "finished") throw new Error("synthetic lost audit"); } }); routers.push(router);
  const handlers = new Map(); registerAgentDockTools({}, (_server, name, _definition, handler) => handlers.set(name, handler), z, router);
  return (tool, input, authInfo = auth) => handlers.get(`tong_agentdock_${tool}`)(input, { authInfo, _meta: { clientId: "owner-client", identity: "forged" } });
}
const auth = { clientId: "owner-client", resource: new URL("http://127.0.0.1/synthetic-mcp"), expiresAt: Math.floor(Date.now() / 1000) + 600, scopes: ["devspace"] };
const base = { projectId: "synthetic", taskId: "task-one", approvalId: "local-command" };
const command = async (call, extra = {}) => (await call("command", { ...base, idempotencyKey: randomUUID(), operation: "pytest", async: true, ...extra })).structuredContent;
try {
  const first = route(), second = route();
  const started = await command(first); assert.equal(started.status, "running", JSON.stringify(started));
  const input = { ...base, sessionId: started.sessionId };
  assert.equal((await first("session_status", input)).structuredContent.status, "running");
  assert.equal((await second("session_status", input)).structuredContent.status, "running", "same verified identity across Routers must resolve its session");
  for (const other of [{ ...auth, clientId: "other-client" }, { ...auth, resource: new URL("http://127.0.0.1/other") }, { ...auth, expiresAt: 1 }, undefined]) {
    const denied = await second("session_status", input, other === undefined ? null : other);
    assert.equal(denied.isError, true); assert.ok(["SESSION_DENIED", "AUTH_FAILED"].includes(denied.structuredContent.code));
  }
  for (const changed of [{ taskId: "task-other" }, { approvalId: "approval-other" }]) assert.equal((await second("session_status", { ...input, ...changed })).structuredContent.code, "SESSION_DENIED");
  assert.equal((await second("session_status", { ...input, projectId: "other-project", approvalId: "other-project-command" })).structuredContent.code, "SESSION_DENIED", "another registered and approved project cannot observe this session");
  assert.equal((await route(otherPolicyPath)("session_status", input)).structuredContent.code, "SESSION_DENIED", "an equivalent policy at a different local path cannot share ownership");
  await routers[0].close();
  assert.equal((await second("session_status", input)).structuredContent.status, "running", "closing one Router must preserve the owned backend connection");
  finish = true; failAudit = true;
  assert.equal((await second("session_status", input)).structuredContent.code, "AUDIT_UNAVAILABLE");
  failAudit = false;
  const completed = (await second("session_status", input)).structuredContent;
  assert.equal(completed.exitCode, 0); assert.equal(completed.commandOk, true); assert.equal(completed.stdout, "start\nfinal\n");
  assert.deepEqual((await second("session_status", input)).structuredContent, completed, "repeat completion query must use bounded retained output");
  await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [] }));
  assert.equal((await second("session_status", input)).structuredContent.code, "APPROVAL_DENIED");
  await writeFile(policyPath, JSON.stringify(policy));
  time += 300001;
  assert.equal((await second("session_status", input)).structuredContent.code, "SESSION_DENIED");
  const sync = await command(second, { async: false }); assert.equal(sync.status, "exited"); assert.equal(sync.exitCode, 0);
  finish = false;
  const active = await command(second); disconnect = true;
  assert.equal((await second("session_status", { ...base, sessionId: active.sessionId })).structuredContent.code, "UNAVAILABLE");
  disconnect = false;
  const count = calls.length;
  assert.equal((await second("session_status", { ...base, sessionId: active.sessionId })).structuredContent.code, "SESSION_DENIED");
  assert.equal(calls.length, count, "disconnected owner must not reconnect to observe an old backend ID");
  const beforeRestart = await command(second); finish = true;
  const restartInput = { ...base, sessionId: beforeRestart.sessionId };
  assert.equal((await second("session_status", restartInput)).structuredContent.exitCode, 0);
  bootStamp = "2026-10-12T00:01:00.000Z";
  assert.equal((await second("session_status", restartInput)).structuredContent.code, "SESSION_DENIED", "cached results must fail closed when the backend runtime changes");
  bootStamp = "2026-10-12T00:00:00.000Z";
  assert.equal((await second("session_status", restartInput)).structuredContent.code, "SESSION_DENIED", "a changed instance must not revive an old record");
  for (let index = 0; index < 100; index++) {
    const value = (await second("file_edit", base, { ...auth, clientId: `bounded-owner-${index}` })).structuredContent;
    assert.equal(value.code, "INVALID_ARGUMENT", "malformed calls must not allocate execution scopes");
  }
  const freshOwner = { ...auth, clientId: "valid-after-malformed" };
  assert.equal((await second("command", { ...base, operation: "pytest", async: false, idempotencyKey: randomUUID() }, freshOwner)).structuredContent.exitCode, 0,
    "malformed calls must not exhaust authenticated scope capacity; active capacity is tested separately");
  console.log("PASS: authenticated cross-Router ownership, no metadata authority, Router detach, sync final result, consuming backend cache, repeat/expiry/revocation, audit loss and disconnect fail closed.");
} finally {
  failAudit = false; disconnect = false;
  await Promise.allSettled(routers.map(router => router.close())); await closeTongMcpTools();
  await Promise.allSettled(clients.map(client => client.close()));
  await Promise.allSettled([...transports].map(transport => transport.close())); http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\tong-session-ownership-") || resolve(root).startsWith(resolve(tmpdir()) + "/tong-session-ownership-"));
  await rm(root, { recursive: true, force: true });
}
