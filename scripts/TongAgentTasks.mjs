import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { TongWorkerBroker } from "./TongWorkerBroker.mjs";
import { TongTrustedPolicy, TongTrustedCodexBroker, TongExecutorRouter } from "./TongTrustedCodexBroker.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATE_PATH = resolve(projectRoot, "runtime", "agent-tasks.json");
const TASK_STATES = new Set(["queued", "running", "waiting_user_action", "success", "failed", "cancelled"]);
const TERMINAL_STATES = new Set(["success", "failed", "cancelled"]);
const MAX_TASK_TEXT_CHARS = 16_000;
const MAX_SCOPE_CHARS = 2_000;
const MAX_LOG_ENTRY_BYTES = 8 * 1024;
const MAX_TASK_LOG_BYTES = 256 * 1024;
const MAX_LOG_PAGE_SIZE = 100;
const MAX_TASK_PAGE_SIZE = 100;
const MAX_TASK_TIMEOUT_MS = 60 * 60 * 1_000;
const MAX_PARALLEL_TASKS = 16;
const LOG_TRUNCATED_MARKER = "Earlier task log entries were dropped to stay within the log size limit.";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key) => `${key}=[REDACTED]`)
    .replace(/\b(cookie|authorization)\s*[:=]\s*[^\r\n]+/gi, (_match, key) => `${key}=[REDACTED]`);
}

function boundedLogText(value) {
  const safe = cleanText(value);
  const bytes = Buffer.from(safe, "utf8");
  return bytes.length <= MAX_LOG_ENTRY_BYTES
    ? safe
    : `${bytes.subarray(0, MAX_LOG_ENTRY_BYTES - 16).toString("utf8")} …[truncated]`;
}

function publicTask(task, now = Date.now()) {
  const runtimeMs = task.startedAt
    ? Math.max(0, (task.finishedAt ? Date.parse(task.finishedAt) : now) - Date.parse(task.startedAt))
    : 0;
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    agent: task.agent,
    executorMode: task.executorMode ?? "isolated",
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    runtimeMs,
    codexSessionId: task.codexSessionId,
    resumeAvailable: Boolean(task.codexSessionId && task.status === "waiting_user_action" && !task.pendingApproval),
    error: task.error,
  };
}

function taskKey(taskId) {
  return createHash("sha256").update(taskId).digest("hex").slice(0, 20);
}

function encodeCursor(taskId, offset, kind) {
  return Buffer.from(JSON.stringify({ v: 1, task: taskKey(taskId), offset, kind })).toString("base64url");
}

function decodeCursor(cursor, taskId, kind) {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length > 256) throw new Error("Invalid task cursor");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value.v !== 1 || value.task !== taskKey(taskId) || value.kind !== kind
        || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error();
    return value.offset;
  } catch { throw new Error("Invalid task cursor"); }
}

function parseStatusLines(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => line.trimEnd());
}

function execFileText(file, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { cwd, windowsHide: true, encoding: "utf8", maxBuffer: 512 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

async function gitSnapshot(cwd) {
  try {
    const output = await execFileText("git", ["status", "--porcelain=v1", "--untracked-files=all"], cwd);
    return parseStatusLines(output);
  } catch { return null; }
}

async function collectGitResult(cwd, baselineFiles = []) {
  const current = await gitSnapshot(cwd);
  if (!current) return { changedFiles: [], diffSummary: null, gitAvailable: false };
  const baseline = new Set(baselineFiles);
  const changedFiles = current.filter((line) => !baseline.has(line)).map((line) => line.slice(3)).slice(0, 500);
  let diffSummary = null;
  try {
    diffSummary = (await execFileText("git", ["diff", "--stat", "--no-ext-diff"], cwd)).trim().slice(0, 8_000);
  } catch { /* a missing diff is reported as unavailable */ }
  return { changedFiles, diffSummary, gitAvailable: true };
}

function normalizeRequest(input) {
  const allowedKeys = new Set(["projectId", "agent", "task", "scope", "idempotencyKey", "timeoutSeconds"]);
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new Error("Invalid task request: unsupported fields");
  }
  const { projectId, agent, task, scope, idempotencyKey, timeoutSeconds } = input;
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(projectId)) throw new Error("Invalid project id");
  if (agent !== "codex") throw new Error("Unsupported agent; only codex is available in this phase");
  if (typeof task !== "string" || task.trim().length < 1 || task.length > MAX_TASK_TEXT_CHARS || /\0/.test(task)) {
    throw new Error("Invalid task description");
  }
  if (typeof scope !== "string" || scope.trim().length < 1 || scope.length > MAX_SCOPE_CHARS || /\0/.test(scope)) {
    throw new Error("Invalid allowed work scope");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 128
      || /[\x00-\x20]/.test(idempotencyKey)) throw new Error("Invalid idempotency key");
  if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3_600)) {
    throw new Error("Invalid task timeout");
  }
  return { projectId, agent, task: task.trim(), scope: scope.trim(), idempotencyKey, timeoutSeconds };
}

