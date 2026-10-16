import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { CodexAppServerAdapter } from "../scripts/TongCodexAppServer.mjs";

assert.throws(() => new CodexAppServerAdapter({ executable: "codex.exe" }), /absolute/i,
  "the App Server executable must not be resolved through an inherited PATH");

class SimulatedAppServerProcess extends EventEmitter {
  requests = [];
  killed = false;
  exited = false;
  stdout = new PassThrough();
  stderr = new PassThrough();

  constructor({ interruptOnly = false, threadId = "thread-simulated", rejectThreadStart = false } = {}) {
    super();
    this.threadId = threadId;
    this.interruptOnly = interruptOnly;
    this.rejectThreadStart = rejectThreadStart;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) this.receive(JSON.parse(line));
        callback();
      },
      final: (callback) => { this.exit(0); callback(); },
    });
  }

  send(value) { this.stdout.write(`${JSON.stringify(value)}\n`); }

  receive(message) {
    if (message.id === undefined) return;
    this.requests.push(message);
    const response = (result = {}) => this.send({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "initialize") {
      this.experimentalApi = message.params?.capabilities?.experimentalApi === true;
      response({ userAgent: "codex-cli 0.155.0-alpha.16.3" });
    } else if (message.method === "thread/read") {
      response({ thread: { id: message.params.threadId, cwd: projectRoot, source: "appServer", status: { type: "notLoaded" } } });
    } else if (message.method === "thread/start" || message.method === "thread/resume") {
      if (message.params?.runtimeWorkspaceRoots && !this.experimentalApi) {
        this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32600,
          message: `${message.method}.runtimeWorkspaceRoots requires experimentalApi capability` } });
      } else if (this.rejectThreadStart) {
        this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32600,
          message: "Invalid request token=synthetic-secret C:\\Users\\Private\\config.toml" } });
      } else response({ thread: { id: message.params.threadId ?? this.threadId } });
    }
    else if (message.method === "turn/start") {
      if (!this.experimentalApi || message.params?.runtimeWorkspaceRoots?.length !== 1
          || !Array.isArray(message.params?.input) || message.params.input[0]?.type !== "text") {
        this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32600,
          message: "Invalid turn/start parameters" } });
        return;
      }
      response({ turn: { id: "turn-simulated", status: "inProgress" } });
      if (!this.interruptOnly) queueMicrotask(() => {
        this.send({ jsonrpc: "2.0", method: "item/completed",
          params: { threadId: this.threadId, turnId: "turn-simulated", item: {
            type: "commandExecution", id: "command-1", command: "node --test", exitCode: 0, status: "completed",
          } } });
        this.send({ jsonrpc: "2.0", method: "item/agentMessage/delta",
          params: { threadId: this.threadId, turnId: "turn-simulated", itemId: "item-1", delta: "Synthetic completion." } });
        this.send({ jsonrpc: "2.0", method: "turn/completed",
          params: { threadId: this.threadId,
            turn: { id: "turn-simulated", status: "completed", items: [{ type: "agentMessage", text: "Synthetic completion." }] } } });
      });
    } else if (message.method === "turn/interrupt") {
      response({});
      queueMicrotask(() => this.send({ jsonrpc: "2.0", method: "turn/completed",
        params: { threadId: message.params.threadId,
          turn: { id: message.params.turnId, status: "interrupted", items: [] } } }));
    }
  }

  exit(code) {
    if (this.exited) return;
    this.exited = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }

  kill() {
    this.killed = true;
    this.exit(1);
    return true;
  }
}

