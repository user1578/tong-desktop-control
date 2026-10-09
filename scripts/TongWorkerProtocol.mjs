import { createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute, join } from "node:path";

export const WORKER_PROTOCOL_VERSION = 1;
export const MAX_WORKER_IPC_MESSAGE_BYTES = 64 * 1024;
export const MAX_WORKER_TIMEOUT_MS = 60 * 60 * 1_000;
export const MAX_WORKER_LOG_BYTES = 8 * 1024;

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const SID = /^S-\d-\d+(?:-\d+)+$/i;
const PAYLOAD_FIELDS = new Set([
  "taskId", "projectId", "projectRoot", "task", "scope", "prompt", "timeoutMs",
  "threadId", "continuationMessage",
]);
const ENVIRONMENT_FIELDS = new Set([
  "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "HOME", "CODEX_HOME", "PATH", "PATHEXT", "ComSpec",
]);

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !fields.has(key))) {
    throw new Error(`Invalid ${label}: unsupported fields`);
  }
}

function assertText(value, min, max, label) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.includes("\0")) {
    throw new Error(`Invalid ${label}`);
  }
}

function normalizedPath(path) {
  return process.platform === "win32" ? path.replaceAll("/", "\\").toLowerCase() : path;
}

function normalizeWorkerPayload(input) {
  exactObject(input, PAYLOAD_FIELDS, "worker task");
  if (typeof input.taskId !== "string" || !TASK_ID.test(input.taskId)) throw new Error("Invalid worker task id");
  if (typeof input.projectId !== "string" || !PROJECT_ID.test(input.projectId)) throw new Error("Invalid worker project id");
  if (typeof input.projectRoot !== "string" || !isAbsolute(input.projectRoot)) throw new Error("Invalid worker project root");
  assertText(input.task, 1, 16_000, "worker task");
  assertText(input.scope, 1, 2_000, "worker scope");
  assertText(input.prompt, 1, 20_000, "worker prompt");
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > MAX_WORKER_TIMEOUT_MS) {
    throw new Error("Invalid worker timeout");
  }
  if (input.threadId !== undefined) assertText(input.threadId, 1, 200, "worker thread id");
  if (input.continuationMessage !== undefined) assertText(input.continuationMessage, 1, 2_000, "worker continuation");

  const payload = {
    taskId: input.taskId,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    task: input.task,
    scope: input.scope,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
  };
  if (input.threadId !== undefined) payload.threadId = input.threadId;
  if (input.continuationMessage !== undefined) payload.continuationMessage = input.continuationMessage;
  return payload;
}

function assertSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error("Worker IPC authentication is unavailable");
}

function signPayload(payload, secret) {
  assertSecret(secret);
  return createHmac("sha256", secret).update(JSON.stringify(payload), "utf8").digest();
}

export function createSignedWorkerEnvelope(input, secret) {
  const payload = normalizeWorkerPayload(input);
  const signature = signPayload(payload, secret).toString("base64url");
  const envelope = { protocolVersion: WORKER_PROTOCOL_VERSION, payload, signature };
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_WORKER_IPC_MESSAGE_BYTES) {
    throw new Error("Worker IPC message exceeds the size limit");
  }
  return envelope;
}

export function verifySignedWorkerEnvelope(envelope, secret, { expectedTaskId } = {}) {
  exactObject(envelope, new Set(["protocolVersion", "payload", "signature"]), "worker IPC envelope");
  if (envelope.protocolVersion !== WORKER_PROTOCOL_VERSION || typeof envelope.signature !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(envelope.signature)
      || Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_WORKER_IPC_MESSAGE_BYTES) {
    throw new Error("Invalid worker IPC envelope");
  }
  const payload = normalizeWorkerPayload(envelope.payload);
  const supplied = Buffer.from(envelope.signature, "base64url");
  const expected = signPayload(payload, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Worker IPC authentication failed");
  }
  if (expectedTaskId !== undefined && payload.taskId !== expectedTaskId) {
    throw new Error("Worker IPC task identity mismatch");
  }
  return Object.freeze(payload);
}

export function createSignedWorkerCancelMessage(taskId, secret) {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) throw new Error("Invalid worker cancellation task id");
  const message = { protocolVersion: WORKER_PROTOCOL_VERSION, kind: "cancel", taskId };
  message.signature = signPayload(message, secret).toString("base64url");
  return message;
}

export function verifySignedWorkerCancelMessage(message, secret, { expectedTaskId } = {}) {
  exactObject(message, new Set(["protocolVersion", "kind", "taskId", "signature"]), "worker cancel message");
  if (message.protocolVersion !== WORKER_PROTOCOL_VERSION || message.kind !== "cancel"
      || typeof message.taskId !== "string" || !TASK_ID.test(message.taskId)
      || typeof message.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(message.signature)) {
    throw new Error("Invalid worker cancellation message");
  }
  const signed = { protocolVersion: message.protocolVersion, kind: message.kind, taskId: message.taskId };
  const supplied = Buffer.from(message.signature, "base64url");
  const expected = signPayload(signed, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Worker IPC authentication failed");
  }
  if (expectedTaskId !== undefined && message.taskId !== expectedTaskId) {
    throw new Error("Worker IPC task identity mismatch");
  }
  return Object.freeze(signed);
}

