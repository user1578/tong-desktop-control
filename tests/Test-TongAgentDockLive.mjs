import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import { TongAgentDockClient } from "../scripts/TongAgentDockClient.mjs";
import { TongAgentDockRouter, registerAgentDockTools } from "../scripts/TongAgentDockTools.mjs";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";

if (process.env.TONG_AGENTDOCK_LIVE !== "1") {
  console.log("SKIP: opt-in local AgentDock smoke test; set TONG_AGENTDOCK_LIVE=1.");
} else {
  const poc = process.env.TONG_AGENTDOCK_POC_ROOT;
  assert.ok(poc && isAbsolute(poc), "explicit PoC root required");
  const token = process.env.TONG_AGENTDOCK_TOKEN;
  assert.ok(token?.length >= 16, "local test token must be supplied without printing it");
  const dock = new TongAgentDockClient({ tokenProvider: () => token });
  const phase = process.env.TONG_AGENTDOCK_LIVE_PHASE ?? "online";
  const evidence = join(poc, "isolated", "evidence");
  if (phase === "offline") {
    try {
      await assert.rejects(dock.connect(), (error) => error.code === "UNAVAILABLE" && !String(error).includes(token));
      await writeFile(join(evidence, "p243-live-offline.json"), JSON.stringify({ phase, result: "passed", errorType: "UNAVAILABLE", fallback: false }, null, 2));
      console.log("PASS: stopped AgentDock reports UNAVAILABLE without leaking credentials or executing a fallback.");
    } finally { await dock.close(); }
  } else {
    const root = await mkdtemp(join(poc, "p243-live-"));
    const project = join(root, "project"), outside = join(root, "outside");
    await mkdir(project); await mkdir(outside);
    await writeFile(join(project, "hello.txt"), "P243_SYNTHETIC_HELLO\n");
    await mkdir(join(project, "nested"));
    await writeFile(join(project, "nested", "中文.txt"), "P243_NESTED_ONLY\n");
    await writeFile(join(outside, "canary.txt"), "P243_OUTSIDE_CANARY\n");
    const state = await mkdtemp(join(poc, "isolated", "state", "p243-client-"));
    const access = new TongProjectAccess({ registryPath: join(state, "projects.json"), agentAccessPath: join(state, "codex-grants.json"), demoRoot: join(root, "unused-demo"), scanRoots: [] });
    await access.addProject({ id: "p243-synthetic", name: "P2.4.3 synthetic", root: project, permission: "read" });
    const policyPath = join(state, "agentdock-access.json");
    await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, projects: [{ projectId: "p243-synthetic", root: project, scope: "synthetic", tools: ["list_dir", "read_file", "search_text"] }] }));
    const audit = [];
    const router = new TongAgentDockRouter({ client: dock, access, policyPath, audit: (event) => audit.push(event) });
    const bad = new TongAgentDockClient({ tokenProvider: () => token + "-wrong" });
    const server = new McpServer({ name: "tong-local-agentdock-smoke", version: "1" });
    const inbound = new Client({ name: "synthetic-inbound-client", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    registerAgentDockTools(server, registerAppTool, z, router);
    try {
      await dock.connect();
      assert.equal(dock.serverInfo.version, "1.0.1");
      assert.equal(dock.discoveredToolCount, 18);
      assert.deepEqual((await dock.listTools()).map(({ name }) => name).sort(), ["list_dir", "read_file", "search_text"]);
      await server.connect(right); await inbound.connect(left);
      const read = await inbound.callTool({ name: "tong_agentdock_read_file", arguments: { projectId: "p243-synthetic", path: "hello.txt" } });
      assert.equal(read.structuredContent.content, "P243_SYNTHETIC_HELLO\n");
      assert.equal((await router.call("list_dir", { projectId: "p243-synthetic", path: "." })).entries.length, 2);
      const nested = await router.call("list_dir", { projectId: "p243-synthetic", path: ".", maxDepth: 2 });
      assert.ok(nested.entries.some((item) => item.path === "nested/中文.txt"));
      assert.equal((await router.call("read_file", { projectId: "p243-synthetic", path: "nested/中文.txt" })).content, "P243_NESTED_ONLY\n");
      assert.equal((await router.call("search_text", { projectId: "p243-synthetic", path: ".", query: "HELLO" })).matches.length, 1);
      const denied = await inbound.callTool({ name: "tong_agentdock_read_file", arguments: { projectId: "p243-synthetic", path: "../outside/canary.txt" } });
      assert.equal(denied.structuredContent.code, "ACCESS_DENIED");
      assert.ok(!JSON.stringify(denied).includes("P243_OUTSIDE_CANARY"));
      await assert.rejects(router.call("exec_command", { projectId: "p243-synthetic", path: "." }), (error) => error.code === "TOOL_DENIED");
      await assert.rejects(bad.connect(), (error) => error.code === "AUTH_FAILED" && !String(error).includes(token));
      assert.ok(!JSON.stringify(audit).includes(token) && !JSON.stringify(audit).includes("P243_SYNTHETIC_HELLO"));
      const summary = { phase, result: "passed", server: dock.serverInfo, discoveredTools: dock.discoveredToolCount,
        mappedTools: 3, authorizedRead: true, list: true, search: true, unicodePath: true, nestedDepths: true, outsidePathDenied: true,
        shellDenied: true, wrongTokenDenied: true, syntheticRoot: root, protectedPolicyDirectory: state, audit };
      await writeFile(join(evidence, "p243-live-online.json"), JSON.stringify(summary, null, 2));
      console.log("PASS: AgentDock v1.0.1 SDK connection, 18 discovered tools, three mapped read tools, grants, path/tool denial and token safety.");
    } finally { await bad.close(); await inbound.close(); await server.close(); await router.close(); }
  }
}
