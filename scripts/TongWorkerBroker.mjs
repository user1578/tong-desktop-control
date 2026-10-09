import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { assertWorkerIsolationSnapshot, createSignedWorkerEnvelope,
  sanitizeWorkerLog, MAX_WORKER_TIMEOUT_MS } from "./TongWorkerProtocol.mjs";

export const WORKER_DISABLED_MESSAGE = "Worker execution is disabled until a verified Windows isolation launcher is configured";

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const TASK_FIELDS = new Set(["taskId", "projectId", "cwd", "task", "scope", "prompt", "timeoutMs", "threadId", "continuationMessage"]);

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validateTask(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)
      || Object.keys(spec).some((key) => !TASK_FIELDS.has(key))) throw new Error("Invalid worker task: unsupported fields");
  if (typeof spec.taskId !== "string" || !TASK_ID.test(spec.taskId)) throw new Error("Invalid worker task id");
  if (typeof spec.projectId !== "string" || !PROJECT_ID.test(spec.projectId)) throw new Error("Invalid worker project id");
  if (typeof spec.cwd !== "string" || !isAbsolute(spec.cwd)) throw new Error("Invalid worker project path");
  if (typeof spec.task !== "string" || spec.task.trim().length < 1 || spec.task.length > 16_000 || spec.task.includes("\0")) {
    throw new Error("Invalid worker task description");
  }
  if (typeof spec.scope !== "string" || spec.scope.trim().length < 1 || spec.scope.length > 2_000 || spec.scope.includes("\0")) {
    throw new Error("Invalid worker task scope");
  }
  if (typeof spec.prompt !== "string" || spec.prompt.length < 1 || spec.prompt.length > 20_000 || spec.prompt.includes("\0")) {
    throw new Error("Invalid worker task prompt");
  }
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1_000 || spec.timeoutMs > MAX_WORKER_TIMEOUT_MS) {
    throw new Error("Invalid worker timeout");
  }
  if (spec.threadId != null && (typeof spec.threadId !== "string" || !spec.threadId || spec.threadId.length > 200)) {
    throw new Error("Invalid worker thread id");
  }
  if (spec.continuationMessage != null && (typeof spec.continuationMessage !== "string"
      || !spec.continuationMessage.trim() || spec.continuationMessage.length > 2_000 || spec.continuationMessage.includes("\0"))) {
    throw new Error("Invalid worker continuation message");
  }
  return spec;
}

function validateSession(session) {
  if (!session || typeof session.runTask !== "function" || typeof session.interrupt !== "function"
      || typeof session.terminateJobObject !== "function" || typeof session.close !== "function") {
    throw new Error("Worker process session is incomplete; execution was stopped safely");
  }
  return session;
}

export class TongWorkerBroker {
  constructor({ access, inspectIsolation, launchWorker, cancelGraceMs = 5_000 } = {}) {
    if (!access || typeof access.authorize !== "function" || typeof access.listProjects !== "function") {
      throw new TypeError("TongWorkerBroker requires project access");
    }
    if (cancelGraceMs < 0 || cancelGraceMs > 30_000) throw new Error("Invalid Worker cancellation grace period");
    this.access = access;
    this.inspectIsolation = inspectIsolation;
    this.launchWorker = launchWorker;
    this.cancelGraceMs = cancelGraceMs;
    this.active = new Map();
    this.closed = false;
  }

