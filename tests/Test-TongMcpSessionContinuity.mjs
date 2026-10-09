import assert from "node:assert/strict";
import { Agent, createServer, request as httpRequest } from "node:http";
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
const gatewayRequestSockets = [];
const upstreamRequestSockets = [];
const upstreamConnectionHeaders = [];
const agents = new Set();
const continuityAgent = new Agent({ keepAlive: true, maxSockets: 1 });
agents.add(continuityAgent);

function createKeepAliveAgent() {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  agents.add(agent);
  return agent;
}
const upstream = createServer((req, res) => {
  upstreamRequestSockets.push(req.socket);
  upstreamConnectionHeaders.push(req.headers.connection);
  void (async () => {
    if (req.method === "GET" && req.url === "/authorize") {
      res.writeHead(400);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/mcp") {
      assert.equal(req.headers["mcp-session-id"], sessionId);
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": sessionId });
      res.end(": synthetic stream ready\n\n");
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
        connection: "keep-alive",
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
    if (method === "ping") {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
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
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: result }], structuredContent: { result } },
      });
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": sessionId });
      res.end(`event: message\ndata: ${response}\n\n`);
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
  gateway.on("request", (request) => {
    if (request.url === "/mcp") gatewayRequestSockets.push(request.socket);
  });
  await new Promise((resolve, reject) => {
    gateway.once("listening", resolve);
    gateway.once("error", reject);
  });

  const baseUrl = `http://127.0.0.1:${gateway.address().port}/mcp`;
  const send = async (body, headers = {}, agent = continuityAgent) => {
    const requestBody = Buffer.from(JSON.stringify(body), "utf8");
    return new Promise((resolve, reject) => {
      const request = httpRequest(baseUrl, {
        method: "POST",
        agent,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": requestBody.length,
          "x-forwarded-for": "198.51.100.77",
          authorization: "Bearer synthetic-diagnostic-secret",
          ...headers,
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const responseBody = Buffer.concat(chunks);
          if (response.headers["content-length"] !== undefined) {
            assert.equal(Number(response.headers["content-length"]), responseBody.length);
          }
          const raw = responseBody.toString("utf8");
          let parsed;
          const eventStream = String(response.headers["content-type"] ?? "").includes("text/event-stream");
          if (raw) {
            if (eventStream) {
              const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
              assert.equal(data.length, 1, "one finite SSE response must contain one JSON-RPC message");
              parsed = JSON.parse(data[0].slice("data:".length).trimStart());
            } else {
              parsed = JSON.parse(raw);
            }
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsed,
            eventStream,
            rawLength: responseBody.length,
            reusedSocket: request.reusedSocket,
          });
        });
      });
      request.once("error", (error) => {
        error.reusedSocket = request.reusedSocket;
        reject(error);
      });
      request.end(requestBody);
    });
  };

  const flowSocketStart = gatewayRequestSockets.length;
  const initialized = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "continuity-test", version: "1" } },
  });
  assert.equal(initialized.status, 200);
  const clientSessionId = initialized.headers["mcp-session-id"];
  assert.equal(clientSessionId, "synthetic-session-1");
  const sessionHeaders = { "mcp-session-id": clientSessionId, "mcp-protocol-version": "2025-11-25" };

  const notification = await send({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionHeaders);
  const initialAssignments = diagnostics.filter((entry) => entry.event === "upstream_socket_assigned");
  assert.equal(initialAssignments[0].reusedSocket, false);
  assert.equal(initialAssignments[1].reusedSocket, false, "Gateway must not reuse the DevSpace socket after sending Connection: close");
  assert.equal(notification.status, 202);
  assert.equal(upstreamRequestSockets.length, 2);
  assert.notEqual(
    upstreamRequestSockets[0],
    upstreamRequestSockets[1],
    "initialized notification must use a new DevSpace socket after initialize declared Connection: close",
  );
  assert.deepEqual(upstreamConnectionHeaders.slice(0, 2), ["close", "close"]);
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
  const flowSockets = gatewayRequestSockets.slice(flowSocketStart);
  assert.equal(flowSockets.length, 10);
  assert.equal(new Set(flowSockets).size, 1, "all MCP requests in one client flow must use the same inbound HTTP connection");
  assert.ok((await call(10, "read", { path: "continuity.txt" })).eventStream);

  const sseGet = await fetch(baseUrl, {
    headers: { accept: "text/event-stream", "mcp-session-id": clientSessionId, authorization: "Bearer synthetic-diagnostic-secret" },
  });
  assert.equal(sseGet.status, 200);
  assert.match(sseGet.headers.get("content-type"), /text\/event-stream/);
  assert.equal(await sseGet.text(), ": synthetic stream ready\n\n");

  continuityAgent.destroy();
  const reconnectAgent = createKeepAliveAgent();
  const beforeReconnect = gatewayRequestSockets.length;
  const reconnected = await send({ jsonrpc: "2.0", id: 11, method: "ping" }, sessionHeaders, reconnectAgent);
  assert.equal(reconnected.status, 200);
  assert.equal(reconnected.reusedSocket, false);
  assert.notEqual(gatewayRequestSockets[beforeReconnect], flowSockets[0]);

  const boundaryIntervalsSeconds = [1, 4, 5, 6, 10];
  const boundaryReuseResults = [];
  for (const [index, intervalSeconds] of boundaryIntervalsSeconds.entries()) {
    console.log(`Testing idle interval ${intervalSeconds}s`);
    const agent = createKeepAliveAgent();
    const boundaryInit = await send({
      jsonrpc: "2.0",
      id: 20 + index * 4,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "boundary-test", version: "1" } },
    }, {}, agent);
    assert.equal(boundaryInit.status, 200);
    const boundarySessionHeaders = {
      "mcp-session-id": boundaryInit.headers["mcp-session-id"],
      "mcp-protocol-version": "2025-11-25",
    };
    assert.equal((await send({ jsonrpc: "2.0", method: "notifications/initialized" }, boundarySessionHeaders, agent)).status, 202);
    const boundaryOpened = await send({
      jsonrpc: "2.0",
      id: 21 + index * 4,
      method: "tools/call",
      params: { name: "open_workspace", arguments: { path: workspaceRoot, mode: "checkout" } },
    }, boundarySessionHeaders, agent);
    assert.equal(boundaryOpened.status, 200);
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    let boundaryRead;
    try {
      boundaryRead = await send({
        jsonrpc: "2.0",
        id: 22 + index * 4,
        method: "tools/call",
        params: { name: "read", arguments: { workspaceId: "synthetic-workspace", path: "continuity.txt" } },
      }, boundarySessionHeaders, agent);
    } catch (error) {
      throw new Error(`read failed after ${intervalSeconds}s (code=${error.code ?? "unknown"}, reusedSocket=${error.reusedSocket ?? "unknown"}, keepAliveHint=${boundaryOpened.headers["keep-alive"] ?? "absent"})`, { cause: error });
    }
    assert.equal(boundaryRead.status, 200, `read must succeed after ${intervalSeconds}s whether the client socket is reused or reopened`);
    boundaryReuseResults.push(`${intervalSeconds}s=${boundaryRead.reusedSocket ? "reused" : "reopened"}`);
    agent.destroy();
  }

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
  const recoveryAgent = createKeepAliveAgent();
  const recovered = await send({ jsonrpc: "2.0", id: 40, method: "ping" }, sessionHeaders, recoveryAgent);
  assert.equal(recovered.status, 200, "a fresh connection must work after an HTTP parser error closed the malformed connection");
  recoveryAgent.destroy();
  console.log("PASS: a denied Bash request leaves the same MCP session usable for open_workspace/read/write/edit/read.");
  console.log("PASS: sequential MCP calls reuse one inbound HTTP connection, then recover after explicit close.");
  console.log(`PASS: calls succeed after ${boundaryIntervalsSeconds.join(", ")} second idle intervals (${boundaryReuseResults.join(", " )}).`);
  console.log("PASS: a new HTTP connection succeeds after an HTTP parser error.");
  forwardedForStripped = forwardedForHeaders.length > 0 && forwardedForHeaders.every((value) => value === undefined);
} finally {
  for (const agent of agents) agent.destroy();
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
const upstreamAssignments = diagnostics.filter((entry) => entry.event === "upstream_socket_assigned");
assert.ok(upstreamAssignments.every((entry) => entry.reusedSocket === false), "no Gateway to DevSpace request may reuse a closing socket");
assert.equal(new Set(upstreamRequestSockets).size, upstreamRequestSockets.length);
assert.ok(upstreamConnectionHeaders.every((value) => value === "close"));
console.log("PASS: every Gateway to DevSpace request uses a fresh TCP socket while preserving Connection: close.");

const callResponses = diagnostics.filter(
  (entry) => entry.event === "upstream_response" && entry.mcpMethods?.includes("tools/call"),
);
assert.equal(callResponses.length, 18);
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
