import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { TongAgentDockClient } from "../scripts/TongAgentDockClient.mjs";
import { TongAgentDockRouter } from "../scripts/TongAgentDockTools.mjs";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";

if (process.env.TONG_AGENTDOCK_LIVE !== "1") console.log("SKIP: opt-in independent AgentDock v1.0.1 execution acceptance.");
else {
  const poc = process.env.TONG_AGENTDOCK_POC_ROOT, token = process.env.TONG_AGENTDOCK_TOKEN;
  assert.ok(poc && isAbsolute(poc) && token?.length >= 16);
  const dock = new TongAgentDockClient({ controlledExecution: true, tokenProvider: () => token });
  const evidence = join(poc, "isolated", "evidence");
  if (process.env.TONG_AGENTDOCK_LIVE_PHASE === "offline") {
    const state = JSON.parse(await readFile(join(evidence, "p244-live-context.json"), "utf8"));
    const access = new TongProjectAccess(state.accessOptions);
    const audits = [], router = new TongAgentDockRouter({ client: dock, access, policyPath: state.policyPath, audit: event => audits.push(event) });
    try {
      await assert.rejects(router.call("file_edit", { idempotencyKey: randomUUID(), projectId: "synthetic", taskId: "acceptance-task", approvalId: "local-write", action: "add", path: "offline.txt", content: "offline\n" }), error => error.code === "UNAVAILABLE");
      await assert.rejects(readFile(join(state.project, "offline.txt")));
      await assert.rejects(router.call("command", { idempotencyKey: randomUUID(), projectId: "synthetic", taskId: "acceptance-task", approvalId: "local-command", operation: "pytest" }), error => error.code === "UNAVAILABLE");
      await writeFile(join(evidence, "p244-live-offline.json"), JSON.stringify({ passed: true, error: "UNAVAILABLE", fallback: false, audits }, null, 2));
      console.log("PASS: offline write and command fail explicitly, no local fallback or file creation.");
    } finally { await router.close(); }
  } else {
    const root = await mkdtemp(join(poc, "isolated", "workspace", "p244-synthetic-")), project = join(root, "project"), outside = join(root, "outside");
    await mkdir(project); await mkdir(outside); await mkdir(join(project, "nested"));
    await writeFile(join(outside, "canary.txt"), "P244_OUTSIDE_CANARY\n");
    await writeFile(join(project, "hello.txt"), "before\n");
    await writeFile(join(project, "test_sample.py"), "def test_ok():\n    assert True\n");
    const git = process.env.TONG_AGENTDOCK_TEST_GIT, python = process.env.TONG_AGENTDOCK_TEST_PYTHON;
    assert.ok(isAbsolute(git) && isAbsolute(python));
    execFileSync(git, ["init", "--quiet", project]);
    execFileSync(git, ["-C", project, "add", "hello.txt", "test_sample.py"]);
    execFileSync(git, ["-C", project, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "--quiet", "-m", "synthetic baseline"]);
    const state = await mkdtemp(join(poc, "isolated", "state", "p244-policy-")), policyPath = join(state, "access.json");
    const profile = async path => ({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
    const paths = ["new.txt", "hello.txt", "nested/中文.txt", "patched.txt", "offline.txt", "test_sample.py"];
    const approval = { approvalId: "local-write", taskId: "acceptance-task", projectId: "synthetic", capability: "project.write", operations: ["add", "replace", "patch"], paths, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const command = { ...approval, approvalId: "local-command", capability: "command.execute", operations: ["git_status", "git_diff", "pytest"], paths: [...paths, "."] };
    const policy = { schemaVersion: 1, backendWorkspaceRoot: join(poc, "isolated", "workspace"), projects: [{ projectId: "synthetic", root: project, scope: "synthetic", tools: ["read_file", "list_dir", "search_text"], commands: { git: await profile(git), python: await profile(python), pytestEntry: "test_sample.py", gitDiffPaths: ["hello.txt", "test_sample.py"] } }], approvals: [approval, command] };
    await writeFile(policyPath, JSON.stringify(policy));
    const accessOptions = { registryPath: join(state, "projects.json"), agentAccessPath: join(state, "unused-codex-grants.json"), demoRoot: join(root, "unused-demo"), scanRoots: [] };
    const access = new TongProjectAccess(accessOptions), audits = [];
    await access.addProject({ id: "synthetic", name: "P2.4.4 synthetic", root: project, permission: "write" });
    const router = new TongAgentDockRouter({ client: dock, access, policyPath, audit: event => audits.push(event) });
    const invoke = (tool, input) => router.call(tool, ["file_edit", "command"].includes(tool) ? { idempotencyKey: randomUUID(), ...input } : input);
    const base = { projectId: "synthetic", taskId: "acceptance-task", approvalId: "local-write" }, cmdBase = { ...base, approvalId: "local-command" };
    const results = {};
    async function runCommand(input) {
      let value = await invoke("command", { ...cmdBase, ...input }); const handle = value.sessionId;
      let stdout = value.stdout, stderr = value.stderr;
      for (let i = 0; value.status === "running" && i < 100; i++) { await new Promise(resolve => setTimeout(resolve, 100)); value = await invoke("session_status", { ...cmdBase, sessionId: handle }); stdout += value.stdout; stderr += value.stderr; }
      assert.notEqual(value.status, "running"); return { ...value, stdout, stderr };
    }
    try {
      await dock.connect(); assert.equal(dock.serverInfo.version, "1.0.1"); assert.equal((await dock.listTools()).length, 7);
      results.preview = await invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "new\n", dryRun: true });
      await assert.rejects(readFile(join(project, "new.txt")));
      results.add = await invoke("file_edit", { ...base, action: "add", path: "new.txt", content: "new\n" });
      results.replace = await invoke("file_edit", { ...base, action: "replace", path: "hello.txt", old: "before", new: "after" });
      results.patch = await invoke("file_edit", { ...base, action: "patch", patch: "*** Begin Patch\n*** Update File: hello.txt\n@@\n-after\n+patched\n*** Add File: nested/中文.txt\n+unicode\n*** Add File: patched.txt\n+added by patch\n*** End Patch" });
      assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "patched\n");
      assert.equal(await readFile(join(project, "nested", "中文.txt"), "utf8"), "unicode\n");
      console.log("PASS: real AgentDock add, exact replacement, multi-file relative patch, Unicode and verified content.");
      for (const input of [ { ...base, projectId: "unregistered", action: "add", path: "x.txt", content: "x" }, { ...base, approvalId: "unapproved", action: "replace", path: "hello.txt", old: "patched", new: "x" },
        { ...base, action: "add", path: "../outside/canary.txt", content: "x" }, { ...base, action: "add", path: join(outside, "canary.txt"), content: "x" },
        { ...base, action: "patch", patch: "*** Begin Patch\n*** Update File: hello.txt\n@@\n-patched\n+x\n*** Add File: ../outside/new-canary.txt\n+escape\n*** End Patch" } ]) await assert.rejects(invoke("file_edit", input));
      assert.equal(await readFile(join(outside, "canary.txt"), "utf8"), "P244_OUTSIDE_CANARY\n"); await assert.rejects(readFile(join(outside, "new-canary.txt")));
      assert.equal(await readFile(join(project, "hello.txt"), "utf8"), "patched\n");
      await assert.rejects(invoke("command", { ...base, operation: "pytest" }), error => error.code === "APPROVAL_DENIED");
      await assert.rejects(invoke("exec_command", { ...cmdBase, cmd: "whoami" }), error => error.code === "TOOL_DENIED");
      results.gitStatus = await runCommand({ operation: "git_status" }); assert.equal(results.gitStatus.exitCode, 0); assert.ok(results.gitStatus.stdout.includes("hello.txt"));
      results.gitDiff = await runCommand({ operation: "git_diff" }); assert.equal(results.gitDiff.exitCode, 0); assert.ok(results.gitDiff.stdout.includes("+patched"));
      results.pytest = await runCommand({ operation: "pytest" }); assert.equal(results.pytest.exitCode, 0); assert.ok(results.pytest.stdout.includes("1 passed"));
      console.log("PASS: real fixed Git status/diff and pytest exit 0.");
      await invoke("file_edit", { ...base, action: "replace", path: "test_sample.py", old: "assert True", new: "assert False" });
      results.pytestFailure = await runCommand({ operation: "pytest" }); assert.equal(results.pytestFailure.exitCode, 1); assert.equal(results.pytestFailure.commandOk, false);
      await invoke("file_edit", { ...base, action: "replace", path: "test_sample.py", old: "assert False", new: "import time; time.sleep(20); assert True" });
      results.timeout = await runCommand({ operation: "pytest", timeoutMs: 300 }); assert.equal(results.timeout.status, "timeout");
      const running = await invoke("command", { ...cmdBase, operation: "pytest", async: true }); assert.equal(running.status, "running");
      results.sessionStatus = await invoke("session_status", { ...cmdBase, sessionId: running.sessionId }); assert.equal(results.sessionStatus.status, "running");
      results.cancel = await invoke("session_cancel", { ...cmdBase, sessionId: running.sessionId }); assert.equal(results.cancel.status, "killed");
      console.log("PASS: real pytest exit 1, timeout, owned session status and cancellation.");
      assert.ok(!JSON.stringify(audits).includes(token) && !JSON.stringify(audits).includes("P244_OUTSIDE_CANARY"));
      await writeFile(join(evidence, "p244-live-context.json"), JSON.stringify({ project, policyPath, accessOptions }));
      await writeFile(join(evidence, "p244-live-online.json"), JSON.stringify({ passed: true, server: dock.serverInfo, root, results, audits }, null, 2));
    } finally { await router.close(); }
  }
}
