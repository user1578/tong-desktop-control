import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, open, opendir, readFile, realpath, rename, statfs } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = join(projectRoot, "runtime", "project-access.json");
const DEFAULT_DEMO = join(projectRoot, "demo-workspace");
const LEVELS = new Set(["metadata", "read", "write"]);
const STATUSES = new Set(["enabled", "disabled", "revoked"]);
const PROTECTED_PARTS = new Set([
  "windows", "program files", "program files (x86)", "programdata",
  "system volume information", "$recycle.bin", "appdata", ".ssh",
  ".aws", ".azure", ".gnupg", ".codex", ".devspace", ".git", ".hg", ".svn",
]);
const PROTECTED_FILES = /^(?:\.env(?:\..*)?|credentials(?:\..*)?|ntuser\..*|.*\.(?:pem|key|p12|pfx|kdbx))$/i;
const MAX_DEPTH = 3;
const MAX_RESULTS = 200;
const MAX_VISITED = 2_000;
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_RESULT_BYTES = 32 * 1024;

function denied() { throw new Error("Path not permitted"); }
function unavailable() { throw new Error("Path not available"); }
function same(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function within(root, path) {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}
function validateSyntax(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || /^[\\/]{2}/.test(path)) denied();
  if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(path)) denied();
  const parts = path.slice(parse(path).root.length).split(/[\\/]/);
  if (parts.some((part) => part === ".." || part.includes(":"))) denied();
  return resolve(path);
}
function protectedPath(path) {
  const parts = path.slice(parse(path).root.length).split(/[\\/]/).filter(Boolean);
  return parts.some((part) => PROTECTED_PARTS.has(part.toLowerCase()) || PROTECTED_FILES.test(part));
}
async function checkedDirectory(path) {
  const target = validateSyntax(path);
  if (protectedPath(target)) denied();
  const root = parse(target).root;
  let current = root;
  for (const part of relative(root, target).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); } catch { unavailable(); }
    if (!info.isDirectory() || info.isSymbolicLink()) denied();
    try { if (!same(await realpath(current), current)) denied(); } catch { denied(); }
  }
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) denied();
    if (!same(await realpath(target), target)) denied();
  } catch (error) {
    if (error?.message === "Path not permitted") throw error;
    unavailable();
  }
  return target;
}
function pathTag(path, depth) {
  return createHash("sha256").update(`${path}\0${depth}`).digest("hex").slice(0, 16);
}
function decodeCursor(cursor, path, depth) {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length > 256) throw new Error("Invalid cursor");
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded.v !== 1 || decoded.tag !== pathTag(path, depth)
        || !Number.isInteger(decoded.offset) || decoded.offset < 0 || decoded.offset > MAX_VISITED) throw new Error();
    return decoded.offset;
  } catch { throw new Error("Invalid cursor"); }
}
function encodeCursor(path, depth, offset) {
  return Buffer.from(JSON.stringify({ v: 1, tag: pathTag(path, depth), offset })).toString("base64url");
}
async function sortedEntries(directory, deadline, now) {
  const names = [];
  const handle = await opendir(directory);
  let truncated = false;
  try {
    for await (const entry of handle) {
      if (now() > deadline || names.length >= MAX_DIRECTORY_ENTRIES) { truncated = true; break; }
      names.push(entry.name);
    }
  } finally {
    try { await handle.close(); } catch { /* iterator may already close it */ }
  }
  names.sort((a, b) => a.localeCompare(b));
  return { names, truncated };
}
function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)
      || !/^[a-z][a-z0-9-]{1,39}$/.test(record.id ?? "")
      || typeof record.name !== "string" || record.name.length < 1 || record.name.length > 80
      || /[\x00-\x1f]/.test(record.name)
      || !LEVELS.has(record.permission) || !STATUSES.has(record.status)
      || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error("Invalid registry record");
  }
  try { validateSyntax(record.root); } catch { throw new Error("Invalid registry path"); }
}

export class TongProjectAccess {
  constructor({ registryPath = DEFAULT_REGISTRY, demoRoot = DEFAULT_DEMO,
    scanRoots = process.platform === "win32" ? ["C:\\", "D:\\"] : [],
    now = () => performance.now(), scanBudgetMs = 1_500 } = {}) {
    this.registryPath = registryPath;
    this.demoRoot = resolve(demoRoot);
    this.scanRoots = scanRoots.map(validateSyntax);
    this.now = now;
    this.scanBudgetMs = Math.min(Math.max(scanBudgetMs, 1), 1_500);
  }

