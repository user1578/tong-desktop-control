import { createServer, request as httpRequest } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 7676;
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = 7677;
const MAX_JSON_REQUEST_BYTES = 100 * 1024;
const MAX_FILTERED_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..", "demo-workspace");
const ALLOWED_TOOLS = new Set(["open_workspace", "read", "write", "edit"]);
const MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePath(requestUrl) {
  try {
    return new URL(requestUrl, "http://gateway.local").pathname;
  } catch {
    return "/invalid-url";
  }
}

function safeProtocolVersion(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function sessionTag(value) {
  return typeof value === "string" && value.length > 0
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : undefined;
}

function mimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase() || undefined;
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

function emitDiagnostic(settings, context, event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: "info",
    event,
    ...(context
      ? {
          requestId: context.requestId,
          method: context.method,
          path: context.path,
          ...(context.mcpMethods ? { mcpMethods: context.mcpMethods } : {}),
          ...(context.protocolVersion ? { protocolVersion: context.protocolVersion } : {}),
          authHeaderPresent: context.authHeaderPresent,
          sessionIdPresent: context.sessionIdPresent,
          ...(context.sessionIdTag ? { sessionIdTag: context.sessionIdTag } : {}),
        }
      : {}),
    ...fields,
  };
  try {
    if (settings.logSink) settings.logSink(entry);
    else process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch {
    // Diagnostics must never affect proxy behavior.
  }
}

function createRequestContext(req, res, settings) {
  const requestUrl = typeof req.url === "string" ? req.url : "/";
  const inboundSessionTag = sessionTag(req.headers["mcp-session-id"]);
  const context = {
    requestId: randomUUID(),
    method: req.method,
    path: safePath(requestUrl),
    startedAt: performance.now(),
    authHeaderPresent: typeof req.headers.authorization === "string",
    sessionIdPresent: Boolean(inboundSessionTag),
    sessionIdTag: inboundSessionTag,
    protocolVersion: safeProtocolVersion(req.headers["mcp-protocol-version"]),
    mcpMethods: undefined,
    toolNames: undefined,
  };

  emitDiagnostic(settings, context, "request_start", {
    httpVersion: req.httpVersion,
    contentType: mimeType(req.headers["content-type"]),
    accept: String(req.headers.accept ?? "")
      .split(",")
      .map((value) => mimeType(value))
      .filter(Boolean),
    connection: req.headers.connection === "close" ? "close" : "keep-alive-or-unspecified",
  });
  req.once("aborted", () => emitDiagnostic(settings, context, "client_request_aborted"));
  res.once("finish", () => emitDiagnostic(settings, context, "request_finish", {
    status: res.statusCode,
    durationMs: Math.max(0, Math.round(performance.now() - context.startedAt)),
    complete: true,
    authOutcome: context.authOutcome ?? "unknown",
  }));
  res.once("close", () => {
    if (!res.writableFinished) {
      emitDiagnostic(settings, context, "client_response_closed_early", {
        status: res.statusCode,
        durationMs: Math.max(0, Math.round(performance.now() - context.startedAt)),
      });
    }
  });
  return context;
}

function recordMcpRequest(context, req, message, settings) {
  const requests = Array.isArray(message) ? message : [message];
  context.mcpMethods = requests.map((request) =>
    MCP_METHODS.has(request?.method) ? request.method : "other",
  );
  context.toolNames = requests
    .filter((request) => request?.method === "tools/call")
    .map((request) => ALLOWED_TOOLS.has(String(request?.params?.name ?? ""))
      ? String(request.params.name)
      : "restricted");
  const initialize = requests.find((request) => request?.method === "initialize");
  context.protocolVersion = safeProtocolVersion(initialize?.params?.protocolVersion)
    ?? safeProtocolVersion(req.headers["mcp-protocol-version"]);
  emitDiagnostic(settings, context, "mcp_request", {
    toolNames: context.toolNames,
    protocolVersion: context.protocolVersion,
  });
}

function logUpstreamStart(settings, context) {
  emitDiagnostic(settings, context, "upstream_start", {
    sessionIdForwarded: context.sessionIdPresent,
  });
}

function logUpstreamResponse(settings, context, upstreamResponse, startedAt) {
  const responseSessionTag = sessionTag(upstreamResponse.headers["mcp-session-id"]);
  const status = upstreamResponse.statusCode ?? 502;
  context.authOutcome = context.path !== "/mcp"
    ? "not_applicable"
    : status === 401
      ? "rejected"
      : status === 403
        ? "forbidden"
      : context.authHeaderPresent
        ? "accepted"
        : "no_authorization_header";
  emitDiagnostic(settings, context, "upstream_response", {
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    contentType: mimeType(upstreamResponse.headers["content-type"]),
    responseSessionIdPresent: Boolean(responseSessionTag),
    ...(responseSessionTag ? { responseSessionIdTag: responseSessionTag } : {}),
    sessionIdMatched: context.sessionIdPresent && responseSessionTag
      ? context.sessionIdTag === responseSessionTag
      : null,
    authOutcome: context.authOutcome,
  });
}

function summarizeMcpResponse(body, contentType, context) {
  if (!mimeType(contentType)?.includes("json")) return {};
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    const responses = Array.isArray(parsed) ? parsed : [parsed];
    const errors = responses.filter((response) => isObject(response?.error));
    const toolLists = responses.filter((response) => Array.isArray(response?.result?.tools));
    const initialize = responses.find((response) => isObject(response?.result?.serverInfo));
    return {
      ...(errors.length
        ? {
            jsonRpcError: true,
            jsonRpcErrorCodes: errors
              .map((response) => response.error.code)
              .filter((code) => Number.isInteger(code)),
          }
        : { jsonRpcError: false }),
      ...(toolLists.length
        ? { toolsCount: toolLists.reduce((count, response) => count + response.result.tools.length, 0) }
        : {}),
      ...(initialize
        ? { negotiatedProtocolVersion: safeProtocolVersion(initialize.result.protocolVersion) }
        : {}),
      ...(context?.mcpMethods?.includes("tools/call")
        ? {
            toolCallOutcome: responses.some((response) => response?.result?.isError === true)
              ? "tool_error"
              : errors.length
                ? "rpc_error"
                : "success",
          }
        : {}),
    };
  } catch {
    return {};
  }
}

