import { once } from "node:events";
import { isAbsolute } from "node:path";
import { MAX_WORKER_IPC_MESSAGE_BYTES, WORKER_PROTOCOL_VERSION, createSignedWorkerCancelMessage,
  sanitizeWorkerLog, verifySignedWorkerCancelMessage, verifySignedWorkerEnvelope } from "./TongWorkerProtocol.mjs";

const START_FIELDS = new Set(["protocolVersion", "kind", "taskId", "envelope"]);
const RESPONSE_TYPES = new Set(["session", "log", "state", "result", "error"]);

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !fields.has(key))) throw new Error(`Invalid Worker IPC ${label}`);
}

function parseFrame(text) {
  try { return JSON.parse(text); }
  catch { throw new Error("Invalid Worker IPC JSON frame"); }
}

async function writeFrame(stream, message) {
  const line = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_WORKER_IPC_MESSAGE_BYTES) throw new Error("Worker IPC frame exceeds the size limit");
  if (!stream.write(line)) await once(stream, "drain");
}

async function* readFrames(stream) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = buffer.length ? Buffer.concat([buffer, bytes]) : bytes;
    let start = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0a) continue;
      let frame = buffer.subarray(start, index);
      if (frame.at(-1) === 0x0d) frame = frame.subarray(0, frame.length - 1);
      if (frame.length > MAX_WORKER_IPC_MESSAGE_BYTES) throw new Error("Worker IPC frame exceeds the size limit");
      yield frame.toString("utf8");
      start = index + 1;
    }
    buffer = buffer.subarray(start);
    if (buffer.length > MAX_WORKER_IPC_MESSAGE_BYTES) throw new Error("Worker IPC frame exceeds the size limit");
  }
  if (buffer.length) yield buffer.toString("utf8");
}

function decodeBootstrapSecret(secret) {
  if (Buffer.isBuffer(secret)) {
    if (secret.length !== 32) throw new Error("Worker bootstrap authentication is unavailable");
    return Buffer.from(secret);
  }
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error("Worker bootstrap authentication is unavailable");
  }
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== 32) throw new Error("Worker bootstrap authentication is unavailable");
  return decoded;
}

function cleanResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker returned an invalid result");
  return {
    ...(typeof value.threadId === "string" && value.threadId.length <= 200 ? { threadId: value.threadId } : {}),
    turnStatus: typeof value.turnStatus === "string" ? value.turnStatus.slice(0, 80) : "unknown",
    summary: sanitizeWorkerLog(value.summary).slice(0, 16_000),
    tests: Array.isArray(value.tests) ? value.tests.slice(0, 100).map((test) => ({
      command: sanitizeWorkerLog(test?.command).slice(0, 2_000),
      exitCode: Number.isInteger(test?.exitCode) ? test.exitCode : null,
      status: typeof test?.status === "string" ? test.status.slice(0, 40) : "unknown",
      evidence: sanitizeWorkerLog(test?.evidence).slice(0, 80),
    })) : [],
  };
}

export class TongWorkerStdioSession {
  constructor({ input, output, terminateJobObject, closeProcess = async () => {} } = {}) {
    if (!input || typeof input[Symbol.asyncIterator] !== "function" || !output || typeof output.write !== "function"
        || typeof terminateJobObject !== "function" || typeof closeProcess !== "function") {
      throw new TypeError("TongWorkerStdioSession requires private process streams and Job Object controls");
    }
    this.input = input;
    this.output = output;
    this.terminateProcessGroup = terminateJobObject;
    this.closeProcess = closeProcess;
    this.current = null;
    this.readerEnded = false;
    this.closed = false;
    this.reader = this.readResponses();
  }

  async readResponses() {
    try {
      for await (const text of readFrames(this.input)) {
        const message = parseFrame(text);
        exactObject(message, new Set(["protocolVersion", "kind", "taskId", "sessionId", "log", "state", "result", "error"]), "response");
        if (message.protocolVersion !== WORKER_PROTOCOL_VERSION || !RESPONSE_TYPES.has(message.kind)) {
          throw new Error("Invalid Worker IPC response type");
        }
        const current = this.current;
        if (!current || message.taskId !== current.taskId) continue;
        if (message.kind === "session") {
          if (typeof message.sessionId !== "string" || message.sessionId.length < 1 || message.sessionId.length > 200) {
            throw new Error("Worker returned an invalid session id");
          }
          await current.callbacks.onSessionId(message.sessionId);
        } else if (message.kind === "log") {
          if (typeof message.log?.message !== "string") throw new Error("Worker returned an invalid log entry");
          current.callbacks.onLog(sanitizeWorkerLog(message.log.message),
            typeof message.log.kind === "string" ? message.log.kind.slice(0, 40) : "output");
        } else if (message.kind === "state") {
          if (message.state === "waiting_user_action") current.callbacks.onState(message.state);
        } else if (message.kind === "result") {
          current.resolve(cleanResult(message.result));
        } else if (message.kind === "error") {
          current.reject(new Error(sanitizeWorkerLog(message.error?.message ?? "Worker task failed").slice(0, 500)));
        }
      }
    } catch (error) {
      this.current?.reject(error instanceof Error ? error : new Error("Worker IPC failed"));
    } finally {
      this.readerEnded = true;
      this.current?.reject(new Error("Worker process exited before returning a result"));
    }
  }

