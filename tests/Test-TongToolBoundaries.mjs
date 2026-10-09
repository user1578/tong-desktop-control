import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  editFileTool,
  readFileTool,
  runShellTool,
  writeFileTool,
} from "../node_modules/@waishnav/devspace/dist/pi-tools.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(projectRoot, "demo-workspace");
const suffix = randomUUID();
const marker = `TONG-BOUNDARY-CANARY-${suffix}`;
const parentCanaryName = `.tong-shell-boundary-${suffix}.txt`;
const parentCanary = path.join(projectRoot, parentCanaryName);
const workspaceCanaryName = `.tong-file-boundary-${suffix}.txt`;
const workspaceCanary = path.join(workspace, workspaceCanaryName);
const junctionName = `.tong-junction-${suffix}`;
const junctionPath = path.join(workspace, junctionName);
const junctionWriteName = `.tong-junction-write-${suffix}.txt`;
const junctionWritePath = path.join(projectRoot, junctionWriteName);
const context = { cwd: workspace, root: workspace };

let junctionCreated = false;
try {
  const write = await writeFileTool(
    { path: workspaceCanaryName, content: marker },
    context,
  );
  assert.equal(write.isError, undefined, "workspace write should succeed");

  const read = await readFileTool({ path: workspaceCanaryName }, context);
  assert.equal(read.isError, undefined, "workspace read should succeed");
  assert.ok(read.content.some((item) => item.text?.includes(marker)));
  const edit = await editFileTool(
    {
      path: workspaceCanaryName,
      edits: [{ oldText: marker, newText: `${marker}-EDITED` }],
    },
    context,
  );
  assert.equal(edit.isError, undefined, "workspace edit should succeed");
  const edited = await readFileTool({ path: workspaceCanaryName }, context);
  assert.ok(edited.content.some((item) => item.text?.includes(`${marker}-EDITED`)));
  console.log("PASS: DevSpace file read/write/edit works inside demo-workspace.");

  await writeFile(parentCanary, marker, "utf8");

  let traversalDenied = false;
  try {
    await readFileTool({ path: `../${parentCanaryName}` }, context);
  } catch (error) {
    traversalDenied = error?.name === "AccessDeniedError";
  }
  assert.equal(traversalDenied, true, "direct file-tool traversal should be rejected");
  console.log("PASS: direct file-tool path traversal is rejected.");

  const shell = await runShellTool(
    { command: `cat ../${parentCanaryName}`, timeout: 15 },
    context,
  );
  assert.equal(shell.isError, undefined, "the documented Bash tool should run");
  assert.ok(shell.content.some((item) => item.text?.includes(marker)));
  console.log("CONFIRMED: Bash reads a synthetic file above the allowed root.");

  try {
    await symlink(projectRoot, junctionPath, "junction");
    junctionCreated = true;
    const junctionRead = await readFileTool(
      { path: `${junctionName}/${parentCanaryName}` },
      context,
    );
    if (junctionRead.isError || !junctionRead.content.some((item) => item.text?.includes(marker))) {
      console.log("PASS: this Windows DevSpace build blocked a junction escape.");
    } else {
      console.log("CONFIRMED: a Windows junction lets the file tool read the synthetic parent canary.");
    }

    const junctionWrite = await writeFileTool(
      { path: `${junctionName}/${junctionWriteName}`, content: marker },
      context,
    );
    if (junctionWrite.isError) {
      console.log("PASS: this Windows DevSpace build blocked a junction write escape.");
    } else {
      console.log("CONFIRMED: a Windows junction lets the file tool write a synthetic parent canary.");
    }
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "ENOTSUP") {
      console.log("SKIP: Windows did not allow creating the test junction.");
    } else {
      throw error;
    }
  }
} finally {
  if (junctionCreated) await unlink(junctionPath).catch(() => {});
  await unlink(workspaceCanary).catch(() => {});
  await unlink(parentCanary).catch(() => {});
  await unlink(junctionWritePath).catch(() => {});
}