export function filterAllowedTools(message) {
  if (Array.isArray(message)) return message.map(filterAllowedTools);
  if (!isObject(message)) return message;
  if (isObject(message.result) && Array.isArray(message.result.tools)) {
    return {
      ...message,
      result: {
        ...message.result,
        tools: message.result.tools.filter((tool) => ALLOWED_TOOLS.has(String(tool?.name ?? ""))),
      },
    };
  }
  return message;
}

export function findDisallowedToolCall(message) {
  const requests = Array.isArray(message) ? message : [message];
  return requests.find(
    (request) =>
      isObject(request) &&
      request.method === "tools/call" &&
      isObject(request.params) &&
      !ALLOWED_TOOLS.has(String(request.params.name ?? "")),
  );
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function validateWorkspaceFilePath(inputPath, workspaceRoot = WORKSPACE_ROOT) {
  if (
    typeof inputPath !== "string" ||
    inputPath.length === 0 ||
    inputPath.includes("\0") ||
    isAbsolute(inputPath) ||
    (process.platform === "win32" && inputPath.includes(":"))
  ) {
    return false;
  }

  let canonicalRoot;
  try {
    canonicalRoot = await realpath(workspaceRoot);
  } catch {
    return false;
  }
  if (!samePath(canonicalRoot, workspaceRoot)) return false;

  const target = resolve(canonicalRoot, inputPath);
  const relativeTarget = relative(canonicalRoot, target);
  if (
    relativeTarget === "" ||
    isAbsolute(relativeTarget) ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    return false;
  }

  let current = canonicalRoot;
  for (const segment of relativeTarget.split(/[\\/]/)) {
    current = resolve(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) return false;
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return true;
      return false;
    }
  }
  return true;
}

