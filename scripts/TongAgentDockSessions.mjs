import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { dockError } from "./TongAgentDockClient.mjs";
import { TongAgentDockExecution, validateExecutionInput } from "./TongAgentDockExecution.mjs";

// Process-local only: a restart cannot resurrect backend IDs or task ownership.
// The SDK supplies authInfo from DevSpace's verified req.auth, never tool arguments.
const coordinators = new Map();
function principal(auth) {
  if (!auth || typeof auth.clientId !== "string" || !auth.clientId || auth.clientId.length > 256
      || /[\x00-\x1f]/.test(auth.clientId) || !Number.isFinite(auth.expiresAt) || auth.expiresAt <= Date.now() / 1000
      || !Array.isArray(auth.scopes) || !auth.scopes.length) throw dockError("AUTH_FAILED");
  let resource;
  try { resource = new URL(auth.resource); } catch { throw dockError("AUTH_FAILED"); }
  if (!["http:", "https:"].includes(resource.protocol) || resource.username || resource.password || resource.search || resource.hash) throw dockError("AUTH_FAILED");
  return createHash("sha256").update(JSON.stringify([auth.clientId, resource.href])).digest("hex");
}
class SessionCoordinator {
  #executions = new Map(); #clients = new Set(); #closing = false;
  async call(authInfo, options, tool, input, assertOpen, onDispatch) {
    if (this.#closing) throw dockError("CLOSED");
    validateExecutionInput(tool, input);
    const owner = principal(authInfo);
    const retiring = [];
    for (const [key, entry] of this.#executions) if (entry.execution.idle) {
      this.#executions.delete(key);
      retiring.push((async () => { await entry.execution.close(); await entry.client.close(); this.#clients.delete(entry.client); })());
    }
    await Promise.all(retiring);
    assertOpen();
    if (this.#closing) throw dockError("CLOSED");
    if (!this.#executions.has(owner)) {
      if (["session_status", "session_cancel"].includes(tool)) throw dockError("SESSION_DENIED");
      if (this.#executions.size >= 64) throw dockError("SESSION_DENIED");
      const client = options.client.createPeer();
      this.#executions.set(owner, { client, execution: new TongAgentDockExecution({ ...options, client, principal: owner }) });
      this.#clients.add(client);
    }
    onDispatch();
    return this.#executions.get(owner).execution.call(tool, input, () => {
      if (principal(authInfo) !== owner) throw dockError("AUTH_FAILED");
    });
  }
  owns(client) { return this.#clients.has(client); }
  async close() {
    this.#closing = true;
    await Promise.all([...this.#executions.values()].map(entry => entry.execution.close()));
    await Promise.all([...this.#clients].map(client => client.close()));
  }
}
export function agentDockSessionCoordinator(policyPath) {
  const key = process.platform === "win32" ? resolve(policyPath).toLowerCase() : resolve(policyPath);
  if (!coordinators.has(key)) coordinators.set(key, new SessionCoordinator());
  return coordinators.get(key);
}
export async function closeAgentDockSessionCoordinators() {
  await Promise.all([...coordinators.values()].map(coordinator => coordinator.close()));
}
