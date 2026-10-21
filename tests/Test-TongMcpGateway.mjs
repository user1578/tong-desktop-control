import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  filterToolListResponse,
  filterAllowedTools,
  findDisallowedToolCall,
  startMcpGateway,
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
      { name: "tong_list_drives" },
      { name: "tong_windows_inspect" },
      { name: "tong_dev_environment" },
      { name: "tong_scan_directory" },
      { name: "tong_list_projects" },
      { name: "tong_agent_start" },
      { name: "tong_agent_status" },
      { name: "tong_agent_wait" },
      { name: "tong_agent_list" },
      { name: "tong_agent_logs" },
      { name: "tong_agent_cancel" },
      { name: "tong_agent_resume" },
      { name: "tong_agent_result" },
      { name: "tong_agent_sessions" },
      { name: "tong_project_prepare" },
      { name: "tong_goal_start" },
      { name: "tong_goal_status" },
      { name: "tong_goal_list" },
      { name: "tong_goal_result" },
      { name: "tong_goal_cancel" },
      { name: "tong_goal_review" },
      { name: "tong_goal_resume" },
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
  ["open_workspace", "read", "write", "edit", "tong_list_drives", "tong_windows_inspect", "tong_dev_environment", "tong_scan_directory", "tong_list_projects",
    "tong_agent_start", "tong_agent_status", "tong_agent_wait", "tong_agent_list", "tong_agent_logs", "tong_agent_cancel", "tong_agent_resume", "tong_agent_result", "tong_agent_sessions", "tong_project_prepare",
    "tong_goal_start", "tong_goal_status", "tong_goal_list", "tong_goal_result", "tong_goal_cancel", "tong_goal_review", "tong_goal_resume"],
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
assert.equal(findDisallowedToolCall({ ...blocked, params: { name: "tong_scan_directory" } }), undefined);
assert.equal(findDisallowedToolCall({ ...blocked, params: { name: "tong_windows_inspect" } }), undefined);
assert.equal(findDisallowedToolCall({ ...blocked, params: { name: "tong_dev_environment" } }), undefined);
assert.equal(findDisallowedToolCall({ ...blocked, params: { name: "tong_agent_wait" } }), undefined);
assert.ok(findDisallowedToolCall({ ...blocked, params: { name: "tong_add_project" } }));
assert.equal(findDisallowedToolCall([blocked, { ...blocked, id: 10, params: { name: "read" } }]), blocked);
assert.deepEqual(await validateAllowedToolCall(blocked), {
  code: -32602,
  message: "Tool not found: bash",
});
const validTask = { projectId: "project-1", agent: "codex", task: "Make a small change", scope: "project files and tests",
  idempotencyKey: "gateway-client-request-001" };
assert.equal(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_agent_start", arguments: validTask } }), null);
assert.equal(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_agent_start", arguments: { ...validTask, requiredCapabilities: ["project.read","git.push"] } } }), null);
assert.equal(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_project_prepare", arguments: { projectPath: "D:\\\\作业\\\\26ict\\\\TravelGuard" } } }), null);
assert.ok(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_project_prepare", arguments: { projectPath: "oops", grant: true } } }));
assert.equal(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_agent_start",
  arguments: { ...validTask, sessionMode: "existing", codexSessionId: "019a1234-1234-7123-8123-123456789abc" } } }), null);
assert.equal(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_agent_sessions",
  arguments: { projectId: "project-one", limit: 10, searchTerm: "Acceptance" } } }), null);
