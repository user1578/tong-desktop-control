import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  filterToolListResponse,
  filterAllowedTools,
  findDisallowedToolCall,
  validateAllowedToolCall,
} from "../scripts/TongMcpGateway.mjs";

const toolsList = {
  jsonrpc: "2.0",
  id: 7,
  result: {
    tools: [
      { name: "open_workspace" },
      { name: "read" },
      { name: "write" },
      { name: "edit" },
      { name: "bash" },
      { name: "exec_command" },
      { name: "write_stdin" },
      { name: "show_changes" },
    ],
    nextCursor: "cursor-1",
  },
};

const filtered = filterAllowedTools(toolsList);
assert.deepEqual(
  filtered.result.tools.map((tool) => tool.name),
  ["open_workspace", "read", "write", "edit"],
);
assert.equal(filtered.result.nextCursor, "cursor-1");

const jsonResponse = filterToolListResponse(
  Buffer.from(JSON.stringify(toolsList)),
  "application/json",
);
assert.deepEqual(JSON.parse(jsonResponse.toString("utf8")), filtered);

const sseResponse = filterToolListResponse(
  Buffer.from(`event: message\ndata: ${JSON.stringify(toolsList)}\n\n`),
  "text/event-stream",
);
assert.ok(!sseResponse.toString("utf8").includes('"name":"bash"'));
assert.ok(sseResponse.toString("utf8").includes('"name":"read"'));

const blocked = { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "bash", arguments: {} } };
assert.equal(findDisallowedToolCall(blocked), blocked);
assert.equal(findDisallowedToolCall({ ...blocked, params: { name: "read" } }), undefined);
assert.equal(findDisallowedToolCall([blocked, { ...blocked, id: 10, params: { name: "read" } }]), blocked);
assert.deepEqual(await validateAllowedToolCall(blocked), {
  code: -32602,
  message: "Tool not found: bash",
});

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-gateway-boundary-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const outsideRoot = join(temporaryRoot, "outside");
await mkdir(workspaceRoot);
await mkdir(outsideRoot);
await writeFile(join(workspaceRoot, "inside.txt"), "synthetic inside canary");
await writeFile(join(outsideRoot, "outside.txt"), "synthetic outside canary");
await symlink(outsideRoot, join(workspaceRoot, "escape"), "junction");

try {
  const openWorkspaceCall = {
    method: "tools/call",
    params: { name: "open_workspace", arguments: { path: workspaceRoot } },
  };
  assert.equal(await validateAllowedToolCall(openWorkspaceCall, workspaceRoot), null);
  assert.ok(await validateAllowedToolCall({
    ...openWorkspaceCall,
    params: { name: "open_workspace", arguments: { path: outsideRoot } },
  }, workspaceRoot));
  assert.equal(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "read", arguments: { workspaceId: "test", path: "inside.txt" } },
  }, workspaceRoot), null);
  assert.ok(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "write", arguments: { workspaceId: "test", path: "..\\outside.txt", content: "blocked" } },
  }, workspaceRoot));
  assert.ok(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "read", arguments: { workspaceId: "test", path: "escape\\outside.txt" } },
  }, workspaceRoot));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("PASS: gateway exposes only open_workspace/read/write/edit in JSON and SSE tool lists.");
console.log("PASS: gateway detects direct and batched calls to disallowed tools.");
console.log("PASS: gateway restricts workspace opening and blocks traversal/junction paths.");
