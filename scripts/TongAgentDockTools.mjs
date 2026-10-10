import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { AGENTDOCK_READ_TOOLS, TongAgentDockClient, TongAgentDockError, dockError } from "./TongAgentDockClient.mjs";
import { AGENTDOCK_EXCLUDES, checkedAgentDockPath } from "./TongAgentDockPaths.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const AGENTDOCK_PUBLIC_TOOLS = Object.freeze(["tong_agentdock_list_dir", "tong_agentdock_read_file", "tong_agentdock_search_text"]);
const publicToBackend = Object.fromEntries(AGENTDOCK_PUBLIC_TOOLS.map((name, i) => [name, AGENTDOCK_READ_TOOLS[i]]));
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function integer(value, min, max) { return value === undefined || Number.isInteger(value) && value >= min && value <= max; }
export function validateAgentDockInput(tool, input) {
  if (!AGENTDOCK_READ_TOOLS.includes(tool) || !object(input)) throw dockError("INVALID_ARGUMENT");
  const keys = ["projectId", "path", ...(tool === "read_file" ? ["startLine", "endLine", "maxBytes"]
    : tool === "list_dir" ? ["maxDepth", "maxEntries"] : ["query", "caseSensitive", "maxResults"])];
  if (Object.keys(input).some((key) => !keys.includes(key)) || !/^[a-z][a-z0-9-]{1,39}$/.test(input.projectId ?? "")
      || input.path !== undefined && (typeof input.path !== "string" || !input.path || input.path.length > 4096)
      || tool === "read_file" && (typeof input.path !== "string" || !integer(input.startLine, 1, 1000000)
        || !integer(input.endLine, input.startLine ?? 1, 1000000) || !integer(input.maxBytes, 1, 65536))
      || tool === "list_dir" && (!integer(input.maxDepth, 1, 3) || !integer(input.maxEntries, 1, 200))
      || tool === "search_text" && (typeof input.query !== "string" || !input.query || input.query.length > 512
        || /[\x00-\x1f]/.test(input.query) || input.query.trimStart().startsWith("-") || !integer(input.maxResults, 1, 100)
        || input.caseSensitive !== undefined && typeof input.caseSensitive !== "boolean")) throw dockError("INVALID_ARGUMENT");
}
export function validateAgentDockGatewayCall(name, input) {
  try { validateAgentDockInput(publicToBackend[name], input); return null; }
  catch { return { code: -32602, message: "Invalid AgentDock read arguments" }; }
}
async function localAudit(event) {
  const path = join(projectRoot, "runtime", "agentdock-audit.jsonl");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(event) + "\n", { mode: 0o600 });
}
function invalidResult() { throw dockError("INVALID_RESULT"); }
function filteredResult(tool, data, checked, input) {
  if (!object(data)) invalidResult();
  const path = checked.relative(checked.target);
  if (tool === "read_file") {
    if (typeof data.content !== "string" || Buffer.byteLength(data.content) > (input.maxBytes ?? 65536)) invalidResult();
    if (data.path !== undefined && checked.resultPath(data.path) !== checked.target) invalidResult();
    return { path, content: data.content, encoding: "utf-8", truncated: data.truncated === true,
      ...(Number.isInteger(data.next_start_line) ? { nextStartLine: data.next_start_line } : {}) };
  }
  if (tool === "list_dir") {
    if (!Array.isArray(data.entries) || data.entries.length > (input.maxEntries ?? 100)) invalidResult();
    const entries = data.entries.map((item) => {
      if (!object(item) || typeof item.path !== "string" || !["file", "directory"].includes(item.type)) invalidResult();
      const target = checked.resultPath(item.path);
      if (checked.manifest.get(target) !== item.type) invalidResult();
      return { path: checked.relative(target), type: item.type,
        ...(Number.isSafeInteger(item.size_bytes) && item.size_bytes >= 0 ? { sizeBytes: item.size_bytes } : {}) };
    });
    return { path, entries, truncated: data.truncated === true, partial: data.partial === true };
  }
  if (!Array.isArray(data.matches) || data.matches.length > (input.maxResults ?? 100)) invalidResult();
  const matches = data.matches.map((item) => {
    if (!object(item) || typeof item.path !== "string" || !Number.isInteger(item.line) || item.line < 1
        || typeof item.preview !== "string" || Buffer.byteLength(item.preview) > 4096) invalidResult();
    const target = checked.resultPath(item.path);
    if (checked.manifest.get(target) !== "file") invalidResult();
    return { path: checked.relative(target), line: item.line, preview: item.preview };
  });
  return { matches, truncated: data.truncated === true };
}