const projectRoot = "C:\\synthetic\\authorized-project";
const codexExecutable = "C:\\Program Files\\Tong Worker\\codex.exe";
const workerEnvironment = { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\TongCodexWorker" };
const launches = [];
const processes = [];
const adapter = new CodexAppServerAdapter({
  executable: codexExecutable,
  env: workerEnvironment,
  requestTimeoutMs: 500,
  shutdownTimeoutMs: 20,
  spawnProcess: (executable, args, options) => {
    launches.push({ executable, args, options });
    const process = new SimulatedAppServerProcess();
    processes.push(process);
    return process;
  },
});

const logs = [];
const first = await adapter.runTask({
  taskId: "task-1", projectId: "authorized", cwd: projectRoot,
  task: "create a file", scope: "project files only", prompt: "Create a file in the project.",
}, {
  signal: new AbortController().signal,
  onSessionId: (id) => logs.push(`session:${id}`),
  onLog: (message, kind) => logs.push(`${kind}:${message}`),
});

assert.equal(first.threadId, "thread-simulated");
assert.equal(first.turnStatus, "completed");
assert.ok(first.summary.includes("Synthetic completion."));
assert.deepEqual(first.tests, [{ command: "node --test", exitCode: 0, status: "passed",
  evidence: "codex_app_server_command_event" }]);
assert.ok(logs.some((line) => line === "session:thread-simulated"));
assert.ok(logs.some((line) => line.includes("Synthetic completion.")));
assert.deepEqual(launches[0].args, ["app-server", "--listen", "stdio://"]);
assert.equal(launches[0].executable, codexExecutable);
assert.equal(launches[0].options.shell, false, "Codex must be spawned without a shell");
assert.equal(launches[0].options.cwd, projectRoot);
assert.deepEqual(launches[0].options.env, workerEnvironment,
  "Codex must receive an explicit worker environment instead of inheriting Gateway variables");
assert.deepEqual(processes[0].requests.find((request) => request.method === "thread/start").params.runtimeWorkspaceRoots,
  [projectRoot]);
assert.deepEqual(processes[0].requests.find((request) => request.method === "initialize").params.capabilities,
  { experimentalApi: true, requestAttestation: false });
assert.equal(processes[0].requests.find((request) => request.method === "thread/start").params.sandbox, "workspace-write");
assert.equal(processes[0].requests.find((request) => request.method === "thread/start").params.approvalPolicy, "on-request");
assert.deepEqual(processes[0].requests.find((request) => request.method === "turn/start").params.runtimeWorkspaceRoots,
  [projectRoot]);

const resumedProcess = new SimulatedAppServerProcess({ threadId: "thread-existing" });
const resumeAdapter = new CodexAppServerAdapter({
  executable: codexExecutable, env: workerEnvironment, requestTimeoutMs: 500, shutdownTimeoutMs: 20,
  spawnProcess: () => resumedProcess,
});
const resumed = await resumeAdapter.runTask({
  taskId: "task-2", projectId: "authorized", cwd: projectRoot,
  task: "continue", scope: "same project", prompt: "Continue the saved session.", threadId: "thread-existing",
}, { signal: new AbortController().signal, onSessionId: () => {}, onLog: () => {} });
assert.equal(resumed.threadId, "thread-existing");
assert.ok(resumedProcess.requests.some((request) => request.method === "thread/resume"
  && request.params.threadId === "thread-existing"));
assert.ok(!resumedProcess.requests.some((request) => request.method === "thread/start"));
assert.ok(resumedProcess.requests.some((request) => request.method === "thread/read"
  && request.params.includeTurns === false), "resume must validate stored project metadata before changing cwd");

const rejectedProcess = new SimulatedAppServerProcess({ rejectThreadStart: true });
const rejectedAdapter = new CodexAppServerAdapter({ executable: codexExecutable, env: workerEnvironment,
  requestTimeoutMs: 500, shutdownTimeoutMs: 20, spawnProcess: () => rejectedProcess });
await assert.rejects(rejectedAdapter.runTask({ cwd: projectRoot, prompt: "Synthetic only." }), (error) => {
  assert.match(error.message, /thread\/start.*-32600/);
  assert.doesNotMatch(error.message, /synthetic-secret|Private/);
  return true;
});

const interruptProcess = new SimulatedAppServerProcess({ interruptOnly: true });
const interruptAdapter = new CodexAppServerAdapter({
  executable: codexExecutable, env: workerEnvironment, requestTimeoutMs: 500, shutdownTimeoutMs: 20,
  spawnProcess: () => interruptProcess,
});
const controller = new AbortController();
const interruptedPromise = interruptAdapter.runTask({
  taskId: "task-3", projectId: "authorized", cwd: projectRoot,
  task: "wait", scope: "same project", prompt: "Wait until interrupted.",
}, { signal: controller.signal, onSessionId: () => {}, onLog: () => {} });
for (let attempt = 0; attempt < 100 && !interruptProcess.requests.some((request) => request.method === "turn/start"); attempt += 1) {
  await delay(5);
}
controller.abort(new Error("cancelled in test"));
const interrupted = await interruptedPromise;
assert.equal(interrupted.turnStatus, "interrupted");
const interrupt = interruptProcess.requests.find((request) => request.method === "turn/interrupt");
assert.equal(interrupt.params.threadId, "thread-simulated");
assert.equal(interrupt.params.turnId, "turn-simulated");
const approvalProcess=new SimulatedAppServerProcess({interruptOnly:true});
const originalReceive=approvalProcess.receive.bind(approvalProcess);
approvalProcess.receive=(message)=>{originalReceive(message);if(message.id==='approval-1')approvalProcess.send({jsonrpc:'2.0',method:'turn/completed',params:{threadId:'thread-simulated',turn:{id:'turn-simulated',status:'completed',items:[]}}});if(message.method==='turn/start')queueMicrotask(()=>approvalProcess.send({jsonrpc:'2.0',id:'approval-1',method:'item/commandExecution/requestApproval',params:{threadId:'thread-simulated',turnId:'turn-simulated',command:'synthetic system change'}}));};
const approvalAdapter=new CodexAppServerAdapter({executable:codexExecutable,env:workerEnvironment,requestTimeoutMs:500,shutdownTimeoutMs:20,spawnProcess:()=>approvalProcess});
const approvalController=new AbortController();
const approvalTimeout=setTimeout(()=>approvalController.abort(),500);
const blocked=await approvalAdapter.runTask({cwd:projectRoot,prompt:'test policy boundary'},{signal:approvalController.signal,onState:()=>delay(30)}).finally(()=>clearTimeout(approvalTimeout));
assert.equal(blocked.turnStatus,'interrupted');
assert.equal(blocked.approvalRequired.method,'item/commandExecution/requestApproval');
assert.equal(approvalProcess.requests.find(r=>r.id==='approval-1').result.decision,'decline');
const dependencyProcess=new SimulatedAppServerProcess();
const dependencyAdapter=new CodexAppServerAdapter({executable:codexExecutable,env:workerEnvironment,requestTimeoutMs:500,shutdownTimeoutMs:20,spawnProcess:()=>dependencyProcess});
await dependencyAdapter.runTask({cwd:projectRoot,prompt:'install local project dependencies'},{authorizedCapabilities:['dependency.install']});
assert.deepEqual(dependencyProcess.requests.find(r=>r.method==='turn/start').params.sandboxPolicy,{type:'workspaceWrite',writableRoots:[projectRoot],networkAccess:true});
assert.equal(processes[0].requests.find(r=>r.method==='turn/start').params.sandboxPolicy,undefined,'legacy tasks must not acquire networking from task text');
console.log("PASS: Codex App Server starts and resumes saved threads, reports turn completion, and interrupts only its own turn.");
