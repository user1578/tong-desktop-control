import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMcpGateway } from "../scripts/TongMcpGateway.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-mcp-continuity-"));
const workspaceRoot = join(temporaryRoot, "workspace");
await import("node:fs/promises").then(({ mkdir }) => mkdir(workspaceRoot));

let sessionId;
let content = "";
let forwardedForStripped = false;
const upstreamCalls = [];
const forwardedForHeaders = [];
const diagnostics = [];
const upstream = createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/authorize") {
      res.writeHead(400);
      res.end();
      return;
    }
    forwardedForHeaders.push(req.headers["x-forwarded-for"]);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const method = request.method;
    const params = request.params ?? {};
    if (method === "initialize") {
      sessionId = "synthetic-session-1";
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "synthetic-devspace", version: "1.0.8" },
        },
      }));
      return;
    }
    if (method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (req.headers["mcp-session-id"] !== sessionId) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32001, message: "Session not found" } }));
      return;
    }
    if (method === "tools/list") {
      upstreamCalls.push("tools/list");
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: ["open_workspace", "read", "write", "edit", "bash"].map((name) => ({ name })) },
      }));
      return;
    }
    if (method === "tools/call") {
      upstreamCalls.push(String(params.name));
      if (params.name === "open_workspace") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "workspace opened" }] } }));
        return;
      }
      if (params.name === "write") content = String(params.arguments.content);
      if (params.name === "edit") content = content.replace(params.arguments.edits[0].oldText, params.arguments.edits[0].newText);
      const result = params.name === "read" ? content : params.name === "edit" ? content : "ok";
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: result }], structuredContent: { result } },
      }));
      return;
    }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }));
  })().catch((error) => {
    res.writeHead(500);
    res.end(String(error));
  });
});

let gateway;
try {
  await new Promise((resolve, reject) => upstream.listen(0, "127.0.0.1", resolve).once("error", reject));
  gateway = startMcpGateway({
    listenHost: "127.0.0.1",
    listenPort: 0,
    upstreamHost: "127.0.0.1",
    upstreamPort: upstream.address().port,
    workspaceRoot,
    logSink: (entry) => diagnostics.push(entry),
  });
  await new Promise((resolve, reject) => {
    gateway.once("listening", resolve);
    gateway.once("error", reject);
  });

  const baseUrl = `http://127.0.0.1:${gateway.address().port}/mcp`;
  const send = async (body, headers = {}) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        connection: "close",
        "x-forwarded-for": "198.51.100.77",
        authorization: "Bearer synthetic-diagnostic-secret",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    return { status: response.status, headers: response.headers, body: raw ? JSON.parse(raw) : undefined };
  };

  const initialized = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "continuity-test", version: "1" } },
  });
  assert.equal(initialized.status, 200);
  const clientSessionId = initialized.headers.get("mcp-session-id");
  assert.equal(clientSessionId, "synthetic-session-1");
  const sessionHeaders = { "mcp-session-id": clientSessionId, "mcp-protocol-version": "2025-11-25" };

  assert.equal((await send({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionHeaders)).status, 202);
  const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionHeaders);
  assert.deepEqual(listed.body.result.tools.map(({ name }) => name), ["open_workspace", "read", "write", "edit"]);

  const denied = await send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "bash", arguments: { command: "echo blocked-canary" } },
  }, sessionHeaders);
  assert.equal(denied.status, 200);
  assert.equal(denied.body.error.code, -32602);
  assert.equal(upstreamCalls.includes("bash"), false);

  const opened = await send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "open_workspace", arguments: { path: workspaceRoot, mode: "checkout" } },
  }, sessionHeaders);
  assert.equal(opened.status, 200);

  const call = async (id, name, args) => send({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: { workspaceId: "synthetic-workspace", ...args } },
  }, sessionHeaders);
  assert.equal((await call(5, "read", { path: "continuity.txt" })).body.result.structuredContent.result, "");
  assert.equal((await call(6, "write", { path: "continuity.txt", content: "before edit" })).status, 200);
  assert.equal((await call(7, "read", { path: "continuity.txt" })).body.result.structuredContent.result, "before edit");
  assert.equal((await call(8, "edit", { path: "continuity.txt", edits: [{ oldText: "before", newText: "after" }] })).status, 200);
  assert.equal((await call(9, "read", { path: "continuity.txt" })).body.result.structuredContent.result, "after edit");
  assert.deepEqual(upstreamCalls.filter((name) => ["open_workspace", "read", "write", "edit", "bash"].includes(name)), ["open_workspace", "read", "write", "read", "edit", "read"]);

  const invalidJson = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer synthetic-diagnostic-secret" },
    body: "{",
  });
  assert.equal(invalidJson.status, 400);

  const oauthRoute = await fetch(`http://127.0.0.1:${gateway.address().port}/authorize`);
  assert.equal(oauthRoute.status, 400);

  const parserResponse = await new Promise((resolve, reject) => {
    const socket = connect(gateway.address().port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.once("error", reject);
    socket.once("connect", () => socket.write(
      "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nBad Header: x\r\nContent-Length: 0\r\n\r\n",
    ));
    socket.once("close", () => resolve(response));
  });
  assert.match(parserResponse, /^HTTP\/1\.1 400 Bad Request/);
  console.log("PASS: a denied Bash request leaves the same MCP session usable for open_workspace/read/write/edit/read.");
  forwardedForStripped = forwardedForHeaders.length > 0 && forwardedForHeaders.every((value) => value === undefined);
} finally {
  if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
  if (upstream.listening) await new Promise((resolve) => upstream.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}

assert.equal(forwardedForStripped, true, "untrusted client forwarding headers must not reach DevSpace");
console.log("PASS: untrusted X-Forwarded-For is stripped before proxying to DevSpace.");

const initializeTrace = diagnostics.find(
  (entry) => entry.event === "upstream_response" && entry.mcpMethods?.includes("initialize"),
);
assert.ok(initializeTrace, "initialize must have an upstream response trace");
assert.equal(initializeTrace.protocolVersion, "2025-11-25");
assert.equal(initializeTrace.authHeaderPresent, true);
assert.equal(initializeTrace.authOutcome, "accepted");
assert.equal(initializeTrace.sessionIdMatched, null);
const oauthRouteTrace = diagnostics.find(
  (entry) => entry.event === "upstream_response" && entry.path === "/authorize",
);
assert.equal(oauthRouteTrace.authOutcome, "not_applicable");

const callResponses = diagnostics.filter(
  (entry) => entry.event === "upstream_response" && entry.mcpMethods?.includes("tools/call"),
);
assert.equal(callResponses.length, 7);
assert.ok(callResponses.every((entry) => entry.sessionIdPresent && entry.sessionIdMatched === true));
assert.ok(callResponses.every((entry) => entry.durationMs >= 0 && entry.status === 200));
assert.ok(diagnostics.some(
  (entry) => entry.event === "request_parse_error" && entry.status === 400 && entry.bodyBytes === 1,
));
assert.ok(diagnostics.some(
  (entry) => entry.event === "http_client_error" && entry.phase === "http_parser" && entry.errorCode === "HPE_INVALID_HEADER_TOKEN",
));

const serializedDiagnostics = JSON.stringify(diagnostics);
assert.equal(serializedDiagnostics.includes("synthetic-diagnostic-secret"), false);
assert.equal(serializedDiagnostics.includes(sessionId), false);
assert.equal(serializedDiagnostics.includes("continuity.txt"), false);
assert.equal(serializedDiagnostics.includes("synthetic-workspace"), false);
console.log("PASS: MCP request traces include protocol/auth/session outcomes without credentials or tool arguments.");
