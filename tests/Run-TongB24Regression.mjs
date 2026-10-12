import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
const evidence = resolve(process.argv[2] ?? "");
assert.ok(evidence.startsWith(resolve("D:\\agentdock-poc-20261010\\isolated\\state") + "\\b24-closeout-"));
await mkdir(evidence, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(TONG_|AGENTDOCK_|DEVSPACE_|OAUTH_)/i.test(name)));
const blocked = new Map([
  ["Test-TongAgentDockRuntime.mjs", "Existing synthetic runtime is fixed to 18765; production owns that port. No production stop or runtime change authorized."],
  ["Test-TongRuntimeChildEnvironment.mjs", "Existing synthetic runtime is fixed to 18765; production owns that port. New independent E2E uses distinct ports."],
]);
const records = [];
for (const name of (await readdir(join(cwd, "tests"))).filter(name => /^Test-.*\.mjs$/.test(name)).sort()) {
  if (name === "Test-TongB24CloseoutLive.mjs") continue; // Executed separately with a new isolated instance.
  if (blocked.has(name)) { records.push({ name, status: "blocked", reason: blocked.get(name) }); console.log(`BLOCKED ${name}`); continue; }
  const started = Date.now();
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, [join(cwd, "tests", name)], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    child.on("error", error => resolveResult({ exitCode: null, output: String(error) }));
    child.on("close", exitCode => resolveResult({ exitCode, output }));
  });
  await writeFile(join(evidence, name + ".log"), result.output);
  const status = result.exitCode !== 0 ? "failed" : /^SKIP:/m.test(result.output) && !/^PASS:/m.test(result.output) ? "skipped-opt-in" : "passed";
  records.push({ name, status, exitCode: result.exitCode, durationMs: Date.now() - started });
  console.log(`${status.toUpperCase()} ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (status === "failed") console.log(result.output.slice(-1500));
  await writeFile(join(evidence, "node-regression.json"), JSON.stringify({ records }, null, 2));
}
await writeFile(join(evidence, "node-regression.json"), JSON.stringify({ records, summary: Object.fromEntries(["passed", "failed", "blocked", "skipped-opt-in"].map(status => [status, records.filter(record => record.status === status).length])) }, null, 2));
if (records.some(record => record.status === "failed")) process.exitCode = 1;
console.log("Regression inventory complete; blocked and opt-in entries are not passes.");
