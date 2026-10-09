import { TongProjectAccess } from "./TongProjectAccess.mjs";
import { TongAgentTaskManager } from "./TongAgentTasks.mjs";

let defaultTaskManager;

function success(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function failure(error) {
  const message = error instanceof Error && /^(?:Path not permitted|Path not available|Invalid (?:maxDepth|limit|cursor|registry))$/.test(error.message)
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
  "Project is not authorized for agent.execute",
  "Project is missing, disabled, or unavailable",
  "Authorized project root is invalid",
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
        || /^Idempotency key was already used for a different task$/.test(error.message))
        ? error.message : "Agent task request failed";
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}

export function registerTongMcpTools(server, registerTool, z, access, tasks) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return;
  const useDefaultAccess = access === undefined;
  access ??= new TongProjectAccess();
  tasks ??= useDefaultAccess
    ? (defaultTaskManager ??= new TongAgentTaskManager({ access }))
    : new TongAgentTaskManager({ access });
  registerTool(server, "tong_list_drives", {
    title: "List C and D drive metadata",
    description: "Return only drive capacity and available space for C: and D:. No file contents are read.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => ({ drives: await access.listDrives() })));

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
    description: "Show local project registrations and effective permissions. Real project file content access is disabled in this phase.",
    inputSchema: {},
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => ({ projects: await access.listProjects() })));

  registerTool(server, "tong_agent_start", {
    title: "Start a Codex project task",
    description: "Queue one Codex task for a locally authorized project. Trusted Windows execution also requires a separate local project grant and per-task local approval. Requires an idempotency key, scope, and bounded timeout.",
    inputSchema: {
      projectId: z.string().min(2).max(40).describe("Registered local project ID with an independent agent.execute grant."),
      agent: z.enum(["codex"]).describe("Agent to use. This phase supports Codex only."),
      task: z.string().min(1).max(16_000).describe("Complete task instructions."),
      scope: z.string().min(1).max(2_000).describe("Allowed project work scope for this task."),
      idempotencyKey: z.string().min(16).max(128).describe("Client-generated retry key; reusing it cannot start a duplicate task."),
      timeoutSeconds: z.number().int().min(1).max(3_600).optional().describe("Maximum task runtime in seconds; defaults to the local configured limit."),
    },
    _meta: {},
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, safeAgent((input) => tasks.start(input)));

  registerTool(server, "tong_agent_status", {
    title: "Get Codex task status",
    description: "Read the persisted lifecycle state and runtime for a task ID.",
    inputSchema: { taskId: z.string().uuid() },
    _meta: {},
    annotations: { readOnlyHint: true },
  }, safeAgent(async ({ taskId }) => ({ task: await tasks.status(taskId) })));

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
    description: "Continue an interrupted task only when its saved Codex session can be resumed; does not create a replacement session.",
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