  async readRegistry() {
    let document;
    try { document = JSON.parse(await readFile(this.registryPath, "utf8")); }
    catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, projects: [] };
      throw new Error("Invalid registry");
    }
    if (document?.schemaVersion !== 1 || !Array.isArray(document.projects)) throw new Error("Invalid registry");
    const ids = new Set(["demo"]);
    const roots = new Set([this.demoRoot.toLowerCase()]);
    for (const record of document.projects) {
      try { validateRecord(record); } catch { throw new Error("Invalid registry"); }
      const key = resolve(record.root).toLowerCase();
      if (ids.has(record.id) || (record.status !== "revoked" && roots.has(key))) throw new Error("Invalid registry");
      ids.add(record.id);
      if (record.status !== "revoked") roots.add(key);
    }
    return document;
  }

  async writeRegistry(document) {
    await mkdir(dirname(this.registryPath), { recursive: true });
    const temporary = `${this.registryPath}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    } finally { await handle.close(); }
    try { await rename(temporary, this.registryPath); }
    catch (error) { throw new Error(`Could not save registry: ${error.code ?? "unknown"}`); }
  }

  async listProjects() {
    const document = await this.readRegistry();
    const records = [{ id: "demo", name: "Demo workspace", root: this.demoRoot,
      permission: "write", status: "enabled", createdAt: null, updatedAt: null },
    ...document.projects.filter((item) => item.status !== "revoked")];
    return Promise.all(records.map(async (record) => {
      let available = false;
      try { await checkedDirectory(record.root); available = true; } catch { /* fail closed */ }
      return { ...record, available,
        effectiveCapabilities: record.status === "enabled" && available
          ? record.id === "demo"
            ? ["project.metadata", "project.read", "project.write"]
            : ["project.metadata"]
          : [],
      };
    }));
  }

  async authorize(capability, projectId) {
    if (capability === "disk.metadata") return true;
    if (capability === "agent.execute" || capability === "system.admin") return false;
    if (!["project.metadata", "project.read", "project.write"].includes(capability)) return false;
    const project = (await this.listProjects()).find((entry) => entry.id === projectId);
    return Boolean(project?.effectiveCapabilities.includes(capability));
  }

  async addProject({ id, name, root, permission }) {
    if (id === "demo") throw new Error("Duplicate project");
    const record = { id, name, root, permission, status: "enabled",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    validateRecord(record);
    const target = await checkedDirectory(root);
    if (within(target, projectRoot) || within(projectRoot, target)
        || within(target, this.demoRoot) || within(this.demoRoot, target)) denied();
    const document = await this.readRegistry();
    if (document.projects.some((item) => item.id === id || (item.status !== "revoked" && same(item.root, target)))) throw new Error("Duplicate project");
    record.root = target;
    document.projects.push(record);
    await this.writeRegistry(document);
    return record;
  }

  async changeStatus(id, status) {
    if (id === "demo") throw new Error("Default demo project cannot be changed");
    const document = await this.readRegistry();
    const record = document.projects.find((item) => item.id === id && item.status !== "revoked");
    if (!record) throw new Error("Project not found");
    record.status = status;
    record.updatedAt = new Date().toISOString();
    await this.writeRegistry(document);
  }
  async disableProject(id) { await this.changeStatus(id, "disabled"); }
  async revokeProject(id) { await this.changeStatus(id, "revoked"); }

  async listDrives() {
    if (!(await this.authorize("disk.metadata"))) denied();
    return Promise.all(this.scanRoots.map(async (drive) => {
      const result = { drive: drive.slice(0, 2).toUpperCase() };
      try {
        const stats = await statfs(drive, { bigint: true });
        const total = stats.blocks * stats.bsize;
        const free = stats.bavail * stats.bsize;
        return { ...result, status: "available", totalBytes: String(total),
          freeBytes: String(free), usedBytes: String(total - free) };
      } catch (error) {
        return { ...result, status: error?.code === "ENOENT" ? "missing" : "unavailable" };
      }
    }));
  }

  async scanDirectory({ path, maxDepth = 0, limit = 100, cursor } = {}) {
    if (!(await this.authorize("disk.metadata"))) denied();
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH) throw new Error("Invalid maxDepth");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) throw new Error("Invalid limit");
    const root = validateSyntax(path);
    if (!this.scanRoots.some((drive) => within(drive, root))) denied();
    await checkedDirectory(root);
    const offset = decodeCursor(cursor, root, maxDepth);
    const deadline = this.now() + this.scanBudgetMs;
    const all = [];
    const queue = [{ path: root, depth: 0 }];
    const possibleProjects = new Set();
    let truncated = false;
    let skipped = 0;
    while (queue.length && all.length < MAX_VISITED) {
      if (this.now() > deadline) { truncated = true; break; }
      const directory = queue.shift();
      let listing;
      try { listing = await sortedEntries(directory.path, deadline, this.now); }
      catch { skipped++; continue; }
      if (listing.truncated) truncated = true;
      for (const name of listing.names) {
        if (this.now() > deadline || all.length >= MAX_VISITED) { truncated = true; break; }
        const path = join(directory.path, name);
        if (path.length > 2_048) { skipped++; continue; }
        if ((name === "package.json" || name === ".git") && possibleProjects.size < 8
            && directory.path.length <= 1_024) possibleProjects.add(directory.path);
        if (protectedPath(path)) continue;
        let info;
        try {
          info = await lstat(path);
          if (info.isSymbolicLink() || !same(await realpath(path), path)) continue;
        } catch { skipped++; continue; }
        const type = info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
        all.push({ path, name, type, sizeBytes: info.isFile() ? info.size : null,
          modifiedAt: info.mtime.toISOString(), depth: directory.depth });
        if (type === "directory" && directory.depth < maxDepth) queue.push({ path, depth: directory.depth + 1 });
      }
    }
    if (queue.length || all.length >= MAX_VISITED) truncated = true;
    const entries = [];
    let bytes = 0;
    for (const entry of all.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (bytes + size > MAX_RESULT_BYTES) {
        if (entries.length === 0) throw new Error("Metadata entry too large");
        break;
      }
      entries.push(entry);
      bytes += size;
    }
    const nextOffset = offset + entries.length;
    const summary = { files: all.filter((entry) => entry.type === "file").length,
      directories: all.filter((entry) => entry.type === "directory").length,
      bytes: String(all.reduce((total, entry) => total + BigInt(entry.sizeBytes ?? 0), 0n)) };
    return { entries, nextCursor: nextOffset < all.length ? encodeCursor(root, maxDepth, nextOffset) : null,
      truncated, examined: all.length, skipped, maxDepth, summary, possibleProjects: [...possibleProjects] };
  }
}
