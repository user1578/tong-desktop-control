import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as z from "zod/v4";
import { TongAgentDockRouter, registerAgentDockTools } from "../scripts/TongAgentDockTools.mjs";
import { TongAgentDockClient, dockError } from "../scripts/TongAgentDockClient.mjs";
import { closeTongMcpTools } from "../scripts/TongMcpTools.mjs";

// Catches closed-Router allocation, lifetime identity quotas, and dispatch with
// a different connection generation after the instance probe. No backend runs.
const root = await mkdtemp(join(tmpdir(), "tong-session-coordination-"));
const projects = await Promise.all(Array.from({ length: 65 }, async (_, index) => {
  const path = join(root, `project-${index}`); await mkdir(path);
  return { id: `scope-${index}`, root: path, permission: "write", status: "enabled", available: true };
}));
const policyPath = join(root, "policy.json");
await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, projects: projects.map(project => ({ projectId: project.id, root: project.root, scope: "synthetic", tools: [] })), approvals: [] }));
const auth = index => ({ clientId: `identity-${index}`, resource: new URL("http://127.0.0.1/coordination"), scopes: ["devspace"], expiresAt: Math.floor(Date.now() / 1000) + 600 });
const routers = [];
const audits = [];
function route(path, access, client = new TongAgentDockClient({ url: "http://127.0.0.1:1/mcp", tokenProvider: () => "SYNTHETIC_NO_BACKEND_0123456789", controlledExecution: true }), options = {}) {
  const router = new TongAgentDockRouter({ client, access, policyPath: path, now: options.now, audit: async event => { audits.push(event); await options.audit?.(event); } }); routers.push(router);
  const handlers = new Map(); registerAgentDockTools({}, (_server, name, _definition, handler) => handlers.set(name, handler), z, router);
  return { router, call: (tool, input, identity) => handlers.get(`tong_agentdock_${tool}`)(input, { authInfo: identity }) };
}
const input = index => ({ projectId: projects[index].id, taskId: "scope-task", approvalId: "not-approved", action: "replace", path: "file.txt", old: "old", new: "new", dryRun: true });
try {
  const gates = [], entered = [], pending = [];
  for (let index = 0; index < 64; index++) {
    let reads = 0, release, reach;
    const gate = new Promise(ok => { release = ok; }); gates.push(release);
    entered.push(new Promise(ok => { reach = ok; }));
    const value = route(policyPath, { listProjects: async () => { if (++reads === 2) { reach(); await gate; } return projects; } });
    pending.push(value.call("file_edit", input(index), auth(index)));
  }
  await Promise.all(entered);
  const extra = route(policyPath, { listProjects: async () => projects });
  assert.equal((await extra.call("file_edit", input(64), auth(64))).structuredContent.code, "SESSION_DENIED", "concurrent scopes must be bounded");
  const capacityAudited = audits.some(event => event.phase === "finished" && event.errorType === "SESSION_DENIED");
  gates.forEach(release => release());
  for (const value of await Promise.all(pending)) assert.equal(value.structuredContent.code, "APPROVAL_DENIED");
  assert.ok(capacityAudited, "coordinator capacity denials must be audited");
  assert.equal((await extra.call("file_edit", input(64), auth(64))).structuredContent.code, "APPROVAL_DENIED", "idle scopes must release identity capacity without a runtime restart");
  assert.equal((await extra.call("session_status", { projectId: projects[0].id, taskId: "scope-task", approvalId: "not-approved", sessionId: randomUUID() }, auth("unknown-owner"))).structuredContent.code, "SESSION_DENIED");
  assert.equal((await extra.call("file_edit", input(64), undefined)).structuredContent.code, "AUTH_FAILED");
  assert.ok(audits.some(event => event.errorType === "AUTH_FAILED" && event.phase === "finished"));
  const unaudited = route(policyPath, { listProjects: async () => projects }, undefined, { audit: () => { throw Error("synthetic audit failure"); } });
  assert.equal((await unaudited.call("file_edit", input(64), undefined)).structuredContent.code, "AUDIT_UNAVAILABLE");

  const racePolicy = join(root, "race-policy.json"), project = projects[0].root, exe = join(root, "synthetic.exe");
  await writeFile(exe, "synthetic"); await writeFile(join(project, "test_ok.py"), "def test_ok(): assert True\n");
  await writeFile(racePolicy, JSON.stringify({ schemaVersion: 1, projects: [{ projectId: projects[0].id, root: project, scope: "synthetic", tools: [], commands: { python: { path: exe, sha256: createHash("sha256").update("synthetic").digest("hex") }, pytestEntry: "test_ok.py" } }], approvals: [{ projectId: projects[0].id, taskId: "race-task", approvalId: "race-approved", capability: "command.execute", operations: ["pytest"], paths: ["test_ok.py"], expiresAt: new Date(Date.now() + 600000).toISOString() }] }));
  let dispatches = 0, invalidate = false, bootStamp = "2026-10-12T00:00:00Z"; const peers = [];
  function fake() {
    const peer = { generation: 0, connected: false, createPeer: () => fake(),
      async connect() { if (!this.connected) { this.connected = true; this.generation++; } },
      async backendInstance() { if (invalidate) this.connected = false; return bootStamp; },
      async callTool(name, args, options = {}) {
        if (options.generation !== undefined && (!this.connected || options.generation !== this.generation)) throw dockError("SESSION_DENIED");
        await this.connect(); if (name === "exec_command") dispatches++;
        return { structuredContent: name === "exec_command" && args.execution_mode === "async"
          ? { status: "running", session_id: "backend-local-session", stdout: "", stderr: "" }
          : { status: "exited", exit_code: 0, stdout: "", stderr: "" } };
      }, async close() { this.connected = false; },
    };
    peers.push(peer); return peer;
  }
  let release, reach, reads = 0;
  const gate = new Promise(ok => { release = ok; }), reached = new Promise(ok => { reach = ok; });
  const first = route(racePolicy, { listProjects: async () => { if (++reads === 1) { reach(); await gate; } return projects; } }, fake());
  const command = { projectId: projects[0].id, taskId: "race-task", approvalId: "race-approved", operation: "pytest", idempotencyKey: randomUUID() };
  const closing = first.call("command", command, auth("race")); await reached; await first.router.close(); release();
  assert.equal((await closing).structuredContent.code, "CLOSED"); assert.equal(dispatches, 0);
  const second = route(racePolicy, { listProjects: async () => projects }, fake());
  assert.equal((await second.call("command", { ...command, idempotencyKey: randomUUID() }, auth("race"))).structuredContent.exitCode, 0);
  assert.equal(dispatches, 1, "a fresh transport must not inherit the closed Router's client");
  invalidate = true;
  const changed = { ...command, idempotencyKey: randomUUID() };
  assert.equal((await second.call("command", changed, auth("race"))).structuredContent.code, "SESSION_DENIED", "dispatch must bind the generation captured with its instance probe");
  assert.equal(dispatches, 1, "generation changes must not silently execute on a new connection");
  invalidate = false;
  assert.equal((await second.call("command", changed, auth("race"))).structuredContent.code, "REPLAY_DENIED", "an already reserved operation remains rejected");
  for (const boundary of ["instance", "generation", "expiry", "approval", "identity"]) {
    let clock = 0, armed = false;
    const identity = auth(`delivery-${boundary}`);
    const delivery = route(racePolicy, { listProjects: async () => projects }, fake(), { now: () => clock, audit: async event => {
      if (!armed || event.tool !== "session_status" || event.phase !== "finished") return;
      armed = false;
      if (boundary === "instance") bootStamp = "2026-10-12T00:01:00Z";
      else if (boundary === "generation") peers.forEach(peer => { peer.connected = false; });
      else if (boundary === "expiry") clock += 300001;
      else if (boundary === "identity") identity.expiresAt = 1;
      else {
        const { readFile } = await import("node:fs/promises");
        const value = JSON.parse(await readFile(racePolicy, "utf8"));
        await writeFile(racePolicy, JSON.stringify({ ...value, approvals: [] }));
      }
    } });
    const active = (await delivery.call("command", { ...command, async: true, idempotencyKey: randomUUID() }, identity)).structuredContent;
    assert.equal(active.status, "running");
    armed = true;
    const response = await delivery.call("session_status", { projectId: command.projectId, taskId: command.taskId, approvalId: command.approvalId, sessionId: active.sessionId }, identity);
    assert.equal(response.structuredContent.code, boundary === "approval" ? "APPROVAL_DENIED" : boundary === "identity" ? "AUTH_FAILED" : "SESSION_DENIED", `finished audit must not deliver a result past ${boundary}`);
    if (boundary === "approval") {
      const { readFile } = await import("node:fs/promises");
      const value = JSON.parse(await readFile(racePolicy, "utf8"));
      await writeFile(racePolicy, JSON.stringify({ ...value, approvals: [{ projectId: command.projectId, taskId: command.taskId, approvalId: command.approvalId, capability: "command.execute", operations: ["pytest"], paths: ["test_ok.py"], expiresAt: new Date(Date.now() + 600000).toISOString() }] }));
      const restored = await delivery.call("session_status", { projectId: command.projectId, taskId: command.taskId, approvalId: command.approvalId, sessionId: active.sessionId }, identity);
      assert.equal(restored.structuredContent.exitCode, 0, "delivery refusal must retain the already consumed completion");
    }
  }
  console.log("PASS: active scope capacity and idle reclamation; preflight-close race; captured dispatch generation; retained replay rejection.");
} finally {
  await Promise.allSettled(routers.map(router => router.close())); await closeTongMcpTools();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\tong-session-coordination-") || resolve(root).startsWith(resolve(tmpdir()) + "/tong-session-coordination-"));
  await rm(root, { recursive: true, force: true });
}
