import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TongAgentDockRouter } from "../scripts/TongAgentDockTools.mjs";
import { dockError } from "../scripts/TongAgentDockClient.mjs";
const root = await mkdtemp(join(tmpdir(), "tong-replay-")), project = join(root, "project"), state = join(root, "state");
await mkdir(project); await mkdir(state); await writeFile(join(project, "text.txt"), "A");
const policyPath = join(state, "policy.json");
await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, projects: [{ projectId: "synthetic", root: project, scope: "synthetic", tools: ["read_file"] }],
  approvals: [{ approvalId: "local-write", taskId: "one-task", projectId: "synthetic", capability: "project.write", operations: ["replace"], paths: ["text.txt"], expiresAt: new Date(Date.now() + 600000).toISOString() }] }));
const access = { listProjects: async () => [{ id: "synthetic", root: project, status: "enabled", available: true, permission: "write" }] };
let commits = 0, failAfterWrite = false;
const client = { connect: async () => {}, close: async () => {}, callTool: async (_name, args) => {
  if (!args.dry_run) { commits++; await writeFile(args.path, (await readFile(args.path, "utf8")).replace(args.old, () => args.new)); if (failAfterWrite) throw dockError("TOOL_FAILED"); }
  return { structuredContent: { dry_run: args.dry_run, path: args.path, diff_preview: "synthetic" } };
} };
const audits = [], makeRouter = () => new TongAgentDockRouter({ client, access, policyPath, audit: event => audits.push(event) });
const input = { projectId: "synthetic", taskId: "one-task", approvalId: "local-write", action: "replace", path: "text.txt", old: "A", new: "AB", idempotencyKey: "synthetic-operation-001" };
try {
  const router = makeRouter(); await router.call("file_edit", input); assert.equal(await readFile(join(project, "text.txt"), "utf8"), "AB");
  await assert.rejects(makeRouter().call("file_edit", input), error => error.code === "REPLAY_DENIED");
  assert.equal(commits, 1); assert.equal(await readFile(join(project, "text.txt"), "utf8"), "AB");
  // A distinct explicitly requested operation is allowed within the same approved task.
  await router.call("file_edit", { ...input, idempotencyKey: "synthetic-operation-002" }); assert.equal(commits, 2);
  await assert.rejects(router.call("file_edit", { ...input, idempotencyKey: undefined }), error => error.code === "INVALID_ARGUMENT");
  failAfterWrite = true;
  await assert.rejects(router.call("file_edit", { ...input, idempotencyKey: "synthetic-operation-003" }), error => error.effect === "unknown");
  assert.equal(await readFile(join(project, "text.txt"), "utf8"), "ABBB");
  assert.equal(audits.at(-1).effect, "unknown");
  await assert.rejects(makeRouter().call("file_edit", { ...input, idempotencyKey: "synthetic-operation-003" }), error => error.code === "REPLAY_DENIED");
  assert.equal(commits, 3);
  const records = (await import("node:fs/promises")).readdir;
  for (const name of await records(join(state, "agentdock-operations"))) { const text = await readFile(join(state, "agentdock-operations", name), "utf8"); assert.ok(!text.includes("ABBB") && !text.includes("synthetic backend failed")); }
  console.log("PASS: replay blocked across Routers, missing key denied, explicit new operation allowed, uncertain backend effects preserved.");
} finally { assert.ok(root.startsWith(join(tmpdir(), "tong-replay-"))); await rm(root, { recursive: true, force: true }); }
