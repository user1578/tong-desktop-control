import { TongProjectAccess, configureTongWorkspaceState } from "./TongProjectAccess.mjs";
import { TongAgentTaskManager } from "./TongAgentTasks.mjs";
import { TongGoalSupervisor } from "./TongGoalSupervisor.mjs";
import { notifyWindowsTask } from "./TongWindowsTaskNotice.mjs";
import {TongTrustedPolicy} from './TongTrustedCodexBroker.mjs';
import {prepareTrustedProject} from './TongQuickProject.mjs';
import { TongAgentDockRouter, registerAgentDockTools } from "./TongAgentDockTools.mjs";
import { closeAgentDockSessionCoordinators } from "./TongAgentDockSessions.mjs";
import { closeTongWorkspaceTools } from './TongWorkspaceTools.mjs';
import { inspectWindows } from './TongWindowsInspect.mjs';
import { inspectDevEnvironment } from './TongDevEnvironment.mjs';
import { isAbsolute, join, dirname } from "node:path";
import { TongManagedCleanup } from './TongManagedCleanup.mjs';
import { TongCleanupJobs } from './TongCleanupJobs.mjs';
import { TongDiskCleanupAnalysis } from './TongDiskCleanupAnalysis.mjs';

let defaultTaskManager;
let defaultGoalSupervisor;
let preservedState;
// Called by the locally approved launcher before DevSpace registers tools.
// Preserves the original registry/Codex paths while code comes from a candidate.
export function configureTongMcpState({stateDir,demoRoot,scanRoots}={}) {
  if(!isAbsolute(stateDir??'')||!isAbsolute(demoRoot??'')||scanRoots!==undefined&&(!Array.isArray(scanRoots)||scanRoots.some(root=>!isAbsolute(root))))throw new Error('Preserved Tong state paths must be absolute');
  if(defaultTaskManager||defaultGoalSupervisor||preservedState)throw new Error('Tong state is already configured');
  preservedState=Object.freeze({stateDir,demoRoot,...(scanRoots!==undefined?{scanRoots:[...scanRoots]}:{})});
  configureTongWorkspaceState(preservedState);
}
const dockClosures = new Set();
export async function closeTongMcpTools({ timeoutMs = 10000 } = {}) {
  let timer;
  const cleanup = (async () => {
    // Stop the goal scheduler before closing its underlying per-turn manager.
    const results = await Promise.allSettled([
      ...(defaultGoalSupervisor ? [defaultGoalSupervisor.close()] : []),
      ...[...dockClosures].map(close => close()),
    ]);
    if(defaultTaskManager)results.push(...await Promise.allSettled([defaultTaskManager.close()]));
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
  "Invalid supervised goal",
  "Invalid supervised goal step",
  "Invalid supervised goal verification",
  "Invalid supervised goal verification paths",
  "Goal round budget is smaller than the plan",
  "Goal idempotency conflict",
  "A supervised goal is already active in this project",
  "Goal not found",
  "Goal supervisor is closed",
  "Invalid independent goal review",
  "Goal is not awaiting independent review",
  "Review step mismatch",
  "Review evidence missing",
  "File existence is not final code acceptance",
  "Goal cannot resume without a saved waiting Codex turn",
  "Goal deadline expired; review a new scoped request",
  "Saved Codex turn is not resumable",
  "Goal state changed during recovery",
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
  const goals = useDefaultAccess
    ? (defaultGoalSupervisor ??= new TongGoalSupervisor({
      tasks,
      statePath: stateDir ? join(stateDir,"goal-supervisor.json") : join(process.cwd(),"runtime","goal-supervisor.json"),
      notifier: notifyWindowsTask,
      openDesktopThread: tasks.openDesktopThread,
    })) : null;
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

  const cleanup = new TongManagedCleanup({access,stateDir:stateDir??dirname(access.registryPath)});
  const cleanupJobs = new TongCleanupJobs(cleanup);
  const cleanupAnalysis = new TongDiskCleanupAnalysis(cleanup);
  const cleanupHandler = handler => async input=>{
    try { return success(await handler(input)); }
    catch(error){
      const message = typeof error?.code==='string' && /^CLEANUP_[A-Z0-9_]{3,50}$/.test(error.code)
        ? error.code : 'CLEANUP_OPERATION_FAILED';
      return {content:[{type:'text',text:message}],isError:true};
    }
  };
  registerTool(server,'tong_disk_cleanup_analyze',{
    title:'Analyze C/D disk metadata and safe cleanup categories',
    description:'Bounded metadata only: analyze an explicit C/D path or discover current-user Temp/npm/pip cache roots and drive space. Reuse a dated snapshot for five minutes unless refresh=true. Unknown/partial sizes remain explicit; analysis never grants deletion. Use existing cleanup_run mode=plan for an authorized durable preview, then cleanup_job resume for audited deletion.',
    inputSchema:{path:z.string().min(3).max(2048).optional(),drive:z.enum(['C','D']).optional(),refresh:z.boolean().optional()},
    annotations:{readOnlyHint:true,destructiveHint:false},_meta:{},
  },cleanupHandler(input=>cleanupAnalysis.analyze(input)));
  registerTool(server,'tong_disk_cleanup_plan',{
    title:'Prepare bounded disk cleanup without deleting',
    description:'Plan an exact disposable cache or verified archived candidate inside a readable project or a locally approved cleanup scope. Reports deletionAuthorized separately. Broad metadata scanning remains with tong_scan_directory.',
    inputSchema:{
      projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
      path:z.string().min(4).max(2048),
    },
    annotations:{readOnlyHint:true,destructiveHint:false},_meta:{},
  },cleanupHandler(input=>cleanup.plan(input)));
  registerTool(server,'tong_disk_cleanup_execute',{
    title:'Execute a previously verified cleanup plan',
    description:'Delete the exact prechecked directory once under a separate persistent local cleanup grant. Rechecks grant revision, expiry, target, links, pins and preserved archives; audits results. Project read/write permission alone never authorizes deletion.',
    inputSchema:{
      projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
      planId:z.string().uuid(),
    },
    annotations:{readOnlyHint:false,destructiveHint:true},_meta:{},
  },cleanupHandler(input=>cleanup.execute(input)));
  registerTool(server,'tong_disk_cleanup_run',{
    title:'Clean authorized safe caches with durable progress',
    description:'A cleanup request is an execution request: start managed selective deletion without another confirmation. With path, inspect only that exact authorized cache or archived candidate node_modules subtree. Without path, use known authorized cache roots and the Tong candidate index, never scan whole drives. Return a durable jobId promptly; protected Agent/identity/Git/database content stays in place. No new OS permissions or grants are issued.',
    inputSchema:{projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),path:z.string().min(4).max(2048).optional(),mode:z.enum(['clean','plan','exact']).optional().describe('exact requires a user-specified ordinary path in an existing writable project; safe-cache discovery still requires a cleanup grant.'),idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional()},
    annotations:{readOnlyHint:false,destructiveHint:true},_meta:{},
  },cleanupHandler(input=>cleanupJobs.start(input)));
  registerTool(server,'tong_disk_cleanup_job',{
    title:'Query, cancel or resume a persistent cleanup job',
    description:'Read real stage, counts, audit and disk-space results across connections; request cancellation or resume the same job after interruption. Resume rechecks authorization, references, archives and changed files. Cancellation stops new deletes; deleted disposable cache files cannot be undeleted.',
    inputSchema:{projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),jobId:z.string().uuid(),action:z.enum(['status','cancel','resume']).optional()},
    annotations:{readOnlyHint:false,destructiveHint:true},_meta:{},
  },cleanupHandler(input=>cleanupJobs.control(input)));

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
    let cleanupScopes=[],cleanupAuthorizationAvailable=true;
    try{cleanupScopes=(await cleanup.authorization.read()).grants.filter(g=>g.enabled).map(({id,root,scopes,revision})=>({id,root,scopes,revision}));}
    catch{cleanupAuthorizationAvailable=false;}
    return {projects:(await access.listProjects()).map(project=>({...project,developmentAuthorization:policy.enabled&&project.effectiveCapabilities.includes('project.write')&&project.effectiveCapabilities.includes('agent.execute')?(policy.developmentGrants.find(g=>g.projectId===project.id&&g.root===project.root)??null):null})),trustedFolders:(policy.trustedRoots??[]).map(item=>({root:item.root,gitCommit:item.capabilities.includes('git.commit'),gitPush:item.capabilities.includes('git.push')})),authorizationPolicyAvailable,
      cleanupScopes,cleanupAuthorizationAvailable,
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
    description: "Start ONE standalone Codex turn. On completion a new native session may immediately open in Desktop and show a per-turn notification; Desktop can then own the writer, preventing direct follow-up. For any planned multi-turn task or task-level supervision, use tong_goal_start instead: it defers Desktop opening and user notification until the whole goal is done. Persistent development authorization and bounded per-turn scopes still apply.",
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
    description: "Resume a standalone saved native Codex task. A Desktop client holding the session writer can block this action; do not kill Desktop or delete locks. For a multi-step supervised goal use tong_goal_start/tong_goal_resume and let its scheduler manage all turns. Persistent development grants are reused; higher-impact actions require local confirmation.",
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

  // Goal-level interface stays stable when new agents get their own adapters.
  // Individual Codex turns remain internal and never trigger final reports.
  registerTool(server,"tong_goal_start",{
    title:"Start a supervised multi-turn goal",
    description:"Preferred interface for a task requiring multiple Codex turns. Persist one parent goal and bounded, independently verified steps; reuse one native Codex thread. Child turns do not open Desktop or send per-turn notices; only whole-goal completion opens the new native session and sends a completion notice, or an unrecoverable blocker prompts attention. Requires a project grant. Codex is the available provider in this phase.",
    inputSchema:{
      projectId:z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
      agent:z.enum(["codex"]),
      goal:z.string().min(1).max(4000),
      scope:z.string().min(1).max(2000),
      idempotencyKey:z.string().min(16).max(128),
      steps:z.array(z.object({
        id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        title:z.string().min(1).max(120),
        instruction:z.string().min(1).max(3000),
        verification:z.object({
          type:z.enum(["read-only-turn","files-exist","review-required"]),
          paths:z.array(z.string().min(1).max(240)).max(15).optional(),
        }),
      })).min(1).max(12),
      sessionMode:z.enum(["new","latest"]).optional(),
      workType:z.enum(["development","high-impact"]).optional(),
      requiredCapabilities:z.array(z.enum(["project.read","project.write","command.execute",
        "dependency.install","codex.session","git.commit","git.push"])).min(1).max(7).optional(),
      maxRounds:z.number().int().min(1).max(20).optional(),
      maxAttemptsPerStep:z.number().int().min(1).max(3).optional(),
      roundTimeoutSeconds:z.number().int().min(10).max(3600).optional(),
      deadlineSeconds:z.number().int().min(60).max(14400).optional(),
    },
    annotations:{readOnlyHint:false,destructiveHint:false},_meta:{},
  },safeAgent(input=>goals?.start(input)??Promise.reject(Error("Goal supervisor unavailable"))));

  for(const [tool,description,action] of [
    ["tong_goal_status","Read evidence-backed step checklist and active Codex turn phase for one supervised goal; only verified steps are checked","status"],
    ["tong_goal_result","Read overall completion evidence and all internal turns","result"],
    ["tong_goal_cancel","Stop a supervised goal without deleting its native thread","cancel"],
    ["tong_goal_resume","Resume the same saved Codex turn after a user-action blocker is resolved; never creates a replacement session","resume"],
  ]) registerTool(server,tool,{
    title:description,description,
    inputSchema:{goalId:z.string().uuid()},
    annotations:{readOnlyHint:action!=="cancel",destructiveHint:false},_meta:{},
  },safeAgent(input=>goals?.[action](input.goalId)??Promise.reject(Error("Goal supervisor unavailable"))));

  // Bounded long-poll intended for an active ChatGPT reply. It cannot update
  // an already-sent chat card or send an unsolicited ChatGPT message.
  registerTool(server,"tong_goal_wait",{
    title:"Watch verified goal steps",
    description:"Wait up to 15 seconds for a changed evidence-backed goal progress cursor or a terminal/review checkpoint. Shows active Codex turn phase separately from verified functional milestones. Use repeatedly while the ChatGPT turn remains active; does not push updates to an already-sent card.",
    inputSchema:{
      goalId:z.string().uuid(),
      afterCursor:z.string().regex(/^[a-f0-9]{64}$/).optional(),
      waitSeconds:z.number().int().min(1).max(15).optional(),
    },
    annotations:{readOnlyHint:true},_meta:{},
  },safeAgent(input=>goals?.wait(input)??Promise.reject(Error("Goal supervisor unavailable"))));

  registerTool(server,"tong_goal_review",{
    title:"Record independent step verification",
    description:"Only ChatGPT after separately inspecting project evidence should submit a grounded acceptance or rejection. This is not user permission and cannot expand project capabilities; accepted steps continue automatically, otherwise the goal remains blocked or retries within its existing budget.",
    inputSchema:{
      goalId:z.string().uuid(),
      accepted:z.boolean(),
      evidence:z.string().min(8).max(2000),
    },
    annotations:{readOnlyHint:false,destructiveHint:false},_meta:{},
  },safeAgent(input=>goals?.review(input)??Promise.reject(Error("Goal supervisor unavailable"))));

  registerTool(server,"tong_goal_list",{
    title:"List supervised goals",
    description:"Read a bounded list of parent goals and their statuses without prompts or credentials.",
    inputSchema:{},annotations:{readOnlyHint:true},_meta:{},
  },safeAgent(()=>goals?.list()??Promise.reject(Error("Goal supervisor unavailable"))));
}