export function assertWorkerIpcPeer({ peerSid, expectedPeerSid } = {}) {
  if (typeof peerSid !== "string" || !SID.test(peerSid)
      || typeof expectedPeerSid !== "string" || !SID.test(expectedPeerSid)
      || peerSid.toLowerCase() !== expectedPeerSid.toLowerCase()) {
    throw new Error("Worker IPC peer identity verification failed");
  }
  return true;
}

export function assertWorkerIsolationSnapshot(snapshot, expected = {}) {
  const fail = (reason) => { throw new Error(`Worker isolation check failed: ${reason}`); };
  if (!snapshot || typeof snapshot !== "object" || snapshot.ready !== true) fail("isolation is not ready");
  for (const sidName of ["gatewaySid", "workerSid", "ipcPeerSid"]) {
    if (typeof snapshot[sidName] !== "string" || !SID.test(snapshot[sidName])) fail(`invalid ${sidName}`);
  }
  if (snapshot.gatewaySid.toLowerCase() === snapshot.workerSid.toLowerCase()) fail("Worker must run under a separate Windows identity");
  try { assertWorkerIpcPeer({ peerSid: snapshot.ipcPeerSid, expectedPeerSid: snapshot.gatewaySid }); }
  catch { fail("IPC peer does not match the trusted Gateway identity"); }
  for (const flag of ["restrictedToken", "credentialsSeparated", "cleanEnvironment", "jobObjectKillOnClose",
    "privateIpcAuthenticated", "appContainerBoundary"]) {
    if (snapshot[flag] !== true) fail(`${flag} is not verified`);
  }
  if (expected.projectId !== undefined && snapshot.projectId !== expected.projectId) fail("project identity mismatch");
  if (expected.projectRoot !== undefined && (typeof snapshot.projectRoot !== "string"
      || normalizedPath(snapshot.projectRoot) !== normalizedPath(expected.projectRoot))) fail("project root mismatch");
  if (expected.taskId !== undefined && snapshot.taskId !== expected.taskId) fail("task identity mismatch");
  if (expected.requireTaskAcl === true) {
    if (snapshot.taskAclVerified !== true) fail("task project ACL is not verified");
    if (typeof snapshot.restrictingSid !== "string" || !SID.test(snapshot.restrictingSid)) fail("task restricting SID is missing");
    if (typeof snapshot.appContainerSid !== "string" || !snapshot.appContainerSid.startsWith("S-1-15-2-")) {
      fail("task AppContainer SID is missing");
    }
    if ([snapshot.gatewaySid, snapshot.workerSid].some((sid) => sid.toLowerCase() === snapshot.restrictingSid.toLowerCase())) {
      fail("task restricting SID is not unique");
    }
  }
  return true;
}

function requireAbsolute(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw new Error(`${label} must be an absolute path`);
  return path;
}

export function createWorkerEnvironment({ systemRoot, profileRoot, tempRoot, toolDirectories } = {}) {
  requireAbsolute(systemRoot, "Windows system root");
  requireAbsolute(profileRoot, "Worker profile root");
  requireAbsolute(tempRoot, "Worker temporary root");
  if (!Array.isArray(toolDirectories) || toolDirectories.some((path) => typeof path !== "string" || !isAbsolute(path))) {
    throw new Error("Worker tool directories must be absolute paths");
  }
  const uniqueTools = [...new Set(toolDirectories)];
  return Object.freeze({
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    USERPROFILE: profileRoot,
    APPDATA: join(profileRoot, "AppData", "Roaming"),
    LOCALAPPDATA: join(profileRoot, "AppData", "Local"),
    TEMP: tempRoot,
    TMP: tempRoot,
    HOME: profileRoot,
    CODEX_HOME: join(profileRoot, ".codex"),
    PATH: [...uniqueTools, join(systemRoot, "System32"), systemRoot].join(process.platform === "win32" ? ";" : ":"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: join(systemRoot, "System32", "cmd.exe"),
  });
}

export function assertWorkerEnvironment(environment) {
  exactObject(environment, ENVIRONMENT_FIELDS, "Worker environment");
  for (const key of ["SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "HOME", "CODEX_HOME", "PATH", "ComSpec"]) {
    if (typeof environment[key] !== "string" || !environment[key]) throw new Error(`Worker environment is missing ${key}`);
  }
  if (normalizedPath(environment.SystemRoot) !== normalizedPath(environment.WINDIR)
      || normalizedPath(environment.USERPROFILE) !== normalizedPath(environment.HOME)
      || normalizedPath(environment.CODEX_HOME) !== normalizedPath(join(environment.USERPROFILE, ".codex"))) {
    throw new Error("Worker environment is not bound to the isolated profile");
  }
  if (typeof environment.PATHEXT !== "string" || !/^(?:\.[A-Z0-9]+)(?:;\.[A-Z0-9]+)*$/i.test(environment.PATHEXT)) {
    throw new Error("Worker environment has an invalid executable extension list");
  }
  return Object.freeze({ ...environment });
}

export function sanitizeWorkerLog(value) {
  const safe = String(value ?? "")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key) => `${key}=[REDACTED]`)
    .replace(/\b(cookie|authorization)\s*[:=]\s*[^\r\n]+/gi, (_match, key) => `${key}=[REDACTED]`);
  const bytes = Buffer.from(safe, "utf8");
  return bytes.length <= MAX_WORKER_LOG_BYTES
    ? safe
    : `${bytes.subarray(0, MAX_WORKER_LOG_BYTES - 16).toString("utf8")} …[truncated]`;
}
