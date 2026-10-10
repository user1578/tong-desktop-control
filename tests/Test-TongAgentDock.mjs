import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import { TongAgentDockClient } from "../scripts/TongAgentDockClient.mjs";
import { TongAgentDockRouter, registerAgentDockTools } from "../scripts/TongAgentDockTools.mjs";
import { validateAllowedToolCall, findDisallowedToolCall } from "../scripts/TongMcpGateway.mjs";

const root = await mkdtemp(join(process.env.TEMP ?? tmpdir(), "tong-agentdock-"));
const project = join(root, "project");
const outside = join(root, "outside");
await mkdir(project); await mkdir(outside);
await writeFile(join(project, "hello.txt"), "synthetic hello");
await writeFile(join(outside, "secret.txt"), "OUTSIDE_CANARY");
const policyPath = join(root, "grants.json");
const grants = { schemaVersion: 1, projects: [{ projectId: "synthetic", root: project, scope: "synthetic",
  tools: ["list_dir", "read_file", "search_text"] }] };
await writeFile(policyPath, JSON.stringify(grants));
let registeredRoot = project;
const access = { async listProjects() { return [{ id: "synthetic", root: registeredRoot, permission: "read", status: "enabled", available: true }]; } };
const token = "SYNTHETIC_AUTH_ONLY_0123456789";
let acceptedToken = token;
let mode = "normal";
const calls = [];
const transports = new Set();
const tools = ["read_file", "list_dir", "search_text"].map((name) => ({ name,
  inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: {
    path: { type: "string" }, query: { type: "string" }, runtime: { enum: ["windows"] },
    max_bytes: { type: "integer" }, start_line: { type: "integer" }, end_line: { type: "integer" },
    max_depth: { type: "integer" }, max_entries: { type: "integer" }, include_hidden: { type: "boolean" },
    include_ignored: { type: "boolean" }, exclude_patterns: { type: "array", items: { type: "string" } },
    exclude_globs: { type: "array", items: { type: "string" } }, regex: { type: "boolean" },
    case_sensitive: { type: "boolean" }, max_results: { type: "integer" }, context_lines: { type: "integer" },
  } },
}));
const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${acceptedToken}`) { res.writeHead(401); res.end("unauthorized " + acceptedToken); return; }
  if (mode === "disconnect") { res.destroy(); return; }
  const server = new Server({ name: "agentdock-mock", version: "1.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mode === "bad-schema"
    ? [{ name: "read_file", inputSchema: { type: "string" } }] : tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    calls.push(params);
    if (mode === "hang") await new Promise(() => {});
    if (mode === "tool-error") return { isError: true, structuredContent: { error: token }, content: [{ type: "text", text: token }] };
    if (mode === "mutate") await writeFile(join(project, "hello.txt"), "changed while AgentDock read was in flight");
    if (mode === "revoke") await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, projects: [] }));
    if (mode === "change-root") { registeredRoot = outside; await writeFile(policyPath, JSON.stringify({ ...grants, projects: [{ ...grants.projects[0], root: outside }] })); }
    let data;
    if (params.name === "read_file") data = { path: params.arguments.path, content: mode === "large" ? "x".repeat(300_000) : mode === "leak-token" ? acceptedToken : "synthetic hello", encoding: "utf-8", start_line: 1, end_line: 1, total_lines: 1, truncated: false };
    if (params.name === "list_dir") data = { path: params.arguments.path, entries: [{ name: "hello.txt", path: mode === "escape-result" ? "../outside/secret.txt" : "hello.txt", type: "file", size_bytes: 15 }], truncated: false, partial: false, skipped_paths: [] };
    if (params.name === "search_text") data = { matches: [{ path: join(project, "hello.txt"), line: 1, column: 1, preview: "synthetic hello", match_text: "hello" }], truncated: false };
    if (mode === "workspace-relative") {
      if (params.name === "read_file") data.path = "project/hello.txt";
      if (params.name === "list_dir") data.entries[0].path = "project/hello.txt";
    }
    if (mode === "workspace-relative-escape" && params.name === "read_file") data.path = "outside/secret.txt";
    return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  transports.add(transport);
  res.on("close", () => { transports.delete(transport); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); }
  catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
http.listen(0, "127.0.0.1"); await once(http, "listening");
const url = `http://127.0.0.1:${http.address().port}/mcp`;
const clients = [];
function client(options = {}) { const value = new TongAgentDockClient({ url, tokenProvider: () => token, ...options }); clients.push(value); return value; }
const errorCode = (code) => (error) => { assert.equal(error.code, code); assert.ok(!String(error).includes(token)); return true; };
try {
  assert.throws(() => client({ url: "https://example.invalid/mcp" }), errorCode("INVALID_CONFIG"));
  assert.throws(() => client({ url: "http://127.0.0.1:1/mcp?token=unsafe" }), errorCode("INVALID_CONFIG"));
  const dock = client();
  await dock.connect();
  assert.equal((await dock.listTools()).length, 3);
  assert.equal(dock.serverInfo.version, "1.0.1");
  assert.equal((await dock.callTool("read_file", { path: join(project, "hello.txt") })).structuredContent.content, "synthetic hello");
  const count = calls.length;
  await assert.rejects(dock.callTool("read_file", { path: 123 }), errorCode("SCHEMA_ERROR"));
  await assert.rejects(dock.callTool("exec_command", { cmd: "whoami" }), errorCode("TOOL_DENIED"));
  assert.equal(calls.length, count);
  const bad = client({ tokenProvider: () => "WRONG_AUTH_01234567890123456789" });
  await assert.rejects(bad.connect(), errorCode("AUTH_FAILED"));
  mode = "bad-schema"; await assert.rejects(client().connect(), errorCode("SCHEMA_ERROR"));
  mode = "normal";
  await assert.rejects(client({ maxRequestBytes: 1024 }).callTool("read_file", { path: "x".repeat(2000) }), errorCode("REQUEST_TOO_LARGE"));
  mode = "large"; await assert.rejects(dock.callTool("read_file", { path: join(project, "hello.txt") }), errorCode("OUTPUT_TOO_LARGE"));
  mode = "normal";
  const audits = [];
  const router = new TongAgentDockRouter({ client: client(), access, policyPath, audit: (event) => audits.push(event) });
  assert.equal((await router.call("read_file", { projectId: "synthetic", path: "hello.txt" })).content, "synthetic hello");
  assert.equal((await router.call("list_dir", { projectId: "synthetic", path: "." })).entries[0].path, "hello.txt");
  assert.equal((await router.call("search_text", { projectId: "synthetic", path: ".", query: "hello" })).matches[0].path, "hello.txt");
  await writeFile(policyPath, JSON.stringify({ ...grants, backendWorkspaceRoot: root })); mode = "workspace-relative";
  assert.equal((await router.call("read_file", { projectId: "synthetic", path: "hello.txt" })).path, "hello.txt");
  assert.equal((await router.call("list_dir", { projectId: "synthetic", path: "." })).entries[0].path, "hello.txt");
  mode = "workspace-relative-escape";
  await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), errorCode("INVALID_RESULT"));
  mode = "normal"; await writeFile(policyPath, JSON.stringify(grants));
  await writeFile(join(project, "中文-日文.txt"), "synthetic unicode filename");
  assert.equal((await router.call("read_file", { projectId: "synthetic", path: "中文-日文.txt" })).path, "中文-日文.txt");
  const beforeDenied = calls.length;
  for (const path of ["../outside/secret.txt", join(outside, "secret.txt"), "C:relative", "\\\\server\\share\\x", "hello.txt:stream", "missing.txt"]) {
    await assert.rejects(router.call("read_file", { projectId: "synthetic", path }), errorCode("ACCESS_DENIED"));
  }
  await assert.rejects(router.call("exec_command", { projectId: "synthetic", path: "hello.txt" }), errorCode("TOOL_DENIED"));
  await assert.rejects(router.call("search_text", { projectId: "synthetic", path: ".", query: "--pre=untrusted" }), errorCode("INVALID_ARGUMENT"));
  await assert.rejects(router.call("read_file", { projectId: "missing", path: "hello.txt" }), errorCode("PROJECT_DENIED"));
  await writeFile(join(project, ".env"), "SYNTHETIC_SECRET_BODY");
  await assert.rejects(router.call("read_file", { projectId: "synthetic", path: ".env" }), errorCode("ACCESS_DENIED"));
  await assert.rejects(router.call("search_text", { projectId: "synthetic", path: ".", query: "secret" }), errorCode("ACCESS_DENIED"));
  await symlink(outside, join(project, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "redirect/secret.txt" }), errorCode("ACCESS_DENIED"));
  await assert.rejects(router.call("list_dir", { projectId: "synthetic", path: "." }), errorCode("ACCESS_DENIED"));
  await rm(join(project, "redirect"));
  await link(join(outside, "secret.txt"), join(project, "hardlink.txt"));
  await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hardlink.txt" }), errorCode("ACCESS_DENIED"));
  await rm(join(project, "hardlink.txt"));
  assert.equal(calls.length, beforeDenied, "denials must never reach AgentDock");
  await writeFile(policyPath, JSON.stringify({ ...grants, projects: [] }));
  await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), errorCode("PROJECT_DENIED"));
  await writeFile(policyPath, JSON.stringify(grants));
  mode = "change-root"; await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), errorCode("PROJECT_DENIED"));
  registeredRoot = project; await writeFile(policyPath, JSON.stringify(grants));
  mode = "mutate"; await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), errorCode("ACCESS_DENIED"));
  await writeFile(join(project, "hello.txt"), "synthetic hello");
  mode = "revoke"; await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), errorCode("PROJECT_DENIED"));
  await writeFile(policyPath, JSON.stringify(grants));
  mode = "escape-result"; await assert.rejects(router.call("list_dir", { projectId: "synthetic", path: "." }), errorCode("INVALID_RESULT"));
  mode = "tool-error"; await assert.rejects(router.call("read_file", { projectId: "synthetic", path: "hello.txt" }), (error) => !String(error).includes(token));
  mode = "normal";
  assert.ok(audits.some((event) => event.outcome === "denied"));
  assert.ok(audits.every((event) => event.requestId && event.tool && Number.isFinite(event.durationMs)));
  assert.ok(!JSON.stringify(audits).includes("synthetic hello"));
  assert.ok(!JSON.stringify(audits).includes(token));
  const registrations = [];
  registerAgentDockTools({}, (_server, name, _definition, handler) => registrations.push({ name, handler }), await import("zod/v4"), router);
  assert.deepEqual(registrations.map((item) => item.name), ["tong_agentdock_list_dir", "tong_agentdock_read_file", "tong_agentdock_search_text", "tong_agentdock_file_edit", "tong_agentdock_command", "tong_agentdock_session_status", "tong_agentdock_session_cancel"]);
  assert.ok(findDisallowedToolCall({ method: "tools/call", params: { name: "exec_command", arguments: {} } }));
  assert.equal(await validateAllowedToolCall({ params: { name: "tong_agentdock_read_file", arguments: { projectId: "synthetic", path: "hello.txt" } } }), null);
  assert.ok(await validateAllowedToolCall({ params: { name: "tong_agentdock_read_file", arguments: { projectId: "synthetic", path: "hello.txt", toolName: "exec_command" } } }));
  const inbound = new McpServer({ name: "tong-agentdock-mock-route", version: "1" });
  const inboundClient = new Client({ name: "synthetic-browser", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  registerAgentDockTools(inbound, registerAppTool, z, router);
  try {
    await inbound.connect(right); await inboundClient.connect(left);
    assert.equal((await inboundClient.listTools()).tools.length, 7);
    assert.equal((await inboundClient.callTool({ name: "tong_agentdock_read_file", arguments: { projectId: "synthetic", path: "hello.txt" } })).structuredContent.content, "synthetic hello");
    const extra = await inboundClient.callTool({ name: "tong_agentdock_read_file", arguments: { projectId: "synthetic", path: "hello.txt", toolName: "exec_command" } });
    assert.equal(extra.isError, true);
  } finally { await inboundClient.close(); await inbound.close(); }
  mode = "hang"; await assert.rejects(client({ timeoutMs: 150 }).callTool("read_file", { path: join(project, "hello.txt") }), errorCode("TIMEOUT"));
  mode = "disconnect"; await assert.rejects(client().connect(), errorCode("UNAVAILABLE"));
  mode = "normal";
  acceptedToken = 'SYNTHETIC_"\\TOKEN_0123456789';
  const escapedTokenClient = client({ tokenProvider: () => acceptedToken });
  await escapedTokenClient.connect();
  mode = "leak-token";
  await assert.rejects(escapedTokenClient.callTool("read_file", { path: join(project, "hello.txt") }), (error) => error.code === "SENSITIVE_RESULT" && !String(error).includes(acceptedToken));
  mode = "normal"; acceptedToken = token;
  await dock.close(); await assert.rejects(dock.connect(), errorCode("CLOSED"));
  console.log("PASS: SDK HTTP client, independent project grants, paths, fixed tools, redaction, timeouts and disconnects.");
} finally {
  await Promise.allSettled(clients.map((value) => value.close()));
  await Promise.allSettled([...transports].map((value) => value.close()));
  http.closeAllConnections(); await new Promise((resolve) => http.close(resolve));
  // All targets were created under this test's resolved temporary root.
  assert.ok(root.includes("tong-agentdock-"));
  await rm(root, { recursive: true, force: true });
}
