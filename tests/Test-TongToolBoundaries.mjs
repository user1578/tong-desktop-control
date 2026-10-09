import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoot = await mkdtemp(join(tmpdir(), "tong-tool-boundaries-"));
const workspace = join(temporaryRoot, "workspace");
const outside = join(temporaryRoot, "outside");
const nested = join(workspace, "nested");
await mkdir(nested, { recursive: true });
await mkdir(outside);
await writeFile(join(outside, "canary.txt"), "synthetic outside canary", "utf8");

process.env.TONG_RESTRICTED_MCP = "1";
process.env.TONG_RESTRICTED_ROOT = workspace;

const { readFileTool, writeFileTool, editFileTool, runShellTool } = await import("../node_modules/@waishnav/devspace/dist/pi-tools.js");
const context = { cwd: workspace, root: workspace };

async function denied(operation, description) {
  try {
    const result = await operation();
    assert.equal(result?.isError, true, `${description} must be rejected`);
  } catch (error) {
    if (error?.name === "AccessDeniedError") return;
    throw error;
  }
}

try {
  assert.equal((await writeFileTool({ path: "nested/created.txt", content: "before" }, context)).isError, undefined);
  const read = await readFileTool({ path: "nested/created.txt" }, context);
  assert.equal(read.isError, undefined);
  assert.ok(read.content.some((item) => item.text?.includes("before")));
  if (process.platform === "win32") {
    const mixedCase = await readFileTool({ path: join(workspace.toUpperCase(), "NESTED", "CREATED.TXT") }, context);
    assert.equal(mixedCase.isError, undefined, "case variants inside the root remain usable on Windows");
  }
  assert.equal((await editFileTool({
    path: "nested/created.txt",
    edits: [{ oldText: "before", newText: "after" }],
  }, context)).isError, undefined);
  assert.equal(await readFile(join(nested, "created.txt"), "utf8"), "after");

  await denied(() => readFileTool({ path: "../outside/canary.txt" }, context), "parent traversal read");
  await denied(() => readFileTool({ path: join(outside, "canary.txt") }, context), "absolute outside read");
  await denied(() => readFileTool({ path: "canary.txt" }, { cwd: outside, root: outside }), "stale outside workspace root");
  await denied(() => writeFileTool({ path: join(outside, "absolute-new.txt"), content: "blocked" }, context), "absolute outside write");
  await denied(() => editFileTool({ path: join(outside, "canary.txt"), edits: [{ oldText: "synthetic", newText: "blocked" }] }, context), "absolute outside edit");
  await denied(() => writeFileTool({ path: "../outside/new.txt", content: "blocked" }, context), "parent traversal write");
  await denied(() => writeFileTool({ path: "missing-parent/new.txt", content: "blocked" }, context), "missing parent write");
  await denied(() => readFileTool({ path: "\\\\synthetic-server\\synthetic-share\\canary.txt" }, context), "UNC read");
  await denied(() => writeFileTool({ path: "C:relative-drive.txt", content: "blocked" }, context), "drive-relative write");

  const shell = await runShellTool({ command: "cat ../outside/canary.txt", timeout: 15 }, context);
  assert.equal(shell.isError, true, "restricted DevSpace must refuse Shell execution itself");

  const junction = join(workspace, "junction");
  await symlink(outside, junction, "junction");
  await denied(() => readFileTool({ path: "junction/canary.txt" }, context), "junction read");
  await denied(() => writeFileTool({ path: "junction/new.txt", content: "blocked" }, context), "junction write");
  await denied(() => editFileTool({
    path: "junction/canary.txt", edits: [{ oldText: "synthetic", newText: "blocked" }],
  }, context), "junction edit");

  await link(join(outside, "canary.txt"), join(workspace, "hard-link.txt"));
  await denied(() => readFileTool({ path: "hard-link.txt" }, context), "hard link read");
  await denied(() => writeFileTool({ path: "hard-link.txt", content: "blocked" }, context), "hard link write");

  const fileLink = join(workspace, "file-link.txt");
  try {
    await symlink(join(outside, "canary.txt"), fileLink, "file");
    await denied(() => readFileTool({ path: "file-link.txt" }, context), "symbolic link read");
    await denied(() => writeFileTool({ path: "file-link.txt", content: "blocked" }, context), "symbolic link write");
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    console.log("SKIP: Windows did not permit a synthetic file symlink; junction coverage ran.");
  }

  assert.equal(await readFile(join(outside, "canary.txt"), "utf8"), "synthetic outside canary");
  await assert.rejects(readFile(join(outside, "new.txt")), { code: "ENOENT" });
  console.log("PASS: direct file tools work inside an isolated synthetic workspace and reject traversal, links, and missing parents.");
  console.log("PASS: direct restricted Shell execution is denied.");
} finally {
  delete process.env.TONG_RESTRICTED_MCP;
  delete process.env.TONG_RESTRICTED_ROOT;
  await rm(temporaryRoot, { recursive: true, force: true });
}
