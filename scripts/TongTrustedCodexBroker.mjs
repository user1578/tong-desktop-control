import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { CodexAppServerAdapter } from "./TongCodexAppServer.mjs";

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "..", "runtime");
const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_FIELDS = new Set(["taskId", "projectId", "cwd", "task", "scope", "prompt", "timeoutMs", "threadId", "continuationMessage", "resumeCount", "workType", "requiredCapabilities"]);
export const DEVELOPMENT_CAPABILITIES = Object.freeze(['project.read','project.write','command.execute','dependency.install','codex.session']);
const developmentCapabilities = new Set([...DEVELOPMENT_CAPABILITIES,'git.commit','git.push']);
export function requestedCapabilities(input) {
  if (input.workType !== undefined && !['development','high-impact'].includes(input.workType)) throw new Error('Invalid work type');
  const requested = input.requiredCapabilities ?? DEVELOPMENT_CAPABILITIES;
  if (!Array.isArray(requested) || !requested.length || requested.some(c => !developmentCapabilities.has(c)) || new Set(requested).size !== requested.length) throw new Error('Invalid required capabilities');
  return requested;
}
const disabled = () => new Error("Trusted Codex execution is disabled locally");
const samePath = (left, right) => process.platform === "win32"
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
const fingerprint = (task) => createHash("sha256").update(JSON.stringify([
  task.taskId, task.projectId, resolve(task.cwd), task.task, task.scope,
  task.threadId ?? null, task.continuationMessage ?? null, task.resumeCount ?? 0,
  task.workType ?? 'development', task.requiredCapabilities ?? DEVELOPMENT_CAPABILITIES,task.timeoutMs,
])).digest("hex");

function validatePolicy(value) {
  if (value?.schemaVersion !== 1 || typeof value.enabled !== "boolean"
      || !Array.isArray(value.projects) || value.projects.some((id) => !PROJECT_ID.test(id))
      || new Set(value.projects).size !== value.projects.length
      || !Array.isArray(value.approvals) || value.approvals.some((item) =>
        !TASK_ID.test(item?.taskId) || !/^[a-f0-9]{64}$/.test(item?.fingerprint))
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || (value.developmentGrants !== undefined && (!Array.isArray(value.developmentGrants)
        || new Set(value.developmentGrants.map(g => g?.projectId)).size !== value.developmentGrants.length
        || value.developmentGrants.some(g => !PROJECT_ID.test(g?.projectId) || !value.projects.includes(g.projectId)
          || typeof g.root !== 'string' || !isAbsolute(g.root) || !Array.isArray(g.capabilities)
          || g.capabilities.some(c => !developmentCapabilities.has(c)) || !DEVELOPMENT_CAPABILITIES.every(c => g.capabilities.includes(c)))))
      || (value.executable !== null && (typeof value.executable !== "string"
        || !isAbsolute(value.executable) || extname(value.executable).toLowerCase() !== ".exe"
        || (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(value.executable))))) {
    throw new Error("Trusted Codex policy is invalid");
  }
  return value;
}

export class TongTrustedPolicy {
  constructor({ policyPath = join(runtime, "trusted-codex.json"),
    taskStatePath = join(runtime, "agent-tasks.json"), auditPath } = {}) {
    if (!isAbsolute(policyPath) || !isAbsolute(taskStatePath)) throw new Error("Trusted policy paths must be absolute");
    this.policyPath = resolve(policyPath);
    this.taskStatePath = resolve(taskStatePath);
    this.auditPath = auditPath ?? join(dirname(this.policyPath), "trusted-audit.jsonl");
    this.lockPath = `${this.policyPath}.lock`;
    this.stopPath = `${this.policyPath}.stop`;
  }

  async read() {
    let value;
    try {
      value = validatePolicy(JSON.parse(await readFile(this.policyPath, "utf8")));
    }
    catch (error) {
      if (error?.code === "ENOENT") value = { schemaVersion: 1, enabled: false, executable: null,
        projects: [], approvals: [], generation: 0 };
      else throw new Error("Trusted Codex policy is invalid or unavailable");
    }
    try { await stat(this.stopPath); return { ...value, enabled: false, emergencyStopped: true }; }
    catch (error) { if (error?.code !== "ENOENT") throw new Error("Trusted emergency stop state is unavailable"); }
    return value;
  }

  async audit(action, details = {}) {
    await mkdir(dirname(this.auditPath), { recursive: true });
    await appendFile(this.auditPath, `${JSON.stringify({ at: new Date().toISOString(), action, ...details })}\n`, { mode: 0o600 });
  }

