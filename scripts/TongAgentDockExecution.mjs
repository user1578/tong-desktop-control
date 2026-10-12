import { randomUUID, createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { dockError, TongAgentDockError } from "./TongAgentDockClient.mjs";
import { checkedAgentDockPath, within } from "./TongAgentDockPaths.mjs";
import { resolveAgentDockProject, operationApproval } from "./TongAgentDockPolicy.mjs";
import { agentDockOperationGroup, assertAgentDockOperationUnused, reserveAgentDockOperation } from "./TongAgentDockOperations.mjs";

export const EXECUTION_OPERATIONS = Object.freeze(["file_edit", "command", "session_status", "session_cancel"]);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,79}$/;
const text = value => typeof value === "string" && !value.includes("\0") && Buffer.byteLength(value) <= 65536;
function invalid() { throw dockError("INVALID_ARGUMENT"); }
export function validateExecutionInput(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !/^[a-z][a-z0-9-]{1,39}$/.test(input.projectId ?? "")
      || !identifier.test(input.taskId ?? "") || !identifier.test(input.approvalId ?? "")) invalid();
  const common = ["projectId", "taskId", "approvalId"];
  let keys;
  if (tool === "file_edit") {
    if (!["add", "replace", "patch"].includes(input.action)) invalid();
    keys = [...common, "idempotencyKey", "action", "dryRun", ...(input.action === "add" ? ["path", "content", "overwrite"] : input.action === "replace" ? ["path", "old", "new", "expectedMatches"] : ["patch"])];
    if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") invalid();
    if (input.action === "add" && (!text(input.content) || input.overwrite !== undefined && typeof input.overwrite !== "boolean")) invalid();
    if (input.action === "replace" && (!text(input.old) || !input.old || !text(input.new) || input.expectedMatches !== undefined && input.expectedMatches !== 1)) invalid();
    if (input.action === "patch" ? !text(input.patch) || !input.patch : typeof input.path !== "string" || !input.path || input.path.length > 4096) invalid();
  } else if (tool === "command") {
    keys = [...common, "idempotencyKey", "operation", "timeoutMs", "async"];
    if (!["git_status", "git_diff", "pytest"].includes(input.operation) || input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30000)
        || input.async !== undefined && typeof input.async !== "boolean") invalid();
  } else if (["session_status", "session_cancel"].includes(tool)) {
    keys = [...common, "sessionId"]; if (!identifier.test(input.sessionId ?? "")) invalid();
  } else invalid();
  if ((tool === "command" || tool === "file_edit" && input.dryRun !== true) && !/^[a-zA-Z0-9-]{16,128}$/.test(input.idempotencyKey ?? "")) invalid();
  if (Object.keys(input).some(key => !keys.includes(key))) invalid();
}
function relativePath(path) {
  if (typeof path !== "string" || !path || path !== path.trim() || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path)
      || path.split("/").some(part => !part || part === "." || part === "..")) throw dockError("ACCESS_DENIED");
  return path;
}
async function boundedText(path) {
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > 65536) throw dockError("ACCESS_DENIED");
    const buffer = Buffer.alloc(65537); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw dockError("ACCESS_DENIED");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead)); } catch { throw dockError("ACCESS_DENIED"); }
  } finally { await handle.close(); }
}
// A deliberately strict structured-envelope subset. No unified diffs, deletes, moves,
// fuzzy context, anchors or implicit headers can reach the upstream parser.
function parsePatch(patch) {
  const lines = patch.replaceAll("\r\n", "\n").split("\n"); if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") invalid();
  const operations = []; let current;
  for (const line of lines) {
    const header = /^\*\*\* (Add|Update) File: (.+)$/.exec(line);
    if (header) {
      current = { kind: header[1] === "Add" ? "add" : "update", path: relativePath(header[2]), hunks: [], lines: [] };
      operations.push(current); continue;
    }
    if (!current) invalid();
    if (current.kind === "add") { if (!line.startsWith("+")) invalid(); current.lines.push(line.slice(1)); }
    else if (line === "@@") current.hunks.push([]);
    else { if (!/^[ +\-]/.test(line) || !current.hunks.length) invalid(); current.hunks.at(-1).push(line); }
  }
  if (!operations.length || operations.length > 20 || new Set(operations.map(op => op.path.toLowerCase())).size !== operations.length) invalid();
  for (const op of operations) if (op.kind === "update" && (!op.hunks.length || op.hunks.some(hunk => !hunk.length))) invalid();
  return operations;
}
function applyExactHunks(content, hunks) {
  const bom = content.startsWith("\ufeff") ? "\ufeff" : ""; content = content.slice(bom.length);
  const ending = content.includes("\r\n") ? "\r\n" : "\n", normalized = content.replaceAll("\r\n", "\n"), trailing = normalized.endsWith("\n");
  let lines = normalized === "" ? [] : (trailing ? normalized.slice(0, -1) : normalized).split("\n"), start = 0;
  for (const hunk of hunks) {
    const old = hunk.filter(line => line[0] !== "+").map(line => line.slice(1));
    const next = hunk.filter(line => line[0] !== "-").map(line => line.slice(1));
    const matches = [];
    for (let i = start; old.length && i <= lines.length - old.length; i++) if (old.every((line, j) => line === lines[i + j])) matches.push(i);
    if (!old.length || matches.length !== 1) invalid();
    lines.splice(matches[0], old.length, ...next); start = matches[0] + next.length;
  }
  return bom + lines.join(ending) + (trailing ? ending : "");
}
const digest = value => createHash("sha256").update(value).digest("hex");
const quote = value => "'" + value.replaceAll("'", "''") + "'";

