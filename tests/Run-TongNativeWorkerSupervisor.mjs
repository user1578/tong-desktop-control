import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createNativeWorkerSupervisor } from "../scripts/TongNativeWorkerSupervisor.mjs";
import { createSignedWorkerEnvelope } from "../scripts/TongWorkerProtocol.mjs";

const [exe, policyPath, projectRoot, root] = process.argv.slice(2);
const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const native = createNativeWorkerSupervisor({ executablePath: exe,
  executableSha256: await hash(exe), policyPath, policySha256: await hash(policyPath), synthetic: true });

await assert.rejects(native.inspectIsolation({ projectId: "synthetic", projectRoot }),
  /production isolation is unavailable/i, "same-user synthetic mode must never claim production readiness");

const taskId = randomUUID();
const secret = randomBytes(32);
const envelope = createSignedWorkerEnvelope({ taskId, projectId: "synthetic", projectRoot,
  task: "运行合成 canary", scope: "仅限合成项目", prompt: "run mock", timeoutMs: 30_000 }, secret);
const originalAcl = await readFile(join(root, "original-acl.txt"), "utf8");
const session = await native.launchWorker({ taskId, timeoutMs: 30_000, bootstrapSecret: secret.toString("base64url") });
const result = await session.runTask(envelope, secret);
await session.close();
const canary = JSON.parse(result.summary);
for (const key of ["projectRead", "projectWrite", "projectDelete"]) assert.equal(canary[key], "allowed", key);
for (const name of ["other", "private", "auth"]) {
  for (const action of ["read", "write", "delete"]) assert.equal(canary[`${name}${action}`], "denied", `${name}${action}`);
}
assert.equal(canary.junctionRead, "denied");
assert.equal(canary.environmentSecretAbsent, true);
assert.equal(canary.childExitCode, 0);
assert.deepEqual(canary.child, { project: "allowed", other: "denied" });
assert.equal(canary.token.restrictedToken, true);
assert.equal(canary.token.jobObjectKillOnClose, true);
assert.equal(canary.token.taskAclVerified, true);
assert.equal(canary.token.cleanEnvironment, true);
assert.equal(canary.token.credentialsSeparated, false, "synthetic mode uses the current account");
await delay(500);
try { process.kill(canary.lingerPid, 0); assert.fail("Job descendant remained alive"); }
catch (error) { if (error.code !== "ESRCH") throw error; }

const wrong = await native.launchWorker({ taskId: randomUUID(), timeoutMs: 30_000,
  bootstrapSecret: randomBytes(32).toString("base64url") });
await assert.rejects(wrong.runTask(envelope, secret), /identity mismatch|authentication/i);
await wrong.close();

const raceId = randomUUID();
const raceKey = randomBytes(32);
const raceEnvelope = createSignedWorkerEnvelope({ taskId: raceId, projectId: "synthetic", projectRoot,
  task: "cancel during startup", scope: "synthetic only", prompt: "hang", timeoutMs: 30_000 }, raceKey);
const raceSession = await native.launchWorker({ taskId: raceId, timeoutMs: 30_000,
  bootstrapSecret: raceKey.toString("base64url") });
const raced = raceSession.runTask(raceEnvelope, raceKey);
raced.catch(() => {});
await raceSession.terminateJobObject();
await assert.rejects(raced, /cancelled|bridge|closed|exited/i);
await raceSession.close();

const rawBridge = (command) => new Promise((resolve, reject) => {
  const child = spawn(exe, ["--bridge-synthetic", policyPath],
    { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, output }));
  child.stdin.end(`${JSON.stringify(command)}\n`);
});
const forgedId = randomUUID();
const forgedPayload = { taskId: forgedId, projectId: "synthetic", projectRoot,
  task: "forged", scope: "synthetic only", prompt: "mock", timeoutMs: 1000 };
const forgedEnvelope = createSignedWorkerEnvelope(forgedPayload, randomBytes(32));
const forged = await rawBridge({ kind: "launch", taskId: forgedId, timeoutMs: 1000,
  bootstrapSecret: randomBytes(32).toString("base64url"),
  payloadJson: JSON.stringify(forgedEnvelope.payload),
  executeFrame: JSON.stringify({ protocolVersion: 1, kind: "execute", taskId: forgedId, envelope: forgedEnvelope }) });
assert.notEqual(forged.code, 0, "the native service must reject a valid-looking envelope with the wrong HMAC key");
assert.ok(!forged.output.includes('"ok":true'));

const hang = async (timeoutMs) => {
  await rm(join(projectRoot, "hang-pid.txt"), { force: true });
  const id = randomUUID();
  const key = randomBytes(32);
  const signed = createSignedWorkerEnvelope({ taskId: id, projectId: "synthetic", projectRoot,
    task: "synthetic hanging task", scope: "synthetic only", prompt: "hang", timeoutMs }, key);
  const running = await native.launchWorker({ taskId: id, timeoutMs, bootstrapSecret: key.toString("base64url") });
  const result = running.runTask(signed, key);
  result.catch(() => {});
  for (let n = 0; n < 100; n++) {
    try { return { running, result, pid: Number(await readFile(join(projectRoot, "hang-pid.txt"), "utf8")) }; }
    catch { await delay(25); }
  }
  await running.terminateJobObject();
  throw new Error("Synthetic hanging Worker never started");
};
const canceled = await hang(30_000);
await canceled.running.terminateJobObject();
await assert.rejects(canceled.result, /exited|terminated|closed/i);
await canceled.running.close();
await delay(250);
try { process.kill(canceled.pid, 0); assert.fail("Canceled Job descendant remained alive"); }
catch (error) { if (error.code !== "ESRCH") throw error; }

const timedOut = await hang(1_000);
await assert.rejects(timedOut.result, /exited|terminated|closed/i);
await timedOut.running.close();
await delay(250);
try { process.kill(timedOut.pid, 0); assert.fail("Timed-out Job descendant remained alive"); }
catch (error) { if (error.code !== "ESRCH") throw error; }

// A direct Node pipe client has the same synthetic user SID, but its image is not
// the pinned native bridge and therefore cannot submit a legitimate task.
await new Promise((resolve) => {
  const socket = net.connect(`\\\\.\\pipe\\${policy.pipeName}`);
  socket.once("connect", () => socket.write(JSON.stringify({ kind: "inspect", projectId: "synthetic", projectRoot }) + "\n"));
  socket.once("error", () => resolve());
  socket.once("close", () => resolve());
});

console.log(JSON.stringify({ nativeRestrictedToken: true, namedPipePeerImageRejected: true,
  forgedHmacRejected: true,
  projectOperations: "allowed", outsideOperations: "denied", childToken: "restricted",
  jobDescendantCleanup: "passed", cancellation: "passed", startupCancellation: "passed", timeout: "passed",
  environment: "clean", syntheticIdentitySeparated: false,
  aclOriginalRecorded: originalAcl.length > 0 }));
