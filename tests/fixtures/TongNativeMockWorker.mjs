import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";

function tryFile(path, operation) {
  try {
    if (operation === "read") readFileSync(path);
    if (operation === "write") writeFileSync(path, "synthetic");
    if (operation === "delete") unlinkSync(path);
    return "allowed";
  } catch { return "denied"; }
}

if (process.argv[2] === "--linger") {
  setTimeout(() => {}, 600_000);
} else if (process.argv[2] === "--child") {
  const project = process.argv[3];
  writeFileSync(join(project, "child.json"), JSON.stringify({
    project: tryFile(join(project, "child.canary"), "write"),
    other: tryFile(join(dirname(project), "other", "canary.txt"), "read"),
  }));
} else {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.once("line", (line) => {
    const request = JSON.parse(line);
    const project = request.envelope.payload.projectRoot;
    if (request.envelope.payload.prompt === "hang") {
      const linger = spawn(process.execPath, [process.argv[1], "--linger"],
        { stdio: "ignore", windowsHide: true });
      writeFileSync(join(project, "hang-pid.txt"), String(linger.pid));
      linger.unref();
      setTimeout(() => {}, 600_000);
      return;
    }
    const parent = dirname(project);
    const results = {
      projectRead: tryFile(join(project, "canary.txt"), "read"),
      projectWrite: tryFile(join(project, "write.canary"), "write"),
      projectDelete: tryFile(join(project, "delete.canary"), "delete"),
      junctionRead: tryFile(join(project, "outside-link", "canary.txt"), "read"),
      environmentSecretAbsent: !process.env.OPENAI_API_KEY && !process.env.CODEX_ACCESS_TOKEN
        && !process.env.TONG_SYNTHETIC_SECRET_CANARY,
    };
    for (const name of ["other", "private", "auth"]) {
      for (const action of ["read", "write", "delete"]) {
        results[`${name}${action}`] = tryFile(join(parent, name, "canary.txt"), action);
      }
    }
    const attestation = spawnSync(process.env.TONG_WORKER_NATIVE,
      ["--attest", process.env.TONG_WORKER_SID, process.env.TONG_WORKER_TASK_SID,
        process.env.TONG_GATEWAY_ACCOUNT_SID, project, process.env.TONG_WORKER_TASK_ID,
        process.env.TONG_SUPERVISOR_SERVICE_SID],
      { encoding: "utf8", timeout: 10_000, windowsHide: true });
    results.token = JSON.parse(attestation.stdout);
    const child = spawnSync(process.execPath, [process.argv[1], "--child", project],
      { timeout: 10_000, windowsHide: true });
    results.childExitCode = child.status;
    results.child = JSON.parse(readFileSync(join(project, "child.json"), "utf8"));
    const linger = spawn(process.execPath, [process.argv[1], "--linger"],
      { stdio: "ignore", windowsHide: true });
    results.lingerPid = linger.pid;
    linger.unref();
    process.stdout.write(JSON.stringify({ protocolVersion: 1, kind: "result", taskId: request.taskId,
      result: { turnStatus: "completed", summary: JSON.stringify(results) } }) + "\n", () => process.exit(0));
  });
}
