import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createTongProjectAccess } from './TongProjectAccess.mjs';

export class TongAccessDeniedError extends Error {
  constructor() {
    super("Path is not permitted in the restricted MCP workspace");
    this.name = "AccessDeniedError";
  }
}

function denied() {
  throw new TongAccessDeniedError();
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(root, target) {
  const part = relative(root, target);
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}

export async function checkedRoot(root, capability = 'project.read') {
  if (typeof root !== 'string' || !isAbsolute(root)) denied();
  const access = createTongProjectAccess();
  if (!samePath(root, access.demoRoot) || capability === 'agent.execute') {
    const project = (await access.listProjects()).find(entry => samePath(entry.root, root));
    if (!project?.effectiveCapabilities.includes(capability)) denied();
  }
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) denied();
    if (!samePath(await realpath(root), root)) denied();
  } catch {
    denied();
  }
  return resolve(root);
}

export async function assertTongWorkspaceRoot(path, mode) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return path;
  path ??= createTongProjectAccess().demoRoot;
  if (typeof path !== "string" || mode && mode !== "checkout") denied();
  return checkedRoot(path);
}

export function assertTongRestrictedConfig(config) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return;
  const root = process.env.TONG_RESTRICTED_ROOT;
  if (!root || config.allowedRoots?.length !== 1 || !samePath(config.allowedRoots[0], root)
      || typeof config.agentDir !== "string" || !samePath(config.agentDir, root)
      || config.toolMode !== "minimal" || config.artifactsEnabled || config.skillsEnabled
      || config.subagents?.enabled || config.subagents?.providers?.some((provider) => provider.enabled)) {
    throw new Error("Restricted MCP configuration is not safe");
  }
}

export async function assertTongSafeFilePath(inputPath, context, operation) {
  if (process.env.TONG_RESTRICTED_MCP !== "1") return;
  if (typeof inputPath !== "string" || !inputPath || inputPath.includes("\0")) denied();
  // Device/UNC and drive-relative names have platform-specific resolution rules.
  if (/^[\\/]{2}/.test(inputPath) || (process.platform === "win32" && /^[A-Za-z]:[^\\/]/.test(inputPath))) denied();
  if (process.platform === "win32") {
    const withoutDrive = /^[A-Za-z]:[\\/]/.test(inputPath) ? inputPath.slice(2) : inputPath;
    if (withoutDrive.includes(":")) denied();
  }
  const root = await checkedRoot(context.root, ['write', 'edit', 'delete', 'move'].includes(operation) ? 'project.write' : 'project.read');
  const target = resolve(context.cwd, inputPath);
  if (operation === 'directory' && samePath(root, target)) return;
  if (!inside(root, target)) denied();
  const components = relative(root, target).split(/[\\/]/);
  let current = root;
  for (const [index, component] of components.entries()) {
    current = resolve(current, component);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" && operation === "write" && index === components.length - 1) return;
      denied();
    }
    if (details.isSymbolicLink()) denied();
    // A junction or other redirect can preserve a plausible lexical path.
    try {
      if (!samePath(await realpath(current), current)) denied();
    } catch {
      denied();
    }
    const last = index === components.length - 1;
    if (last && operation !== 'directory' ? !details.isFile() : !details.isDirectory()) denied();
    if (last && details.nlink > 1) denied();
  }
}

export async function loadTongWorkspaceContextFiles(root) {
  await checkedRoot(root);
  const files = [];
  for (const name of ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]) {
    const path = join(root, name);
    try {
      await assertTongSafeFilePath(path, { root, cwd: root }, "read");
      const content = await readFile(path, "utf8");
      await assertTongSafeFilePath(path, { root, cwd: root }, "read");
      files.push({ path, content });
    } catch (error) {
      if (error instanceof TongAccessDeniedError || error?.code === "ENOENT") continue;
      throw error;
    }
  }
  return files;
}
