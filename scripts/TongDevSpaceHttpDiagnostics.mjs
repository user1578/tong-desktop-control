import { createHash } from "node:crypto";
import { Server } from "node:http";
import { performance } from "node:perf_hooks";

const originalEmit = Server.prototype.emit;
const sockets = new WeakMap();
let nextSocketId = 0;
let nextRequestId = 0;

function log(event, fields) {
  try {
    process.stdout.write(`${JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event,
      ...fields,
    })}\n`);
  } catch {
    // Diagnostics must not change HTTP behavior.
  }
}

function tag(value) {
  return typeof value === "string" && value.length > 0
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : undefined;
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

function socketInfo(socket) {
  let info = sockets.get(socket);
  if (info) return info;
  info = {
    socketId: `${process.pid}-${++nextSocketId}`,
    connectedAt: performance.now(),
    lastRequestId: null,
  };
  sockets.set(socket, info);
  socket.once("close", (hadError) => log("devspace_http_socket_close", {
    socketId: info.socketId,
    lastRequestId: info.lastRequestId,
    hadError,
    lifetimeMs: Math.max(0, Math.round(performance.now() - info.connectedAt)),
  }));
  return info;
}

// Observe HTTP events without adding a clientError listener: Node retains its
// default 400/431 response behavior while exposing parser error codes.
function observeHttpEvent(event, args) {
  if (event === "connection") {
    const socket = args[0];
    const info = socketInfo(socket);
    log("devspace_http_socket_open", {
      socketId: info.socketId,
      remotePort: socket.remotePort ?? null,
    });
  } else if (event === "request") {
    const [req, res] = args;
    const info = socketInfo(req.socket);
    const requestId = `${process.pid}-r${++nextRequestId}`;
    info.lastRequestId = requestId;
    const startedAt = performance.now();
    const path = new URL(req.url, "http://local.invalid").pathname;
    if (path === "/mcp") {
      const sessionIdTag = tag(req.headers["mcp-session-id"]);
      log("devspace_http_request_start", {
        requestId,
        socketId: info.socketId,
        method: req.method,
        path,
        httpVersion: req.httpVersion,
        sessionIdPresent: Boolean(sessionIdTag),
        ...(sessionIdTag ? { sessionIdTag } : {}),
        contentLength: /^\d+$/.test(String(req.headers["content-length"] ?? ""))
          ? Number(req.headers["content-length"])
          : null,
        transferEncodingPresent: Boolean(req.headers["transfer-encoding"]),
        connectionClose: req.headers.connection === "close",
      });
      req.once("aborted", () => log("devspace_http_request_aborted", { requestId, socketId: info.socketId }));
      res.once("finish", () => {
        const responseSessionIdTag = tag(res.getHeader("mcp-session-id"));
        log("devspace_http_request_finish", {
          requestId,
          socketId: info.socketId,
          status: res.statusCode,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...(responseSessionIdTag ? { responseSessionIdTag } : {}),
        });
      });
      res.once("close", () => {
        if (!res.writableFinished) log("devspace_http_response_closed_early", {
          requestId,
          socketId: info.socketId,
          status: res.statusCode,
        });
      });
    }
  } else if (event === "clientError") {
    const [error, socket] = args;
    const info = socketInfo(socket);
    log("devspace_http_client_error", {
      socketId: info.socketId,
      lastRequestId: info.lastRequestId,
      errorCode: safeErrorCode(error),
      bytesParsed: Number.isSafeInteger(error?.bytesParsed) ? error.bytesParsed : null,
      rawPacketBytes: Buffer.isBuffer(error?.rawPacket) ? error.rawPacket.length : null,
    });
  }
}

Server.prototype.emit = function emitWithDiagnostics(event, ...args) {
  try {
    observeHttpEvent(event, args);
  } catch {
    // Preserve the server's original event handling if observation fails.
  }
  return originalEmit.call(this, event, ...args);
};
