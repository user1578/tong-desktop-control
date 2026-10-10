import { readFile } from "node:fs/promises";
import { dirname, basename, resolve, isAbsolute } from "node:path";
import { AGENTDOCK_READ_TOOLS, dockError } from "./TongAgentDockClient.mjs";
import { checkedAgentDockPath, within } from "./TongAgentDockPaths.mjs";

// Local-only policy; there is deliberately no inbound grant mutation API.
export async function resolveAgentDockProject(access, policyPath, projectId) {
  let policy, projects;
  try {
    const checked = await checkedAgentDockPath(dirname(resolve(policyPath)), basename(policyPath));
    policy = JSON.parse(await readFile(checked.target, "utf8")); await checked.recheck();
    projects = await access.listProjects();
  } catch { throw dockError("PROJECT_DENIED"); }
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.projects) || policy.backendWorkspaceRoot !== undefined && (typeof policy.backendWorkspaceRoot !== "string" || !isAbsolute(policy.backendWorkspaceRoot))) throw dockError("PROJECT_DENIED");
  const candidates = projects.filter(entry => entry.id === projectId && entry.status === "enabled" && entry.available && ["read", "write"].includes(entry.permission));
  const grants = policy.projects.filter(entry => entry.projectId === projectId);
  const project = candidates[0], grant = grants[0];
  if (candidates.length !== 1 || grants.length !== 1 || grant.scope !== "synthetic" || grant.root !== project.root
      || !Array.isArray(grant.tools) || grant.tools.some(name => !AGENTDOCK_READ_TOOLS.includes(name))
      || projects.some(entry => entry.root && within(resolve(entry.root), resolve(policyPath)))) throw dockError("PROJECT_DENIED");
  return { project, grant, policy, projects };
}

export function operationApproval(context, input, capability, operation, paths) {
  if (!Array.isArray(context.policy.approvals)) throw dockError("APPROVAL_DENIED");
  const matches = context.policy.approvals.filter(entry => entry?.approvalId === input.approvalId);
  const approval = matches[0];
  if (matches.length !== 1 || !approval || approval.projectId !== input.projectId || approval.taskId !== input.taskId
      || approval.capability !== capability || !Array.isArray(approval.operations) || !approval.operations.includes(operation)
      || !Array.isArray(approval.paths) || !paths.every(path => approval.paths.includes(path))
      || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()
      || capability === "project.write" && context.project.permission !== "write") throw dockError("APPROVAL_DENIED");
  return approval;
}
