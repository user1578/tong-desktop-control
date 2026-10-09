import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const CLIENT_INFO = { name: "tong_desktop_control", title: "Tong Desktop Control", version: "0.1.0" };
const SAFETY_INSTRUCTIONS = [
  "Work only inside the supplied authorized project root.",
  "Follow the task's allowed work scope. Do not access credentials, other projects, or operating-system settings.",
  "Approval requests that would expand the configured sandbox are denied.",
].join("\n");
const MAX_AGENT_MESSAGE_CHARS = 16_000;

function safeSummary(value) {
  return String(value ?? "").replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key) => `${key}=[REDACTED]`)
    .replace(/\b(cookie|authorization)\s*[:=]\s*[^\r\n]+/gi, (_match, key) => `${key}=[REDACTED]`)
    .slice(-MAX_AGENT_MESSAGE_CHARS);
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
    child.stderr.on("data", (chunk) => this.onLog(chunk.toString("utf8"), "stderr"));
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
      if (message.error) waiter.reject(new Error(`Codex App Server request failed (${message.error.code ?? "unknown"})`));
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
      this.pending.set(String(id), { resolve: resolvePromise, reject, timer });
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
  constructor({ executable = process.platform === "win32" ? "codex.exe" : "codex", spawnProcess = spawn,
    requestTimeoutMs = 30_000, cancelGraceMs = 5_000, shutdownTimeoutMs = 1_500 } = {}) {
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.cancelGraceMs = cancelGraceMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
  }

  async runTask(spec, { signal, onSessionId = () => {}, onLog = () => {}, onState = () => {} } = {}) {
    if (!spec || typeof spec.cwd !== "string" || typeof spec.prompt !== "string") throw new Error("Invalid Codex task specification");
    const child = this.spawnProcess(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd: spec.cwd,
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
    const deltas = [];
    const testRuns = new Map();
    let completed = false;
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
      if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
        deltas.push(params.delta);
        onLog(params.delta, "agent");
      } else if (message.method === "item/commandExecution/outputDelta" && typeof params.delta === "string") {
        onLog(params.delta, "command_output");
      } else if (message.method === "turn/completed") {
        const turn = params.turn ?? {};
        if ((params.threadId && params.threadId !== threadId) || (turnId && turn.id && turn.id !== turnId)) return;
        if (!turnId && typeof turn.id === "string") turnId = turn.id;
        for (const item of turn.items ?? []) captureCommand(item);
        completed = true;
        completionResolve({ turnStatus: turn.status, summary: turnSummary(turn, deltas), tests: [...testRuns.values()].slice(0, 100) });
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = params.item;
        captureCommand(item);
      } else if (/item\/(?:commandExecution|fileChange)\//.test(message.method)) {
        const safe = { method: message.method,
          ...(typeof params.exitCode === "number" ? { exitCode: params.exitCode } : {}),
          ...(typeof params.status === "string" ? { status: params.status } : {}) };
        onLog(JSON.stringify(safe), "execution_event");
      }
    };
    const serverRequest = async (message) => {
      const method = String(message.method ?? "");
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
      } catch (error) { completionReject(error); }
    };
    const peer = new JsonRpcPeer(child, { onLog, onNotification: notify, onServerRequest: serverRequest,
      requestTimeoutMs: this.requestTimeoutMs });
    let killTimer;
    const killOwnProcess = () => {
      if (!didExit && !child.killed) child.kill();
    };
    const requestInterrupt = () => {
      if (!threadId || !turnId || completed) return;
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
      const initialized = await peer.request("initialize", { clientInfo: CLIENT_INFO, capabilities: {} });
      onLog(`Codex App Server initialized (${initialized.serverInfo?.version ?? initialized.userAgent ?? "version unavailable"}).`, "status");
      peer.notify("initialized");
      const threadParams = {
        cwd: spec.cwd,
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        runtimeWorkspaceRoots: [spec.cwd],
        developerInstructions: SAFETY_INSTRUCTIONS,
      };
      const thread = spec.threadId
        ? await peer.request("thread/resume", { ...threadParams, threadId: spec.threadId })
        : await peer.request("thread/start", threadParams);
      threadId = thread?.thread?.id ?? spec.threadId ?? null;
      if (typeof threadId !== "string" || threadId.length < 1 || threadId.length > 200) {
        throw new Error("Codex App Server did not return a valid thread ID");
      }
      await onSessionId(threadId);
      const prompt = spec.continuationMessage
        ? `${spec.prompt}\n\nContinuation request: ${spec.continuationMessage}`
        : spec.prompt;
      const started = await peer.request("turn/start", {
        threadId,
        cwd: spec.cwd,
        runtimeWorkspaceRoots: [spec.cwd],
        approvalPolicy: "on-request",
        input: [{ type: "text", text: prompt }],
      });
      turnId = started?.turn?.id ?? null;
      if (signal?.aborted) requestInterrupt();
      if (!turnId) {
        const turn = await Promise.race([completion, exited.then(({ code, signal: exitSignal }) => {
          throw new Error(`Codex App Server exited before returning a turn ID (${code ?? exitSignal ?? "unknown"})`);
        })]);
        return { ...turn, threadId };
      }
      const turn = await Promise.race([completion, exited.then(({ code, signal: exitSignal }) => {
        if (!completed) throw new Error(`Codex App Server exited before turn/completed (${code ?? exitSignal ?? "unknown"})`);
        return null;
      }).then((value) => value ?? completion)]);
      return { ...turn, threadId };
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