function validDocument(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.tasks)) return false;
  return document.tasks.every((task) => task && typeof task.taskId === "string"
    && TASK_STATES.has(task.status) && Array.isArray(task.logs));
}

export class TongAgentTaskManager {
  constructor({ access, workerBroker, statePath = DEFAULT_STATE_PATH, trustedPolicyPath,
    maxConcurrent = 2, defaultTimeoutMs = 30 * 60 * 1_000,
    maxTaskRuntimeMs = MAX_TASK_TIMEOUT_MS, collectResult = collectGitResult,
    now = () => Date.now() } = {}) {
    if (!access || typeof access.authorize !== "function" || typeof access.listProjects !== "function") {
      throw new TypeError("TongAgentTaskManager requires project access");
    }
    if (!workerBroker) {
      const policy = new TongTrustedPolicy({ taskStatePath: statePath, ...(trustedPolicyPath ? { policyPath: trustedPolicyPath } : {}) });
      workerBroker = new TongExecutorRouter({ policy, isolated: new TongWorkerBroker({ access }),
        trusted: new TongTrustedCodexBroker({ access, policy }) });
    }
    if (!workerBroker || typeof workerBroker.preflight !== "function" || typeof workerBroker.runTask !== "function") {
      throw new TypeError("TongAgentTaskManager requires an Executor broker");
    }
    if (!isAbsolute(statePath)) throw new Error("Task state path must be absolute");
    this.access = access;
    this.workerBroker = workerBroker;
    this.statePath = resolve(statePath);
    this.managerLockPath = `${this.statePath}.manager.lock`;
    this.managerLock = null;
    this.maxConcurrent = Math.max(1, Math.min(Number.isInteger(maxConcurrent) ? maxConcurrent : 2, MAX_PARALLEL_TASKS));
    this.defaultTimeoutMs = Math.max(1_000, Math.min(Number.isFinite(defaultTimeoutMs) ? defaultTimeoutMs : 30 * 60 * 1_000,
      maxTaskRuntimeMs));
    this.maxTaskRuntimeMs = Math.max(1_000, Math.min(Number.isFinite(maxTaskRuntimeMs) ? maxTaskRuntimeMs : MAX_TASK_TIMEOUT_MS,
      MAX_TASK_TIMEOUT_MS));
    this.collectResult = collectResult;
    this.now = now;
    this.document = { schemaVersion: 1, tasks: [] };
    this.closed = false;
    this.lock = Promise.resolve();
    this.active = new Map();
    this.runningPromises = new Map();
    this.activeProjects = new Set();
    this.pumpScheduled = false;
    this.ready = this.initialize();
  }

  async initialize() {
    await mkdir(dirname(this.managerLockPath), { recursive: true });
    await this.acquireManagerLock();
    try {
      await this.managerLock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      await this.loadState();
    } catch (error) {
      await this.releaseManagerLock();
      throw error;
    }
  }

