import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const CLIENT_INFO = { name: "tong_desktop_control", title: "Tong Desktop Control", version: "0.1.0" };
const SAFETY_INSTRUCTIONS = [
  "Work only inside the supplied authorized project root.",
  "Follow the task's allowed work scope. Do not access credentials, other projects, or operating-system settings.",
  "Approval requests that would expand the configured sandbox are denied.",
].join("\n");
const MAX_AGENT_MESSAGE_CHARS = 16_000;
const SESSION_SOURCES = ["cli", "vscode", "appServer"];

// Codex enforces a single native writer per thread across App Server processes.
// This is a recoverable ownership conflict, not evidence that the rollout is corrupt.
export class CodexSessionBusyError extends Error {
  constructor() {
    super("Codex session is owned by another active writer. No turn was started. Release the session in the other Codex client before retrying the same native session.");
    this.name = "CodexSessionBusyError";
    this.code = "CODEX_SESSION_ACTIVE_WRITER";
  }
}

export class CodexSessionNotReadyError extends Error {
  constructor() {
    super("Native Codex session is busy or not accepting input. No turn was started. Wait until it is idle, then resume the same native session.");
    this.name = "CodexSessionNotReadyError";
    this.code = "CODEX_SESSION_NOT_READY";
  }
}

function isActiveWriterConflict(method, code, message) {
  return ["thread/read", "thread/resume"].includes(method) && code === -32600
    && /(?:already has an active writer|thread-store conflict[^\r\n]*active writer)/i.test(String(message ?? ""));
}
const samePath = (a, b) => typeof a === "string" && typeof b === "string"
  && (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

function projectSession(thread, cwd) {
  return thread && typeof thread.id === "string" && samePath(thread.cwd, cwd)
    && !thread.ephemeral && !thread.parentThreadId
    && SESSION_SOURCES.includes(thread.source)
    && !String(thread.path ?? "").split(/[\\/]/).includes("archived_sessions");
}

function usableSession(thread) {
  return ["idle", "notLoaded"].includes(thread?.status?.type) && thread.canAcceptDirectInput !== false;
}

function safeSummary(value) {
  return String(value ?? "").replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key) => `${key}=[REDACTED]`)
    .replace(/\b(cookie|authorization)\s*[:=]\s*[^\r\n]+/gi, (_match, key) => `${key}=[REDACTED]`)
    .slice(-MAX_AGENT_MESSAGE_CHARS);
}

function nativeThreadTitle(spec) {
  // The first task line is user-facing. Never use the long internal safety prompt as a title.
  const task = safeSummary(spec.task ?? "").split(/\r?\n/).find(line => line.trim())?.trim() ?? "";
  const project = String(spec.projectId ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 32);
  const subject = task.replace(/[\r\n\t\x00-\x1f]+/g, " ").slice(0, 76);
  return subject ? [project, subject].filter(Boolean).join(" · ").slice(0, 110) : null;
}

