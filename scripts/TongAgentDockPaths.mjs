import { lstat, opendir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { dockError } from "./TongAgentDockClient.mjs";

const protectedNames = /^(?:\..*|node_modules|windows|program files(?: \(x86\))?|programdata|appdata|credentials(?:\..*)?|ntuser\..*|.*\.(?:pem|key|p12|pfx|kdbx))$/i;
export const AGENTDOCK_EXCLUDES = ["**/.*", "**/.*/**", "**/node_modules/**", "**/credentials*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.kdbx"];
function same(a, b) { return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
export function within(root, path) {
  const part = relative(root, path);
  return part === "" || !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
function denied() { throw dockError("ACCESS_DENIED"); }
function syntax(input) {
  if (typeof input !== "string" || !input || input.length > 4096 || /[\x00-\x1f]/.test(input)
      || /^[\\/]{2}/.test(input) || /^[A-Za-z]:[^\\/]/.test(input)) denied();
  const body = /^[A-Za-z]:[\\/]/.test(input) ? input.slice(2) : input;
  if (body.includes(":")) denied();
  for (const part of body.split(/[\\/]/)) {
    if (part === ".." || /[. ]$/.test(part) && part !== "." || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)) denied();
  }
}
// Node identifies symlinks/junctions, but not every Windows reparse tag. Read the raw attribute too.
// The constant PowerShell program only inspects metadata; paths are JSON on stdin, never shell source.
async function noWindowsReparse(paths) {
  if (process.platform !== "win32") return;
  const script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($item in $paths){if(([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 2}}";
  await new Promise((accept, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => { child.kill(); reject(dockError("ACCESS_DENIED")); }, 5000);
    child.on("error", () => { clearTimeout(timer); reject(dockError("ACCESS_DENIED")); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? accept() : reject(dockError("ACCESS_DENIED")); });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(paths));
  });
}
async function inspect(path, metadataPaths) {
  let info;
  try {
    info = await lstat(path);
    if (info.isSymbolicLink() || !same(await realpath(path), path) || !(info.isDirectory() || info.isFile())
        || info.isFile() && info.nlink > 1) denied();
  } catch { denied(); }
  metadataPaths.add(path);
  return info;
}
export async function checkedAgentDockPath(root, input = ".", { directory = false, treeDepth = 0, maxEntries = 2000, requireFullTree = false, allowMissing = false, gitMetadata = false, skipGit = false } = {}) {
  syntax(root); syntax(input);
  if (!isAbsolute(root)) denied();
  const canonicalRoot = resolve(root);
  const target = resolve(canonicalRoot, input);
  if (!within(canonicalRoot, target)) denied();
  const parts = relative(canonicalRoot, target).split(/[\\/]/).filter(Boolean);
  if (parts.some((part, index) => protectedNames.test(part) && !(gitMetadata && index === 0 && part === ".git"))) denied();
  const metadataPaths = new Set();
  let current = parse(canonicalRoot).root;
  for (const part of relative(current, canonicalRoot).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (!(await inspect(current, metadataPaths)).isDirectory()) denied();
  }
  let info = await inspect(canonicalRoot, metadataPaths);
  current = canonicalRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    if (allowMissing && index === parts.length - 1) {
      try { await lstat(current); } catch (error) { if (error.code === "ENOENT") { info = undefined; break; } denied(); }
    }
    info = await inspect(current, metadataPaths);
    if (index < parts.length - 1 && !info.isDirectory()) denied();
  }
  if (info ? directory ? !info.isDirectory() : !info.isFile() : !allowMissing || directory) denied();
  const manifest = new Map(info ? [[target, info.isDirectory() ? "directory" : "file"]] : []);
  const identities = new Map();
  let visited = 0;
  async function walk(path, depth) {
    const handle = await opendir(path);
    try {
      for await (const entry of handle) {
        if (++visited > maxEntries) denied();
        if (skipGit && path === canonicalRoot && entry.name === ".git") continue; // Caller checks standalone Git metadata separately.
        if (protectedNames.test(entry.name) && !gitMetadata) {
          if (requireFullTree) denied();
          continue;
        }
        const child = join(path, entry.name);
        const details = await inspect(child, metadataPaths);
        manifest.set(child, details.isDirectory() ? "directory" : "file");
        if (details.isDirectory()) {
          if (depth < treeDepth) await walk(child, depth + 1);
          else if (requireFullTree) denied();
        }
      }
    } catch { denied(); }
    finally { await handle.close().catch(() => {}); }
  }
  if (directory && treeDepth > 0) await walk(target, 1);
  await noWindowsReparse([...metadataPaths]);
  for (const path of metadataPaths) {
    const stat = await lstat(path);
    identities.set(path, `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.mtimeMs}:${stat.size}`);
  }
  return {
    root: canonicalRoot, target, manifest, existed: !!info,
    relative: (path) => relative(canonicalRoot, path).split(sep).join("/") || ".",
    async recheck({ afterWrite = false, ignoreDirectoryTimes = false } = {}) {
      for (const [path, identity] of identities) {
        const stat = await inspect(path, new Set());
        if (afterWrite && path === target && !directory) continue; // AgentDock commits edits by atomic replacement; validate new file separately.
        const observed = `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.mtimeMs}:${stat.size}`;
        // Creating a sibling journal changes directory times, not executable identity.
        const structural = afterWrite || !within(canonicalRoot, path) || ignoreDirectoryTimes && stat.isDirectory();
        if ((structural ? observed.split(":").slice(0, 4).join(":") : observed) !== (structural ? identity.split(":").slice(0, 4).join(":") : identity)) denied();
      }
      await noWindowsReparse([...metadataPaths]);
      if (!info && !afterWrite) { try { await lstat(target); denied(); } catch (error) { if (error.code !== "ENOENT") denied(); } }
    },
    resultPath(value, base = info?.isDirectory() ? target : dirname(target)) {
      try { syntax(value); } catch { throw dockError("INVALID_RESULT"); }
      const path = resolve(base, value);
      if (!within(canonicalRoot, path) || !manifest.has(path)) throw dockError("INVALID_RESULT");
      return path;
    },
  };
}