  async mutate(action, update, details = {}) {
    await mkdir(dirname(this.policyPath), { recursive: true });
    let lock;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { lock = await open(this.lockPath, "wx", 0o600); break; }
      catch (error) { if (error?.code !== "EEXIST") throw error; await delay(50); }
    }
    if (!lock) throw new Error("Trusted policy is busy; retry locally");
    try {
      const value = await this.read();
      await update(value);
      delete value.emergencyStopped;
      validatePolicy(value);
      const temporary = `${this.policyPath}.${randomUUID()}.tmp`;
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); }
      finally { await file.close(); }
      await this.audit(action, details);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try { await rename(temporary, this.policyPath); break; }
        catch (error) {
          if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code) || attempt === 19) throw error;
          await delay(10);
        }
      }
      return value;
    } finally { await lock.close(); await unlink(this.lockPath); }
  }

  async status() {
    const { enabled, executable, projects, generation, approvals, emergencyStopped = false, developmentGrants = [] } = await this.read();
    return { mode: enabled ? "trusted-windows" : "isolated", enabled, executable,
      projects, pendingApprovals: approvals.length, generation, emergencyStopped, developmentGrants };
  }

  async enable(executable) {
    if (typeof executable !== "string" || !isAbsolute(executable) || basename(executable).toLowerCase() !== "codex.exe"
        || extname(executable).toLowerCase() !== ".exe"
        || (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(executable))) {
      throw new Error("Codex executable must be an absolute .exe path");
    }
    const path = await realpath(executable);
    if (!samePath(path, executable) || !(await stat(path)).isFile()) throw new Error("Codex executable must be a regular file");
    await this.mutate("enable", (value) => { value.executable = path; value.enabled = true;
      value.approvals = []; value.generation += 1;
    });
    try { await unlink(this.stopPath); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  async disable() {
    await this.mutate("disable", (value) => { value.enabled = false; value.approvals = []; value.generation += 1; });
  }

  async emergencyStop() {
    await mkdir(dirname(this.stopPath), { recursive: true });
    await writeFile(this.stopPath, `${new Date().toISOString()}\n`, { mode: 0o600 });
    await this.audit("emergency-stop");
  }

  async grant(projectId, access) {
    if (!PROJECT_ID.test(projectId) || !(await access.authorize("agent.execute", projectId))) {
      throw new Error("Project must have agent.execute before a trusted grant");
    }
    await this.mutate("grant", (value) => {
      if (!value.projects.includes(projectId)) value.projects.push(projectId);
      value.projects.sort();
    }, { projectId });
  }

  async revoke(projectId) {
    if (!PROJECT_ID.test(projectId)) throw new Error("Invalid project id");
    await this.mutate("revoke", (value) => { value.projects = value.projects.filter((id) => id !== projectId);
      value.approvals = value.approvals.filter((item) => item.projectId !== projectId);
      value.developmentGrants = (value.developmentGrants ?? []).filter(item => item.projectId !== projectId);
      value.generation += 1;
    }, { projectId });
  }

  async authorizeDevelopment(projectId, access, {gitCommit = false, gitPush = false,expectedRoot} = {}) {
    if (typeof gitCommit !== 'boolean' || typeof gitPush !== 'boolean') throw new Error('Invalid Git authorization');
    if (!await access.authorize('agent.execute',projectId) || !await access.authorize('project.write',projectId)) throw new Error('Project requires write and agent.execute authorization');
    const project = (await access.listProjects()).find(p => p.id === projectId && p.available && p.status === 'enabled');
    if (!project || !samePath(await realpath(project.root),project.root)) throw new Error('Authorized project root is invalid');
    if(expectedRoot !== undefined && !samePath(project.root,expectedRoot)) throw new Error('Project changed during confirmation');
    const contains = (root,path) => { const part=resolve(path).toLowerCase();const base=resolve(root).toLowerCase();return part===base || part.startsWith(base+'\\') || part.startsWith(base+'/'); };
    if ([this.policyPath,this.taskStatePath,this.auditPath].some(p => contains(project.root,p))) throw new Error('Authorization state must be outside the project');
    const grant = {projectId,grantId:randomUUID(),root:project.root,capabilities:[...DEVELOPMENT_CAPABILITIES,...(gitCommit?['git.commit']:[]),...(gitPush?['git.push']:[])],issuedAt:new Date().toISOString()};
    await this.mutate('authorize-development',value => {
      if (!value.enabled || !value.projects.includes(projectId)) throw disabled();
      value.developmentGrants = [...(value.developmentGrants ?? []).filter(g => g.projectId !== projectId),grant];
      value.generation += 1;
    },grant);
    return grant;
  }

  async approveTask(taskId, expectedFingerprint) {
    if (!TASK_ID.test(taskId)) throw new Error("Invalid task id");
    const state = JSON.parse(await readFile(this.taskStatePath, "utf8"));
    const task = state?.tasks?.find((item) => item.taskId === taskId);
    if (!task || task.status !== "waiting_user_action" || task.pendingApproval !== true) {
      throw new Error("Task is not awaiting local approval");
    }
    const taskFingerprint = fingerprint({...task,cwd:task.projectRoot,threadId:task.codexSessionId});
    if (expectedFingerprint !== undefined && taskFingerprint !== expectedFingerprint) throw new Error('Task changed during confirmation');
    await this.mutate("approve-task", (value) => {
      if (!value.enabled || !value.projects.includes(task.projectId)) throw disabled();
      value.approvals = value.approvals.filter((item) => item.taskId !== taskId);
      value.approvals.push({ taskId, projectId: task.projectId, fingerprint: taskFingerprint });
    }, { taskId, projectId: task.projectId });
  }

  async taskForConfirmation(taskId) {
    const state=JSON.parse(await readFile(this.taskStatePath,'utf8'));
    const task=state?.tasks?.find(t => t.taskId === taskId && t.status === 'waiting_user_action' && t.pendingApproval === true);
    if(!task) throw new Error('Task is not awaiting local approval');
    return {task, fingerprint:fingerprint({...task,cwd:task.projectRoot,threadId:task.codexSessionId})};
  }

  async consumeApproval(task) {
    let approved = false;
    await this.mutate("consume-approval", (value) => {
      const index = value.approvals.findIndex((item) => item.taskId === task.taskId
        && item.projectId === task.projectId && item.fingerprint === fingerprint(task));
      if (index >= 0 && value.enabled && value.projects.includes(task.projectId)) {
        value.approvals.splice(index, 1);
        approved = true;
      }
    }, { taskId: task.taskId, projectId: task.projectId });
    return approved;
  }
}

// The Windows system proxy is not necessarily honored by Codex WebSockets.
// Allow a deliberately configured loopback HTTP(S) proxy for the Codex child
// only; never inherit arbitrary proxy credentials or untrusted remote proxies.
export function trustedCodexEnvironment(source = process.env) {
  const allowed = ["SystemRoot", "WINDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA",
    "LOCALAPPDATA", "TEMP", "TMP", "PATH", "PATHEXT", "ComSpec"];
  const env = Object.fromEntries(allowed.filter((key) => typeof source[key] === "string")
    .map((key) => [key, source[key]]));
  const raw = source.TONG_CODEX_PROXY_URL;
  if (raw !== undefined) {
    if (typeof raw !== "string" || raw.length > 256) throw new Error("Invalid trusted Codex loopback proxy");
    let proxy;
    try { proxy = new URL(raw); }
    catch { throw new Error("Invalid trusted Codex loopback proxy"); }
    if (!["http:", "https:"].includes(proxy.protocol)
        || !["localhost", "127.0.0.1", "[::1]"].includes(proxy.hostname.toLowerCase())
        || !proxy.port || !Number.isInteger(Number(proxy.port)) || Number(proxy.port) < 1
        || Number(proxy.port) > 65535 || proxy.username || proxy.password
        || proxy.pathname !== "/" || proxy.search || proxy.hash) {
      throw new Error("Invalid trusted Codex loopback proxy");
    }
    env.HTTP_PROXY = proxy.origin;
    env.HTTPS_PROXY = proxy.origin;
    env.NO_PROXY = "localhost,127.0.0.1,::1";
  }
  return env;
}

export class TongTrustedCodexBroker {
  constructor({ access, policy = new TongTrustedPolicy(), adapterFactory = (executable) =>
    new CodexAppServerAdapter({ executable, env: trustedCodexEnvironment() }), pollMs = 500 } = {}) {
    if (!access || typeof access.authorize !== "function" || typeof access.listProjects !== "function") {
      throw new TypeError("Trusted broker requires project access");
    }
    this.access = access;
    this.policy = policy;
    this.adapterFactory = adapterFactory;
    this.pollMs = pollMs;
    this.active = new Map();
    this.closed = false;
  }

  async preflight({ projectId, projectRoot, workType, requiredCapabilities } = {}) {
    if (this.closed) throw new Error("Trusted broker is closed");
    const config = await this.policy.read();
    if (!config.enabled || !config.executable) throw disabled();
    if (!PROJECT_ID.test(projectId) || !config.projects.includes(projectId)) throw new Error("Trusted project grant is missing");
    if (!(await this.access.authorize("agent.execute", projectId))) throw new Error("Project is not authorized for agent.execute");
    const project = (await this.access.listProjects()).find((item) => item.id === projectId);
    if (!project || project.status !== "enabled" || project.available !== true
        || !isAbsolute(project.root) || !samePath(project.root, projectRoot)) throw new Error("Trusted project is unavailable or mismatched");
    const actual = await realpath(config.executable);
    if (!samePath(actual, config.executable) || !(await stat(actual)).isFile()) throw new Error("Configured Codex executable changed");
    const requested = requestedCapabilities({workType,requiredCapabilities});
    const grant = (config.developmentGrants ?? []).find(g => g.projectId === projectId && samePath(g.root,projectRoot));
    if(grant && (!await this.access.authorize('project.write',projectId) || !await this.access.authorize('project.read',projectId))) throw new Error('Project is not authorized for agent.execute');
    if (grant && workType !== 'high-impact' && requested.some(c => !grant.capabilities.includes(c))) throw new Error('Required capability is outside project authorization');
    return { config, project, authorization:{mode:grant && workType !== 'high-impact'?'project-development':'local-task-confirmation',requiredCapabilities:requested,capabilities:grant?.capabilities ?? [],root:projectRoot} };
  }

  async sessionAccess(input) {
    const result = await this.preflight(input);
    if (!(await this.access.authorize("project.read", input.projectId))) throw new Error("Project is not authorized for native session metadata");
    return result;
  }

  async listSessions(input) {
    const { config } = await this.sessionAccess(input);
    const { limit, searchTerm } = input;
    let cursor;
    if (input.cursor !== undefined) {
      try {
        const value = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
        if (value.projectId !== input.projectId || value.searchTerm !== (searchTerm ?? null)
            || typeof value.cursor !== "string" || value.cursor.length > 2000) throw new Error();
        cursor = value.cursor;
      } catch { throw new Error("Invalid native session query"); }
    }
    const result = await this.adapterFactory(config.executable).listSessions({ cwd: input.projectRoot, limit, cursor, searchTerm });
    await this.sessionAccess(input);
    return { ...result, nextCursor: result.nextCursor ? Buffer.from(JSON.stringify({ projectId: input.projectId,
      searchTerm: searchTerm ?? null, cursor: result.nextCursor })).toString("base64url") : null };
  }

  async selectSession(input) {
    const { config } = await this.sessionAccess(input);
    const result = await this.adapterFactory(config.executable).selectSession({ cwd: input.projectRoot,
      sessionMode: input.sessionMode, codexSessionId: input.codexSessionId, searchTerm: input.searchTerm });
    await this.sessionAccess(input);
    return result;
  }

  async runTask(task, { signal, onSessionId = () => {}, onLog = () => {}, onState = () => {} } = {}) {
    if (!task || typeof task !== "object" || Array.isArray(task)
        || Object.keys(task).some((key) => !TASK_FIELDS.has(key))) throw new Error("Trusted task has unsupported fields");
    if (!TASK_ID.test(task.taskId) || !PROJECT_ID.test(task.projectId)
        || typeof task.task !== "string" || typeof task.scope !== "string" || typeof task.prompt !== "string"
        || !Number.isInteger(task.timeoutMs) || task.timeoutMs < 1_000 || task.timeoutMs > 3_600_000) {
      throw new Error("Invalid trusted task");
    }
    const { config, authorization } = await this.preflight({ projectId: task.projectId, projectRoot: task.cwd,workType:task.workType,requiredCapabilities:task.requiredCapabilities });
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason ?? new Error("Trusted task cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.active.set(task.taskId, controller);
    let timer;
    let projectLock;
    let projectLockPath;
    try {
      if (authorization.mode === 'project-development') {
        await this.policy.audit('project-authorization-used',{taskId:task.taskId,projectId:task.projectId,root:task.cwd,capabilities:authorization.requiredCapabilities});
      } else {
        await onState("waiting_user_action");
        onLog("Waiting for local confirmation of this task and scope. Use TongTrustedControl approve locally; no chat text or tool parameter can approve it.", "status");
      }
      while (authorization.mode !== 'project-development' && !controller.signal.aborted) {
        const current = await this.policy.read();
        if (!current.enabled || current.generation !== config.generation
            || !current.projects.includes(task.projectId)) throw disabled();
        if (current.approvals.some((item) => item.taskId === task.taskId)) {
          if (await this.policy.consumeApproval(task)) break;
        }
        await delay(this.pollMs, undefined, { signal: controller.signal });
      }
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Trusted task cancelled");
      await this.preflight({ projectId: task.projectId, projectRoot: task.cwd,workType:task.workType,requiredCapabilities:task.requiredCapabilities });
      const lockDirectory = join(dirname(this.policy.policyPath), "trusted-project-locks");
      await mkdir(lockDirectory, { recursive: true });
      projectLockPath = join(lockDirectory, `${task.projectId}.lock`);
      while (!controller.signal.aborted) {
        try { projectLock = await open(projectLockPath, "wx", 0o600); break; }
        catch (error) {
          if (error?.code !== "EEXIST") throw error;
          await delay(this.pollMs, undefined, { signal: controller.signal });
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Trusted task cancelled");
      await projectLock.writeFile(`${JSON.stringify({ taskId: task.taskId, pid: process.pid,
        createdAt: new Date().toISOString() })}\n`);
      const locked = await this.preflight({ projectId: task.projectId, projectRoot: task.cwd,workType:task.workType,requiredCapabilities:task.requiredCapabilities });
      if (locked.config.generation !== config.generation || controller.signal.aborted) throw disabled();
      await onState("running");
      await this.policy.audit("run", { taskId: task.taskId, projectId: task.projectId });
      timer = setInterval(() => {
        void this.preflight({projectId:task.projectId,projectRoot:task.cwd,workType:task.workType,requiredCapabilities:task.requiredCapabilities}).then(({config:current}) => {
          if (!current.enabled || current.generation !== config.generation
              || !current.projects.includes(task.projectId)) controller.abort(disabled());
        }).catch(() => controller.abort(disabled()));
      }, this.pollMs);
      const latest = await this.policy.read();
      if (!latest.enabled || latest.generation !== config.generation || controller.signal.aborted) throw disabled();
      const approvedTask=authorization.mode !== 'project-development' && task.workType === 'high-impact'
        ? {...task,prompt:task.prompt+'\nLocally confirmed capabilities for this single workflow: '+JSON.stringify(authorization.requiredCapabilities)+'. This does not expand the OS sandbox.'}:task;
      const result = await this.adapterFactory(config.executable).runTask(approvedTask, {
        signal: controller.signal, onSessionId, onLog, onState,
        authorizedCapabilities:authorization.mode === 'project-development'?authorization.capabilities:[],
      });
      const {config:finalPolicy} = await this.preflight({projectId:task.projectId,projectRoot:task.cwd,workType:task.workType,requiredCapabilities:task.requiredCapabilities});
      if (!finalPolicy.enabled || finalPolicy.generation !== config.generation) throw disabled();
      if (controller.signal.aborted && !signal?.aborted) throw controller.signal.reason ?? disabled();
      return result;
    } finally {
      if (timer) clearInterval(timer);
      if (projectLock) {
        await projectLock.close();
        await unlink(projectLockPath);
      }
      signal?.removeEventListener("abort", abort);
      this.active.delete(task.taskId);
      await this.policy.audit("finish", { taskId: task.taskId, projectId: task.projectId });
    }
  }

  async close() {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort(new Error("Trusted broker closed"));
  }
}

// The public task manager uses one Executor interface for both existing isolation
// and the locally selected trusted Windows executor. Future WSL executors can
// implement the same preflight/runTask/close methods without changing MCP tools.
export class TongExecutorRouter {
  constructor({ policy, isolated, trusted }) {
    this.policy = policy;
    this.isolated = isolated;
    this.trusted = trusted;
  }

  async preflight(input) {
    requestedCapabilities(input);
    const mode = input.executorMode ?? ((await this.policy.read()).enabled ? "trusted-windows" : "isolated");
    if (mode === "trusted-windows") return { ...(await this.trusted.preflight(input)), mode };
    if (mode === "isolated") {
      if(input.workType === 'high-impact') throw new Error('High-impact tasks require trusted local confirmation');
      return { ...(await this.isolated.preflight(input)), mode };
    }
    throw new Error("Unsupported executor mode");
  }

  async runTask(task, callbacks) {
    const { executorMode, resumeCount, workType, requiredCapabilities, ...spec } = task;
    if (executorMode === "trusted-windows") return this.trusted.runTask({ ...spec, resumeCount,workType,requiredCapabilities }, callbacks);
    if (executorMode === "isolated") return this.isolated.runTask(spec, callbacks);
    throw new Error("Unsupported executor mode");
  }

  async listSessions(input) { return this.trusted.listSessions(input); }
  async selectSession(input) { return this.trusted.selectSession(input); }

  async close() { await Promise.allSettled([this.isolated.close(), this.trusted.close()]); }
}
