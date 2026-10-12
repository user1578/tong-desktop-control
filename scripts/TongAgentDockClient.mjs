import { isIP } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

export const AGENTDOCK_READ_TOOLS = Object.freeze(["list_dir", "read_file", "search_text"]);
export const AGENTDOCK_EXECUTION_TOOLS = Object.freeze(["file_edit", "exec_command", "session_observe", "session_act"]);
const MESSAGES = {
  INVALID_CONFIG: "AgentDock local configuration is invalid", AUTH_FAILED: "AgentDock authentication failed",
  UNAVAILABLE: "AgentDock is unavailable", TIMEOUT: "AgentDock request timed out", CLOSED: "AgentDock client is closed",
  REQUEST_TOO_LARGE: "AgentDock request exceeds its size limit", OUTPUT_TOO_LARGE: "AgentDock response exceeds its size limit",
  SCHEMA_ERROR: "AgentDock tool schema is invalid or incompatible", TOOL_DENIED: "AgentDock tool is not permitted",
  TOOL_FAILED: "AgentDock tool returned an error", SENSITIVE_RESULT: "AgentDock result contains a credential",
  PROJECT_DENIED: "Project is not authorized for AgentDock", ACCESS_DENIED: "AgentDock project path is not permitted",
  INVALID_ARGUMENT: "Invalid AgentDock tool arguments", INVALID_RESULT: "AgentDock result is invalid or outside the project",
  AUDIT_UNAVAILABLE: "AgentDock audit is unavailable",
  APPROVAL_DENIED: "Local operation approval is missing, expired or outside scope", SESSION_DENIED: "Session does not belong to this task",
  VERIFY_FAILED: "File content does not match the requested change", ALREADY_EXISTS: "File already exists; overwrite approval required",
  EXECUTABLE_DENIED: "Approved command executable is unavailable or changed",
  REPLAY_DENIED: "Operation key has already been reserved; reconcile before requesting a new operation",
};
export class TongAgentDockError extends Error {
  constructor(code) { super(MESSAGES[code] ?? MESSAGES.UNAVAILABLE); this.name = "TongAgentDockError"; this.code = code; }
}
export function dockError(code) { return new TongAgentDockError(code); }
function containsToken(value, token) {
  if (typeof value === "string") return value.includes(token);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key.includes(token) || containsToken(item, token));
}
function bound(value, fallback, minimum, maximum) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < minimum || n > maximum) throw dockError("INVALID_CONFIG");
  return n;
}
function localURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || !(host === "::1" || isIP(host) === 4 && host.startsWith("127."))) throw new Error();
    return url;
  } catch { throw dockError("INVALID_CONFIG"); }
}

