import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { CodexAppServerAdapter } from "./TongCodexAppServer.mjs";
import { assertWorkerEnvironment, assertWorkerIsolationSnapshot, sanitizeWorkerLog,
  verifySignedWorkerEnvelope } from "./TongWorkerProtocol.mjs";

const HEX_SHA256 = /^[a-f0-9]{64}$/i;

async function verifyCodexExecutable(policy) {
  const path = policy?.codexExecutablePath;
  const expectedHash = policy?.codexExecutableSha256;
  if (typeof path !== "string" || !isAbsolute(path) || !HEX_SHA256.test(expectedHash ?? "")) {
    throw new Error("Fixed Codex executable policy is unavailable");
  }
  let details;
  let actualPath;
  let content;
  try {
    details = await lstat(path);
    actualPath = await realpath(path);
    if (!details.isFile() || details.isSymbolicLink() || actualPath !== path) {
      throw new Error("not a fixed regular file");
    }
    content = await readFile(path);
  } catch {
    throw new Error("Fixed Codex executable is unavailable");
  }
  if (createHash("sha256").update(content).digest("hex") !== expectedHash.toLowerCase()) {
    throw new Error("Fixed Codex executable hash does not match the protected Worker policy");
  }
  return path;
}

export class TongCodexWorker {
  constructor({ policy, inspectIsolation, appServerFactory } = {}) {
    this.policy = policy ?? {};
    this.inspectIsolation = inspectIsolation;
    this.appServerFactory = appServerFactory ?? ((executablePath, environment) => new CodexAppServerAdapter({
      executable: executablePath,
      env: environment,
    }));
  }

  async runTask(envelope, secret, { signal, onSessionId = () => {}, onLog = () => {}, onState = () => {} } = {}) {
    const request = verifySignedWorkerEnvelope(envelope, secret);
    if (typeof this.inspectIsolation !== "function") {
      throw new Error("Worker identity and isolation verifier is unavailable");
    }
    const snapshot = await this.inspectIsolation(request);
    assertWorkerIsolationSnapshot(snapshot, { ...request, requireTaskAcl: true });
    const executablePath = await verifyCodexExecutable(this.policy);
    const environment = assertWorkerEnvironment(this.policy.environment);
    if (signal?.aborted) throw signal.reason ?? new Error("Worker task cancelled");
    const adapter = this.appServerFactory(executablePath, environment);
    if (!adapter || typeof adapter.runTask !== "function") throw new Error("Worker App Server adapter is unavailable");
    return adapter.runTask({
      taskId: request.taskId,
      projectId: request.projectId,
      cwd: request.projectRoot,
      task: request.task,
      scope: request.scope,
      prompt: request.prompt,
      timeoutMs: request.timeoutMs,
      threadId: request.threadId,
      continuationMessage: request.continuationMessage,
    }, {
      signal,
      onSessionId: (id) => onSessionId(id),
      onLog: (value, kind) => onLog(sanitizeWorkerLog(value), kind),
      onState: (state) => onState(state),
    });
  }
}

export { verifyCodexExecutable };