const validGoal = {
  projectId:"p0-homework-111",agent:"codex",goal:"Check test project",scope:"Read-only test",
  idempotencyKey:"goal-gateway-acceptance-001",
  steps:[{id:"check",title:"Check",instruction:"Inspect list",
    verification:{type:"read-only-turn"}}],
};
assert.equal(await validateAllowedToolCall({method:"tools/call",params:{
  name:"tong_goal_start",arguments:validGoal
}}),null);
for(const invalidGoal of [
  {...validGoal,agent:"zcode"},
  {...validGoal,maxRounds:999},
  {...validGoal,steps:[{...validGoal.steps[0],verification:{type:"files-exist",paths:["..\\private"]}}]},
  {...validGoal,execute:"powershell"},
]) assert.ok(await validateAllowedToolCall({method:"tools/call",params:{
  name:"tong_goal_start",arguments:invalidGoal
}}),"reject unregistered agents and unsafe goal steps");
assert.equal(await validateAllowedToolCall({method:"tools/call",params:{name:"tong_goal_list",arguments:{}}}),null);
const watchId = "123e4567-e89b-42d3-a456-426614174000";
assert.equal(await validateAllowedToolCall({method:"tools/call",params:{
  name:"tong_goal_review",arguments:{goalId:watchId,accepted:true,evidence:"Verified the expected file and tested all required cases"}
}}),null);
assert.ok(await validateAllowedToolCall({method:"tools/call",params:{
  name:"tong_goal_review",arguments:{goalId:watchId,accepted:true,evidence:"short"}
}}));
assert.equal(await validateAllowedToolCall({method:"tools/call",params:{
  name:"tong_goal_status",arguments:{goalId:watchId}
}}),null);
assert.equal(await validateAllowedToolCall({ method:"tools/call", params:{
  name:"tong_agent_wait",arguments:{taskId:watchId,waitSeconds:10,afterUpdatedAt:"2026-10-21T01:30:00.000Z"}
} }), null);
for (const watch of [
  {taskId:watchId,waitSeconds:60},{taskId:"../private",waitSeconds:3},
  {taskId:watchId,afterUpdatedAt:"not a timestamp"}
]) assert.ok(await validateAllowedToolCall({method:"tools/call",params:{name:"tong_agent_wait",arguments:watch}}));
for (const args of [{...validTask,sessionMode:"existing"},{...validTask,codexSessionId:"../../outside"},
  {...validTask,sessionMode:"new",sessionSearch:"private"}]) {
  assert.ok(await validateAllowedToolCall({method:"tools/call",params:{name:"tong_agent_start",arguments:args}}));
}
for (const injected of [
  { ...validTask, executable: "powershell.exe" },
  { ...validTask, command: "whoami" },
  { ...validTask, agent: "other-agent" },
  { ...validTask, idempotencyKey: "short" },
  { ...validTask, task: "task\u0000injection" },
  { ...validTask, scope: "scope\u0000injection" },
]) {
  assert.ok(await validateAllowedToolCall({ method: "tools/call", params: { name: "tong_agent_start", arguments: injected } }),
    "Gateway must reject arbitrary executable, shell, agent, and weak idempotency parameters");
}
assert.ok(await validateAllowedToolCall({ method: "tools/call", params: {
  name: "tong_agent_status", arguments: { taskId: "../../outside" },
} }));
assert.ok(await validateAllowedToolCall({ method: "tools/call", params: {
  name: "tong_agent_resume", arguments: { taskId: "123e4567-e89b-42d3-a456-426614174000", message: "invalid\u0000message" },
} }));
assert.ok(findDisallowedToolCall({ method: "tools/call", params: { name: "exec_command", arguments: {} } }));

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
  assert.equal(await validateAllowedToolCall({
    ...openWorkspaceCall,
    params: { name: "open_workspace", arguments: { path: outsideRoot } },
  }, workspaceRoot), null, 'DevSpace resolves authorized roots from current local grants');
  assert.equal(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "tong_scan_directory", arguments: { path: "C:\\" } },
  }, workspaceRoot), null);
  assert.equal(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "read", arguments: { workspaceId: "test", path: "inside.txt" } },
  }, workspaceRoot), null);
  assert.ok(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "write", arguments: { workspaceId: "test", path: "..\\outside.txt", content: "blocked" } },
  }, workspaceRoot));
  assert.equal(await validateAllowedToolCall({
    method: "tools/call",
    params: { name: "read", arguments: { workspaceId: "test", path: "escape\\outside.txt" } },
  }, workspaceRoot), null, 'DevSpace checks links against the actual workspace root');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("PASS: gateway exposes file tools, Windows/system metadata tools, and constrained agent/session tools in JSON and SSE lists.");
console.log("PASS: gateway detects direct and batched calls to disallowed tools.");
console.log("PASS: gateway rejects agent executable injection and malformed task identifiers while retaining the Shell deny list.");
console.log("PASS: gateway blocks traversal; authenticated DevSpace owns workspace grants and junction checks.");

const upstreamPaths = [];
const upstream = createServer((req, res) => {
  upstreamPaths.push(req.url);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const gateway = startMcpGateway({ listenPort: 0, upstreamPort: upstream.address().port, logSink: () => {} });
try {
  await new Promise((resolve) => gateway.once("listening", resolve));
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  for (const path of ["/mcp/", "/MCP", "/MCP/"]) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 404, `${path} must not bypass MCP policy`);
    assert.deepEqual(upstreamPaths, [], `${path} must not reach DevSpace`);
  }
  const canonical = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(canonical.status, 200);
  assert.deepEqual(upstreamPaths, ["/mcp"]);
} finally {
  await new Promise((resolve) => gateway.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
}
console.log("PASS: noncanonical MCP paths cannot bypass Gateway tool policy.");
