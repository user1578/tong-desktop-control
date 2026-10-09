import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync,
  writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

function redactDiagnostic(value) {
  let text = String(value);
  for (const name of ["TONG_WORKER_BOOTSTRAP", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN",
    "TONG_SYNTHETIC_SECRET_CANARY"]) {
    const secret = process.env[name];
    if (secret?.length >= 8) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,]+/gi, "$1[redacted]");
}

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
      const started = performance.now();
      const diagnostics = { pid: null, events: [{ name: "launch", elapsedMs: 0 }],
        stderr: "", stderrBytes: 0, stderrTruncated: false, startupError: null,
        stderrCaptureError: null, stderrCaptureMode: "synthetic-file" };
      const event = (name) => {
        const elapsedMs = Math.round(performance.now() - started);
        diagnostics.events.push({ name, elapsedMs });
        process.stderr.write(`fixture: child event ${name} ${elapsedMs}ms\n`);
      };
      const stderrLimit = 8192;
      const stderrPath = join(project, "child-probe.stderr");
      let launched;
      let stderrFd;
      try {
        stderrFd = openSync(stderrPath, "wx+");
        process.stderr.write("fixture: child spawn call\n");
        launched = spawn(process.execPath, [process.argv[1], "--child", project],
          { stdio: ["ignore", "ignore", stderrFd], windowsHide: true });
        process.stderr.write(`fixture: child spawn returned pid=${launched.pid || "none"}\n`);
      } catch (error) {
        event("startup-exception");
        diagnostics.startupError = { code: error.code || null,
          message: redactDiagnostic(error.message).slice(0, 1024) };
        if (stderrFd !== undefined) closeSync(stderrFd);
        resolve({ status: null, error: "startup exception", diagnostics });
        return;
      }
      closeSync(stderrFd);
      diagnostics.pid = launched.pid || null;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const fd = openSync(stderrPath, "r");
          try {
            diagnostics.stderrBytes = fstatSync(fd).size;
            const prefix = Buffer.alloc(Math.min(stderrLimit, diagnostics.stderrBytes));
            let bytesRead = 0;
            while (bytesRead < prefix.length) {
              const count = readSync(fd, prefix, bytesRead, prefix.length - bytesRead, bytesRead);
              if (count === 0) break;
              bytesRead += count;
            }
            diagnostics.stderr = redactDiagnostic(prefix.subarray(0, bytesRead).toString("utf8"));
            diagnostics.stderrTruncated = diagnostics.stderrBytes > stderrLimit;
          } finally { closeSync(fd); }
        } catch (error) {
          diagnostics.stderrCaptureError = { code: error.code || null,
            message: redactDiagnostic(error.message).slice(0, 1024) };
        }
        try { unlinkSync(stderrPath); } catch { /* temporary test root is removed in the harness */ }
        resolve({ ...result, diagnostics });
      };
      const timer = setTimeout(() => {
        event("timeout");
        launched.kill();
        finish({ status: null, error: "child process timed out" });
      }, 10_000);
      launched.once("spawn", () => event("spawn"));
      launched.once("error", (error) => {
        event("startup-error");
        diagnostics.startupError = { code: error.code || null,
          message: redactDiagnostic(error.message).slice(0, 1024) };
        finish({ status: null, error: "startup error" });
      });
      launched.once("exit", () => event("exit"));
      launched.once("close", (status) => { event("close"); finish({ status, error: null }); });
    });
    process.stderr.write(`fixture: child ${child.status} ${child.error || ""} ${JSON.stringify(child.diagnostics)}\n`);
    results.childExitCode = child.status;
    results.childDiagnostic = child.diagnostics;
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