export async function validateAllowedToolCall(request, workspaceRoot = WORKSPACE_ROOT) {
  const name = String(request?.params?.name ?? "");
  if (!ALLOWED_TOOLS.has(name)) {
    return { code: -32602, message: `Tool not found: ${name || "unknown"}` };
  }

  const args = request?.params?.arguments;
  if (!isObject(args)) return { code: -32602, message: "Invalid tool arguments" };

  if (name === "open_workspace") {
    const path = args.path;
    const mode = args.mode;
    if (
      typeof path !== "string" ||
      !samePath(path, workspaceRoot) ||
      (mode !== undefined && mode !== "checkout")
    ) {
      return { code: -32602, message: "Only the demo workspace checkout is available" };
    }
    return null;
  }

  if (typeof args.workspaceId !== "string" || args.workspaceId.length === 0) {
    return { code: -32602, message: "Invalid workspaceId" };
  }
  if (!(await validateWorkspaceFilePath(args.path, workspaceRoot))) {
    return { code: -32602, message: "File path must stay inside the demo workspace and avoid links" };
  }
  return null;
}

function transformSseToolList(body) {
  const trailingNewlines = body.match(/\n*$/)?.[0] ?? "";
  const events = body.replace(/\n+$/, "").split(/\r?\n\r?\n/);
  const filtered = events.map((event) => {
    if (!event) return event;
    const lines = event.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return event;
    try {
      const parsed = JSON.parse(dataLines.join("\n"));
      const resultLines = JSON.stringify(filterAllowedTools(parsed));
      const metadata = lines.filter((line) => !line.startsWith("data:"));
      return [...metadata, `data: ${resultLines}`].join("\n");
    } catch {
      return event;
    }
  });
  return filtered.join("\n\n") + trailingNewlines;
}

export function filterToolListResponse(body, contentType) {
  if (contentType.includes("text/event-stream")) {
    return Buffer.from(transformSseToolList(body.toString("utf8")), "utf8");
  }
  if (!contentType.includes("application/json")) return body;
  try {
    return Buffer.from(JSON.stringify(filterAllowedTools(JSON.parse(body.toString("utf8")))), "utf8");
  } catch {
    return body;
  }
}

function filteredHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  return result;
}

function sendBufferedResponse(res, upstreamResponse, body, transform = false, context, settings, startedAt) {
  let responseBody = body;
  const headers = filteredHeaders(upstreamResponse.headers);
  if (transform && upstreamResponse.statusCode >= 200 && upstreamResponse.statusCode < 300) {
    const contentType = String(upstreamResponse.headers["content-type"] ?? "").toLowerCase();
    responseBody = filterToolListResponse(body, contentType);
    delete headers["content-encoding"];
  }
  delete headers["content-length"];
  if (context && settings) {
    emitDiagnostic(settings, context, "upstream_body_complete", {
      status: upstreamResponse.statusCode ?? 502,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...summarizeMcpResponse(responseBody, headers["content-type"], context),
    });
  }
  res.writeHead(upstreamResponse.statusCode ?? 502, {
    ...headers,
    "content-length": responseBody.length,
  });
  res.end(responseBody);
}

function collectResponse(upstreamResponse, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    upstreamResponse.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        upstreamResponse.destroy(new Error("filtered MCP response exceeded its size limit"));
        reject(new Error("filtered MCP response exceeded its size limit"));
        return;
      }
      chunks.push(chunk);
    });
    upstreamResponse.on("end", () => resolve(Buffer.concat(chunks, length)));
    upstreamResponse.on("error", reject);
  });
}

function sendJsonRpcError(res, request, code, message) {
  const response = {
    jsonrpc: "2.0",
    id: request?.id ?? null,
    error: { code, message },
  };
  const body = Buffer.from(JSON.stringify(response), "utf8");
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (tooLarge) return;
      length += chunk.length;
      if (length > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        fail(Object.assign(new Error("request body too large"), {
          statusCode: 413,
          failureType: "too_large",
          receivedBytes: length,
        }));
      } else {
        settled = true;
        resolve(Buffer.concat(chunks, length));
      }
    });
    req.on("error", (error) => fail(Object.assign(new Error("request stream error"), {
      statusCode: 400,
      failureType: "stream_error",
      errorCode: safeErrorCode(error),
      receivedBytes: length,
    })));
    req.on("aborted", () => fail(Object.assign(new Error("request aborted"), {
      statusCode: 400,
      failureType: "aborted",
      receivedBytes: length,
    })));
  });
}