  async runTask(envelope, secret, callbacks = {}) {
    if (this.closed || this.readerEnded) throw new Error("Worker process is not available");
    if (this.current) throw new Error("Worker process already has an active task");
    const task = verifySignedWorkerEnvelope(envelope, secret);
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    this.current = {
      taskId: task.taskId,
      secret: Buffer.from(secret),
      callbacks: {
        onSessionId: callbacks.onSessionId ?? (() => {}),
        onLog: callbacks.onLog ?? (() => {}),
        onState: callbacks.onState ?? (() => {}),
      },
      resolve: resolveResult,
      reject: rejectResult,
    };
    try {
      await writeFrame(this.output, { protocolVersion: WORKER_PROTOCOL_VERSION, kind: "execute",
        taskId: task.taskId, envelope });
    } catch (error) {
      this.current = null;
      throw error;
    }
    return result.finally(() => { this.current = null; });
  }

  async interrupt(taskId) {
    if (!this.current || this.current.taskId !== taskId || this.closed) return;
    const message = createSignedWorkerCancelMessage(taskId, this.current.secret);
    await writeFrame(this.output, message);
  }

  async terminateJobObject() {
    await this.terminateProcessGroup();
    this.current?.reject(new Error("Worker process group was terminated"));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { this.output.end(); } catch { /* the worker may have exited */ }
    await this.closeProcess();
    this.current?.reject(new Error("Worker process was closed"));
  }
}

export async function serveTongCodexWorker({ worker, bootstrapSecret, input, output } = {}) {
  if (!worker || typeof worker.runTask !== "function" || !input || typeof input[Symbol.asyncIterator] !== "function"
      || !output || typeof output.write !== "function") throw new TypeError("Worker stdio service is not configured");
  const secret = decodeBootstrapSecret(bootstrapSecret);
  const frames = readFrames(input)[Symbol.asyncIterator]();
  let taskId = null;
  const emit = (kind, fields = {}) => writeFrame(output, { protocolVersion: WORKER_PROTOCOL_VERSION, kind, taskId, ...fields });
  let writes = Promise.resolve();
  const enqueue = (kind, fields) => {
    writes = writes.then(() => emit(kind, fields));
    return writes;
  };
  try {
    const first = await frames.next();
    if (first.done) throw new Error("Worker IPC request is missing");
    const start = parseFrame(first.value);
    exactObject(start, START_FIELDS, "request");
    if (start.protocolVersion !== WORKER_PROTOCOL_VERSION || start.kind !== "execute"
        || typeof start.taskId !== "string" || start.taskId.length < 1 || start.taskId.length > 200) {
      throw new Error("Invalid Worker IPC start request");
    }
    // Correlate authentication failures with the one outstanding private-stdio request.
    // The id is not trusted for authorization and the envelope still validates it.
    taskId = start.taskId;
    const request = verifySignedWorkerEnvelope(start.envelope, secret, { expectedTaskId: start.taskId });
    taskId = request.taskId;
    const controller = new AbortController();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const next = await frames.next();
          if (next.done) return;
          const cancel = parseFrame(next.value);
          verifySignedWorkerCancelMessage(cancel, secret, { expectedTaskId: taskId });
          controller.abort(new Error("Cancelled by the Worker broker"));
        }
      } catch {
        // Invalid control frames do not authorize or replace the active task.
      }
    })();
    const result = await worker.runTask(start.envelope, secret, {
      signal: controller.signal,
      onSessionId: (sessionId) => enqueue("session", { sessionId }),
      onLog: (message, kind) => { void enqueue("log", { log: { message: sanitizeWorkerLog(message), kind } }); },
      onState: (state) => { if (state === "waiting_user_action") void enqueue("state", { state }); },
    });
    await writes;
    await emit("result", { result: cleanResult(result) });
    return result;
  } catch (error) {
    const message = sanitizeWorkerLog(error instanceof Error ? error.message : "Worker request failed").slice(0, 500);
    try { await emit("error", { error: { message } }); } catch { /* the Broker may have closed the pipe */ }
    throw error;
  }
}

export { readFrames as readWorkerFrames, writeFrame as writeWorkerFrame };