  async acquireManagerLock() {
    const recoveryPath = `${this.managerLockPath}.recovery`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        this.managerLock = await open(this.managerLockPath, "wx", 0o600);
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      let recovery;
      try { recovery = await open(recoveryPath, "wx", 0o600); }
      catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await delay(50);
        continue;
      }
      try {
        let owner;
        try { owner = JSON.parse(await readFile(this.managerLockPath, "utf8")); }
        catch (error) {
          if (error?.code === "ENOENT") continue;
          throw new Error("Task manager lock is invalid; inspect it locally before recovery");
        }
        if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) {
          throw new Error("Task manager lock is invalid; inspect it locally before recovery");
        }
        try { process.kill(owner.pid, 0); }
        catch (error) {
          if (error?.code !== "ESRCH") throw new Error("Task state is already owned by another manager");
          const stalePath = `${this.managerLockPath}.${randomUUID()}.stale`;
          try { await rename(this.managerLockPath, stalePath); }
          catch (moveError) { if (moveError?.code !== "ENOENT") throw moveError; continue; }
          await unlink(stalePath);
          continue;
        }
        throw new Error("Task state is already owned by another manager");
      } finally {
        await recovery.close();
        await unlink(recoveryPath);
      }
    }
    throw new Error("Task manager lock recovery is busy; retry locally");
  }

  async releaseManagerLock() {
    if (!this.managerLock) return;
    await this.managerLock.close();
    this.managerLock = null;
    await unlink(this.managerLockPath);
  }

  async loadState() {
    try {
      this.document = JSON.parse(await readFile(this.statePath, "utf8"));
      if (!validDocument(this.document)) throw new Error("Invalid task state document");
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Task state is invalid or unavailable");
      this.document = { schemaVersion: 1, tasks: [] };
    }
    const timestamp = new Date(this.now()).toISOString();
    let recovered = false;
    for (const task of this.document.tasks) {
      if (task.status === "running") {
        task.status = task.codexSessionId ? "waiting_user_action" : "failed";
        task.pendingApproval = false;
        task.error = task.codexSessionId
          ? { message: "Task manager restarted while Codex was running.", suggestion: "Use tong_agent_resume to continue the saved Codex session." }
          : { message: "Task manager restarted before a Codex session was saved.", suggestion: "Submit a new request with a new idempotency key after checking project state." };
        task.updatedAt = timestamp;
        if (!task.codexSessionId) task.finishedAt = timestamp;
        recovered = true;
      } else if (task.status === "waiting_user_action" && task.pendingApproval) {
        task.status = task.codexSessionId ? "waiting_user_action" : "failed";
        task.pendingApproval = false;
        task.continuationMessage = null;
        task.error = task.codexSessionId
          ? { message: "Task manager restarted before local approval was consumed.",
            suggestion: "Review the saved Codex session and use tong_agent_resume to request a new local approval." }
          : { message: "Task manager restarted before local approval and Codex session creation.",
            suggestion: "Review project state and submit a new request with a new idempotency key." };
        task.updatedAt = timestamp;
        if (!task.codexSessionId) task.finishedAt = timestamp;
        recovered = true;
      } else if (task.status === "queued") {
        task.status = "failed";
        task.finishedAt = timestamp;
        task.updatedAt = timestamp;
        task.error = { message: "Queued task was not launched after the task manager restarted.",
          suggestion: "Review project state and Worker isolation, then submit a new request with a new idempotency key." };
        recovered = true;
      }
    }
    if (recovered) await this.persist();
  }

  async withLock(callback) {
    let release;
    const previous = this.lock;
    this.lock = new Promise((resolvePromise) => { release = resolvePromise; });
    await previous;
    try { return await callback(); }
    finally { release(); }
  }

  async persist() {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(this.document)}\n`, "utf8"); }
    finally { await handle.close(); }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { await rename(temporary, this.statePath); return; }
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code) || attempt === 19) {
          throw new Error(`Could not save task state: ${error.code ?? "unknown"}`);
        }
        await delay(10);
      }
    }
  }

  async ensureOpen() {
    await this.ready;
    if (this.closed) throw new Error("Task manager is closed");
  }

  async projectForExecution(projectId) {
    if (!(await this.access.authorize("agent.execute", projectId))) {
      throw new Error("Project is not authorized for agent.execute");
    }
    const project = (await this.access.listProjects()).find((entry) => entry.id === projectId);
    if (!project || project.status !== "enabled" || project.available !== true) {
      throw new Error("Project is missing, disabled, or unavailable");
    }
    if (!isAbsolute(project.root)) throw new Error("Authorized project root is invalid");
    return { ...project, root: resolve(project.root) };
  }

  async start(input) {
    await this.ensureOpen();
    const request = normalizeRequest(input);
    const project = await this.projectForExecution(request.projectId);
    const preflight = await this.workerBroker.preflight({ projectId: project.id, projectRoot: project.root });
    const idempotencyHash = digest(request.idempotencyKey);
    const requestHash = digest(JSON.stringify({ ...request, idempotencyKey: undefined }));
    return this.withLock(async () => {
      const existing = this.document.tasks.find((task) => task.idempotencyHash === idempotencyHash);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("Idempotency key was already used for a different task");
        return publicTask(existing, this.now());
      }
      const createdAt = new Date(this.now()).toISOString();
      const timeoutMs = Math.min((request.timeoutSeconds ?? this.defaultTimeoutMs / 1_000) * 1_000, this.maxTaskRuntimeMs);
      const task = {
        taskId: randomUUID(), idempotencyHash, requestHash,
        projectId: request.projectId, projectRoot: project.root, agent: request.agent,
        executorMode: preflight?.mode ?? "isolated", task: request.task, scope: request.scope,
        timeoutMs, status: "queued", createdAt, startedAt: null, updatedAt: createdAt, finishedAt: null,
        codexSessionId: null, pendingApproval: false, resumeCount: 0, summary: null, result: null, error: null,
        baselineFiles: [], logs: [], logBytes: 0, logsTruncated: false,
      };
      this.document.tasks.push(task);
      await this.persist();
      this.schedulePump();
      return publicTask(task, this.now());
    });
  }

  schedulePump() {
    if (this.pumpScheduled || this.closed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  async pump() {
    while (!this.closed && this.active.size < this.maxConcurrent) {
      const task = this.document.tasks.find((entry) => entry.status === "queued" && !this.activeProjects.has(entry.projectId));
      if (!task) return;
      this.activeProjects.add(task.projectId);
      const controller = new AbortController();
      this.active.set(task.taskId, { controller, timedOut: false });
      const worker = this.execute(task.taskId, controller, task.continuationMessage ?? null);
      this.runningPromises.set(task.taskId, worker);
      void worker.finally(() => this.runningPromises.delete(task.taskId));
    }
  }

  async updateTask(taskId, updater) {
    return this.withLock(async () => {
      const task = this.document.tasks.find((entry) => entry.taskId === taskId);
      if (!task) return null;
      updater(task);
      task.updatedAt = new Date(this.now()).toISOString();
      await this.persist();
      return task;
    });
  }

  async addLog(taskId, kind, value) {
    const message = boundedLogText(typeof value === "string" ? value : JSON.stringify(value));
    await this.updateTask(taskId, (task) => {
      task.logs.push({ sequence: (task.logs.at(-1)?.sequence ?? 0) + 1, timestamp: new Date(this.now()).toISOString(), kind,
        message });
      task.logBytes += Buffer.byteLength(message, "utf8");
      const markerBytes = Buffer.byteLength(LOG_TRUNCATED_MARKER, "utf8");
      const markerIndex = task.logs.findIndex((entry) => entry.kind === "system" && entry.message === LOG_TRUNCATED_MARKER);
      if (task.logBytes > MAX_TASK_LOG_BYTES) {
        task.logsTruncated = true;
        if (markerIndex < 0) {
          while (task.logs.length && task.logBytes + markerBytes > MAX_TASK_LOG_BYTES) {
            const removed = task.logs.shift();
            task.logBytes -= Buffer.byteLength(removed.message, "utf8");
          }
          const marker = { sequence: task.logs[0]?.sequence ?? 0,
            timestamp: task.logs[0]?.timestamp ?? new Date(this.now()).toISOString(), kind: "system", message: LOG_TRUNCATED_MARKER };
          task.logs.unshift(marker);
          task.logBytes += markerBytes;
        } else {
          while (task.logBytes > MAX_TASK_LOG_BYTES && task.logs.length > 1) {
            const removeIndex = markerIndex === 0 ? 1 : 0;
            const [removed] = task.logs.splice(removeIndex, 1);
            task.logBytes -= Buffer.byteLength(removed.message, "utf8");
          }
        }
      }
    });
  }

  async execute(taskId, controller, continuationMessage = null) {
    const active = this.active.get(taskId);
    if (!active) return;
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) return;
    const timeoutMs = Math.min(task.timeoutMs, this.maxTaskRuntimeMs);
    const timeout = setTimeout(() => {
      const current = this.active.get(taskId);
      if (!current || current.controller.signal.aborted) return;
      current.timedOut = true;
      current.controller.abort(new Error("Task timed out"));
    }, timeoutMs);
    timeout.unref?.();
    const pendingLogs = [];
    try {
      const project = await this.projectForExecution(task.projectId);
      await this.workerBroker.preflight({ projectId: project.id, projectRoot: project.root,
        executorMode: task.executorMode ?? "isolated" });
      await this.updateTask(taskId, (record) => {
        record.status = "running";
        record.startedAt ??= new Date(this.now()).toISOString();
        record.finishedAt = null;
        record.error = null;
      });
      await this.addLog(taskId, "status", continuationMessage ? "Continuing the saved Codex session." : "Task started.");
      const baseline = await gitSnapshot(project.root);
      await this.updateTask(taskId, (record) => { record.baselineFiles = baseline ?? []; });
      const current = this.document.tasks.find((entry) => entry.taskId === taskId);
      const instructions = [
        "Work only in the authorized project root provided by Tong Desktop Control.",
        "Follow the allowed work scope and task. Do not attempt to access credentials, private files, other projects, or operating-system settings.",
        `Allowed work scope: ${current.scope}`,
        `Task: ${current.task}`,
      ].join("\n\n");
      const result = await this.workerBroker.runTask({
        taskId, projectId: project.id, cwd: project.root, task: current.task, scope: current.scope,
        prompt: instructions, timeoutMs, threadId: current.codexSessionId ?? undefined,
        continuationMessage, ...(this.workerBroker instanceof TongExecutorRouter
          ? { executorMode: task.executorMode ?? "isolated", resumeCount: current.resumeCount ?? 0 } : {}),
      }, {
        signal: controller.signal,
        onSessionId: async (id) => {
          if (typeof id === "string" && id.length <= 200) {
            await this.updateTask(taskId, (record) => { record.codexSessionId = id; });
          }
        },
        onLog: (message, kind = "output") => {
          const writing = this.addLog(taskId, kind, message);
          pendingLogs.push(writing);
          void writing.catch(() => {});
          return writing;
        },
        onState: (state) => {
          if (state === "waiting_user_action" || state === "running") {
            return this.updateTask(taskId, (record) => {
              record.status = state;
              record.pendingApproval = state === "waiting_user_action" && task.executorMode === "trusted-windows";
            });
          }
        },
      });
      await Promise.all(pendingLogs);
      const execution = this.active.get(taskId);
      const finishedAt = new Date(this.now()).toISOString();
      const gitResult = await this.collectResult(project.root, current.baselineFiles);
      await this.addLog(taskId, "status", `Codex turn finished with status ${result?.turnStatus ?? "unknown"}.`);
      await this.updateTask(taskId, (record) => {
        record.summary = typeof result?.summary === "string" ? cleanText(result.summary).slice(0, 16_000) : null;
        record.result = { ...(gitResult ?? {}), tests: Array.isArray(result?.tests) ? result.tests.slice(0, 100) : [] };
        record.turnStatus = result?.turnStatus ?? null;
        record.finishedAt = finishedAt;
        if (execution?.timedOut) {
          record.status = "failed";
          record.error = { message: "Task timed out", suggestion: "Check logs and project state before submitting a new request." };
        } else if (controller.signal.aborted) {
          record.status = "cancelled";
          record.error = null;
        } else if (result?.turnStatus === "completed") {
          record.status = "success";
          record.error = null;
        } else if (result?.turnStatus === "interrupted") {
          record.status = "waiting_user_action";
          record.error = { message: "Codex interrupted before completing the task.",
            suggestion: "Use tong_agent_resume to continue the saved Codex session after reviewing its logs." };
        } else {
          record.status = "failed";
          record.error = { message: "Codex task did not complete successfully.",
            suggestion: "Review task logs before choosing whether to resume." };
        }
        record.pendingApproval = false;
        record.continuationMessage = null;
      });
    } catch (error) {
      await Promise.allSettled(pendingLogs);
      const execution = this.active.get(taskId);
      const finishedAt = new Date(this.now()).toISOString();
      await this.addLog(taskId, "error", error instanceof Error ? error.message : "Codex adapter failed");
      await this.updateTask(taskId, (record) => {
        record.finishedAt = finishedAt;
        record.continuationMessage = null;
        if (execution?.timedOut) {
          record.status = "failed";
          record.error = { message: "Task timed out", suggestion: "Check logs and project state before submitting a new request." };
        } else if (controller.signal.aborted) {
          record.status = "cancelled";
          record.error = null;
        } else {
          record.status = "failed";
          record.error = { message: cleanText(error instanceof Error ? error.message : "Codex adapter failed").slice(0, 500),
            suggestion: "Review task logs and local Codex availability before submitting another request." };
        }
      });
    } finally {
      clearTimeout(timeout);
      this.active.delete(taskId);
      this.activeProjects.delete(task?.projectId);
      this.schedulePump();
    }
  }

  async status(taskId) {
    await this.ensureOpen();
    await this.lock;
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("Task not found");
    return publicTask(task, this.now());
  }

  async list({ limit = 50, cursor } = {}) {
    await this.ensureOpen();
    await this.lock;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TASK_PAGE_SIZE) throw new Error("Invalid task limit");
    const offset = decodeCursor(cursor, "task-list", "list");
    const tasks = [...this.document.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = tasks.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return { tasks: page.map((task) => publicTask(task, this.now())),
      nextCursor: nextOffset < tasks.length ? encodeCursor("task-list", nextOffset, "list") : null };
  }

  async logs({ taskId, limit = 50, cursor } = {}) {
    await this.ensureOpen();
    await this.lock;
    if (typeof taskId !== "string") throw new Error("Invalid task id");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_PAGE_SIZE) throw new Error("Invalid log limit");
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("Task not found");
    const offset = decodeCursor(cursor, taskId, "logs");
    const entries = task.logs.slice(offset, offset + limit);
    const nextOffset = offset + entries.length;
    return { taskId, entries, nextCursor: nextOffset < task.logs.length ? encodeCursor(taskId, nextOffset, "logs") : null,
      truncated: task.logsTruncated, maxBytes: MAX_TASK_LOG_BYTES };
  }

  async cancel(taskId) {
    await this.ensureOpen();
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("Task not found");
    if (TERMINAL_STATES.has(task.status)) return publicTask(task, this.now());
    if (task.status === "queued") {
      await this.updateTask(taskId, (record) => {
        record.status = "cancelled";
        record.finishedAt = new Date(this.now()).toISOString();
      });
      this.schedulePump();
      return this.status(taskId);
    }
    const active = this.active.get(taskId);
    if (active && !active.controller.signal.aborted) active.controller.abort(new Error("Cancelled by user"));
    return this.status(taskId);
  }

  async resume(taskId, { message = "Continue the same task in this saved Codex session. Review the existing work before making further changes." } = {}) {
    await this.ensureOpen();
    if (typeof message !== "string" || message.trim().length < 1 || message.length > MAX_SCOPE_CHARS || /\0/.test(message)) {
      throw new Error("Invalid resume message");
    }
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "waiting_user_action" || !task.codexSessionId || task.pendingApproval) {
      throw new Error("Task has no resumable Codex session");
    }
    const project = await this.projectForExecution(task.projectId);
    await this.workerBroker.preflight({ projectId: project.id, projectRoot: project.root,
      executorMode: task.executorMode ?? "isolated" });
    await this.updateTask(taskId, (record) => {
      record.status = "queued";
      record.updatedAt = new Date(this.now()).toISOString();
      record.finishedAt = null;
      record.resumeCount += 1;
      record.error = null;
      record.continuationMessage = message.trim();
    });
    this.schedulePump();
    return { ...(await this.status(taskId)), resumeQueued: true };
  }

  async result(taskId) {
    await this.ensureOpen();
    await this.lock;
    const task = this.document.tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("Task not found");
    return {
      ...publicTask(task, this.now()),
      agentSummary: task.summary,
      changedFiles: task.result?.changedFiles ?? [],
      diffSummary: task.result?.diffSummary ?? null,
      gitAvailable: task.result?.gitAvailable ?? false,
      tests: task.result?.tests ?? [],
      verification: task.status === "success"
        ? "Codex turn completed; GPT should independently review the diff and test evidence."
        : "No successful Codex turn is recorded.",
    };
  }

  async close() {
    await this.ready;
    this.closed = true;
    for (const [taskId, active] of this.active) {
      const task = this.document.tasks.find((entry) => entry.taskId === taskId);
      if (task && !TERMINAL_STATES.has(task.status) && !active.controller.signal.aborted) {
        active.controller.abort(new Error("Task manager stopped"));
      }
    }
    await Promise.allSettled([...this.runningPromises.values()]);
    await this.releaseManagerLock();
  }
}
