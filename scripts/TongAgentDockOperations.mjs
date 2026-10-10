import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { checkedAgentDockPath, within } from "./TongAgentDockPaths.mjs";
import { dockError } from "./TongAgentDockClient.mjs";

const groups = new Map();
export function agentDockOperationGroup(policyPath) {
  const key = process.platform === "win32" ? resolve(policyPath).toLowerCase() : resolve(policyPath);
  if (!groups.has(key)) groups.set(key, { busy: new Set(), launching: 0, sessions: new Map() });
  return groups.get(key);
}
const hash = value => createHash("sha256").update(value).digest("hex");
// Atomic create-only reservation survives MCP reconnection and Tong restarts.
// Records contain digests and references, never arguments, content or output.
export async function reserveAgentDockOperation(policyPath, context, tool, input) {
  const root = join(dirname(resolve(policyPath)), "agentdock-operations");
  if (context.projects.some(project => project.root && within(resolve(project.root), root))) throw dockError("APPROVAL_DENIED");
  await checkedAgentDockPath(dirname(root), ".", { directory: true });
  try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw dockError("AUDIT_UNAVAILABLE"); }
  const checked = await checkedAgentDockPath(root, ".", { directory: true });
  const operationId = hash(input.idempotencyKey);
  let handle;
  try { handle = await open(join(root, operationId + ".json"), "wx", 0o600); }
  catch (error) { throw dockError(error.code === "EEXIST" ? "REPLAY_DENIED" : "AUDIT_UNAVAILABLE"); }
  try {
    await handle.writeFile(JSON.stringify({ operationId, fingerprint: hash(JSON.stringify({ tool, input })),
      projectId: input.projectId, taskId: input.taskId, approvalId: input.approvalId, reservedAt: new Date().toISOString() }) + "\n");
    await handle.sync(); await checked.recheck({ afterWrite: true });
  } catch { throw dockError("AUDIT_UNAVAILABLE"); } finally { await handle.close(); }
  return operationId;
}