export class TongAgentDockExecution {
  #sessions = new Map(); #group; #inflight = new Set(); #closing = false;
  constructor({ client, access, policyPath, audit, maxOwnedSessions = 8, now = () => performance.now(), principal } = {}) {
    if (!Number.isInteger(maxOwnedSessions) || maxOwnedSessions < 1 || maxOwnedSessions > 100) throw dockError("INVALID_CONFIG");
    Object.assign(this, { client, access, policyPath, audit, maxOwnedSessions, now, principal });
    this.#group = agentDockOperationGroup(policyPath);
  }
  async #context(input) { return resolveAgentDockProject(this.access, this.policyPath, input.projectId); }
  get idle() {
    if (this.#inflight.size) return false;
    for (const [id, session] of this.#sessions) if (session.deadline <= this.now()) this.#forget(id);
    return this.#sessions.size === 0;
  }
  async #write(context, input, event, assertCaller) {
    const operations = input.action === "patch" ? parsePatch(input.patch) : [{ kind: input.action, path: relativePath(input.path) }];
    event.operation = input.action; event.targets = operations.map(op => op.path);
    const approve = ctx => {
      const approval = operationApproval(ctx, input, "project.write", input.action, event.targets);
      if (input.overwrite === true && approval.allowOverwrite !== true) throw dockError("APPROVAL_DENIED");
      return approval;
    };
    approve(context); let current;
    if(input.dryRun!==true)await assertAgentDockOperationUnused(this.policyPath,context,input);
    const files = [];
    for (const op of operations) {
      const checked = await checkedAgentDockPath(context.project.root, op.path, { allowMissing: op.kind === "add" });
      if (op.kind === "add" && checked.existed && !(input.action === "add" && input.overwrite === true)) throw dockError("ALREADY_EXISTS");
      const before = checked.existed ? await boundedText(checked.target) : null;
      let expected;
      if (op.kind === "add") expected = input.action === "patch" ? op.lines.join("\n") + "\n" : input.content;
      else if (op.kind === "update") expected = applyExactHunks(before, op.hunks);
      else { if (before.split(input.old).length - 1 !== 1) invalid(); expected = before.replace(input.old, () => input.new); }
      if (!text(expected)) invalid();
      await checked.recheck(); files.push({ checked, before, expected, path: op.path });
    }
    const args = { action: input.action, runtime: "windows", dry_run: true, max_diff_bytes: 65536,
      ...(input.action === "patch" ? { patch: input.patch, workdir: context.project.root } : { path: files[0].checked.target }),
      ...(input.action === "add" ? { content: input.content, overwrite: input.overwrite === true } : {}),
      ...(input.action === "replace" ? { old: input.old, new: input.new, expected_matches: 1, replace_all: false } : {}) };
    // Audit intent before every backend invocation; logging failures cannot create an unaudited write.
    await this.audit({ ...event, phase: "started", outcome: "authorized" });
    await this.client.connect();
    current = await this.#context(input); if (current.project.root !== context.project.root) throw dockError("PROJECT_DENIED"); approve(current);
    assertCaller();
    let result = await this.client.callTool("file_edit", args);
    for (const file of files) await file.checked.recheck();
    current = await this.#context(input); if (current.project.root !== context.project.root) throw dockError("PROJECT_DENIED"); approve(current);
    const preview = result.structuredContent;
    if (!preview || preview.dry_run !== true || typeof preview.diff_preview !== "string" || Buffer.byteLength(preview.diff_preview) > 65536) throw dockError("INVALID_RESULT");
    const reportedTarget = value => {
      if (typeof value !== "string") throw dockError("INVALID_RESULT");
      if (isAbsolute(value)) return resolve(value);
      try { relativePath(value.replaceAll("\\", "/")); } catch { throw dockError("INVALID_RESULT"); }
      const base = context.policy.backendWorkspaceRoot ?? context.project.root;
      if (!isAbsolute(base)) throw dockError("INVALID_RESULT");
      return resolve(base, value);
    };
    if (preview.path !== undefined && reportedTarget(preview.path) !== files[0].checked.target) throw dockError("INVALID_RESULT");
    if (preview.affected_files !== undefined) {
      if (!Array.isArray(preview.affected_files) || preview.affected_files.length !== files.length) throw dockError("INVALID_RESULT");
      const seen = new Set();
      for (const item of preview.affected_files) {
        if (!item || typeof item.path !== "string" || item.move_to !== undefined || !["add", "update"].includes(item.operation)) throw dockError("INVALID_RESULT");
        const target = reportedTarget(item.path);
        if (!files.some(file => file.checked.target === target) || seen.has(target)) throw dockError("INVALID_RESULT");
        seen.add(target);
      }
    }
    if (input.dryRun === true) return { toolOk: true, dryRun: true, changed: files.some(f => f.before !== f.expected), targets: event.targets, diffPreview: preview.diff_preview };
    await this.audit({ ...event, phase: "commit", outcome: "authorized" });
    for (const file of files) await file.checked.recheck();
    current = await this.#context(input); if (current.project.root !== context.project.root) throw dockError("PROJECT_DENIED"); approve(current);
    event.operationId = await reserveAgentDockOperation(this.policyPath, current, "file_edit", input);
    for (const file of files) await file.checked.recheck();
    current = await this.#context(input); if (current.project.root !== context.project.root) throw dockError("PROJECT_DENIED");
    approve(current); assertCaller(); event.effect = "unknown";
    result = await this.client.callTool("file_edit", { ...args, dry_run: false });
    event.effect = "applied";
    current = await this.#context(input); if (current.project.root !== context.project.root) throw dockError("PROJECT_DENIED"); approve(current);
    const changes = [];
    for (const file of files) {
      await file.checked.recheck({ afterWrite: true });
      const checked = await checkedAgentDockPath(context.project.root, file.path);
      const actual = await boundedText(checked.target); await checked.recheck();
      if (actual !== file.expected) throw dockError("VERIFY_FAILED");
      changes.push({ path: file.path, operation: file.before === null ? "add" : "update", beforeSha256: file.before === null ? null : digest(file.before), afterSha256: digest(actual), sizeBytes: Buffer.byteLength(actual) });
    }
    event.changes = changes;
    return { toolOk: true, dryRun: false, verified: true, changed: files.some(f => f.before !== f.expected), changes };
  }
  async #executable(profile, context) {
    try {
      if (!profile || !isAbsolute(profile.path) || !/^[a-f0-9]{64}$/.test(profile.sha256) || !/\.exe$/i.test(profile.path)
          || context.projects.some(p => p.root && within(resolve(p.root), resolve(profile.path)))) throw new Error();
      const checked = await checkedAgentDockPath(dirname(profile.path), basename(profile.path));
      const handle = await open(checked.target, "r"); let hash;
      try { hash = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); } finally { await handle.close(); }
      await checked.recheck({ ignoreDirectoryTimes: true }); if (hash.digest("hex") !== profile.sha256) throw new Error();
      return checked;
    } catch { throw dockError("EXECUTABLE_DENIED"); }
  }
  #commandResult(data, sessionId) {
    if (!data || !["running", "exited", "timeout", "killed"].includes(data.status)
        || typeof data.stdout !== "string" || typeof data.stderr !== "string" || Buffer.byteLength(data.stdout) + Buffer.byteLength(data.stderr) > 65536
        || data.status === "exited" && !Number.isInteger(data.exit_code)) throw dockError("INVALID_RESULT");
    return { toolOk: true, status: data.status, stdout: data.stdout, stderr: data.stderr, outputMode: "delta", truncated: data.stdout_truncated === true || data.stderr_truncated === true,
      ...(Number.isInteger(data.exit_code) ? { exitCode: data.exit_code } : {}),
      ...(data.status !== "running" ? { commandOk: data.status === "exited" && data.exit_code === 0 } : {}),
      timedOut: data.status === "timeout" || data.timed_out === true, ...(sessionId ? { sessionId } : {}) };
  }
  async #command(context, input, event, assertCaller) {
    for (const entries of [this.#group.sessions, this.#group.results]) for (const [id, deadline] of entries) if (deadline <= this.now()) this.#forget(id);
    if (this.#group.sessions.size + this.#group.results.size + this.#group.launching >= this.maxOwnedSessions) throw dockError("SESSION_DENIED");
    this.#group.launching++;
    try { return await this.#launchCommand(context, input, event, assertCaller); } finally { this.#group.launching--; }
  }
  async #launchCommand(context, input, event, assertCaller) {
    if (process.platform !== "win32") throw dockError("TOOL_DENIED");
    const entry = context.grant.commands?.pytestEntry;
    const diffPaths = context.grant.commands?.gitDiffPaths;
    if (input.operation === "git_diff" && (!Array.isArray(diffPaths) || !diffPaths.length || diffPaths.length > 20)) throw dockError("APPROVAL_DENIED");
    const targets = input.operation === "pytest" ? [relativePath(entry)] : input.operation === "git_diff" ? diffPaths.map(relativePath) : ["."];
    operationApproval(context, input, "command.execute", input.operation, targets);
    const root = await checkedAgentDockPath(context.project.root, ".", { directory: true, treeDepth: 20, requireFullTree: true, skipGit: true });
    const executable = await this.#executable(context.grant.commands?.[input.operation === "pytest" ? "python" : "git"], context);
    let command, env;
    if (input.operation === "pytest") {
      const test = await checkedAgentDockPath(context.project.root, entry); await test.recheck();
      command = `& ${quote(executable.target)} -I -B -m pytest -q -p no:cacheprovider -c NUL -o addopts= --noconftest --rootdir=. --confcutdir=. -- ${quote(entry)}; exit $LASTEXITCODE`;
      env = { PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1", PYTEST_ADDOPTS: "", PYTHONPATH: "", PYTHONHOME: "", PYTHONDONTWRITEBYTECODE: "1" };
    } else {
      // Standalone repositories only: .git files, linked worktrees and reparse metadata are refused.
      const git = await checkedAgentDockPath(context.project.root, ".git", { directory: true, gitMetadata: true, treeDepth: 20, requireFullTree: true });
      if (["commondir", "objects/info/alternates"].some(path => git.manifest.has(resolve(context.project.root, ".git", path)))) throw dockError("ACCESS_DENIED");
      if (git.manifest.has(resolve(context.project.root, ".git", "config"))) {
        const config = await boundedText(resolve(context.project.root, ".git", "config"));
        if (/^\s*\[\s*include(?:if)?\b/im.test(config)) throw dockError("ACCESS_DENIED");
      }
      for (const path of input.operation === "git_diff" ? targets : []) await checkedAgentDockPath(context.project.root, path);
      await git.recheck();
      command = `& ${quote(executable.target)} --no-pager -c core.fsmonitor=false -c core.attributesFile=NUL -c diff.external= -c submodule.recurse=false ${input.operation === "git_status" ? "status --short --untracked-files=no --ignore-submodules=all" : "diff --no-ext-diff --no-textconv --no-renames --ignore-submodules=all -- " + targets.map(path => quote(":(literal)" + path)).join(" ")}; exit $LASTEXITCODE`;
      env = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_COUNT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_DIR: resolve(context.project.root, ".git"), GIT_WORK_TREE: context.project.root,
        GIT_EXTERNAL_DIFF: "", GIT_DIFF_OPTS: "", GIT_PAGER: "cat" };
    }
    event.operation = input.operation; event.targets = targets;
    const current = await this.#context(input);
    if (JSON.stringify(current.grant) !== JSON.stringify(context.grant)) throw dockError("APPROVAL_DENIED");
    operationApproval(current, input, "command.execute", input.operation, targets); await root.recheck(); await executable.recheck({ ignoreDirectoryTimes: true });
    await this.audit({ ...event, phase: "started", outcome: "authorized" });
    await this.client.connect();
    const generation = this.client.generation;
    const backendInstance = this.principal ? await this.client.backendInstance(generation) : undefined;
    const launchContext = await this.#context(input);
    if (JSON.stringify(launchContext.grant) !== JSON.stringify(context.grant)) throw dockError("APPROVAL_DENIED");
    operationApproval(launchContext, input, "command.execute", input.operation, targets);
    event.operationId = await reserveAgentDockOperation(this.policyPath, launchContext, "command", input);
    await root.recheck(); await executable.recheck({ ignoreDirectoryTimes: true });
    const dispatchContext = await this.#context(input);
    if (JSON.stringify(dispatchContext.grant) !== JSON.stringify(context.grant)) throw dockError("APPROVAL_DENIED");
    operationApproval(dispatchContext, input, "command.execute", input.operation, targets); assertCaller(); event.effect = "unknown";
    const result = await this.client.callTool("exec_command", { cmd: command, runtime: "windows", workdir: root.target, env,
      timeout_ms: input.timeoutMs ?? 30000, execution_mode: input.async === true ? "async" : "sync", yield_time_ms: 500, max_output_bytes: 65536, tty: false },
      { generation, ...(input.async === true ? {} : { timeoutMs: (input.timeoutMs ?? 30000) + 5000 }) });
    const data = result.structuredContent; let sessionId;
    if (data?.status === "running") {
      if (typeof data.session_id !== "string" || !data.session_id || data.session_id.length > 256) throw dockError("INVALID_RESULT");
      sessionId = randomUUID(); this.#sessions.set(sessionId, { backendId: data.session_id, projectId: input.projectId, taskId: input.taskId, approvalId: input.approvalId,
        operation: input.operation, targets, root: root.target, generation, deadline: this.now() + (input.timeoutMs ?? 30000) + 5000,
        stdout: "", stderr: "", truncated: false });
      this.#sessions.get(sessionId).backendInstance = backendInstance;
      this.#group.owners.set(sessionId, this);
      this.#group.sessions.set(sessionId, this.#sessions.get(sessionId).deadline);
    }
    event.effect = "executed"; if (sessionId) event.sessionId = sessionId;
    try {
      const value = this.#commandResult(data, sessionId);
      if (sessionId) this.#accumulate(this.#sessions.get(sessionId), value);
      event.exitCode = value.exitCode; event.status = value.status;
      await root.recheck({ afterWrite: input.operation === "pytest" });
      const after = await this.#context(input); if (after.project.root !== root.target) throw dockError("PROJECT_DENIED");
      operationApproval(after, input, "command.execute", input.operation, targets);
      return value;
    } catch (error) {
      if (sessionId) {
        try { await this.#kill(sessionId, event); }
        catch { error.sessionId = sessionId; error.effect = "unknown"; }
      }
      throw error;
    }
  }
  async #session(context, tool, input, event, assertCaller) {
    const session = this.#sessions.get(input.sessionId);
    if (session?.deadline <= this.now()) { this.#forget(input.sessionId); throw dockError("SESSION_DENIED"); }
    if (!session || session.projectId !== input.projectId || session.taskId !== input.taskId || session.approvalId !== input.approvalId || session.root !== context.project.root) throw dockError("SESSION_DENIED");
    // Cancellation of an owned process remains possible after expiry/revocation. It never starts a new process.
    if (tool === "session_status") operationApproval(context, input, "command.execute", session.operation, session.targets);
    if (session.generation !== this.client.generation || this.client.connected === false) throw dockError("SESSION_DENIED");
    await this.#instance(session);
    event.operation = tool; event.sessionId = input.sessionId;
    await this.audit({ ...event, phase: "started", outcome: "authorized" });
    assertCaller();
    let value = session.result;
    if (!value) {
      const result = await this.client.callTool(tool === "session_cancel" ? "session_act" : "session_observe", { action: tool === "session_cancel" ? "kill" : "status", session_id: session.backendId, max_output_bytes: 65536 }, { generation: session.generation });
      value = this.#commandResult(result.structuredContent, input.sessionId);
      this.#accumulate(session, value);
      if (value.status !== "running") {
        this.#group.sessions.delete(input.sessionId);
        if (tool === "session_status") {
          value = { ...value, stdout: session.stdout, stderr: session.stderr, truncated: session.truncated, outputMode: "snapshot" };
          session.result = Object.freeze(value);
          session.deadline = this.now() + 300000;
          this.#group.results.set(input.sessionId, session.deadline);
        } else this.#forget(input.sessionId);
      }
    }
    event.exitCode = value.exitCode; event.status = value.status;
    if (tool === "session_status") {
      const current = await this.#context(input); if (current.project.root !== session.root) throw dockError("PROJECT_DENIED");
      operationApproval(current, input, "command.execute", session.operation, session.targets);
    }
    return value;
  }
  #accumulate(session, value) {
    const stdout = Buffer.from(session.stdout + value.stdout), stderr = Buffer.from(session.stderr + value.stderr);
    const stdoutBytes = Math.min(stdout.length, 65536), stderrBytes = Math.min(stderr.length, 65536 - stdoutBytes);
    session.stdout = stdout.subarray(0, stdoutBytes).toString("utf8");
    session.stderr = stderr.subarray(0, stderrBytes).toString("utf8");
    session.truncated ||= value.truncated || stdout.length + stderr.length > 65536;
  }
  #forget(id) {
    const owner = this.#group.owners.get(id);
    owner?.#sessions.delete(id);
    this.#group.owners.delete(id); this.#group.sessions.delete(id); this.#group.results.delete(id);
  }
  async #instance(session) {
    if (session.unavailable) throw dockError("SESSION_DENIED");
    if (session.backendInstance !== undefined) {
      try { if (await this.client.backendInstance(session.generation) !== session.backendInstance) throw dockError("SESSION_DENIED"); }
      catch (error) { session.unavailable = true; throw error; }
    }
  }
  async call(tool, input, assertCaller = () => {}) {
    if (this.#closing) throw dockError("CLOSED");
    const pending = this.#runCall(tool, input, assertCaller); this.#inflight.add(pending);
    try { return await pending; } finally { this.#inflight.delete(pending); }
  }
  async #runCall(tool, input, assertCaller) {
    const started = performance.now(), event = { requestId: randomUUID(), projectId: /^[a-z][a-z0-9-]{1,39}$/.test(input?.projectId ?? "") ? input.projectId : "unknown", tool, outcome: "denied" };
    let locked = false;
    try {
      validateExecutionInput(tool, input); event.taskId = input.taskId; event.approvalId = input.approvalId;
      if (this.#group.busy.has(input.projectId)) throw dockError("ACCESS_DENIED"); this.#group.busy.add(input.projectId); locked = true;
      const context = await this.#context(input);
      assertCaller();
      const result = tool === "file_edit" ? await this.#write(context, input, event, assertCaller) : tool === "command" ? await this.#command(context, input, event, assertCaller) : await this.#session(context, tool, input, event, assertCaller);
      assertCaller();
      event.outcome = "allowed"; return result;
    } catch (error) {
      const safe = error instanceof TongAgentDockError ? error : dockError("UNAVAILABLE"); event.errorType = safe.code;
      if (!["APPROVAL_DENIED", "PROJECT_DENIED", "ACCESS_DENIED", "INVALID_ARGUMENT", "ALREADY_EXISTS", "SESSION_DENIED", "EXECUTABLE_DENIED", "REPLAY_DENIED"].includes(safe.code)) event.outcome = "failed";
      if (["TIMEOUT", "UNAVAILABLE"].includes(safe.code)) event.effect = "unknown";
      safe.effect ??= event.effect; event.effect = safe.effect;
      throw safe;
    } finally {
      if (locked) this.#group.busy.delete(input.projectId); event.durationMs = Math.round(performance.now() - started);
      try { await this.audit({ ...event, phase: "finished" }); } catch {
        const error = dockError("AUDIT_UNAVAILABLE"); error.effect = event.effect;
        if (event.sessionId && this.#sessions.has(event.sessionId) && !this.#sessions.get(event.sessionId).result) {
          try { await this.#kill(event.sessionId, event); } catch { error.sessionId = event.sessionId; error.effect = "unknown"; }
        }
        throw error;
      }
      if (event.outcome === "allowed") {
        try {
          if (tool === "session_status") {
            const session = this.#sessions.get(input.sessionId);
            if (!session) throw dockError("SESSION_DENIED");
            await this.#instance(session);
            const current = await this.#context(input);
            if (current.project.root !== session.root) throw dockError("PROJECT_DENIED");
            operationApproval(current, input, "command.execute", session.operation, session.targets);
            if (session.deadline <= this.now() || session.unavailable || session.generation !== this.client.generation || this.client.connected === false) throw dockError("SESSION_DENIED");
          }
          assertCaller();
        } catch (error) {
          const safe = error instanceof TongAgentDockError ? error : dockError("UNAVAILABLE");
          safe.effect ??= event.effect;
          try { await this.audit({ ...event, phase: "delivery", outcome: "denied", errorType: safe.code }); }
          catch { const failure = dockError("AUDIT_UNAVAILABLE"); failure.effect = event.effect; throw failure; }
          throw safe;
        }
      }
    }
  }
  async #kill(sessionId, event) {
    const session = this.#sessions.get(sessionId);
    if (session?.result) { this.#forget(sessionId); return; }
    try { await this.audit({ ...event, phase: "cleanup", sessionId, outcome: "authorized" }); } catch { /* Killing an already-owned process must remain possible during audit failure. */ }
    if (!session || session.generation !== this.client.generation || this.client.connected === false) throw dockError("SESSION_DENIED");
    await this.#instance(session);
    const result = await this.client.callTool("session_act", { action: "kill", session_id: session.backendId, max_output_bytes: 65536 }, { generation: session.generation });
    const value = this.#commandResult(result.structuredContent);
    if (value.status === "running") throw dockError("INVALID_RESULT");
    this.#forget(sessionId);
  }
  async close() {
    this.#closing = true; await Promise.allSettled([...this.#inflight]);
    for (const sessionId of this.#sessions.keys()) {
      const session = this.#sessions.get(sessionId);
      await this.#kill(sessionId, { requestId: randomUUID(), tool: "session_cancel", projectId: session.projectId, taskId: session.taskId, approvalId: session.approvalId, operation: "shutdown" }).catch(() => {});
    }
  }
}
