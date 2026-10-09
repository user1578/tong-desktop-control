import { readFile } from "node:fs/promises";
import { TongProjectAccess } from "./TongProjectAccess.mjs";
import { TongTrustedPolicy } from "./TongTrustedCodexBroker.mjs";

const policy = new TongTrustedPolicy();
const access = new TongProjectAccess();
const [command, ...args] = process.argv.slice(2);

function usage() {
  throw new Error("Usage: node scripts/TongTrustedControl.mjs status | enable --codex ABSOLUTE_CODEX_EXE | disable | stop | grant PROJECT_ID | revoke PROJECT_ID | task TASK_ID | approve TASK_ID");
}

try {
  if (command === "status" && args.length === 0) {
    console.log(JSON.stringify(await policy.status(), null, 2));
  } else if (command === "enable" && args.length === 2 && args[0] === "--codex") {
    await policy.enable(args[1]);
    console.log("Trusted Windows Codex enabled locally. Each project and task still requires its own grant and approval.");
  } else if (command === "disable" && args.length === 0) {
    await policy.disable();
    console.log("Trusted Windows Codex disabled. Running turns were asked to stop.");
  } else if (command === "stop" && args.length === 0) {
    await policy.emergencyStop();
    console.log("Emergency stop recorded. Running turns were asked to stop; descendant process cleanup is not guaranteed.");
  } else if (command === "grant" && args.length === 1) {
    await policy.grant(args[0], access);
    console.log(`Trusted execution granted to project ${args[0]}.`);
  } else if (command === "revoke" && args.length === 1) {
    await policy.revoke(args[0]);
    console.log(`Trusted execution revoked from project ${args[0]}.`);
  } else if (command === "task" && args.length === 1) {
    const state = JSON.parse(await readFile(policy.taskStatePath, "utf8"));
    const task = state?.tasks?.find((item) => item.taskId === args[0]);
    if (!task) throw new Error("Task not found");
    console.log(JSON.stringify({ taskId: task.taskId, status: task.status, projectId: task.projectId,
      projectRoot: task.projectRoot, task: task.task, scope: task.scope,
      continuationMessage: task.continuationMessage, timeoutMs: task.timeoutMs,
      pendingApproval: task.pendingApproval }, null, 2));
  } else if (command === "approve" && args.length === 1) {
    await policy.approveTask(args[0]);
    console.log(`Approved one execution of task ${args[0]}.`);
  } else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Trusted control failed");
  process.exitCode = 1;
}
