import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, createServer } from "../node_modules/@waishnav/devspace/dist/server.js";
import { WorkspaceRegistry } from "../node_modules/@waishnav/devspace/dist/workspaces.js";
import { assertTongWorkspaceRoot } from "../scripts/TongSafeFilePath.mjs";
import { closeTongMcpTools } from "../scripts/TongMcpTools.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-tool-registration-"));
const workspaceRoot = join(temporaryRoot, "workspace");
await mkdir(workspaceRoot);
const outsideAgentDir = join(temporaryRoot, "outside-agent-dir");
await mkdir(outsideAgentDir);
await writeFile(join(workspaceRoot, "AGENTS.md"), "synthetic workspace instructions", "utf8");
await writeFile(join(outsideAgentDir, "AGENTS.md"), "synthetic outside instructions", "utf8");
process.env.TONG_RESTRICTED_MCP = "1";
process.env.TONG_RESTRICTED_ROOT = workspaceRoot;
process.env.TONG_LOCAL_STATE_DIR = join(temporaryRoot, "state");

const config = {
  toolMode: "minimal",
  widgets: "off",
  skillsEnabled: false,
  artifactsEnabled: false,
  subagents: { enabled: false, providers: [] },
  publicBaseUrl: "http://127.0.0.1:7677",
  logging: { level: "silent", format: "json" },
  allowedRoots: [workspaceRoot],
  agentDir: workspaceRoot,
};
let opened = 0;
const workspaces = { openWorkspace: async () => { opened++; throw new Error("synthetic workspace stub invoked"); } };
const server = createMcpServer(config, workspaces, null, null, () => [], []);
const client = new Client({ name: "synthetic-boundary-client", version: "1" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const names = (await client.listTools()).tools.map(({ name }) => name);
  assert.deepEqual(names, ["open_workspace", "read", "write", "edit",
    "tong_list_directory", "tong_delete_file", "tong_move_file", "tong_run_command",
    "tong_list_drives", "tong_dev_environment", "tong_windows_inspect", "tong_scan_directory", "tong_list_projects", "tong_project_prepare",
    "tong_agent_start", "tong_agent_sessions", "tong_agent_status", "tong_agent_wait", "tong_agent_list",
    "tong_agent_logs", "tong_agent_cancel", "tong_agent_resume", "tong_agent_result",
    "tong_goal_start", "tong_goal_status", "tong_goal_result", "tong_goal_cancel", "tong_goal_resume", "tong_goal_review", "tong_goal_list"]);
  const goalList=await client.callTool({name:"tong_goal_list",arguments:{}});
  assert.equal(goalList.isError,undefined,"authorized MCP can inspect its empty goal registry");
  assert.deepEqual(goalList.structuredContent.goals,[]);
  const secondServer = createMcpServer(config, workspaces, null, null, () => [], []);
  const secondClient = new Client({ name: "second-synthetic-client", version: "1" }, { capabilities: {} });
  const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await secondServer.connect(secondServerTransport);
    await secondClient.connect(secondClientTransport);
    assert.deepEqual((await secondClient.listTools()).tools.map(({ name }) => name), names,
      "multiple MCP sessions in one DevSpace process must share one task manager");
  } finally {
    await secondClient.close();
    await secondServer.close();
  }
  process.env.TONG_AGENTDOCK_ENABLED = "1";
  process.env.TONG_AGENTDOCK_POLICY_PATH = join(temporaryRoot, "no-agentdock-grants.json");
  const dockServer = createMcpServer(config, workspaces, null, null, () => [], []);
  const dockClient = new Client({ name: "agentdock-registration-client", version: "1" });
  const [dockLeft, dockRight] = InMemoryTransport.createLinkedPair();
  try {
    await dockServer.connect(dockRight); await dockClient.connect(dockLeft);
    const dockNames = (await dockClient.listTools()).tools.map(({ name }) => name);
    for (const name of ["tong_agentdock_list_dir", "tong_agentdock_read_file", "tong_agentdock_search_text", "tong_agentdock_file_edit", "tong_agentdock_command", "tong_agentdock_session_status", "tong_agentdock_session_cancel"]) assert.ok(dockNames.includes(name));
    for (const name of ["exec_command", "file_edit", "session_act", "mcp_tool_call"]) assert.ok(!dockNames.includes(name));
    const deniedRead = await dockClient.callTool({ name: "tong_agentdock_read_file", arguments: { projectId: "demo", path: "AGENTS.md" } });
    assert.equal(deniedRead.structuredContent.code, "PROJECT_DENIED");
    const deniedWrite = await dockClient.callTool({ name: "tong_agentdock_file_edit", arguments: { projectId: "demo", taskId: "synthetic-task", approvalId: "unapproved", idempotencyKey: "registration-operation-001", action: "add", path: "x.txt", content: "x" } });
    assert.equal(deniedWrite.structuredContent.code, "PROJECT_DENIED");
    const deniedCommand = await dockClient.callTool({ name: "tong_agentdock_command", arguments: { projectId: "demo", taskId: "synthetic-task", approvalId: "unapproved", idempotencyKey: "registration-operation-002", operation: "git_status" } });
    assert.equal(deniedCommand.structuredContent.code, "PROJECT_DENIED");
  } finally {
    await dockClient.close(); await dockServer.close();
    delete process.env.TONG_AGENTDOCK_ENABLED; delete process.env.TONG_AGENTDOCK_POLICY_PATH;
  }
  const deniedCalls = await Promise.allSettled([
    client.callTool({ name: "bash", arguments: { workspaceId: "synthetic", command: "cat ../outside/canary.txt" } }),
    client.callTool({ name: "exec_command", arguments: { workspaceId: "synthetic", command: "cat ../outside/canary.txt" } }),
    client.callTool({ name: "write_stdin", arguments: { workspaceId: "synthetic", chars: "blocked" } }),
    client.callTool({ name: "tong_add_project", arguments: { path: workspaceRoot, permission: "write" } }),
  ]);
  assert.ok(deniedCalls.every(({ status, value }) => status === "rejected" || value?.isError === true));
  const outsideOpen = await client.callTool({ name: "open_workspace", arguments: {
    path: join(temporaryRoot, "outside"), mode: "checkout",
  } });
  assert.equal(outsideOpen.isError, true);
  const worktreeOpen = await client.callTool({ name: "open_workspace", arguments: {
    path: workspaceRoot, mode: "worktree",
  } });
  assert.equal(worktreeOpen.isError, true);
  assert.equal(opened, 0, "denied workspace opens must stop before registry access");
  await assertTongWorkspaceRoot(workspaceRoot, "checkout");
  assert.throws(() => createServer({ ...config, toolMode: "codex" }), /Restricted MCP configuration/);
  assert.throws(() => createServer({ ...config, artifactsEnabled: true }), /Restricted MCP configuration/);
  assert.throws(() => createServer({ ...config, allowedRoots: [temporaryRoot] }), /Restricted MCP configuration/);
  assert.throws(() => createServer({ ...config, agentDir: outsideAgentDir }), /Restricted MCP configuration/);
  const authorizedWorkspace = await new WorkspaceRegistry(config).openWorkspace({ path: workspaceRoot, mode: "checkout" });
  const instructions = JSON.stringify(authorizedWorkspace.agentsFiles);
  assert.match(instructions, /synthetic workspace instructions/);
  assert.doesNotMatch(instructions, /synthetic outside instructions/);
  assert.deepEqual(authorizedWorkspace.availableAgentsFiles, []);
  await unlink(join(workspaceRoot, "AGENTS.md"));
  await link(join(outsideAgentDir, "AGENTS.md"), join(workspaceRoot, "AGENTS.md"));
  const linkedWorkspace = await new WorkspaceRegistry(config).openWorkspace({ path: workspaceRoot, mode: "checkout" });
  assert.doesNotMatch(JSON.stringify(linkedWorkspace.agentsFiles), /synthetic outside instructions/);
  assert.deepEqual(linkedWorkspace.availableAgentsFiles, []);
  console.log("PASS: restricted DevSpace registers file, workspace and agent tools and rejects Shell aliases and unauthorized workspace modes.");
} finally {
  await client.close();
  await server.close();
  await closeTongMcpTools();
  delete process.env.TONG_RESTRICTED_MCP;
  delete process.env.TONG_RESTRICTED_ROOT;
  delete process.env.TONG_LOCAL_STATE_DIR;
  await rm(temporaryRoot, { recursive: true, force: true });
}
