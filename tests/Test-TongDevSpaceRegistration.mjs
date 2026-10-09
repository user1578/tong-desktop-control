import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, createServer } from "../node_modules/@waishnav/devspace/dist/server.js";
import { WorkspaceRegistry } from "../node_modules/@waishnav/devspace/dist/workspaces.js";
import { assertTongWorkspaceRoot } from "../scripts/TongSafeFilePath.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-tool-registration-"));
const workspaceRoot = join(temporaryRoot, "workspace");
await mkdir(workspaceRoot);
const outsideAgentDir = join(temporaryRoot, "outside-agent-dir");
await mkdir(outsideAgentDir);
await writeFile(join(workspaceRoot, "AGENTS.md"), "synthetic workspace instructions", "utf8");
await writeFile(join(outsideAgentDir, "AGENTS.md"), "synthetic outside instructions", "utf8");
process.env.TONG_RESTRICTED_MCP = "1";
process.env.TONG_RESTRICTED_ROOT = workspaceRoot;

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
  assert.deepEqual(names, ["open_workspace", "read", "write", "edit"]);
  const deniedCalls = await Promise.allSettled([
    client.callTool({ name: "bash", arguments: { workspaceId: "synthetic", command: "cat ../outside/canary.txt" } }),
    client.callTool({ name: "exec_command", arguments: { workspaceId: "synthetic", command: "cat ../outside/canary.txt" } }),
    client.callTool({ name: "write_stdin", arguments: { workspaceId: "synthetic", chars: "blocked" } }),
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
  console.log("PASS: restricted DevSpace registers only four tools and rejects Shell aliases and unauthorized workspace modes.");
} finally {
  await client.close();
  await server.close();
  delete process.env.TONG_RESTRICTED_MCP;
  delete process.env.TONG_RESTRICTED_ROOT;
  await rm(temporaryRoot, { recursive: true, force: true });
}
