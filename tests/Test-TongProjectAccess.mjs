import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { TongProjectAccess } from "../scripts/TongProjectAccess.mjs";

const temp = await mkdtemp(join(parse(process.cwd()).root, "tong-project-access-"));
const scanRoot = join(temp, "scan");
const outside = join(temp, "outside");
const demo = join(temp, "demo");
const registryPath = join(temp, "private-registry.json");
const agentAccessPath = join(temp, "agent-execution.json");
await mkdir(join(scanRoot, "code"), { recursive: true });
await mkdir(outside);
await mkdir(demo);
await writeFile(join(scanRoot, "code", "package.json"), "SYNTHETIC_PRIVATE_BODY", "utf8");
await writeFile(join(outside, "canary.txt"), "SYNTHETIC_OUTSIDE_BODY", "utf8");
await mkdir(join(scanRoot, ".ssh"));
await writeFile(join(scanRoot, ".ssh", "key.txt"), "SYNTHETIC_KEY_BODY", "utf8");
await symlink(outside, join(scanRoot, "junction"), "junction");
let fileSymlinkCreated = false;
try {
  await symlink(join(outside, "canary.txt"), join(scanRoot, "file-link.txt"), "file");
  fileSymlinkCreated = true;
} catch (error) {
  if (!["EPERM", "EACCES"].includes(error?.code)) throw error;
}