/** SDK handles MCP framing and negotiation. This wrapper only applies local transport limits and policy. */
export class TongAgentDockClient {
  #requestTimeout = new AsyncLocalStorage();
  #url; #tokenProvider; #token; #client; #transport; #connecting; #closed = false; #validators = new Map(); #tools = []; #discoveredCount = 0;
  constructor({ url = "http://127.0.0.1:18765/mcp", tokenProvider = () => process.env.TONG_AGENTDOCK_TOKEN,
    timeoutMs, maxRequestBytes, maxResponseBytes, controlledExecution = false } = {}) {
    this.#url = localURL(url);
    if (typeof tokenProvider !== "function") throw dockError("INVALID_CONFIG");
    this.#tokenProvider = tokenProvider;
    this.timeoutMs = bound(timeoutMs, 5000, 50, 30000);
    this.maxRequestBytes = bound(maxRequestBytes, controlledExecution === true ? 131072 : 32768, 1024, 1048576);
    this.maxResponseBytes = bound(maxResponseBytes, 262144, 1024, 4194304);
    this.allowedTools = Object.freeze([...AGENTDOCK_READ_TOOLS, ...(controlledExecution === true ? AGENTDOCK_EXECUTION_TOOLS : [])]);
    this.generation = 0;
  }
  get serverInfo() { return this.#client?.getServerVersion(); }
  get discoveredToolCount() { return this.#discoveredCount; }
  get connected() { return !this.#closed && Boolean(this.#client?.transport); }
  createPeer() {
    if (this.#closed) throw dockError("CLOSED");
    return new TongAgentDockClient({ url: this.#url.href, tokenProvider: this.#tokenProvider, timeoutMs: this.timeoutMs,
      maxRequestBytes: this.maxRequestBytes, maxResponseBytes: this.maxResponseBytes,
      controlledExecution: this.allowedTools.includes("exec_command") });
  }
  async #fetch(input, init = {}) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const analyticsURL = new URL("/internal/runtime/analytics", this.#url);
    if (url.href !== this.#url.href && !(url.href === analyticsURL.href && init.method === "GET")) throw dockError("INVALID_CONFIG");
    if (typeof init.body === "string" && Buffer.byteLength(init.body) > this.maxRequestBytes) throw dockError("REQUEST_TOO_LARGE");
    const signal = AbortSignal.any([AbortSignal.timeout(this.#requestTimeout.getStore() ?? this.timeoutMs), ...(init.signal ? [init.signal] : [])]);
    let response;
    try { response = await fetch(input, { ...init, redirect: "error", signal }); }
    catch (error) { throw dockError(signal.aborted ? "TIMEOUT" : "UNAVAILABLE"); }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw dockError("AUTH_FAILED"); }
    const limit = url.href === analyticsURL.href ? 2097152 : this.maxResponseBytes;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel(); throw dockError("OUTPUT_TOO_LARGE");
    }
    if (!response.body) return response;
    let bytes = 0;
    const stream = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw dockError("OUTPUT_TOO_LARGE");
      controller.enqueue(chunk);
    } }));
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  #safeError(error) {
    if (error instanceof TongAgentDockError) return error;
    if (error?.code === -32001 || error?.name === "TimeoutError" || error?.name === "AbortError") return dockError("TIMEOUT");
    // Never forward SDK/HTTP exception bodies, request headers or nested causes.
    return dockError("UNAVAILABLE");
  }
  async connect() {
    if (this.#closed) throw dockError("CLOSED");
    if (this.#client) return;
    if (this.#connecting) return this.#connecting;
    this.#connecting = this.#open();
    try { await this.#connecting; } finally { this.#connecting = undefined; }
  }
  async #open() {
    let client, transport;
    try {
      const token = await this.#tokenProvider();
      if (typeof token !== "string" || token.length < 16 || token.length > 4096 || /[\x00-\x20\x7f]/.test(token)) throw dockError("INVALID_CONFIG");
      this.#token = token;
      client = new Client({ name: "tong-agentdock-client", version: "0.1.0" }, { capabilities: {} });
      transport = new StreamableHTTPClientTransport(this.#url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
        fetch: (input, init) => this.#fetch(input, init),
        reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 1000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      });
      await client.connect(transport, { timeout: this.timeoutMs });
      let descriptors;
      try { descriptors = await client.listTools({}, { timeout: this.timeoutMs }); }
      catch (error) { if (error instanceof TongAgentDockError) throw error; throw dockError("SCHEMA_ERROR"); }
      if (descriptors.nextCursor) throw dockError("SCHEMA_ERROR");
      if (containsToken({ descriptors, server: client.getServerVersion() }, token)) throw dockError("SENSITIVE_RESULT");
      const validator = new AjvJsonSchemaValidator();
      const validators = new Map();
      const tools = descriptors.tools.filter((tool) => this.allowedTools.includes(tool.name));
      for (const tool of tools) {
        if (tool.inputSchema?.type !== "object" || validators.has(tool.name)) throw dockError("SCHEMA_ERROR");
        try { validators.set(tool.name, validator.getValidator(tool.inputSchema)); }
        catch { throw dockError("SCHEMA_ERROR"); }
      }
      if (tools.length !== this.allowedTools.length) throw dockError("SCHEMA_ERROR");
      if (this.#closed) throw dockError("CLOSED");
      this.#client = client; this.#transport = transport; this.#tools = tools; this.#validators = validators;
      this.#discoveredCount = descriptors.tools.length;
      this.generation++;
    } catch (error) {
      await client?.close().catch(() => {}); await transport?.close().catch(() => {});
      this.#token = undefined;
      throw this.#safeError(error);
    }
  }
  async listTools() { await this.connect(); return structuredClone(this.#tools); }
  async backendInstance(generation = this.generation) {
    if (!this.connected || this.generation !== generation) throw dockError("SESSION_DENIED");
    try {
      const response = await this.#fetch(new URL("/internal/runtime/analytics", this.#url), { method: "GET", headers: { Authorization: `Bearer ${this.#token}` } });
      if (!response.ok) { await response.body?.cancel(); throw dockError("UNAVAILABLE"); }
      const data = await response.json();
      if (containsToken(data, this.#token)) throw dockError("SENSITIVE_RESULT");
      if (data?.ok !== true || data.source !== "agentdock-api" || typeof data.started_at !== "string" || !Number.isFinite(Date.parse(data.started_at))) throw dockError("INVALID_RESULT");
      if (!this.connected || this.generation !== generation) throw dockError("SESSION_DENIED");
      return data.started_at;
    } catch (error) {
      const safe = this.#safeError(error);
      if (["UNAVAILABLE", "TIMEOUT", "OUTPUT_TOO_LARGE"].includes(safe.code)) await this.#reset();
      throw safe;
    }
  }
  async callTool(name, args, { generation, timeoutMs = this.timeoutMs } = {}) {
    if (!this.allowedTools.includes(name)) throw dockError("TOOL_DENIED");
    if (Buffer.byteLength(JSON.stringify(args) ?? "") > this.maxRequestBytes) throw dockError("REQUEST_TOO_LARGE");
    if (generation !== undefined && (!this.connected || this.generation !== generation)) throw dockError("SESSION_DENIED");
    timeoutMs = bound(timeoutMs, this.timeoutMs, 50, 35000);
    await this.connect();
    if (generation !== undefined && this.generation !== generation) throw dockError("SESSION_DENIED");
    if (!this.#validators.get(name)?.(args).valid) throw dockError("SCHEMA_ERROR");
    const token = this.#token;
    try {
      const result = await this.#requestTimeout.run(timeoutMs, () => this.#client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }));
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded) > this.maxResponseBytes) throw dockError("OUTPUT_TOO_LARGE");
      if (containsToken(result, token)) throw dockError("SENSITIVE_RESULT");
      if (result.isError) throw dockError("TOOL_FAILED");
      return result;
    } catch (error) {
      const safe = this.#safeError(error);
      if (["UNAVAILABLE", "TIMEOUT", "OUTPUT_TOO_LARGE"].includes(safe.code)) await this.#reset();
      throw safe;
    }
  }
  async #reset() {
    const client = this.#client, transport = this.#transport;
    this.#client = undefined; this.#transport = undefined; this.#token = undefined; this.#validators.clear(); this.#tools = [];
    await client?.close().catch(() => {}); await transport?.close().catch(() => {});
  }
  async close() {
    this.#closed = true;
    await this.#connecting?.catch(() => {});
    await this.#reset();
  }
}
