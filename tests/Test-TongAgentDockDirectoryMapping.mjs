import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TongAgentDockRouter } from "../scripts/TongAgentDockTools.mjs";

// Catches using the backend workspace as the base for list_dir entries,
// accepting fabricated siblings, or omitting the existing path recheck.
const root = await mkdtemp(join(tmpdir(), "tong-directory-mapping-"));
const project = join(root, "project"), nested = join(project, "nested");
await mkdir(nested, { recursive: true });
await writeFile(join(project, "edge.txt"), "edge");
await writeFile(join(nested, "中文.txt"), "nested");
await writeFile(join(root, "outside.txt"), "outside");
const policyPath = join(root, "policy.json");
await writeFile(policyPath, JSON.stringify({ schemaVersion: 1, backendWorkspaceRoot: root,
  projects: [{ projectId: "synthetic", root: project, scope: "synthetic", tools: ["list_dir", "read_file", "search_text"] }] }));
let payload, duringCall;
const client = { async callTool() { await duringCall?.(); return { structuredContent: payload }; }, async close() {} };
const router = new TongAgentDockRouter({ client, policyPath, audit: () => {}, access: {
  listProjects: async () => [{ id: "synthetic", root: project, permission: "read", status: "enabled", available: true }],
} });
const list = (path = ".", maxDepth = 2) => router.call("list_dir", { projectId: "synthetic", path, maxDepth });
const invalid = error => error.code === "INVALID_RESULT";
try {
  payload = { path: "project", entries: [{ path: "edge.txt", type: "file" }, { path: "nested", type: "directory" }, { path: "nested/中文.txt", type: "file" }] };
  assert.deepEqual((await list()).entries.map(item => item.path), ["edge.txt", "nested", "nested/中文.txt"]);
  payload = { path: "project/nested", entries: [{ path: "中文.txt", type: "file" }] };
  assert.deepEqual((await list("nested")).entries, [{ path: "nested/中文.txt", type: "file" }]);
  for (const path of ["../edge.txt", "../outside.txt", join(root, "outside.txt"), "project/edge.txt", "missing.txt", "中文.txt:stream", "C:relative", "\\\\server\\share\\x", "NUL", "edge.txt."]) {
    payload = { path: "project/nested", entries: [{ path, type: "file" }] };
    await assert.rejects(list("nested"), invalid, path);
  }
  payload = { path: "outside", entries: [{ path: "edge.txt", type: "file" }] };
  await assert.rejects(list(), invalid, "returned directory must match the checked request");
  payload = { path: "project", entries: [{ path: "edge.txt", type: "directory" }] };
  await assert.rejects(list(), invalid, "manifest type must match");
  payload = { path: "project", entries: [{ path: "edge.txt", type: "file" }] };
  duringCall = () => writeFile(join(project, "edge.txt"), "changed while listing");
  await assert.rejects(list(), error => error.code === "ACCESS_DENIED");
  duringCall = undefined;
  await symlink(root, join(project, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(list(), error => error.code === "ACCESS_DENIED");
  await rm(join(project, "redirect"));
  await link(join(root, "outside.txt"), join(project, "hardlink.txt"));
  await assert.rejects(list(), error => error.code === "ACCESS_DENIED");
  await rm(join(project, "hardlink.txt"));
  payload = { path: "project/edge.txt", content: "edge" };
  assert.equal((await router.call("read_file", { projectId: "synthetic", path: "edge.txt" })).path, "edge.txt");
  payload = { matches: [{ path: "project/nested/中文.txt", line: 1, preview: "nested" }] };
  assert.equal((await router.call("search_text", { projectId: "synthetic", path: "nested", query: "nested" })).matches[0].path, "nested/中文.txt");
  console.log("PASS: request-relative list entries, nested/unicode files, forged paths, manifest, junction/hardlink and recheck; workspace-relative read/search preserved.");
} finally {
  await router.close();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\tong-directory-mapping-") || resolve(root).startsWith(resolve(tmpdir()) + "/tong-directory-mapping-"));
  await rm(root, { recursive: true, force: true });
}
