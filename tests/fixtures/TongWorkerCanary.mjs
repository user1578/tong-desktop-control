import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [,, mode, ...args] = process.argv;

function attempt(file, operation) {
  try {
    if (operation === "read") readFileSync(file, "utf8");
    else if (operation === "write") writeFileSync(file, "synthetic Worker write");
    else if (operation === "delete") unlinkSync(file);
    else throw new Error("unsupported synthetic operation");
    return "allowed";
  } catch {
    return "denied";
  }
}

if (mode === "child") {
  const [project, other, resultPath] = args;
  writeFileSync(resultPath, JSON.stringify({
    childProjectWrite: attempt(join(project, "child-write.canary"), "write"),
    childOtherRead: attempt(join(other, "canary.txt"), "read"),
  }));
} else if (mode === "linger") {
  setTimeout(() => process.exit(0), 10 * 60_000);
} else if (mode === "worker") {
  const [project, other, privateRoot, authRoot, resultPath] = args;
  const result = {
    projectRead: attempt(join(project, "canary.txt"), "read"),
    projectWrite: attempt(join(project, "write.canary"), "write"),
    projectDelete: attempt(join(project, "delete.canary"), "delete"),
    junctionRead: attempt(join(project, "outside-link", "canary.txt"), "read"),
    syntheticSecretInherited: Boolean(process.env.TONG_SYNTHETIC_SECRET_CANARY),
    openAiKeyInherited: Boolean(process.env.OPENAI_API_KEY),
    codexTokenInherited: Boolean(process.env.CODEX_ACCESS_TOKEN),
  };
  for (const [label, root] of [["other", other], ["private", privateRoot], ["auth", authRoot]]) {
    for (const operation of ["read", "write", "delete"]) {
      const key = `${label}${operation[0].toUpperCase()}${operation.slice(1)}`;
      result[key] = attempt(join(root, "canary.txt"), operation);
    }
  }

  const childResultPath = join(project, "child-result.json");
  const child = spawnSync(process.execPath,
    [process.argv[1], "child", project, other, childResultPath],
    { encoding: "utf8", timeout: 30_000, windowsHide: true });
  result.childExitCode = child.status ?? -1;
  result.child = existsSync(childResultPath) ? JSON.parse(readFileSync(childResultPath, "utf8")) : null;
  const lingeringChild = spawn(process.execPath, [process.argv[1], "linger"],
    { stdio: "ignore", windowsHide: true });
  lingeringChild.unref();
  result.lingerPid = lingeringChild.pid;
  writeFileSync(resultPath, JSON.stringify(result));
} else {
  process.exitCode = 2;
}