try {
  const access = new TongProjectAccess({ registryPath, agentAccessPath, demoRoot: demo, scanRoots: [scanRoot] });
  const first = await access.scanDirectory({ path: scanRoot, maxDepth: 2, limit: 1 });
  assert.equal(first.entries.length, 1);
  assert.ok(first.nextCursor);
  const shallow = await access.scanDirectory({ path: scanRoot, maxDepth: 0, limit: 10 });
  assert.ok(!shallow.entries.some((entry) => entry.name === "package.json"));
  const second = await access.scanDirectory({ path: scanRoot, maxDepth: 2, limit: 10, cursor: first.nextCursor });
  assert.ok(second.entries.some((entry) => entry.name === "package.json"));
  assert.ok(second.possibleProjects.includes(join(scanRoot, "code")));
  assert.ok(second.summary.files >= 1);
  assert.ok(second.summary.bytes >= 1);
  assert.ok(!JSON.stringify([first, second]).includes("SYNTHETIC_PRIVATE_BODY"));
  assert.ok(!JSON.stringify([first, second]).includes("SYNTHETIC_KEY_BODY"));
  assert.ok(!JSON.stringify([first, second]).includes("SYNTHETIC_OUTSIDE_BODY"));
  assert.ok(!JSON.stringify([first, second]).includes("key.txt"));
  assert.ok(!JSON.stringify([first, second]).includes("canary.txt"));
  assert.ok(second.entries.every((entry) => !entry.path.includes("junction")));
  if (fileSymlinkCreated) assert.ok(second.entries.every((entry) => entry.name !== "file-link.txt"));
  assert.equal((await access.scanDirectory({ path: join(scanRoot, "code"), maxDepth: 0 })).entries[0].name, "package.json");
  await assert.rejects(access.scanDirectory({ path: join(scanRoot, "junction") }), /not permitted/i);
  await assert.rejects(access.scanDirectory({ path: join(scanRoot, "missing") }), /not available/i);
  await assert.rejects(access.scanDirectory({ path: "\\\\synthetic-server\\share" }), /not permitted/i);
  await assert.rejects(access.scanDirectory({ path: join(scanRoot, ".ssh") }), /not permitted/i);
  await assert.rejects(access.scanDirectory({ path: outside }), /not permitted/i);
  await assert.rejects(access.scanDirectory({ path: scanRoot, limit: 0 }), /limit/i);
  let clock = 0;
  const deadlineAccess = new TongProjectAccess({ registryPath, demoRoot: demo, scanRoots: [scanRoot],
    now: () => { clock += 1_000; return clock; }, scanBudgetMs: 1 });
  assert.equal((await deadlineAccess.scanDirectory({ path: scanRoot })).truncated, true);

  const drives = await new TongProjectAccess({ registryPath, demoRoot: demo }).listDrives();
  assert.deepEqual(drives.map(({ drive }) => drive), ["C:", "D:"]);
  assert.ok(drives.every(({ status }) => ["available", "missing", "unavailable"].includes(status)));

  const initial = await access.listProjects();
  assert.equal(initial.length, 1);
  assert.equal(initial[0].id, "demo");
  assert.equal(await access.authorize("project.write", "demo"), true);
  assert.equal(await access.authorize("agent.execute", "demo"), false);
  assert.equal(await access.authorize("system.admin", "demo"), false);
  assert.equal(await access.authorize("disk.metadata"), true);

  const added = await access.addProject({ id: "synthetic", name: "Synthetic", root: outside, permission: "write" });
  assert.equal(added.id, "synthetic");
  assert.equal(await access.authorize("project.metadata", "synthetic"), true);
  assert.equal(await access.authorize("project.read", "synthetic"), false);
  assert.equal(await access.authorize("project.write", "synthetic"), false);
  assert.equal(await access.authorize("agent.execute", "synthetic"), false,
    "project registration and file permissions must not imply agent.execute");
  await access.grantAgentExecution("synthetic");
  assert.equal(await access.authorize("agent.execute", "synthetic"), true);
  assert.ok((await access.listProjects()).find((project) => project.id === "synthetic")
    .effectiveCapabilities.includes("agent.execute"));
  const reloadedAccess = new TongProjectAccess({ registryPath, agentAccessPath, demoRoot: demo, scanRoots: [scanRoot] });
  assert.equal(await reloadedAccess.authorize("agent.execute", "synthetic"), true,
    "agent execution grants must persist independently of project registrations");
  await assert.rejects(access.addProject({ id: "synthetic", name: "Duplicate", root: scanRoot, permission: "metadata" }), /duplicate/i);
  await assert.rejects(access.addProject({ id: "demo", name: "Shadow", root: scanRoot, permission: "metadata" }), /duplicate/i);
  await assert.rejects(access.addProject({ id: "duplicate-root", name: "Duplicate", root: outside, permission: "metadata" }), /duplicate/i);
  await assert.rejects(access.addProject({ id: "unc", name: "UNC", root: "\\\\synthetic-server\\share", permission: "metadata" }), /invalid registry path/i);
  await assert.rejects(access.addProject({ id: "ads", name: "ADS", root: `${outside}:stream`, permission: "metadata" }), /invalid registry path/i);
  await assert.rejects(access.addProject({ id: "junction", name: "Junction", root: join(scanRoot, "junction"), permission: "metadata" }), /not permitted/i);
  await assert.rejects(access.addProject({ id: "execute", name: "Execute", root: scanRoot, permission: "execute" }), /invalid registry record/i);
  await rename(outside, join(temp, "moved-outside"));
  assert.equal(await access.authorize("project.metadata", "synthetic"), false);
  await access.disableProject("synthetic");
  assert.equal(await access.authorize("project.metadata", "synthetic"), false);
  assert.equal(await access.authorize("agent.execute", "synthetic"), false,
    "disabled projects must not remain executable");
  await access.revokeAgentExecution("synthetic");
  assert.equal(await access.authorize("agent.execute", "synthetic"), false);
  await assert.rejects(access.grantAgentExecution("missing-project"), /project/i);
  await access.revokeProject("synthetic");
  assert.equal((await access.listProjects()).length, 1);
  const persisted = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.projects[0].status, "revoked");
  await writeFile(registryPath, '{"schemaVersion":1,"projects":[{"id":"invalid"}]}', "utf8");
  await assert.rejects(access.listProjects(), /invalid registry/i);
  console.log("PASS: bounded metadata scan omits content, protected paths and reparse targets; C/D metadata query is read-only.");
  if (!fileSymlinkCreated) console.log("SKIP: Windows did not permit a synthetic file symlink; junction coverage ran.");
  console.log("PASS: local project registry validates roots, permissions, duplicates, disable and revoke.");
} finally {
  const actual = await realpath(temp);
  assert.ok(actual.startsWith(parse(process.cwd()).root + "tong-project-access-"));
  await rm(actual, { recursive: true, force: true });
}
