import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(projectRoot, "node_modules", "@waishnav", "devspace");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
if (version !== "1.0.8") throw new Error(`Expected DevSpace 1.0.8, found ${version}`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceOnce(source, before, after, name) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`DevSpace 1.0.8 patch anchor changed: ${name}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function extendRestrictedServer(source) {
  const toolImport = 'import { assertTongRestrictedConfig, assertTongWorkspaceRoot } from "../../../../scripts/TongSafeFilePath.mjs";';
  const oldImport = 'import { registerTongMcpTools } from "../../../../scripts/TongMcpTools.mjs";';
  const newImport = 'import { registerTongMcpTools, closeTongMcpTools } from "../../../../scripts/TongMcpTools.mjs";';
  if (source.includes(oldImport)) source = replaceOnce(source, oldImport, newImport, "awaitable Tong cleanup import");
  if (!source.includes(newImport)) {
    source = replaceOnce(source, toolImport,
      `${toolImport}\n${newImport}`,
      "agent task tool import");
  }
  const baseToolSet = 'const TONG_ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit"]);';
  const metadataToolSet = 'const TONG_ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit", "tong_list_drives", "tong_scan_directory", "tong_list_projects"]);';
  const agentToolSet = 'const TONG_ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit", "tong_list_drives", "tong_scan_directory", "tong_list_projects", "tong_agent_start", "tong_agent_status", "tong_agent_list", "tong_agent_logs", "tong_agent_cancel", "tong_agent_resume", "tong_agent_result"]);';
  const agentDockReadToolSet = agentToolSet.replace('"tong_agent_result"]);', '"tong_agent_result", "tong_agentdock_list_dir", "tong_agentdock_read_file", "tong_agentdock_search_text"]);');
  const agentDockToolSet = agentDockReadToolSet.replace('"tong_agentdock_search_text"]);', '"tong_agentdock_search_text", "tong_agentdock_file_edit", "tong_agentdock_command", "tong_agentdock_session_status", "tong_agentdock_session_cancel"]);');
  if (!source.includes(agentDockToolSet) && !source.includes('"tong_run_command"]);') &&
      !source.includes('"tong_windows_inspect"]);') && !source.includes('"tong_dev_environment"]);')) {
    const prior = source.includes(agentDockReadToolSet) ? agentDockReadToolSet : source.includes(agentToolSet) ? agentToolSet : source.includes(metadataToolSet) ? metadataToolSet : baseToolSet;
    source = replaceOnce(source, prior, agentDockToolSet, "AgentDock fixed tool registration guard");
  }
  if (!source.includes("registerTongMcpTools(server, registerAppTool, z)")) {
    source = replaceOnce(source,
      '    return server;\n}\nexport function createServer(config = loadConfig(), options = {}) {',
      '    registerTongMcpTools(server, registerAppTool, z);\n    return server;\n}\nexport function createServer(config = loadConfig(), options = {}) {',
      "agent task tool registration");
  }
  if (!source.includes("await closeTongMcpTools();")) source = replaceOnce(source,
    "const results = await transports.closeAll();", "const results = await transports.closeAll();\n                await closeTongMcpTools();", "await owned AgentDock cleanup before process exit");
  if (!source.includes('registerTongWorkspaceTools(server, registerAppTool, z, workspaces)')) {
    source = replaceOnce(source, newImport, `${newImport}\nimport { registerTongWorkspaceTools } from "../../../../scripts/TongWorkspaceTools.mjs";`, 'workspace tools import');
    source = replaceOnce(source, agentDockToolSet, agentDockToolSet.replace(']);', ', "tong_list_directory", "tong_move_file", "tong_delete_file", "tong_run_command"]);'), 'workspace tools allowlist');
    source = replaceOnce(source, '    registerTongMcpTools(server, registerAppTool, z);', '    registerTongWorkspaceTools(server, registerAppTool, z, workspaces);\n    registerTongMcpTools(server, registerAppTool, z);', 'workspace tools registration');
    source = replaceOnce(source, '.describe("Absolute path, or a leading-tilde home path such as ~/project, to a project directory inside an allowed root.")', '.optional()\n                .describe("Authorized project directory. Omit to use the default workspace.")', 'default workspace schema');
    source = replaceOnce(source, '        await assertTongWorkspaceRoot(path, mode);', '        path = await assertTongWorkspaceRoot(path, mode);\n        if (process.env.TONG_RESTRICTED_MCP === "1" && !config.allowedRoots.includes(path)) config.allowedRoots.push(path);', 'authorized workspace registry root');
    source = replaceOnce(source, 'Use open_workspace for the authorized checkout, then read, write, and edit files in that workspace.', 'Use open_workspace with an authorized project path, or omit path for the default. Reuse workspaceId for read/write/edit, tong_list_directory, tong_move_file, tong_delete_file and tong_run_command. Commands require a separate local agent.execute grant.', 'workspace instructions');
  }
  if (!source.includes('"tong_agent_sessions"')) {
    source = replaceOnce(source, '"tong_agent_result"', '"tong_agent_result", "tong_agent_sessions"', 'native Codex session registration guard');
  }
  if (!source.includes('"tong_windows_inspect"')) {
    source = replaceOnce(source, '"tong_run_command"]);', '"tong_run_command", "tong_windows_inspect"]);',
      'Windows inspection read-only tool registration guard');
  }
  if (!source.includes('"tong_dev_environment"')) {
    source = replaceOnce(source, '"tong_windows_inspect"]);', '"tong_windows_inspect", "tong_dev_environment"]);',
      'Windows developer environment read-only tool registration guard');
  }
  return source;
}

const files = [
  {
    name: "pi-tools.js",
    originalHash: "60d9f66cd8569b3c707ec628a83d19e91018ed77489ffec0e57306b516e4d348",
    patchedHash: "d6f47e98e061217ded7e9df070a8d6db3d252eaafce258ca97e0d08071b5e13e",
    transform(source) {
      source = replaceOnce(source,
        'import { resolveAllowedPath } from "./roots.js";',
        'import { resolveAllowedPath } from "./roots.js";\nimport { assertTongSafeFilePath } from "../../../../scripts/TongSafeFilePath.mjs";',
        "path guard import");
      source = replaceOnce(source,
        'export async function readFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, context.readRoots ?? [context.root]);',
        'export async function readFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, context.readRoots ?? [context.root]);\n    await assertTongSafeFilePath(path, context, "read");',
        "read guard");
      source = replaceOnce(source,
        'export async function writeFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, [context.root]);',
        'export async function writeFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, [context.root]);\n    await assertTongSafeFilePath(input.path, context, "write");',
        "write guard");
      source = replaceOnce(source,
        'export async function editFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, [context.root]);',
        'export async function editFileTool(input, context) {\n    const path = resolveAllowedPath(input.path, context.cwd, [context.root]);\n    await assertTongSafeFilePath(input.path, context, "edit");',
        "edit guard");
      source = replaceOnce(source,
        'export async function runShellTool(input, context) {\n    const tool = createBashTool(context.cwd);',
        'export async function runShellTool(input, context) {\n    if (process.env.TONG_RESTRICTED_MCP === "1") return { content: [{ type: "text", text: "Shell is disabled in this MCP instance" }], isError: true };\n    const tool = createBashTool(context.cwd);',
        "shell execution guard");
      return source;
    },
  },
  {
    name: "server.js",
    originalHash: "bf3db902241b631d7c6fbaf12385243b46b4f2d4bb776b6ea7ca6c9d429a3263",
    previousHash: "7102a8c4feec229cf0853de87bfa31065763afeef04c818786b7ccf3f9b4c9b0",
    previousHash2: "6e5ca5457de4c6da8bdcfda02f2f254a9e42c8f59bee32a1ea495c948f595646",
    previousHash3: "ea21bce39c54f32ddd966840dbeb3d87bc2fe117619f5ac517a31d9528f7fc67",
    previousHash4: "3457bd2cc9158e3e93fb22028e81446528c92b94a522913fb081a82f0c0d6df5",
    previousHash5: "e397438fd44a400f85d052cfd89396ac5a1a565962a285789017a608eb807a0d",
    previousHash6: "b71a8e616ffb337c38cba6109f922e163d82bcfa34f1bdf94a830130bcc5979c",
    previousHash7: "c4a4a03e31cbebcba197fd890bf318199c2a902a077dcd49987cb7cdc517758a",
    previousHash8: "8cc2decf858ba0616fb674cd93432cce45bc5636ef7ccb7c1017e74645d46b20",
    previousHash9: "e896e4de982bed8faab799d919f284bca9eaac63acc9d9fd06f31f6832390489",
    patchedHash: "756b28ced3b6838b9a223a2d6a1ff1bdbae37a38d7ab64f6d82f27e5122687a3",
    upgrade: extendRestrictedServer,
    transform(source) {
      source = replaceOnce(source,
        'import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE, } from "@modelcontextprotocol/ext-apps/server";',
        'import { registerAppResource, registerAppTool as registerBaseAppTool, RESOURCE_MIME_TYPE, } from "@modelcontextprotocol/ext-apps/server";\nimport { assertTongRestrictedConfig, assertTongWorkspaceRoot } from "../../../../scripts/TongSafeFilePath.mjs";',
        "registration guard import");
      source = replaceOnce(source,
        'const MCP_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1_000;',
        'const TONG_ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit"]);\nfunction registerAppTool(server, name, ...args) {\n    if (process.env.TONG_RESTRICTED_MCP === "1" && !TONG_ALLOWED_TOOLS.has(name)) return;\n    return registerBaseAppTool(server, name, ...args);\n}\nconst MCP_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1_000;',
        "server tool registration guard");
      source = replaceOnce(source,
        'function serverInstructions(config) {\n    const artifactInstruction',
        'function serverInstructions(config) {\n    if (process.env.TONG_RESTRICTED_MCP === "1") return "Use open_workspace for the authorized checkout, then read, write, and edit files in that workspace.";\n    const artifactInstruction',
        "restricted tool instructions");
      source = replaceOnce(source,
        '    }, async ({ path, mode, baseRef }, { _meta }) => {\n        const startedAt = performance.now();',
        '    }, async ({ path, mode, baseRef }, { _meta }) => {\n        await assertTongWorkspaceRoot(path, mode);\n        const startedAt = performance.now();',
        "workspace root guard");
      source = replaceOnce(source,
        'export function createServer(config = loadConfig(), options = {}) {\n    const incomingArtifactAdapters',
        'export function createServer(config = loadConfig(), options = {}) {\n    assertTongRestrictedConfig(config);\n    const incomingArtifactAdapters',
        "restricted startup guard");
      return extendRestrictedServer(source);
    },
  },
  {
    name: "workspaces.js",
    originalHash: "e11517f291cac33e37a66e84aeb80e1664a5abd0b6eb1e9bdb933d84c186efad",
    patchedHash: "544ac1ae6bd15f6177ff269c5d5918763d2821e83421de54e435df4233ca418a",
    transform(source) {
      source = replaceOnce(source,
        'import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";',
        'import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";\nimport { loadTongWorkspaceContextFiles } from "../../../../scripts/TongSafeFilePath.mjs";',
        "restricted workspace context import");
      source = replaceOnce(source,
        '    async loadInitialAgentsFiles(root) {\n        const agentDir = resolve(this.config.agentDir);',
        '    async loadInitialAgentsFiles(root) {\n        if (process.env.TONG_RESTRICTED_MCP === "1")\n            return loadTongWorkspaceContextFiles(root);\n        const agentDir = resolve(this.config.agentDir);',
        "restricted workspace context guard");
      source = replaceOnce(source,
        '    async findAvailableAgentsFiles(root, loadedFiles) {\n        const loadedPaths',
        '    async findAvailableAgentsFiles(root, loadedFiles) {\n        if (process.env.TONG_RESTRICTED_MCP === "1") return [];\n        const loadedPaths',
        "restricted context discovery guard");
      return source;
    },
  },
];

const checkOnly = process.argv.includes("--check");
for (const file of files) {
  const target = join(packageRoot, "dist", file.name);
  const source = await readFile(target, "utf8");
  const hash = sha256(source);
  if (hash === file.patchedHash) continue;
  if (checkOnly) throw new Error(`DevSpace security patch missing or changed: ${file.name}`);
  if (hash !== file.originalHash && hash !== file.previousHash && hash !== file.previousHash2 && hash !== file.previousHash3 && hash !== file.previousHash4 && hash !== file.previousHash5 && hash !== file.previousHash6 && hash !== file.previousHash7 && hash !== file.previousHash8 && hash !== file.previousHash9) throw new Error(`Unexpected DevSpace 1.0.8 file; refusing to patch: ${file.name}`);
  const patched = hash === file.originalHash ? file.transform(source) : file.upgrade(source);
  if (file.patchedHash && sha256(patched) !== file.patchedHash) throw new Error(`DevSpace security patch output changed: ${file.name}: ${sha256(patched)}`);
  await writeFile(target, patched, "utf8");
  process.stdout.write(`Patched ${file.name}: ${sha256(patched)}\n`);
}
process.stdout.write("DevSpace restricted MCP patch verified.\n");