  async projectForExecution(projectId, projectRoot) {
    if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) throw new Error("Invalid worker project id");
    if (!(await this.access.authorize("agent.execute", projectId))) {
      throw new Error("Project is not authorized for agent.execute");
    }
    const project = (await this.access.listProjects()).find((entry) => entry.id === projectId);
    if (!project || project.status !== "enabled" || project.available !== true) {
      throw new Error("Project is missing, disabled, or unavailable");
    }
    if (typeof project.root !== "string" || !isAbsolute(project.root) || !samePath(project.root, projectRoot)) {
      throw new Error("Worker project path does not match the authorized project registration");
    }
    return { ...project, root: resolve(project.root) };
  }

  async preflight({ projectId, projectRoot } = {}) {
    if (this.closed) throw new Error("Worker broker is closed");
    if (typeof this.inspectIsolation !== "function" || typeof this.launchWorker !== "function") {
      throw new Error(WORKER_DISABLED_MESSAGE);
    }
    const project = await this.projectForExecution(projectId, projectRoot);
    let snapshot;
    try { snapshot = await this.inspectIsolation({ projectId, projectRoot: project.root }); }
    catch { throw new Error("Worker isolation inspection failed; execution was stopped safely"); }
    assertWorkerIsolationSnapshot(snapshot, { projectId, projectRoot: project.root });
    return { projectId, projectRoot: project.root };
  }

  async runTask(input, { signal, onSessionId = () => {}, onLog = () => {}, onState = () => {} } = {}) {
    const spec = validateTask(input);
    if (this.closed) throw new Error("Worker broker is closed");
    if (signal?.aborted) throw signal.reason ?? new Error("Worker task cancelled");
    if (this.active.has(spec.taskId)) throw new Error("Worker task is already active");

    const project = await this.projectForExecution(spec.projectId, spec.cwd);
    await this.preflight({ projectId: project.id, projectRoot: project.root });
    // Re-read the grant immediately before reserving and launching this task.
    await this.projectForExecution(spec.projectId, project.root);
    if (this.active.has(spec.taskId)) throw new Error("Worker task is already active");
    const task = Object.freeze({ ...spec, cwd: project.root });
    const payload = {
      taskId: task.taskId,
      projectId: task.projectId,
      projectRoot: project.root,
      task: task.task.trim(),
      scope: task.scope.trim(),
      prompt: task.prompt,
      timeoutMs: task.timeoutMs,
      ...(task.threadId ? { threadId: task.threadId } : {}),
      ...(task.continuationMessage ? { continuationMessage: task.continuationMessage.trim() } : {}),
    };
    const secret = randomBytes(32);
    const envelope = createSignedWorkerEnvelope(payload, secret);
    this.active.set(task.taskId, { session: null });

    let session;
    let cancellationTimer;
    let rejectForcedTermination;
    let terminated = false;
    const forceTermination = new Promise((_resolve, reject) => { rejectForcedTermination = reject; });
    const terminateThisJob = async () => {
      if (!session || terminated) return;
      terminated = true;
      try {
        await session.terminateJobObject();
        rejectForcedTermination(new Error("Worker process group terminated after cancellation"));
      } catch {
        rejectForcedTermination(new Error("Worker process group could not be terminated; task failed closed"));
      }
    };
    const abortHandler = () => {
      if (!session || cancellationTimer || terminated) return;
      void Promise.resolve(session.interrupt(task.taskId)).catch(() => {});
      cancellationTimer = setTimeout(() => { void terminateThisJob(); }, this.cancelGraceMs);
    };

    try {
      // The launcher receives the one-time key through the private Worker startup
      // environment. It must not place that key on a command line, log, or Codex child env.
      // Task data and the signed project root travel only over inherited private stdio.
      const launchedSession = await this.launchWorker({ taskId: task.taskId, timeoutMs: task.timeoutMs,
        bootstrapSecret: secret.toString("base64url") });
      try {
        session = validateSession(launchedSession);
      } catch (error) {
        if (typeof launchedSession?.terminateJobObject === "function") {
          try { await launchedSession.terminateJobObject(); } catch { /* still close any returned handles */ }
        }
        if (typeof launchedSession?.close === "function") {
          try { await launchedSession.close(); } catch { /* preserve the session validation error */ }
        }
        throw error;
      }
      this.active.set(task.taskId, { session });
      signal?.addEventListener("abort", abortHandler, { once: true });
      if (signal?.aborted) abortHandler();
      const callbacks = {
        onSessionId: (id) => {
          if (typeof id === "string" && id.length > 0 && id.length <= 200) return onSessionId(id);
        },
        onLog: (message, kind = "output") => onLog(sanitizeWorkerLog(message), kind),
        onState: (state) => { if (state === "waiting_user_action") return onState(state); },
      };
      const work = Promise.resolve().then(() => session.runTask(envelope, secret, callbacks));
      return await Promise.race([work, forceTermination]);
    } catch (error) {
      if (session && !terminated) await terminateThisJob();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortHandler);
      if (cancellationTimer) clearTimeout(cancellationTimer);
      this.active.delete(task.taskId);
      if (session) {
        try { await session.close(); } catch { /* close-on-job-handle release is best effort */ }
      }
    }
  }

  async close() {
    this.closed = true;
    const sessions = [...this.active.values()].map(({ session }) => session).filter(Boolean);
    await Promise.allSettled(sessions.map(async (session) => {
      await session.terminateJobObject();
      await session.close();
    }));
    this.active.clear();
  }
}

export { validateTask as validateWorkerTask };
