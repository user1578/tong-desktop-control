import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";
import { TongAgentTaskManager } from "../scripts/TongAgentTasks.mjs";
import { registerTongMcpTools } from "../scripts/TongMcpTools.mjs";

const temp = await mkdtemp(join(parse(process.cwd()).root, "tong-mcp-metadata-"));
const scanRoot = join(temp, "scan");
const registered = join(temp, "registered");
const demo = join(temp, "demo");
await mkdir(scanRoot);
await mkdir(registered);
await mkdir(demo);
await writeFile(join(scanRoot, "sample.txt"), "SYNTHETIC_FILE_BODY", "utf8");
const access = new TongProjectAccess({ registryPath: join(temp, "registry.json"), agentAccessPath: join(temp, "agent-access.json"),
  demoRoot: demo, scanRoots: [scanRoot] });
await access.addProject({ id: "registered", name: "Registered", root: registered, permission: "write" });
const tasks = new TongAgentTaskManager({ access, statePath: join(temp, "agent-tasks.json"), executionEnabled: false });
process.env.TONG_RESTRICTED_MCP = "1";
const server = new McpServer({ name: "tong-metadata-test", version: "1" });
registerTongMcpTools(server, registerAppTool, z, access, tasks);
const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name),
    ["tong_list_drives", "tong_scan_directory", "tong_list_projects", "tong_agent_start", "tong_agent_status",
      "tong_agent_list", "tong_agent_logs", "tong_agent_cancel", "tong_agent_resume", "tong_agent_result"]);
  const drives = await client.callTool({ name: "tong_list_drives", arguments: {} });
  assert.equal(drives.isError, undefined);
  assert.equal(drives.structuredContent.drives[0].status, "available");
  const scan = await client.callTool({ name: "tong_scan_directory", arguments: { path: scanRoot, limit: 10 } });
  assert.equal(scan.isError, undefined);
  assert.equal(scan.structuredContent.entries[0].name, "sample.txt");
  assert.ok(!JSON.stringify(scan).includes("SYNTHETIC_FILE_BODY"));
  const denied = await client.callTool({ name: "tong_scan_directory", arguments: { path: registered } });
  assert.equal(denied.isError, true);
  const projects = await client.callTool({ name: "tong_list_projects", arguments: {} });
  assert.equal(projects.isError, undefined);
  assert.equal(projects.structuredContent.projects[1].id, "registered");
  assert.deepEqual(projects.structuredContent.projects[1].effectiveCapabilities, ["project.metadata", "project.read", "project.write"]);
  const startRequest = { projectId: "registered", agent: "codex", task: "synthetic task", scope: "project files",
    idempotencyKey: "mcp-client-request-0001" };
  const deniedStart = await client.callTool({ name: "tong_agent_start", arguments: startRequest });
  assert.equal(deniedStart.isError, true);
  assert.ok(deniedStart.content[0].text.includes("agent.execute"));
  await access.grantAgentExecution("registered");
  const disabledStart = await client.callTool({ name: "tong_agent_start", arguments: startRequest });
  assert.equal(disabledStart.isError, true);
  assert.ok(disabledStart.content[0].text.includes("Worker execution is disabled"));
  assert.deepEqual((await client.callTool({ name: "tong_agent_list", arguments: {} })).structuredContent.tasks, []);
  assert.equal(await readFile(join(scanRoot, "sample.txt"), "utf8"), "SYNTHETIC_FILE_BODY");
  console.log("PASS: MCP tool handlers expose bounded metadata and effective project permissions only.");
} finally {
  await client.close();
  await server.close();
  await tasks.close();
  delete process.env.TONG_RESTRICTED_MCP;
  const actual = await realpath(temp);
  assert.ok(actual.startsWith(parse(process.cwd()).root + "tong-mcp-metadata-"));
  await rm(actual, { recursive: true, force: true });
}
