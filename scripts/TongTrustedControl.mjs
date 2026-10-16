import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { TongProjectAccess } from "./TongProjectAccess.mjs";
import { TongTrustedPolicy } from "./TongTrustedCodexBroker.mjs";

const input = process.argv.slice(2);
let stateDir;
if (input[0] === "--state-dir") {
  if (!input[1] || !isAbsolute(input[1])) throw new Error("State directory must be absolute");
  stateDir = resolve(input[1]);
  input.splice(0, 2);
}
const policy = new TongTrustedPolicy(stateDir ? { policyPath: join(stateDir, "trusted-codex.json"),
  taskStatePath: join(stateDir, "agent-tasks.json") } : {});
const access = new TongProjectAccess(stateDir ? { registryPath: join(stateDir, "project-access.json"),
  agentAccessPath: join(stateDir, "agent-execution.json") } : {});
const [command, ...args] = input;

function usage() {
  throw new Error("Usage: node scripts/TongTrustedControl.mjs [--state-dir ABSOLUTE_DIRECTORY] status | enable --codex ABSOLUTE_CODEX_EXE | disable | stop | grant PROJECT_ID | revoke PROJECT_ID | task TASK_ID | approve TASK_ID");
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
      codexSessionId: task.codexSessionId, sessionMode: task.sessionMode,
      pendingApproval: task.pendingApproval }, null, 2));
  } else if (command === "approve" && args.length === 1) {
    await policy.approveTask(args[0]);
    console.log(`Approved one execution of task ${args[0]}.`);
  } else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Trusted control failed");
  process.exitCode = 1;
}