function upstreamOptions(req, body, upstreamPort) {
  const headers = filteredHeaders(req.headers);
  // DevSpace keeps Express trust proxy disabled, so do not forward ngrok's client IP header.
  delete headers["x-forwarded-for"];
  headers.host = req.headers.host;
  headers.connection = "close";
  if (body !== undefined) {
    headers["content-length"] = body.length;
    delete headers["transfer-encoding"];
    headers["accept-encoding"] = "identity";
  }
  return {
    hostname: UPSTREAM_HOST,
    port: upstreamPort,
    method: req.method,
    path: req.url,
    headers,
  };
}

function proxyStreaming(req, res, upstreamPort, context, settings) {
  const startedAt = performance.now();
  logUpstreamStart(settings, context);
  const upstream = httpRequest(upstreamOptions(req, undefined, upstreamPort), (upstreamResponse) => {
    logUpstreamResponse(settings, context, upstreamResponse, startedAt);
    upstreamResponse.once("end", () => emitDiagnostic(settings, context, "upstream_body_complete", {
      status: upstreamResponse.statusCode ?? 502,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    }));
    upstreamResponse.once("aborted", () => emitDiagnostic(settings, context, "upstream_response_aborted", {
      status: upstreamResponse.statusCode ?? 502,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    }));
    upstreamResponse.once("close", () => {
      if (!upstreamResponse.complete) {
        emitDiagnostic(settings, context, "upstream_response_closed_early", {
          status: upstreamResponse.statusCode ?? 502,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
      }
    });
    res.writeHead(upstreamResponse.statusCode ?? 502, filteredHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(res);
  });
  upstream.once("finish", () => emitDiagnostic(settings, context, "upstream_request_sent"));
  upstream.on("error", (error) => {
    emitDiagnostic(settings, context, error?.code === "ETIMEDOUT" ? "upstream_timeout" : "upstream_error", {
      errorCode: safeErrorCode(error),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("MCP upstream unavailable");
  });
  req.pipe(upstream);
}

async function proxyBuffered(req, body, res, upstreamPort, filterToolList, context, settings) {
  const startedAt = performance.now();
  logUpstreamStart(settings, context);
  const upstream = httpRequest(upstreamOptions(req, body, upstreamPort), (upstreamResponse) => {
    logUpstreamResponse(settings, context, upstreamResponse, startedAt);
    collectResponse(upstreamResponse, MAX_FILTERED_RESPONSE_BYTES)
      .then((responseBody) => sendBufferedResponse(
        res,
        upstreamResponse,
        responseBody,
        filterToolList,
        context,
        settings,
        startedAt,
      ))
      .catch((error) => {
        emitDiagnostic(settings, context, error?.code === "ETIMEDOUT" ? "upstream_timeout" : "upstream_response_error", {
          errorCode: safeErrorCode(error),
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("MCP upstream response unavailable");
      });
  });
  upstream.once("finish", () => emitDiagnostic(settings, context, "upstream_request_sent"));
  upstream.on("error", (error) => {
    emitDiagnostic(settings, context, error?.code === "ETIMEDOUT" ? "upstream_timeout" : "upstream_error", {
      errorCode: safeErrorCode(error),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("MCP upstream unavailable");
  });
  upstream.end(body);
}

async function authorizeDeniedCall(req, probeBody, deniedCall, denial, res, upstreamPort, context, settings) {
  const startedAt = performance.now();
  logUpstreamStart(settings, context);
  const upstream = httpRequest(upstreamOptions(req, probeBody, upstreamPort), (upstreamResponse) => {
    logUpstreamResponse(settings, context, upstreamResponse, startedAt);
    collectResponse(upstreamResponse, MAX_FILTERED_RESPONSE_BYTES)
      .then((responseBody) => {
        if (upstreamResponse.statusCode === 401 || upstreamResponse.statusCode === 403) {
          sendBufferedResponse(res, upstreamResponse, responseBody, false, context, settings, startedAt);
        } else {
          emitDiagnostic(settings, context, "gateway_policy_reject", {
            jsonRpcErrorCode: denial.code,
            upstreamAuthenticated: true,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          });
          sendJsonRpcError(res, deniedCall, denial.code, denial.message);
        }
      })
      .catch((error) => {
        emitDiagnostic(settings, context, "upstream_response_error", {
          errorCode: safeErrorCode(error),
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("MCP upstream response unavailable");
      });
  });
  upstream.once("finish", () => emitDiagnostic(settings, context, "upstream_request_sent"));
  upstream.on("error", (error) => {
    emitDiagnostic(settings, context, error?.code === "ETIMEDOUT" ? "upstream_timeout" : "upstream_error", {
      errorCode: safeErrorCode(error),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("MCP upstream unavailable");
  });
  upstream.end(probeBody);
}

function isMcpPost(req) {
  if (req.method !== "POST") return false;
  return new URL(req.url, "http://gateway.local").pathname === "/mcp";
}

async function handleRequest(req, res, settings, context) {
  if (!isMcpPost(req)) {
    proxyStreaming(req, res, settings.upstreamPort, context, settings);
    return;
  }

  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    emitDiagnostic(settings, context, "request_reject", {
      status: 415,
      reason: "unsupported_content_type",
    });
    res.writeHead(415, { "content-type": "text/plain" });
    res.end("MCP POST requests must use application/json");
    return;
  }

  let rawBody;
  try {
    // The upstream Express JSON parser uses its 100 KiB default body limit too.
    rawBody = await readRequestBody(req, MAX_JSON_REQUEST_BYTES);
  } catch (error) {
    const status = error?.statusCode ?? 400;
    emitDiagnostic(settings, context, "request_body_error", {
      status,
      reason: error?.failureType ?? "read_failed",
      ...(Number.isSafeInteger(error?.receivedBytes) ? { bodyBytes: error.receivedBytes } : {}),
      ...(error?.errorCode ? { errorCode: error.errorCode } : {}),
    });
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(status === 413 ? "MCP request body too large" : "MCP request body invalid");
    }
    return;
  }
  emitDiagnostic(settings, context, "request_body_complete", { bodyBytes: rawBody.length });

  let message;
  try {
    message = JSON.parse(rawBody.toString("utf8"));
  } catch {
    emitDiagnostic(settings, context, "request_parse_error", {
      status: 400,
      bodyBytes: rawBody.length,
    });
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("MCP request body invalid");
    return;
  }

  recordMcpRequest(context, req, message, settings);

  const requests = Array.isArray(message) ? message : [message];
  for (const request of requests) {
    if (request?.method !== "tools/call") continue;
    const denial = await validateAllowedToolCall(request, settings.workspaceRoot);
    if (denial) {
      // Authenticate a harmless tools/list probe; never forward a denied call.
      const probe = Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id ?? null,
        method: "tools/list",
        params: {},
      }), "utf8");
      await authorizeDeniedCall(req, probe, request, denial, res, settings.upstreamPort, context, settings);
      return;
    }
  }

  const isToolList = (Array.isArray(message) ? message : [message]).some(
    (item) => item?.method === "tools/list",
  );
  if (isToolList) {
    await proxyBuffered(req, rawBody, res, settings.upstreamPort, true, context, settings);
    return;
  }
  proxyBuffered(req, rawBody, res, settings.upstreamPort, false, context, settings);
}

export function startMcpGateway(options = {}) {
  const settings = {
    listenPort: options.listenPort ?? LISTEN_PORT,
    upstreamPort: options.upstreamPort ?? UPSTREAM_PORT,
    workspaceRoot: options.workspaceRoot ?? WORKSPACE_ROOT,
    logSink: typeof options.logSink === "function" ? options.logSink : undefined,
  };
  const server = createServer((req, res) => {
    const context = createRequestContext(req, res, settings);
    handleRequest(req, res, settings, context).catch((error) => {
      emitDiagnostic(settings, context, "gateway_error", {
        errorCode: safeErrorCode(error),
      });
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("MCP gateway error");
    });
  });
  server.on("clientError", (error, socket) => {
    emitDiagnostic(settings, null, "http_client_error", {
      requestId: randomUUID(),
      phase: "http_parser",
      errorCode: safeErrorCode(error),
      ...(Number.isSafeInteger(error?.bytesParsed) ? { bytesParsed: error.bytesParsed } : {}),
    });
    if (socket.writable && !socket.destroyed) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });
  server.listen(settings.listenPort, LISTEN_HOST, () => {
    process.stdout.write(`Tong MCP gateway listening on http://${LISTEN_HOST}:${settings.listenPort}; upstream ${UPSTREAM_HOST}:${settings.upstreamPort}\n`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpGateway();
}
