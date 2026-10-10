import { once } from "node:events";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
// Test-only process. Credentials arrive over parent IPC, never argv or logs.
const [settings] = await once(process, "message");
for (const key of Object.keys(process.env)) if (/^(TONG_|DEVSPACE_|AGENTDOCK_)/.test(key)) delete process.env[key];
Object.assign(process.env, { TONG_RESTRICTED_MCP: "1", TONG_RESTRICTED_ROOT: settings.demoRoot, TONG_LOCAL_STATE_DIR: settings.stateDir,
  TONG_AGENTDOCK_ENABLED: "1", TONG_AGENTDOCK_URL: "http://127.0.0.1:18765/mcp", TONG_AGENTDOCK_TOKEN: settings.agentdockToken,
  TONG_AGENTDOCK_POLICY_PATH: settings.policyPath, DEVSPACE_CONFIG_DIR: join(settings.stateDir, "config") });
await mkdir(process.env.DEVSPACE_CONFIG_DIR, { recursive: true });
const { createServer } = await import("../../node_modules/@waishnav/devspace/dist/server.js");
const { startMcpGateway } = await import("../../scripts/TongMcpGateway.mjs");
const instance = createServer({ host: "127.0.0.1", port: settings.upstreamPort, publicBaseUrl: `http://127.0.0.1:${settings.gatewayPort}`,
  oauth: { ownerToken: settings.ownerToken, accessTokenTtlSeconds: 3600, refreshTokenTtlSeconds: 7200, scopes: ["devspace"], allowedRedirectHosts: ["127.0.0.1"] },
  allowedHosts: ["127.0.0.1", "localhost"], allowedRoots: [settings.demoRoot], agentDir: settings.demoRoot,
  stateDir: join(settings.stateDir, "devspace"), worktreeRoot: join(settings.stateDir, "unused-worktrees"),
  toolMode: "minimal", widgets: "off", skillsEnabled: false, artifactsEnabled: false, subagents: { enabled: false, providers: [] }, logging: { level: "debug", format: "json" },
});
const upstream = instance.app.listen(settings.upstreamPort, "127.0.0.1"); await once(upstream, "listening");
const gateway = startMcpGateway({ listenPort: settings.gatewayPort, upstreamPort: settings.upstreamPort, workspaceRoot: settings.demoRoot }); await once(gateway, "listening");
process.send({ event: "ready", pid: process.pid, gatewayPort: gateway.address().port, upstreamPort: upstream.address().port });
let closing;
async function stop() {
  closing ??= (async () => {
    gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
    await instance.close(); // Patched DevSpace must await Tong-owned backend cleanup.
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    process.send({ event: "stopped" }); process.disconnect();
  })();
  await closing;
}
process.on("message", message => { if (message?.event === "stop") void stop().catch(() => { process.exitCode = 1; process.disconnect(); }); });
process.on("SIGTERM", () => { void stop(); });