/** Independent synthetic-project grants. agent.execute is never consulted or promoted. */
export class TongAgentDockRouter {
  constructor({ client, access, policyPath = join(projectRoot, "runtime", "agentdock-access.json"), audit = localAudit } = {}) {
    this.client = client ?? new TongAgentDockClient({ url: process.env.TONG_AGENTDOCK_URL });
    this.access = access; this.policyPath = policyPath; this.audit = audit;
  }
  async #project(projectId, tool) {
    let policy, projects;
    try { policy = JSON.parse(await readFile(this.policyPath, "utf8")); projects = await this.access.listProjects(); }
    catch { throw dockError("PROJECT_DENIED"); }
    if (policy?.schemaVersion !== 1 || !Array.isArray(policy.projects)) throw dockError("PROJECT_DENIED");
    const project = projects.find((entry) => entry.id === projectId && entry.status === "enabled" && entry.available
      && ["read", "write"].includes(entry.permission));
    const grants = policy.projects.filter((entry) => entry.projectId === projectId);
    const grant = grants[0];
    if (!project || grants.length !== 1 || !grant || grant.scope !== "synthetic" || grant.root !== project.root
        || !Array.isArray(grant.tools) || grant.tools.some((name) => !AGENTDOCK_READ_TOOLS.includes(name))
        || !grant.tools.includes(tool)) throw dockError("PROJECT_DENIED");
    return project;
  }
  async call(tool, input) {
    const started = performance.now();
    const event = { requestId: randomUUID(), projectId: /^[a-z][a-z0-9-]{1,39}$/.test(input?.projectId ?? "") ? input.projectId : "unknown",
      tool: AGENTDOCK_READ_TOOLS.includes(tool) ? tool : "unknown", outcome: "denied" };
    try {
      if (!AGENTDOCK_READ_TOOLS.includes(tool)) throw dockError("TOOL_DENIED");
      const project = await this.#project(input?.projectId, tool);
      validateAgentDockInput(tool, input);
      let checked;
      if (tool === "read_file") checked = await checkedAgentDockPath(project.root, input.path);
      else if (tool === "list_dir") checked = await checkedAgentDockPath(project.root, input.path ?? ".", { directory: true, treeDepth: input.maxDepth ?? 1 });
      else checked = await checkedAgentDockPath(project.root, input.path ?? ".", { directory: true, treeDepth: 20, requireFullTree: true });
      event.target = checked.relative(checked.target);
      const args = { path: checked.target, ...(process.platform === "win32" ? { runtime: "windows" } : {}) };
      if (tool === "read_file") Object.assign(args, { max_bytes: input.maxBytes ?? 65536,
        ...(input.startLine ? { start_line: input.startLine } : {}), ...(input.endLine ? { end_line: input.endLine } : {}) });
      if (tool === "list_dir") Object.assign(args, { max_depth: input.maxDepth ?? 1, max_entries: input.maxEntries ?? 100,
        include_hidden: false, include_ignored: false, exclude_patterns: AGENTDOCK_EXCLUDES });
      if (tool === "search_text") Object.assign(args, { query: input.query, regex: false, case_sensitive: input.caseSensitive ?? false,
        max_results: input.maxResults ?? 100, context_lines: 0, include_hidden: false, include_ignored: false, exclude_globs: AGENTDOCK_EXCLUDES });
      const result = await this.client.callTool(tool, args);
      await checked.recheck();
      // Re-check the grant after execution too; revocation prevents delivery of in-flight results.
      const currentProject = await this.#project(input.projectId, tool);
      if (currentProject.root !== project.root) throw dockError("PROJECT_DENIED");
      const filtered = filteredResult(tool, result.structuredContent, checked, input);
      event.outcome = "allowed";
      return filtered;
    } catch (error) {
      const safe = error instanceof TongAgentDockError ? error : dockError("UNAVAILABLE");
      event.errorType = safe.code;
      if (!["TOOL_DENIED", "PROJECT_DENIED", "ACCESS_DENIED", "INVALID_ARGUMENT"].includes(safe.code)) event.outcome = "failed";
      throw safe;
    } finally {
      event.durationMs = Math.round(performance.now() - started);
      try { await this.audit(event); } catch { throw dockError("AUDIT_UNAVAILABLE"); }
    }
  }
  async close() { await this.client.close(); }
}

export function registerAgentDockTools(server, registerTool, z, router) {
  const common = { projectId: z.string().min(2).max(40), path: z.string().min(1).max(4096) };
  const definitions = [
    { name: AGENTDOCK_PUBLIC_TOOLS[0], tool: "list_dir", inputSchema: { ...common, path: common.path.optional(), maxDepth: z.number().int().min(1).max(3).optional(), maxEntries: z.number().int().min(1).max(200).optional() } },
    { name: AGENTDOCK_PUBLIC_TOOLS[1], tool: "read_file", inputSchema: { ...common, startLine: z.number().int().min(1).max(1000000).optional(), endLine: z.number().int().min(1).max(1000000).optional(), maxBytes: z.number().int().min(1).max(65536).optional() } },
    { name: AGENTDOCK_PUBLIC_TOOLS[2], tool: "search_text", inputSchema: { ...common, path: common.path.optional(), query: z.string().min(1).max(512), caseSensitive: z.boolean().optional(), maxResults: z.number().int().min(1).max(100).optional() } },
  ];
  for (const definition of definitions) registerTool(server, definition.name, {
    title: `AgentDock ${definition.tool}`, description: "Read an explicitly granted synthetic project through the local AgentDock backend.",
    inputSchema: z.object(definition.inputSchema).strict(), _meta: {}, annotations: { readOnlyHint: true, destructiveHint: false },
  }, async (input) => {
    try { const value = await router.call(definition.tool, input); return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] }; }
    catch (error) { const safe = error instanceof TongAgentDockError ? error : dockError("UNAVAILABLE");
      return { isError: true, structuredContent: { code: safe.code, error: safe.message }, content: [{ type: "text", text: safe.message }] }; }
  });
  if (server.server) {
    const previous = server.server.onclose;
    server.server.onclose = () => { previous?.(); void router.close().catch(() => {}); };
  }
}
