import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { TongWorkerStdioSession } from "./TongWorkerStdio.mjs";
import { verifySignedWorkerEnvelope } from "./TongWorkerProtocol.mjs";

const HEX = /^[0-9a-f]{64}$/i;

async function pinnedFile(path, sha256) {
  if (process.platform !== "win32" || typeof path !== "string" || !isAbsolute(path) || !HEX.test(sha256 ?? "")) {
    throw new Error("Native Worker fixed file policy is unavailable");
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase()) {
    throw new Error("Native Worker fixed file path is not a regular file");
  }
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== sha256.toLowerCase()) throw new Error("Native Worker fixed file SHA-256 mismatch");
}

function firstLine(stream, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const bytes = [];
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Native Supervisor acknowledgement timed out")); }, 10_000);
    const cleanup = () => { clearTimeout(timeout); stream.off("readable", read); stream.off("end", end); stream.off("error", fail); };
    const fail = (error) => { cleanup(); reject(error); };
    const end = () => { cleanup(); reject(new Error("Native Supervisor closed before acknowledgement")); };
    const read = () => {
      let byte;
      while ((byte = stream.read(1)) !== null) {
        if (byte[0] === 10) { cleanup(); resolve(Buffer.concat(bytes).toString("utf8").trimEnd()); return; }
        bytes.push(byte);
        if (bytes.length > limit) { cleanup(); reject(new Error("Native Supervisor acknowledgement is too large")); return; }
      }
    };
    stream.on("readable", read); stream.once("end", end); stream.once("error", fail);
    read();
  });
}

export function createNativeWorkerSupervisor({ executablePath, executableSha256, policyPath, policySha256,
  synthetic = false, spawnProcess = spawn } = {}) {
  const verifyFiles = async () => {
    await pinnedFile(executablePath, executableSha256);
    await pinnedFile(policyPath, policySha256);
  };
  const startBridge = () => spawnProcess(executablePath,
    [synthetic ? "--bridge-synthetic" : "--bridge", policyPath],
    { env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const send = async (command, onChild = () => {}) => {
    await verifyFiles();
    const child = startBridge();
    onChild(child);
    let stderr = "";
    child.on("error", (error) => { stderr = error.message; });
    child.stdin.on("error", (error) => { stderr = error.message; });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-1000);
    });
    try {
      child.stdin.write(`${JSON.stringify(command)}\n`);
      const line = await firstLine(child.stdout);
      const response = JSON.parse(line);
      if (response?.ok !== true) throw new Error("Native Supervisor rejected the request");
      return { child, response };
    } catch (error) {
      child.kill();
      throw new Error(`Native Supervisor bridge failed: ${error.message}${stderr ? ` (${stderr.trim()})` : ""}`);
    }
  };
  const inspectIsolation = async ({ projectId, projectRoot }) => {
    const { child, response } = await send({ kind: "inspect", projectId, projectRoot });
    child.stdin.end();
    if (response.source !== "native-token-and-pipe" || response.syntheticOnly === true) {
      throw new Error("Native Worker production isolation is unavailable");
    }
    return { ready: true, ...response };
  };
  const launchWorker = async ({ taskId, timeoutMs, bootstrapSecret }) => {
    let child;
    let stdio;
    let closed = false;
    let aborted = false;
    let launchedProject;
    const stop = async (verifyCleanup = false) => {
      aborted = true;
      if (child && child.exitCode === null && child.signalCode === null) {
        const exit = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        let timer;
        try {
          await Promise.race([exit, new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Native bridge did not exit")), 3_000);
          })]);
        } finally { clearTimeout(timer); }
      }
      if (verifyCleanup && launchedProject) {
        const probe = await send({ kind: "inspect", projectId: launchedProject.projectId,
          projectRoot: launchedProject.projectRoot });
        probe.child.stdin.end();
      }
    };
    return {
      async runTask(envelope, secret, callbacks) {
        if (closed || child) throw new Error("Native Worker session is already used");
        const payload = verifySignedWorkerEnvelope(envelope, secret, { expectedTaskId: taskId });
        if (payload.timeoutMs !== timeoutMs || secret.toString("base64url") !== bootstrapSecret) {
          throw new Error("Native Worker launch identity mismatch");
        }
        const executeFrame = JSON.stringify({ protocolVersion: 1, kind: "execute", taskId, envelope });
        launchedProject = { projectId: payload.projectId, projectRoot: payload.projectRoot };
        await send({ kind: "launch", taskId, timeoutMs, bootstrapSecret,
          payloadJson: JSON.stringify(envelope.payload), executeFrame }, (pending) => {
          child = pending;
          if (aborted || closed) pending.kill();
        });
        if (aborted || closed) { await stop(true); throw new Error("Native Worker launch was cancelled"); }
        stdio = new TongWorkerStdioSession({ input: child.stdout, output: child.stdin,
          terminateJobObject: () => stop(true), closeProcess: () => stop(false) });
        return stdio.runTask(envelope, secret, callbacks);
      },
      async interrupt(id) { if (stdio) await stdio.interrupt(id); },
      async terminateJobObject() { await stop(true); },
      async close() { closed = true; if (stdio) await stdio.close(); else await stop(false); },
    };
  };
  return Object.freeze({ inspectIsolation, launchWorker });
}
