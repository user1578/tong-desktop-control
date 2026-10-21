import { TongProjectAccess, configureTongWorkspaceState } from "./TongProjectAccess.mjs";
import { TongAgentTaskManager } from "./TongAgentTasks.mjs";
import {TongTrustedPolicy} from './TongTrustedCodexBroker.mjs';
import {prepareTrustedProject} from './TongQuickProject.mjs';
import { TongAgentDockRouter, registerAgentDockTools } from "./TongAgentDockTools.mjs";
import { closeAgentDockSessionCoordinators } from "./TongAgentDockSessions.mjs";
import { closeTongWorkspaceTools } from './TongWorkspaceTools.mjs';
import { inspectWindows } from './TongWindowsInspect.mjs';
import { inspectDevEnvironment } from './TongDevEnvironment.mjs';
import { isAbsolute, join } from "node:path";

let defaultTaskManager;
let preservedState;
// Called by the locally approved launcher before DevSpace registers tools.
// Preserves the original registry/Codex paths while code comes from a candidate.
export function configureTongMcpState({stateDir,demoRoot,scanRoots}={}) {
  if(!isAbsolute(stateDir??'')||!isAbsolute(demoRoot??'')||scanRoots!==undefined&&(!Array.isArray(scanRoots)||scanRoots.some(root=>!isAbsolute(root))))throw new Error('Preserved Tong state paths must be absolute');
  if(defaultTaskManager||preservedState)throw new Error('Tong state is already configured');
  preservedState=Object.freeze({stateDir,demoRoot,...(scanRoots!==undefined?{scanRoots:[...scanRoots]}:{})});
  configureTongWorkspaceState(preservedState);
}
const dockClosures = new Set();
export async function closeTongMcpTools({ timeoutMs = 10000 } = {}) {
  let timer;
  const cleanup = (async () => {
    const results = await Promise.allSettled([...dockClosures].map(close => close()).concat(defaultTaskManager ? [defaultTaskManager.close()] : []));
    results.push(...await Promise.allSettled([closeAgentDockSessionCoordinators(), closeTongWorkspaceTools()]));
    return results;
  })();
  try {
    const result = await Promise.race([cleanup, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    return { complete: result !== null && result.every(entry => entry.status === "fulfilled") };
  } finally { clearTimeout(timer); }
}

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function failure(error) {
  const message = error instanceof Error && /^(?:Path not permitted|Path not available|Invalid (?:maxDepth|limit|cursor|registry|development environment query)|Windows development environment inspection unavailable)$/.test(error.message)
    ? error.message : "Metadata request failed";
  return { content: [{ type: "text", text: message }], isError: true };
}
function safe(handler) {
  return async (input) => {
    try { return success(await handler(input)); }
    catch (error) { return failure(error); }
  };
}

const AGENT_ERRORS = new Set([
  "Invalid task request: unsupported fields",
  "Invalid project id",
  "Unsupported agent; only codex is available in this phase",
  "Invalid task description",
  "Invalid allowed work scope",
  "Invalid idempotency key",
  "Invalid task timeout",
  "Invalid native session selection",
  "Invalid native session query",
  "Native session discovery requires trusted Windows execution",
  "Project is not authorized for native session metadata",
  "Native Codex session project mismatch or unavailable",
  "Native Codex session is busy or unavailable",
  "Native session search limit reached; specify a session ID",
  "Project is not authorized for agent.execute",
  "Project is missing, disabled, or unavailable",
  "Authorized project root is invalid",
  "Invalid work type",
  "Invalid required capabilities",
  "Required capability is outside project authorization",
  "High-impact tasks require trusted local confirmation",
  "Worker execution is disabled until a verified Windows isolation launcher is configured",
  "Trusted Codex execution is disabled locally",
  "Trusted project grant is missing",
  "Trusted project is unavailable or mismatched",
  "Project must have agent.execute before a trusted grant",
  "Task not found",
  "Task has no resumable Codex session",
  "Invalid resume message",
  "Invalid task limit",
  "Invalid task cursor",
  "Invalid task id",
  "Invalid log limit",
  "Task manager is closed",
  "Task state is invalid or unavailable",
]);

function safeAgent(handler) {
  return async (input) => {
    try { return success(await handler(input)); }
    catch (error) {
      const message = error instanceof Error && (AGENT_ERRORS.has(error.message)
        || /^Idempotency key was already used for a different task$/.test(error.message)
        || /^Codex App Server thread\/(?:list|read) failed \(/.test(error.message))
        ? error.message : "Agent task request failed";
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}

export function registerTongMcpTools(server, registerTool, z, access, tasks, agentDock) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return;
  const useDefaultAccess = access === undefined;
  const stateDir = preservedState?.stateDir ?? process.env.TONG_LOCAL_STATE_DIR;
  if (stateDir && !isAbsolute(stateDir)) throw new Error("Tong local state directory must be absolute");
  access ??= preservedState ? new TongProjectAccess({ registryPath: join(stateDir,"project-access.json"),agentAccessPath:join(stateDir,"agent-execution.json"),demoRoot:preservedState.demoRoot,...(preservedState.scanRoots!==undefined?{scanRoots:preservedState.scanRoots}:{}) })
    : stateDir ? new TongProjectAccess({ registryPath: join(stateDir, "project-access.json"), agentAccessPath: join(stateDir, "agent-execution.json"), demoRoot: process.env.TONG_RESTRICTED_ROOT, scanRoots: [] }) : new TongProjectAccess();
  tasks ??= useDefaultAccess
    ? (defaultTaskManager ??= new TongAgentTaskManager({ access,
      notifyOnCompletion: true,
      ...(stateDir ? { statePath: join(stateDir, "agent-tasks.json"), trustedPolicyPath: join(stateDir, "trusted-codex.json") } : {}) }))
    : new TongAgentTaskManager({ access });
  if (agentDock || process.env.TONG_AGENTDOCK_ENABLED === "1") {
    const close = registerAgentDockTools(server, registerTool, z, agentDock ?? new TongAgentDockRouter({ access,
      policyPath: process.env.TONG_AGENTDOCK_POLICY_PATH }), () => dockClosures.delete(close));
    dockClosures.add(close);
  }
  registerTool(server, "tong_list_drives", {
    title: "List C and D drive metadata",
    description: "Return only drive capacity and available space for C: and D:. No file contents are read.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => ({ drives: await access.listDrives() })));

  registerTool(server, "tong_dev_environment", {
    title: "Inspect Windows development tools on PATH",
    description: "Read installed developer tool paths and Windows file-version metadata for a fixed allowlist. Does not execute discovered programs, install packages, or change system state. Missing file versions are null.",
    inputSchema: {
      tool: z.enum(["all", "python", "py", "node", "npm", "git", "pwsh", "cmake", "gcc", "java", "mvn"]).optional(),
    },
    _meta: {}, annotations: { readOnlyHint: true },
  }, safe((input) => inspectDevEnvironment(input)));

  registerTool(server, "tong_windows_inspect", {
    title: "Inspect Windows processes or services",
    description: "Read a bounded snapshot of Windows process names/PIDs/memory or service names/status. Optional exact-name filter. No command line, environment, control or system changes.",
    inputSchema: {
      kind: z.enum(["processes", "services"]),
      name: z.string().min(1).max(80).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    _meta: {}, annotations: { readOnlyHint: true },
  }, safe((input) => inspectWindows(input)));

  registerTool(server, "tong_scan_directory", {
    title: "Scan directory metadata",
    description: "Return bounded file and directory metadata on C: or D:. Protected paths and reparse targets are skipped. No file contents are read.",
    inputSchema: {
      path: z.string().describe("Absolute directory path on C: or D:"),
      maxDepth: z.number().int().min(0).max(3).optional().describe("Nested directory levels; defaults to 0."),
      limit: z.number().int().min(1).max(200).optional().describe("Maximum entries returned; defaults to 100."),
      cursor: z.string().optional().describe("Continuation token from the prior scan response."),
    },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe((input) => access.scanDirectory(input)));

  registerTool(server, "tong_list_projects", {
    title: "List locally registered projects",
    description: "Show local project registrations and effective read, write and independent execution permissions.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => {
    let policy,authorizationPolicyAvailable=true;
    try{policy=await new TongTrustedPolicy(stateDir?{policyPath:join(stateDir,'trusted-codex.json')}:{}).status();}
    catch{authorizationPolicyAvailable=false;policy={enabled:false,developmentGrants:[]};}
    return {projects:(await access.listProjects()).map(project=>({...project,developmentAuthorization:policy.enabled&&project.effectiveCapabilities.includes('project.write')&&project.effectiveCapabilities.includes('agent.execute')?(policy.developmentGrants.find(g=>g.projectId===project.id&&g.root===project.root)??null):null})),trustedFolders:(policy.trustedRoots??[]).map(item=>({root:item.root,gitCommit:item.capabilities.includes('git.commit'),gitPush:item.capabilities.includes('git.push')})),authorizationPolicyAvailable,
      confirmation:{clientElicitationAvailable:Boolean(server.server?.getClientCapabilities?.()?.elicitation),verifiedUserPresence:false,authorizationMethod:'local-interactive-console',chatTextCanAuthorize:false}};
  }));

  registerTool(server, 'tong_project_prepare', {
    title:'Auto-connect a project inside a previously trusted folder',
    description:'Resolve and register a requested local project, attach the already locally approved persistent Codex development grant, then return the project ID. Only operates inside a directory the user previously trusted on their Windows machine. For new folder roots, returns needs-local-trust; never elevates permissions based solely on chat text.',
    inputSchema:{
      projectPath:z.string().min(4).max(1024).describe('Existing absolute local project folder requested by the user'),
      projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(),
    },
    annotations:{readOnlyHint:false,destructiveHint:false},_meta:{},
  },safeAgent(async input=>prepareTrustedProject(input,{access,policy:new TongTrustedPolicy(stateDir?{
    policyPath:join(stateDir,'trusted-codex.json'),taskStatePath:join(stateDir,'agent-tasks.json')}:{} )})));

  registerTool(server, "tong_agent_start", {
    title: "Start a Codex project task",
    description: "Queue a Codex task. A persistent root-bound development grant starts normal work without task challenges; high-impact work waits for local confirmation. Declare requiredCapabilities before long work. Reuse the latest suitable project thread for a related follow-up; use new for an unrelated goal or when explicitly requested. Conversation lengths are not forced to a fixed turn count. Requires an idempotency key, scope and bounded timeout.",
    inputSchema: {
      projectId: z.string().min(2).max(40).describe("Registered local project ID with an independent agent.execute grant."),
      agent: z.enum(["codex"]).describe("Agent to use. This phase supports Codex only."),
      task: z.string().min(1).max(16_000).describe("Complete task instructions."),
      scope: z.string().min(1).max(2_000).describe("Allowed project work scope for this task."),
      workType: z.enum(['development','high-impact']).optional().describe('Production, system, permission/service changes, important data deletion or out-of-project work MUST be high-impact. Project authorization never grants those rights.'),
      requiredCapabilities: z.array(z.enum(['project.read','project.write','command.execute','dependency.install','codex.session','git.commit','git.push'])).min(1).max(7).optional().describe('Declare all development capabilities needed for the workflow before starting. Missing Git authorization is rejected before queueing.'),
      idempotencyKey: z.string().min(16).max(128).describe("Client-generated retry key; reusing it cannot start a duplicate task."),
      timeoutSeconds: z.number().int().min(1).max(3_600).optional().describe("Maximum task runtime in seconds; defaults to the local configured limit."),
      sessionMode: z.enum(["latest", "new", "existing"]).optional().describe("Defaults to latest reusable native project session; use new for a distinct goal, or existing for a specified native thread. Do not start a fresh conversation solely to reach a round quota."),
      codexSessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/).optional().describe("Required only for existing; obtained from native discovery or a previous task."),
      sessionSearch: z.string().min(1).max(200).optional().describe("Optional case-sensitive title filter for latest session selection."),
    },
    _meta: {},
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, safeAgent((input) => tasks.start(input)));

  registerTool(server, "tong_agent_sessions", {
    title: "List native Codex project sessions",
    description: "Read bounded native session metadata for one locally granted project. Includes app-server and desktop/CLI sessions, without messages or rollout paths. Requires project.read, agent.execute and trusted project grant.",
    inputSchema: {
      projectId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(4096).optional(),
      searchTerm: z.string().min(1).max(200).optional(),
    },
    _meta: {}, annotations: { readOnlyHint: true },
  }, safeAgent((input) => tasks.sessions(input)));

  registerTool(server, "tong_agent_status", {
    title: "Get Codex task status",
    description: "Read persisted task lifecycle, verified four-step checklist and current activity for a task ID. A checked step only means its recorded checkpoint completed, not that every domain-specific test passed.",
    inputSchema: { taskId: z.string().uuid() },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent(async ({ taskId }) => ({ task: await tasks.status(taskId) })));

  registerTool(server, "tong_agent_wait", {
    title: "Wait for Codex task progress",
    description: "Bounded read-only wait (up to 15 seconds) for a task update or completion, including its verified lifecycle checklist. Useful only while the ChatGPT turn remains active; does not push chat messages after a turn ends.",
    inputSchema: {
      taskId: z.string().uuid(),
      afterUpdatedAt: z.string().datetime().optional(),
      waitSeconds: z.number().int().min(1).max(15).optional(),
    },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent((input) => tasks.wait(input)));

  registerTool(server, "tong_agent_list", {
    title: "List Codex tasks",
    description: "Read a page of persisted Codex tasks without exposing task prompts or credentials.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(256).optional(),
    },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent((input) => tasks.list(input)));

  registerTool(server, "tong_agent_logs", {
    title: "Read Codex task logs",
    description: "Read a bounded page of redacted logs for one task ID.",
    inputSchema: {
      taskId: z.string().uuid(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(256).optional(),
    },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent((input) => tasks.logs(input)));

  registerTool(server, "tong_agent_cancel", {
    title: "Cancel a Codex task",
    description: "Cancel one queued or running task and interrupt only its associated Codex turn.",
    inputSchema: { taskId: z.string().uuid() },
    _meta: {},
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, safeAgent(async ({ taskId }) => ({ task: await tasks.cancel(taskId) })));

  registerTool(server, "tong_agent_resume", {
    title: "Resume a Codex session",
    description: "Continue a saved native Codex session. Persistent development authorization is reused; high-impact or legacy tasks require a fresh local scoped confirmation. Never expands project permissions.",
    inputSchema: {
      taskId: z.string().uuid(),
      message: z.string().min(1).max(2_000).optional(),
    },
    _meta: {},
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, safeAgent((input) => tasks.resume(input.taskId, { message: input.message })));

  registerTool(server, "tong_agent_result", {
    title: "Get Codex task result",
    description: "Read the agent summary, observed changed files, Git diff summary, and test command events for a task.",
    inputSchema: { taskId: z.string().uuid() },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent((input) => tasks.result(input.taskId)));
}
