import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, open } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer as netServer } from "node:net";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";

if (process.env.TONG_PREDEPLOYMENT_E2E !== "1") console.log("SKIP: opt-in local Tong/Gateway/OAuth/AgentDock predeployment E2E.");
else {
  const poc = process.env.TONG_AGENTDOCK_POC_ROOT;
  assert.ok(poc && isAbsolute(poc));
  const isolated = join(poc, "isolated"), evidence = await mkdtemp(join(isolated, "evidence", "b1-e2e-"));
  const state = await mkdtemp(join(isolated, "state", "b1-tong-")), workspace = await mkdtemp(join(isolated, "workspace", "b1-project-"));
  const project = join(workspace, "project"), demo = join(workspace, "demo"), outside = join(workspace, "outside");
  for (const path of [project, demo, outside, join(state, "home")]) await mkdir(path);
  const git = process.env.TONG_AGENTDOCK_TEST_GIT, python = process.env.TONG_AGENTDOCK_TEST_PYTHON;
  assert.ok(git && python && isAbsolute(git) && isAbsolute(python));
  const port = Number(process.env.TONG_B1_GATEWAY_PORT ?? 17876), upstreamPort = Number(process.env.TONG_B1_UPSTREAM_PORT ?? 17877);
  assert.ok([port, upstreamPort].every(value => Number.isInteger(value) && value > 1024 && value < 65536 && ![7676, 7677, 18765].includes(value)) && port !== upstreamPort);
  async function unused(value) { const probe = netServer(); await new Promise((ok, fail) => probe.once("error", fail).listen(value, "127.0.0.1", ok)); await new Promise(ok => probe.close(ok)); }
  for (const value of [port, upstreamPort, 18765]) await unused(value);
  const baseURL = `http://127.0.0.1:${port}`, resource = baseURL + "/mcp";
  const agentToken = randomBytes(32).toString("hex"), ownerToken = randomBytes(32).toString("hex");
  let tokens, dock, tong, client, transport; const records = [], checks = {}, outputs = {};
  const streams = [];
  const alive = child => child && child.exitCode === null && child.signalCode === null;
  function log(name) { const stream = createWriteStream(join(evidence, name)); streams.push(stream); return stream; }
  const dockOut = log("agentdock.stdout.log"), dockErr = log("agentdock.stderr.log"), tongOut = log("tong.stdout.log"), tongErr = log("tong.stderr.log");
  const policyPath = join(state, "agentdock-access.json");
  await writeFile(join(project, "calculator.py"), "def add(a, b):\n    return a - b\n");
  await writeFile(join(project, "test_calculator.py"), "from calculator import add\ndef test_add():\n    assert add(2, 3) == 5\n");
  await writeFile(join(outside, "canary.txt"), "B1_OUTSIDE_CANARY\n");
  execFileSync(git, ["init", "--quiet", project]); execFileSync(git, ["-C", project, "add", "calculator.py", "test_calculator.py"]);
  execFileSync(git, ["-C", project, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "--quiet", "-m", "synthetic baseline"]);
  const access = new TongProjectAccess({ registryPath: join(state, "project-access.json"), agentAccessPath: join(state, "agent-execution.json"), demoRoot: demo, scanRoots: [] });
  await access.addProject({ id: "b1-synthetic", name: "B1 synthetic", root: project, permission: "write" });
  const profile = async path => ({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  const policy = { schemaVersion: 1, backendWorkspaceRoot: join(isolated, "workspace"), projects: [{ projectId: "b1-synthetic", root: project, scope: "synthetic", tools: ["read_file", "list_dir", "search_text"],
    commands: { python: await profile(python), git: await profile(git), pytestEntry: "test_calculator.py", gitDiffPaths: ["calculator.py", "new_module.py"] } }], approvals: [] };
  await writeFile(policyPath, JSON.stringify(policy));
  const expiresAt = new Date(Date.now() + 3600000).toISOString(), taskId = "b1-e2e-task";
  const common = { projectId: "b1-synthetic", taskId }, write = { ...common, approvalId: "b1-local-write" }, command = { ...common, approvalId: "b1-local-command" };
  const systemKeys = new Set(["SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "PROGRAMDATA", "PATH", "PATHEXT", "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key.toUpperCase())));
  const startedAt = new Date().toISOString();
  async function call(name, args) {
    const begun = new Date().toISOString();
    const input = ["tong_agentdock_file_edit", "tong_agentdock_command"].includes(name) ? { idempotencyKey: randomUUID(), ...args } : args;
    const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 30000 });
    assert.ok(!JSON.stringify(result).includes(agentToken) && !JSON.stringify(result).includes(ownerToken));
    if (tokens) assert.ok(!JSON.stringify(result).includes(tokens.access_token) && !JSON.stringify(result).includes(tokens.refresh_token));
    records.push({ name, taskId: input.taskId, startedAt: begun, endedAt: new Date().toISOString(), isError: result.isError === true,
      code: result.structuredContent?.code, status: result.structuredContent?.status, exitCode: result.structuredContent?.exitCode });
    return result;
  }
  async function run(operation) {
    let result = await call("tong_agentdock_command", { ...command, operation }); assert.ok(!result.isError);
    let value = result.structuredContent, stdout = value.stdout, stderr = value.stderr; const sessionId = value.sessionId;
    for (let i = 0; value.status === "running" && i < 100; i++) { await new Promise(ok => setTimeout(ok, 100)); result = await call("tong_agentdock_session_status", { ...command, sessionId }); assert.ok(!result.isError); value = result.structuredContent; stdout = value.outputMode === "snapshot" ? value.stdout : stdout + value.stdout; stderr = value.outputMode === "snapshot" ? value.stderr : stderr + value.stderr; }
    assert.notEqual(value.status, "running"); return { ...value, stdout, stderr };
  }
  try {
    dock = spawn(join(poc, "runtime", "agentdock.exe"), ["--host", "127.0.0.1", "--port", "18765", "--mcp-apps-mode", "off"], {
      cwd: isolated, windowsHide: true, env: { ...env, AGENTDOCK_HOME: join(isolated, "state"), AGENTDOCK_DEFAULT_DIR: join(isolated, "workspace"), AGENTDOCK_AUTH_TOKEN: agentToken,
        AGENTDOCK_BROWSER_ENABLED: "false", AGENTDOCK_ACP_ENABLED: "false", AGENTDOCK_MCP_APPS_MODE: "off", TEMP: join(isolated, "temp"), TMP: join(isolated, "temp") }, stdio: ["ignore", "pipe", "pipe"] });
    dock.stdout.pipe(dockOut); dock.stderr.pipe(dockErr);
    for (let i = 0; i < 50; i++) { if (dock.exitCode !== null) throw new Error("Owned AgentDock failed to start"); try { const response = await fetch("http://127.0.0.1:18765/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(300) }); await response.body?.cancel(); if (response.status === 401) break; } catch {} if (i === 49) throw new Error("Owned AgentDock readiness timed out"); await new Promise(ok => setTimeout(ok, 100)); }
    tong = fork(fileURLToPath(new URL("fixtures/TongPredeploymentServer.mjs", import.meta.url)), [], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true,
      env: { ...env, USERPROFILE: join(state, "home"), HOME: join(state, "home"), APPDATA: join(state, "home", "AppData", "Roaming"), LOCALAPPDATA: join(state, "home", "AppData", "Local") }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    tong.stdout.pipe(tongOut); tong.stderr.pipe(tongErr);
    const ready = Promise.race([once(tong, "message"), once(tong, "exit").then(() => { throw new Error("Owned Tong failed to start; inspect isolated logs"); }), new Promise((_, fail) => { const timer = setTimeout(() => fail(new Error("Tong readiness timeout")), 15000); timer.unref(); })]);
    tong.send({ stateDir: state, demoRoot: demo, policyPath, gatewayPort: port, upstreamPort, agentdockToken: agentToken, ownerToken });
    const [message] = await ready; assert.equal(message.event, "ready");
    const metadata = await (await fetch(baseURL + "/.well-known/oauth-authorization-server")).json();
    assert.equal(metadata.issuer, baseURL + "/");
    const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-auth-probe", version: "1" } } };
    for (const credential of [null, "WRONG_SYNTHETIC_ACCESS_TOKEN"]) { const response = await fetch(resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(initialize) }); assert.equal(response.status, 401); await response.body?.cancel(); }
    checks.authRejected = true;
    const redirect = "http://127.0.0.1:17878/callback";
    const registered = await fetch(metadata.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "B1 local synthetic", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) }); assert.equal(registered.status, 201); const info = await registered.json();
    const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
    const fields = { response_type: "code", client_id: info.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "devspace", state: randomUUID(), resource };
    const wrongOwner = await fetch(metadata.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ ...fields, owner_token: "WRONG_SYNTHETIC_OWNER" }) }); assert.equal(wrongOwner.status, 401); await wrongOwner.body?.cancel();
    const approved = await fetch(metadata.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ ...fields, owner_token: ownerToken }) }); assert.equal(approved.status, 302); const location = new URL(approved.headers.get("location")); assert.equal(location.searchParams.get("state"), fields.state); await approved.body?.cancel();
    const issued = await fetch(metadata.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: info.client_id, code: location.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect, resource }) }); assert.equal(issued.status, 200); tokens = await issued.json();
    client = new Client({ name: "b1-local-e2e-client", version: "1" });
    transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } }, reconnectionOptions: { maxRetries: 0 } });
    await client.connect(transport); const session = transport.sessionId; assert.ok(session);
    const tools = (await client.listTools()).tools.map(tool => tool.name); assert.equal(tools.length, 21); assert.ok(!tools.includes("exec_command") && !tools.includes("file_edit"));
    checks.oauthPkceAndInitialize = true; checks.fixedTools = tools;
    const projects = await call("tong_list_projects", {}); assert.ok(projects.structuredContent.projects.some(entry => entry.id === "b1-synthetic" && !entry.effectiveCapabilities.includes("agent.execute")));
    const read = await call("tong_agentdock_read_file", { projectId: "b1-synthetic", path: "calculator.py" }); assert.ok(read.structuredContent.content.includes("a - b"));
    const denied = await call("tong_agentdock_file_edit", { ...write, action: "replace", path: "calculator.py", old: "a - b", new: "a + b" }); assert.equal(denied.structuredContent.code, "APPROVAL_DENIED");
    policy.approvals = [{ ...write, capability: "project.write", operations: ["add", "replace", "patch"], paths: ["calculator.py", "new_module.py"], expiresAt }, { ...command, capability: "command.execute", operations: ["pytest", "git_status", "git_diff"], paths: ["test_calculator.py", "calculator.py", "new_module.py", "."], expiresAt }];
    await writeFile(policyPath, JSON.stringify(policy)); // Trusted local approval, not a public MCP mutation.
    const editInput = { ...write, action: "replace", path: "calculator.py", old: "a - b", new: "a + b", idempotencyKey: randomUUID() };
    assert.equal((await call("tong_agentdock_file_edit", { ...editInput, dryRun: true })).structuredContent.dryRun, true);
    assert.equal((await call("tong_agentdock_file_edit", editInput)).structuredContent.verified, true);
    assert.equal((await call("tong_agentdock_file_edit", { ...write, action: "add", path: "new_module.py", content: "B1_FILE_BODY_MARKER = 1\n" })).structuredContent.verified, true);
    const replay = await call("tong_agentdock_file_edit", editInput); assert.ok(["REPLAY_DENIED", "INVALID_ARGUMENT"].includes(replay.structuredContent.code));
    assert.ok((await call("tong_agentdock_read_file", { projectId: "b1-synthetic", path: "calculator.py" })).structuredContent.content.includes("a + b"));
    outputs.pytest = await run("pytest"); assert.equal(outputs.pytest.exitCode, 0); assert.ok(outputs.pytest.stdout.includes("1 passed"));
    outputs.gitStatus = await run("git_status"); assert.equal(outputs.gitStatus.exitCode, 0); assert.ok(outputs.gitStatus.stdout.includes("calculator.py"));
    outputs.gitDiff = await run("git_diff"); assert.equal(outputs.gitDiff.exitCode, 0); assert.ok(outputs.gitDiff.stdout.includes("+    return a + b"));
    const queryKey = randomUUID(); assert.equal((await call("tong_agentdock_command", { ...command, operation: "git_status", idempotencyKey: queryKey })).isError, undefined);
    assert.equal((await call("tong_agentdock_command", { ...command, operation: "git_status", idempotencyKey: queryKey })).structuredContent.code, "REPLAY_DENIED");
    checks.durableOperationReplayDenied = true;
    for (const args of [{ projectId: "b1-synthetic", path: "../outside/canary.txt" }, { projectId: "unregistered", path: "calculator.py" }]) assert.equal((await call("tong_agentdock_read_file", args)).isError, true);
    assert.equal((await call("tong_agentdock_file_edit", { ...write, action: "patch", patch: "*** Begin Patch\n*** Add File: new_module.py\n+x\n*** Add File: ../outside/escape.txt\n+x\n*** End Patch" })).isError, true);
    await assert.rejects(client.callTool({ name: "tong_agentdock_command", arguments: { ...command, idempotencyKey: randomUUID(), operation: "pytest", cmd: "whoami" } }), error => error.code === -32602);
    await assert.rejects(client.callTool({ name: "exec_command", arguments: { cmd: "whoami" } }), error => error.code === -32602);
    checks.invalidArgumentsAndGenericShellDenied = true;
    assert.equal(await readFile(join(outside, "canary.txt"), "utf8"), "B1_OUTSIDE_CANARY\n");
    const refreshed = await fetch(metadata.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: info.client_id, refresh_token: tokens.refresh_token, resource }) }); assert.equal(refreshed.status, 200); const refresh = await refreshed.json();
    checks.oauthRefresh = true;
    assert.equal(transport.sessionId, session); checks.sameMcpClientSession = true;
    const dockExit = once(dock, "exit"); dock.kill(); await dockExit;
    const offline = await call("tong_agentdock_command", { ...command, operation: "pytest" }); assert.equal(offline.structuredContent.code, "UNAVAILABLE");
    assert.equal((await call("tong_agentdock_read_file", { projectId: "b1-synthetic", path: "calculator.py" })).structuredContent.code, "UNAVAILABLE");
    checks.offlineNoFallback = true;
    await client.close(); client = undefined;
    const stopped = once(tong, "exit"); tong.send({ event: "stop" }); const [exit] = await stopped; assert.equal(exit, 0);
    for (const stream of streams) if (!stream.writableEnded) stream.end(); await Promise.all(streams.map(stream => stream.closed ? Promise.resolve() : once(stream, "close")));
    const auditText = await readFile(join(state, "agentdock-audit.jsonl"), "utf8"), tongLogs = await readFile(join(evidence, "tong.stdout.log"), "utf8") + await readFile(join(evidence, "tong.stderr.log"), "utf8"), dockLogs = await readFile(join(evidence, "agentdock.stderr.log"), "utf8");
    for (const secret of [agentToken, ownerToken, tokens.access_token, tokens.refresh_token, refresh.access_token, refresh.refresh_token]) assert.ok(![auditText, tongLogs, dockLogs].some(log => log.includes(secret)));
    assert.ok(!auditText.includes("B1_FILE_BODY_MARKER") && !auditText.includes("1 passed") && !auditText.includes("return a + b"));
    assert.ok(!tongLogs.includes("B1_FILE_BODY_MARKER") && !dockLogs.includes("B1_FILE_BODY_MARKER"));
    const audit = auditText.trim().split("\n").map(line => JSON.parse(line)); assert.ok(audit.some(entry => entry.taskId === taskId && entry.operation === "pytest" && entry.outcome === "allowed"));
    for (const tool of ["read_file", "file_edit", "exec_command"]) assert.ok(dockLogs.includes(`"tool":"${tool}"`));
    checks.auditAndBackendLogCoverage = true; checks.credentialsAbsentFromLogs = true;
    await writeFile(join(evidence, "result.json"), JSON.stringify({ passed: true, localOnly: true, startedAt, endedAt: new Date().toISOString(), root: workspace, state, gatewayPort: port, upstreamPort, checks, outputs, records, audit }, null, 2));
    await writeFile(join(isolated, "evidence", "b1-e2e-latest.json"), JSON.stringify({ evidence, state, workspace, passed: true, tongPid: tong.pid, agentdockPid: dock.pid, gatewayPort: port, upstreamPort, stopped: true }, null, 2));
    console.log("PASS: one OAuth-authenticated MCP client through independent Tong Gateway/DevSpace to real AgentDock, file read/write, pytest exit 0, Git checks, denial, replay, offline and secret-free logs.");
  } finally {
    await client?.close().catch(() => {});
    if (alive(tong)) { const exit = once(tong, "exit"); if (tong.connected) tong.send({ event: "stop" }); const timer = setTimeout(() => tong.kill(), 12000); await exit; clearTimeout(timer); }
    if (alive(dock)) { const exit = once(dock, "exit"); dock.kill(); await exit; }
    for (const stream of streams) if (!stream.writableEnded) stream.end();
    await writeFile(join(evidence, "lifecycle.json"), JSON.stringify({ tongPid: tong?.pid, tongExitCode: tong?.exitCode, tongSignal: tong?.signalCode, agentdockPid: dock?.pid, agentdockExitCode: dock?.exitCode, agentdockSignal: dock?.signalCode, processesStopped: !alive(tong) && !alive(dock) }));
    await writeFile(join(evidence, "steps.json"), JSON.stringify({ checks, records }, null, 2));
    console.log("Independent test evidence retained: " + evidence);
  }
}
