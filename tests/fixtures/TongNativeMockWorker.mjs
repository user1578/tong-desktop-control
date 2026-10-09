import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
  lines.once("line", async (line) => {
    process.stderr.write("fixture: request received\n");
    const request = JSON.parse(line);
    const project = request.envelope.payload.projectRoot;
    writeFileSync(join(project, "worker-started.canary"), "started");
    process.stderr.write("fixture: wrote project canary\n");
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
    for (const name of ["other", "private", "auth", "everyone", "users",
      "all-app-packages", "all-restricted-packages"]) {
      for (const action of ["read", "write", "delete"]) {
        results[`${name}${action}`] = tryFile(join(parent, name, "canary.txt"), action);
      }
    }
    process.stderr.write("fixture: completed filesystem probes\n");
    process.stderr.write("fixture: starting child process probe\n");
    const child = await new Promise((resolve) => {
      const launched = spawn(process.execPath, [process.argv[1], "--child", project],
        { stdio: "ignore", windowsHide: true });
      let settled = false;
      const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const timer = setTimeout(() => { launched.kill(); finish({ status: null, error: "child process timed out" }); }, 10_000);
      launched.once("error", (error) => finish({ status: null, error: error.message }));
      launched.once("close", (status) => finish({ status, error: null }));
    });
    process.stderr.write(`fixture: child ${child.status} ${child.error || ""}\n`);
    results.childExitCode = child.status;
    results.child = existsSync(join(project, "child.json"))
      ? JSON.parse(readFileSync(join(project, "child.json"), "utf8")) : null;
    const version = (executable, args) => new Promise((resolve) => {
      let settled = false;
      const child = spawn(executable, args, { stdio: "ignore", windowsHide: true });
      const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const timer = setTimeout(() => {
        process.stderr.write(`fixture: runtime timeout pid=${child.pid || "none"}\n`);
        child.kill(); finish({ exitCode: null, started: false, error: "runtime probe timed out" });
      }, 10_000);
      child.once("spawn", () => process.stderr.write(`fixture: runtime spawned pid=${child.pid}\n`));
      child.once("error", (error) => finish({ exitCode: null, started: false, error: error.message }));
      child.once("close", (exitCode) => finish({ exitCode, started: exitCode === 0, error: null }));
    });
    results.runtimeVersions = {};
    for (const [name, executable, args] of [
      ["node", process.execPath, ["--version"]], ["git", "git.exe", ["--version"]],
      ["python", "python.exe", ["--version"]], ["codex", process.env.TONG_WORKER_CODEX, ["--version"]],
    ]) {
      process.stderr.write(`fixture: starting runtime ${name}\n`);
      results.runtimeVersions[name] = await version(executable, args);
      process.stderr.write(`fixture: ${name} ${results.runtimeVersions[name].exitCode} ${results.runtimeVersions[name].error || ""}\n`);
    }
    const linger = spawn(process.execPath, [process.argv[1], "--linger"],
      { stdio: "ignore", windowsHide: true });
    results.lingerPid = linger.pid;
    linger.unref();
    process.stdout.write(JSON.stringify({ protocolVersion: 1, kind: "result", taskId: request.taskId,
      result: { turnStatus: "completed", summary: JSON.stringify(results) } }) + "\n", () => process.exit(0));
  });
}
