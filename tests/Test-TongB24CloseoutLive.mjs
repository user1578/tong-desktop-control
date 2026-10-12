import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, fork, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { issueOAuth, toolCall } from "./fixtures/TongProductionSwitchSupport.mjs";
import { safeEnvironment, processIdentity, processDescendants, terminateOwnedProcess, sameProcess } from "../scripts/TongRuntimeSecurity.mjs";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";

if (!process.argv[2]) console.log("SKIP: explicit independent B2.4 closeout live fixture required.");
else {
  const root = resolve(process.argv[2]);
  assert.ok(root.startsWith(resolve("D:\\agentdock-poc-20261010\\isolated\\state") + "\\b24-closeout-"));
  const workspace = join(root, "live-workspace"), project = join(workspace, "project"), demo = join(workspace, "demo"), state = join(root, "live-state");
  for (const path of [project, demo, state, join(root, "home"), join(root, "temp"), join(root, "backend")]) await mkdir(path, { recursive: true });
  const entry = "tests/test_calculator.py"; await mkdir(join(project, "tests"));
  const passing = "import runpy\nfrom pathlib import Path\n\ndef test_add():\n    calculator = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'calculator.py'))\n    assert calculator['add'](2, 3) == 5\n";
  await writeFile(join(project, "calculator.py"), "def add(a, b):\n    return a - b\n");
  await writeFile(join(project, entry), passing);
  const git = "C:\\Users\\Rune\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe";
  const python = "D:\\agentdock-poc-20261010\\isolated\\state\\p244-python-runtime\\Scripts\\python.exe";
  const env = safeEnvironment(root), gitEnv = { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL" };
  for (const args of [["init", "--quiet", project], ["-C", project, "add", "calculator.py", entry], ["-C", project, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "--quiet", "-m", "chore: 创建隔离验收基线"]]) execFileSync(git, args, { env: gitEnv, windowsHide: true });
  const profile = async path => ({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  const base = { projectId: "closeout-synthetic", taskId: "closeout-" + randomUUID(), approvalId: "fixture-command" };
  const write = { ...base, approvalId: "fixture-write" };
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  // These local test policies authorize only the newly created isolated fixture.
  const policyPath = join(state, "agentdock-access.json");
  const grant = { projectId: base.projectId, root: project, scope: "synthetic", tools: ["list_dir", "read_file", "search_text"],
    commands: { git: await profile(git), python: await profile(python), pytestEntry: entry, gitDiffPaths: ["calculator.py", entry] } };
  const commandApproval = { ...base, capability: "command.execute", operations: ["git_status", "git_diff", "pytest"], paths: [".", "calculator.py", entry], expiresAt };
  const policy = { schemaVersion: 1, backendWorkspaceRoot: workspace, projects: [grant], approvals: [commandApproval,
    { ...write, capability: "project.write", operations: ["replace"], paths: ["calculator.py", entry], expiresAt }] };
  await writeFile(policyPath, JSON.stringify(policy));
  const access = new TongProjectAccess({ registryPath: join(state, "project-access.json"), agentAccessPath: join(state, "agent-execution.json"), demoRoot: demo, scanRoots: [] });
  await access.addProject({ id: base.projectId, name: "Independent closeout synthetic", root: project, permission: "write" });
  const allocated = new Set();
  async function port() { const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening"); const value = probe.address().port; await new Promise(ok => probe.close(ok)); assert.ok(![7676, 7677, 18765, 4040].includes(value) && !allocated.has(value)); allocated.add(value); return value; }
  const agentdockPort = await port(), upstreamPort = await port(), gatewayPort = await port();
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const agentdockToken = randomBytes(32).toString("hex"), ownerToken = randomBytes(32).toString("hex");
  const streams = [], children = [], identities = [], connections = [], records = [], results = {};
  let dock, tong, oauth, otherOAuth, done = false;
  function log(name) { const stream = createWriteStream(join(root, name)); streams.push(stream); return stream; }
  async function startDock() {
    dock = spawn("D:\\agentdock-poc-20261010\\runtime\\agentdock.exe", ["--host", "127.0.0.1", "--port", String(agentdockPort), "--mcp-apps-mode", "off"], {
      cwd: root, windowsHide: true, env: { ...env, AGENTDOCK_HOME: join(root, "backend"), AGENTDOCK_DEFAULT_DIR: workspace,
        AGENTDOCK_AUTH_TOKEN: agentdockToken, AGENTDOCK_BROWSER_ENABLED: "false", AGENTDOCK_ACP_ENABLED: "false", AGENTDOCK_MCP_APPS_MODE: "off" }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(dock); dock.stdout.pipe(log(`closeout-agentdock-${children.length}.stdout.log`)); dock.stderr.pipe(log(`closeout-agentdock-${children.length}.stderr.log`));
    for (let count = 0; count < 100; count++) {
      if (dock.exitCode !== null) throw Error("isolated backend exited before readiness");
      try { const response = await fetch(`http://127.0.0.1:${agentdockPort}/healthz`, { signal: AbortSignal.timeout(500) }); const health = await response.json(); if (health.ok === true && health.version === "1.0.1") break; } catch {}
      if (count === 99) throw Error("isolated backend readiness failed"); await new Promise(ok => setTimeout(ok, 100));
    }
    identities.push(await processIdentity(dock.pid));
  }
  async function stopDock() {
    const identity = identities.findLast(item => item?.pid === dock.pid);
    assert.ok(identity && sameProcess(await processIdentity(dock.pid), identity));
    const descendants = await processDescendants(dock.pid);
    for (const child of descendants.reverse()) await terminateOwnedProcess(child);
    const exited = once(dock, "exit");
    await terminateOwnedProcess(identity); await exited;
  }
  async function startTong() {
    tong = fork(new URL("./fixtures/TongPredeploymentServer.mjs", import.meta.url), [], { cwd: root, env, windowsHide: true, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    children.push(tong); tong.stdout.pipe(log(`closeout-tong-${children.length}.stdout.log`)); tong.stderr.pipe(log(`closeout-tong-${children.length}.stderr.log`));
    // Measured module initialization under concurrent regression took 22 seconds.
    // This bounds fixture readiness only; command deadlines and assertions stay fixed.
    const ready = Promise.race([once(tong, "message"), once(tong, "exit").then(() => { throw Error("isolated Tong startup exited"); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("isolated Tong startup timeout")), 45000); timer.unref(); })]);
    tong.send({ stateDir: state, demoRoot: demo, policyPath, gatewayPort, upstreamPort, agentdockPort, agentdockToken, ownerToken });
    assert.equal((await ready)[0].event, "ready");
  }
  async function stopTong() {
    if (tong?.connected) { const stopped = once(tong, "exit"); tong.send({ event: "stop" }); await stopped; }
  }
  async function connect(auth) { const value = await auth.connect(21); connections.push(value); return value; }
  const call = async (client, tool, input) => toolCall(client, `tong_agentdock_${tool}`, input, records, oauth);
  async function final(client, sessionId) {
    let value;
    for (let count = 0; count < 100; count++) {
      const response = await call(client, "session_status", { ...base, sessionId }); assert.ok(!response.isError, JSON.stringify(response.structuredContent));
      value = response.structuredContent; if (value.status !== "running") return value;
      await new Promise(ok => setTimeout(ok, 100));
    }
    throw Error("isolated session did not settle");
  }
  try {
    await startDock();
    await startTong();
    oauth = await issueOAuth(origin, ownerToken); otherOAuth = await issueOAuth(origin, ownerToken);
    const first = await connect(oauth);
    const schemas = (await first.client.listTools()).tools;
    const baseline = JSON.parse(await readFile("D:\\tong-agentdock-local\\logs\\b24-on-tools-schema.json", "utf8"));
    assert.deepEqual(schemas.map(item => item.name), baseline.map(item => item.name));
    assert.deepEqual(schemas.map(item => item.inputSchema), baseline.map(item => item.inputSchema), "all 21 public input Schemas must remain unchanged");
    results.schemas = { count: schemas.length, unchanged: true };
    const listing = await call(first.client, "list_dir", { projectId: base.projectId, path: ".", maxDepth: 2 });
    assert.ok(!listing.isError); assert.ok(listing.structuredContent.entries.some(item => item.path === entry));
    const nested = await call(first.client, "list_dir", { projectId: base.projectId, path: "tests" }); assert.equal(nested.structuredContent.entries[0].path, entry);
    assert.ok((await call(first.client, "read_file", { projectId: base.projectId, path: "calculator.py" })).structuredContent.content.includes("a - b"));
    const edited = await call(first.client, "file_edit", { ...write, action: "replace", path: "calculator.py", old: "a - b", new: "a + b" }); assert.equal(edited.structuredContent.verified, true);
    const replayKey = randomUUID();
    const sync = await call(first.client, "command", { ...base, idempotencyKey: replayKey, operation: "pytest" });
    assert.equal(sync.structuredContent.status, "exited"); assert.equal(sync.structuredContent.exitCode, 0); assert.equal(sync.structuredContent.commandOk, true); results.pytestZero = sync.structuredContent;
    assert.equal((await call(first.client, "command", { ...base, idempotencyKey: replayKey, operation: "pytest" })).structuredContent.code, "REPLAY_DENIED");
    for (const operation of ["git_status", "git_diff"]) { const response = await call(first.client, "command", { ...base, operation }); assert.equal(response.structuredContent.exitCode, 0); assert.equal(response.structuredContent.commandOk, true); results[operation] = response.structuredContent; }
    await writeFile(join(project, entry), "def test_failure():\n    assert False\n");
    const failed = await call(first.client, "command", { ...base, operation: "pytest" }); assert.equal(failed.structuredContent.status, "exited"); assert.equal(failed.structuredContent.exitCode, 1); assert.equal(failed.structuredContent.commandOk, false); results.pytestNonzero = failed.structuredContent;
    await writeFile(join(project, entry), "import time\ndef test_slow():\n    time.sleep(10)\n");
    const timeout = await call(first.client, "command", { ...base, operation: "pytest", timeoutMs: 1000 }); assert.equal(timeout.structuredContent.status, "timeout"); assert.equal(timeout.structuredContent.timedOut, true); assert.equal(timeout.structuredContent.commandOk, false); results.pytestTimeout = timeout.structuredContent;
    await writeFile(join(project, entry), "import time\ndef test_async():\n    time.sleep(3)\n    assert True\n");
    const asynchronous = await call(first.client, "command", { ...base, operation: "pytest", async: true }); assert.equal(asynchronous.structuredContent.status, "running");
    const sessionId = asynchronous.structuredContent.sessionId;
    await call(first.client, "session_status", { ...base, sessionId });
    const firstTransportId = first.transport.sessionId;
    await first.client.close(); await oauth.refresh();
    const second = await connect(oauth); assert.notEqual(firstTransportId, second.transport.sessionId);
    const stranger = await connect(otherOAuth);
    assert.equal((await call(stranger.client, "session_status", { ...base, sessionId })).structuredContent.code, "SESSION_DENIED");
    for (const changed of [{ taskId: "other-task" }, { approvalId: "other-approval" }]) assert.equal((await call(second.client, "session_status", { ...base, ...changed, sessionId })).structuredContent.code, "SESSION_DENIED");
    assert.equal((await call(second.client, "read_file", { projectId: base.projectId, path: "../demo/outside.txt" })).structuredContent.code, "ACCESS_DENIED");
    results.crossTransport = await final(second.client, sessionId); assert.equal(results.crossTransport.exitCode, 0); assert.equal(results.crossTransport.commandOk, true); assert.equal(results.crossTransport.outputMode, "snapshot");
    assert.deepEqual((await call(second.client, "session_status", { ...base, sessionId })).structuredContent, results.crossTransport);
    await writeFile(policyPath, JSON.stringify({ ...policy, approvals: [] }));
    assert.equal((await call(second.client, "session_status", { ...base, sessionId })).structuredContent.code, "APPROVAL_DENIED");
    await writeFile(policyPath, JSON.stringify(policy));
    await writeFile(join(project, entry), "import time\ndef test_cancel():\n    time.sleep(25)\n");
    const cancellable = await call(second.client, "command", { ...base, operation: "pytest", async: true }); assert.equal(cancellable.structuredContent.status, "running");
    const cancelled = await call(second.client, "session_cancel", { ...base, sessionId: cancellable.structuredContent.sessionId }); assert.ok(!cancelled.isError); assert.notEqual(cancelled.structuredContent.status, "running"); assert.equal(cancelled.structuredContent.commandOk, false); results.cancelled = cancelled.structuredContent;
    await stopDock(); await startDock();
    const stale = await call(second.client, "session_status", { ...base, sessionId }); assert.equal(stale.structuredContent.code, "SESSION_DENIED"); results.restartDenied = true;
    await writeFile(join(project, entry), passing);
    const restartKey = randomUUID();
    const restartCommand = await call(second.client, "command", { ...base, operation: "pytest", async: true, idempotencyKey: restartKey });
    assert.equal(restartCommand.structuredContent.status, "running");
    const restartSessionId = restartCommand.structuredContent.sessionId;
    assert.equal((await final(second.client, restartSessionId)).exitCode, 0);
    await stopTong(); await startTong();
    await oauth.refresh(); const afterRestart = await connect(oauth);
    assert.equal((await call(afterRestart.client, "session_status", { ...base, sessionId: restartSessionId })).structuredContent.code, "SESSION_DENIED", "a Tong process restart cannot restore in-memory ownership");
    assert.equal((await call(afterRestart.client, "command", { ...base, operation: "pytest", async: true, idempotencyKey: restartKey })).structuredContent.code, "REPLAY_DENIED", "the durable journal must survive a Tong process restart");
    results.tongRestartDenied = true; results.replayAfterRestartDenied = true;
    done = true;
    console.log("PASS: independent Gateway → verified DevSpace OAuth → AgentDock v1.0.1; 21 unchanged Schemas; directory/read/write; pytest 0/1/timeout/cancel; refreshed identity across transports; retained repeat result; foreign identity/task/approval/revocation/replay/restart denial.");
  } catch (error) {
    const message = String(error.message);
    oauth?.assertRedacted(message); otherOAuth?.assertRedacted(message);
    console.error(message.slice(0, 2500));
    throw error;
  } finally {
    await Promise.allSettled(connections.map(value => value.client.close()));
    await stopTong();
    if (dock?.exitCode === null) await stopDock();
    for (const stream of streams) stream.end();
    await Promise.all(streams.map(stream => stream.closed ? undefined : once(stream, "close")));
    const report = { passed: done, root, ports: { agentdockPort, upstreamPort, gatewayPort }, records, results, productionTouched: false };
    oauth?.assertRedacted(report); otherOAuth?.assertRedacted(report);
    for (const stream of streams) { const bytes = await readFile(stream.path); oauth?.assertRedacted(bytes); otherOAuth?.assertRedacted(bytes); assert.ok(!bytes.includes(Buffer.from(agentdockToken))); assert.ok(!bytes.includes(Buffer.from(ownerToken))); }
    await writeFile(join(root, "live-e2e.json"), JSON.stringify(report, null, 2));
  }
}