function safeProtocolMessage(value, limit = 300) {
  return safeSummary(String(value ?? "").replace(/[\r\n\t\x00-\x1f]+/g, " "))
    .replace(/\b(token|client[_-]?secret|api[_-]?key|password)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key) => `${key}=[REDACTED]`)
    .replace(/\b[A-Za-z]:\\[^\s"']+/g, "[path]")
    .replace(/\/(?:Users|home|root)\/[^\s"']+/g, "[path]")
    .replace(/https?:\/\/[^\s"']+/g, "[url]")
    .slice(0, limit);
}

function turnSummary(turn, deltas) {
  const messages = [];
  for (const item of turn?.items ?? []) {
    if (item?.type !== "agentMessage" && item?.type !== "assistantMessage") continue;
    if (typeof item.text === "string") messages.push(item.text);
    for (const content of item.content ?? []) {
      if (typeof content?.text === "string") messages.push(content.text);
    }
  }
  return safeSummary(messages.join("\n").trim() || deltas.join(""));
}

class JsonRpcPeer {
  constructor(child, { onLog, onNotification, onServerRequest, requestTimeoutMs }) {
    this.child = child;
    this.onLog = onLog;
    this.onNotification = onNotification;
    this.onServerRequest = onServerRequest;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.receive(line));
    child.stderr.on("data", (chunk) => this.onLog(safeProtocolMessage(chunk.toString("utf8"), 2_000), "stderr"));
    child.once("error", (error) => this.failAll(error));
    child.once("close", (code, signal) => {
      if (this.pending.size) this.failAll(new Error(`Codex App Server exited (${code ?? signal ?? "unknown"})`));
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { this.onLog("Ignored a malformed App Server protocol line.", "protocol"); return; }
    if (message && Object.hasOwn(message, "id") && (message.result !== undefined || message.error !== undefined)) {
      const waiter = this.pending.get(String(message.id));
      if (!waiter) return;
      this.pending.delete(String(message.id));
      clearTimeout(waiter.timer);
      if (message.error) {
        const code = Number.isInteger(message.error.code) ? message.error.code : "unknown";
        const detail = safeProtocolMessage(message.error.message);
        waiter.reject(isActiveWriterConflict(waiter.method, code, message.error.message)
          ? new CodexSessionBusyError()
          : new Error(`Codex App Server ${waiter.method} failed (${code})${detail ? `: ${detail}` : ""}`));
      }
      else waiter.resolve(message.result ?? {});
      return;
    }
    if (message?.method && Object.hasOwn(message, "id")) {
      void this.onServerRequest(message);
      return;
    }
    if (typeof message?.method === "string") void this.onNotification(message);
  }

  write(message) {
    if (this.child.stdin.destroyed || this.child.stdin.writableEnded) throw new Error("Codex App Server input is closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex App Server request timed out (${method})`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(String(id), { method, resolve: resolvePromise, reject, timer });
      try { this.write({ jsonrpc: "2.0", id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  failAll(error) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  close() { this.lines.close(); }
}

export class CodexAppServerAdapter {
  constructor({ executable, env = {}, spawnProcess = spawn,
    requestTimeoutMs = 30_000, cancelGraceMs = 5_000, shutdownTimeoutMs = 1_500 } = {}) {
    if (typeof executable !== "string" || !isAbsolute(executable)) {
      throw new Error("Codex App Server executable must be a fixed absolute path");
    }
    if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("Codex App Server environment is invalid");
    this.executable = executable;
    this.env = Object.freeze({ ...env });
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.cancelGraceMs = cancelGraceMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
  }

  async withMetadataPeer(cwd, callback) {
    const child = this.spawnProcess(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd, env: this.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let didExit = false;
    const exited = new Promise((done) => child.once("close", () => { didExit = true; done(); }));
    const peer = new JsonRpcPeer(child, { onLog: () => {}, onNotification: () => {},
      onServerRequest: (message) => peer.write({ id: message.id,
        error: { code: -32601, message: "Metadata client does not execute server requests" } }),
      requestTimeoutMs: this.requestTimeoutMs });
    try {
      await peer.request("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } });
      peer.notify("initialized");
      return await callback(peer);
    } finally {
      peer.close();
      if (!didExit) {
        child.stdin.end();
        await Promise.race([exited, delay(this.shutdownTimeoutMs)]);
        if (!didExit) child.kill();
      }
    }
  }

  async listSessions({ cwd, limit = 50, cursor, searchTerm } = {}) {
    return this.withMetadataPeer(cwd, (peer) => this.sessionPage(peer, { cwd, limit, cursor, searchTerm }));
  }

  async sessionPage(peer, { cwd, limit, cursor, searchTerm }) {
    const result = await peer.request("thread/list", { cwd, limit, cursor, searchTerm,
      sourceKinds: SESSION_SOURCES, modelProviders: [], archived: false,
      sortKey: "updated_at", sortDirection: "desc", useStateDbOnly: true });
    if (!Array.isArray(result.data)) throw new Error("Codex App Server returned invalid session metadata");
    return { sessions: result.data.filter((thread) => projectSession(thread, cwd)).map((thread) => ({
      id: thread.id, name: thread.name ? safeSummary(thread.name).slice(0, 300) : null,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
      status: { type: thread.status?.type ?? "unknown" }, source: thread.source,
      usable: usableSession(thread),
      writerOwnershipVerified: false, // Another app-server may hold the native writer despite an idle/notLoaded status.
    })), nextCursor: result.nextCursor ?? null };
  }

  async selectSession({ cwd, sessionMode = "latest", codexSessionId, searchTerm } = {}) {
    if (sessionMode === "new") return null;
    if (sessionMode === "existing") return this.withMetadataPeer(cwd, async (peer) => {
      await this.checkedSession(peer, cwd, codexSessionId);
      return codexSessionId;
    });
    return this.withMetadataPeer(cwd, async (peer) => {
      let cursor;
      // Bound discovery work; never create a new thread just because the search was truncated.
      for (let page = 0; page < 20; page += 1) {
        const result = await this.sessionPage(peer, { cwd, cursor, limit: 100, searchTerm });
        // "latest" means the newest matching conversation, NOT the newest idle
        // fallback. An active conversation must not be silently replaced by an
        // older thread simply because another client holds its writer.
        if (result.sessions.length) return result.sessions[0].id;
        if (!result.nextCursor) return null;
        cursor = result.nextCursor;
      }
      throw new Error("Native session search limit reached; specify a session ID");
    });
  }

  async ensureDesktopProject(peer, cwd) {
    const root = resolve(cwd);
    const matching = new Map();
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const result = await peer.request("project/list", { limit: 100, cursor });
      if (!Array.isArray(result.data)) throw new Error("Codex App Server returned invalid projects");
      for (const project of result.data) {
        if (project?.roots?.some((entry) => samePath(entry.path, root))) {
          if (typeof project.id !== "string" || !project.id) throw new Error("Codex project ID is invalid");
          matching.set(project.id, project);
        }
      }
      cursor = result.nextCursor ?? null;
      if (!cursor) break;
      if (page === 19) throw new Error("Codex project discovery limit reached; cannot safely assign session");
    }
    if (matching.size > 1) throw new Error("Multiple Codex projects match the authorized root; select one in Codex Desktop");
    if (matching.size === 1) return [...matching.keys()][0];

    // This operation runs only after Tong's project/task authorization. It does
    // not write Codex Desktop state files or create another project directory.
    const idempotencyKey = "tong-project-" + createHash("sha256")
      .update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex");
    const result = await peer.request("project/create", {
      idempotencyKey, name: basename(root), roots: [{ path: root }],
    });
    if (typeof result.project?.id !== "string" || !result.project.id
        || !result.project.roots?.some((entry) => samePath(entry.path, root))) {
      throw new Error("Codex App Server did not confirm the authorized project root");
    }
    return result.project.id;
  }

  async checkedSession(peer, cwd, threadId) {
    const result = await peer.request("thread/read", { threadId, includeTurns: false });
    if (!projectSession(result.thread, cwd) || result.thread.id !== threadId) {
      throw new Error("Native Codex session project mismatch or unavailable");
    }
    if (!usableSession(result.thread)) throw new CodexSessionNotReadyError();
    return result.thread;
  }

  async runTask(spec, { signal, onSessionId = () => {}, onLog = () => {}, onState = () => {}, authorizedCapabilities = [] } = {}) {
    if (!spec || typeof spec.cwd !== "string" || typeof spec.prompt !== "string") throw new Error("Invalid Codex task specification");
    signal?.throwIfAborted();
    const child = this.spawnProcess(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd: spec.cwd,
      env: this.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let didExit = false;
    let resolveExit;
    const exited = new Promise((resolvePromise) => { resolveExit = resolvePromise; });
    child.once("close", (code, exitSignal) => { didExit = true; resolveExit({ code, signal: exitSignal }); });
    let threadId = null;
    let turnId = null;
    let completionResolve;
    let completionReject;
    const completion = new Promise((resolvePromise, reject) => { completionResolve = resolvePromise; completionReject = reject; });
    // Handshake failures can close the child before completion is awaited.
    void completion.catch(() => {});
    const deltas = [];
    const agentMessages = new Map();
    const testRuns = new Map();
    let completed = false;
    let approvalRequired = null;
    const captureCommand = (item) => {
      if (item?.type !== "commandExecution" || typeof item.command !== "string"
          || !/\b(test|tests|spec|lint|typecheck|check|build|verify|pytest|vitest|jest)\b/i.test(item.command)) return;
      const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
      testRuns.set(item.id ?? item.command, {
        command: safeSummary(item.command).slice(0, 2_000),
        exitCode,
        status: exitCode === 0 ? "passed" : exitCode === null ? "unknown" : "failed",
        evidence: "codex_app_server_command_event",
      });
    };
    const notify = async (message) => {
      const params = message.params ?? {};
      if ((params.threadId && params.threadId !== threadId) || (turnId && params.turnId && params.turnId !== turnId)) return;
      if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
        deltas.push(params.delta);
        onLog(params.delta, "agent");
      } else if (message.method === "item/commandExecution/outputDelta" && typeof params.delta === "string") {
        onLog(params.delta, "command_output");
      } else if (message.method === "turn/completed") {
        // A fast server completion after decline cannot erase a latched policy
        // boundary while onState is still persisting the user-action status.
        if(approvalRequired)return;
        const turn = params.turn ?? {};
        if ((params.threadId && params.threadId !== threadId) || (turnId && turn.id && turn.id !== turnId)) return;
        if (!turnId && typeof turn.id === "string") turnId = turn.id;
        for (const item of turn.items ?? []) captureCommand(item);
        completed = true;
        const storedMessages = (turn.items ?? []).filter((item) => ["agentMessage", "assistantMessage"].includes(item.type));
        const messages = storedMessages.length ? storedMessages : [...agentMessages.values()];
        const finalMessages = messages.filter((item) => item.phase === "final_answer");
        const items = finalMessages.length ? finalMessages : messages;
        completionResolve({ turnStatus: turn.status, summary: turnSummary({ items }, deltas),
          error: turn.error ? { message: safeSummary(turn.error.message).slice(0, 500) } : null,
          tests: [...testRuns.values()].slice(0, 100) });
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = params.item;
        captureCommand(item);
        if (["commandExecution", "fileChange"].includes(item?.type)) {
          onLog(JSON.stringify({ type: item.type, event: message.method === "item/started" ? "started" : "completed" }), "progress_event");
        }
        if (message.method === "item/completed" && item?.type === "agentMessage") agentMessages.set(item.id, item);
      } else if (message.method === "error") {
        onLog(safeSummary(params.error?.message ?? "Codex reported an error"), "error");
      } else if (/item\/(?:commandExecution|fileChange)\//.test(message.method)) {
        const safe = { method: message.method,
          ...(typeof params.exitCode === "number" ? { exitCode: params.exitCode } : {}),
          ...(typeof params.status === "string" ? { status: params.status } : {}) };
        onLog(JSON.stringify(safe), "execution_event");
      }
    };
    const serverRequest = async (message) => {
      const method = String(message.method ?? "");
      if(method.endsWith('/requestApproval')) {
        approvalRequired={method,reason:'outside-configured-sandbox'};
        completed=true;
      }
      onLog(`Approval request declined by policy: ${method}`, "policy");
      try {
        if (method === "item/commandExecution/requestApproval") {
          // Declining the command allows the agent to continue without that command.
          peer.respond(message.id, { decision: "decline" });
        } else if (method === "item/fileChange/requestApproval") {
          // Reject file-change approvals that ask for access beyond the configured workspace.
          peer.respond(message.id, { decision: "abort" });
        } else if (method === "item/permissions/requestApproval") {
          peer.respond(message.id, { permissions: { fileSystem: { read: [], write: [] }, network: { enabled: false } }, scope: "turn" });
        } else {
          peer.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported App Server request" } });
        }
        if(method.endsWith('/requestApproval')) {
          // Do not silently let a task continue after asking for wider rights.
          // No accept/acceptForSession response is synthesized by the agent.
          onLog('User decision required: requested access is outside project authorization. Task paused; no additional rights granted.','user_action');
          await onState('waiting_user_action');
          requestInterrupt(true);
          completionResolve({turnStatus:'interrupted',summary:'User decision required before expanding project authorization.',approvalRequired,tests:[...testRuns.values()].slice(0,100)});
        }
      } catch (error) { completionReject(error); }
    };
    const peer = new JsonRpcPeer(child, { onLog, onNotification: notify, onServerRequest: serverRequest,
      requestTimeoutMs: this.requestTimeoutMs });
    let killTimer;
    const killOwnProcess = () => {
      if (!didExit && !child.killed) child.kill();
    };
    const requestInterrupt = (force = false) => {
      if (!threadId || !turnId || completed && !force) return;
      void peer.request("turn/interrupt", { threadId, turnId }).catch((error) => {
        onLog(error.message, "interrupt_error");
      });
    };
    const abortHandler = () => {
      requestInterrupt();
      killTimer = setTimeout(killOwnProcess, this.cancelGraceMs);
      killTimer.unref?.();
      if (!threadId) setTimeout(killOwnProcess, Math.min(this.cancelGraceMs, 250)).unref?.();
    };
    signal?.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) abortHandler();
    child.once("close", (code, exitSignal) => {
      if (!completed) completionReject(new Error(`Codex App Server exited before turn/completed (${code ?? exitSignal ?? "unknown"})`));
    });

    try {
      const initialized = await peer.request("initialize", { clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true, requestAttestation: false } });
      onLog(`Codex App Server initialized (${initialized.serverInfo?.version ?? initialized.userAgent ?? "version unavailable"}).`, "status");
      peer.notify("initialized");
      signal?.throwIfAborted();
      const threadParams = {
        cwd: spec.cwd,
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        runtimeWorkspaceRoots: [spec.cwd],
        developerInstructions: SAFETY_INSTRUCTIONS,
      };
      if (spec.threadId) await this.checkedSession(peer, spec.cwd, spec.threadId);
      const desktopProjectId = spec.threadId ? null : await this.ensureDesktopProject(peer, spec.cwd);
      signal?.throwIfAborted();
      const thread = spec.threadId
        ? await peer.request("thread/resume", { ...threadParams, threadId: spec.threadId, excludeTurns: true })
        : await peer.request("thread/start", { ...threadParams, projectId: desktopProjectId });
      if (!spec.threadId && thread?.thread?.projectId !== desktopProjectId) {
        throw new Error("Codex App Server did not confirm the new thread project assignment");
      }
      threadId = thread?.thread?.id ?? null;
      if (typeof threadId !== "string" || threadId.length < 1 || threadId.length > 200) {
        throw new Error("Codex App Server did not return a valid thread ID");
      }
      if (spec.threadId && threadId !== spec.threadId) throw new Error("Codex App Server returned a different native session");
      await onSessionId(threadId);
      if (!spec.threadId) {
        const title = nativeThreadTitle(spec);
        if (title) {
          try { await peer.request("thread/name/set", { threadId, name: title }); }
          catch (error) { onLog(`Optional native session title was not set: ${safeProtocolMessage(error.message)}`, "status"); }
        }
      }
      signal?.throwIfAborted();
      const prompt = spec.continuationMessage
        ? `${spec.prompt}\n\nContinuation request: ${spec.continuationMessage}`
        : spec.prompt;
      const started = await peer.request("turn/start", {
        threadId,
        cwd: spec.cwd,
        runtimeWorkspaceRoots: [spec.cwd],
        approvalPolicy: "on-request",
        // This capability comes only from the broker's locally confirmed grant.
        // Package downloads need networking, but filesystem writes stay scoped.
        ...(authorizedCapabilities.includes('dependency.install') ? {sandboxPolicy:{type:'workspaceWrite',writableRoots:[spec.cwd],networkAccess:true}} : {}),
        input: [{ type: "text", text: prompt }],
      });
      turnId = started?.turn?.id ?? null;
      if (signal?.aborted) requestInterrupt();
      if (!turnId) {
        const turn = await Promise.race([completion, exited.then(({ code, signal: exitSignal }) => {
          throw new Error(`Codex App Server exited before returning a turn ID (${code ?? exitSignal ?? "unknown"})`);
        })]);
        return { ...turn, threadId, turnId };
      }
      const turn = await Promise.race([completion, exited.then(({ code, signal: exitSignal }) => {
        if (!completed) throw new Error(`Codex App Server exited before turn/completed (${code ?? exitSignal ?? "unknown"})`);
        return null;
      }).then((value) => value ?? completion)]);
      return { ...turn, threadId, turnId };
    } catch (error) {
      killOwnProcess();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortHandler);
      if (killTimer) clearTimeout(killTimer);
      peer.close();
      if (!didExit && !child.killed) {
        const waitForExit = Promise.race([exited, delay(this.shutdownTimeoutMs)]);
        try { child.stdin.end(); } catch { /* process may already have exited */ }
        await waitForExit;
        if (!didExit) {
          killOwnProcess();
          await Promise.race([exited, delay(this.shutdownTimeoutMs)]);
        }
      }
    }
  }
}
