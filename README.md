# Tong Desktop Control

Local DevSpace MCP for ChatGPT, exposed through the existing ngrok domain via a loopback-only restricted gateway.

## Connection

- Local MCP gateway: `http://127.0.0.1:7676/mcp`
- DevSpace upstream (loopback only): `http://127.0.0.1:7677/mcp`
- Public MCP: `https://your-ngrok-domain.ngrok-free.dev/mcp`
- Public tool allowlist: `open_workspace`, `read`, `write`, `edit`
- Workspace allowed by DevSpace file tools: `demo-workspace`
- DevSpace user config: `%USERPROFILE%\.devspace\config.json`
- Owner Password file: `%USERPROFILE%\.devspace\auth.json` (keep private; never paste it into chat)

## Start, status, stop

Run these commands from the project directory:

```powershell
& '.\scripts\Start-TongDesktopControl.ps1'
& '.\scripts\Get-TongDesktopControlStatus.ps1'
& '.\scripts\Stop-TongDesktopControl.ps1'
```

Restart both processes:

```powershell
& '.\scripts\Restart-TongDesktopControl.ps1'
```

The scripts start hidden DevSpace, gateway, and ngrok processes; keep PID records under `runtime\`; and write logs under `logs\`. ngrok forwards to the gateway on port 7676. DevSpace listens on loopback port 7677. Stop only targets processes whose PID and command match those records. If another process owns either port, startup reports it and leaves it alone.

The gateway stdout log contains redacted JSON request traces. Correlate `requestId` across `request_start`, `mcp_request`, `upstream_*`, and `request_finish`; pair the upstream interval with DevSpace's request log by UTC time, method, path, and status. `http_client_error` records HTTP parser rejects that never reach the gateway request handler. Gateway traces omit authorization values, cookies, request/response bodies, tool arguments, and raw MCP session IDs; session IDs appear only as short hashes in those traces.

When the shell inherits HTTP proxy variables, the launcher clears them only in the ngrok child process because this ngrok free endpoint rejects proxy connections. The parent environment and ngrok config remain unchanged.

## Change the public domain

Edit only `config\tong.config.json` and change `publicOrigin` to the new HTTPS origin (no path and no `/mcp`). Then run `Start-TongDesktopControl.ps1`; it synchronizes DevSpace's public origin and restarts the processes this project owns. The ngrok executable path and existing ngrok config path are in that same file. The project never edits the existing ngrok config.

## Validate

```powershell
& '.\tests\Test-TongConfiguration.ps1'
& '.\tests\Test-TongPortListenerArray.ps1'
pwsh -NoProfile -ExecutionPolicy Bypass -File '.\tests\Test-TongEndpoints.ps1'
node '.\tests\Test-TongMcpGateway.mjs'
node '.\tests\Test-TongToolBoundaries.mjs'
& '.\node_modules\.bin\devspace.cmd' doctor
& '<path-to-ngrok.exe>' config check --config "$env:LOCALAPPDATA\ngrok\ngrok.yml"
```

The doctor checks the installed Node, Git, Git Bash, SQLite binding, configured URLs, roots, and allowed hosts. The gateway test confirms that only the four listed file/workspace tools are exposed, workspace opening is pinned to `demo-workspace`, and file paths through traversal or a junction are rejected. The endpoint test uses PowerShell 7 because Windows PowerShell 5.1 reports inconsistent public 401 status codes through its legacy `HttpClient`.

## Connect ChatGPT

The existing ChatGPT MCP connection and OAuth authorization are preserved. Open the existing **Tong Desktop Control** connection in ChatGPT web and refresh or reconnect it so ChatGPT reloads the tool list. Do not create a duplicate connection. The public list should contain only `open_workspace`, `read`, `write`, and `edit`; Bash and other tools are intentionally unavailable through this endpoint.

After reconnecting, use `demo-workspace` to open the workspace. Ask ChatGPT to read this README, create and edit a synthetic `mcp-smoke.txt`, and read it back. Bash is not part of the public tool surface.

## Security status (2026-10-09)

The project remains on DevSpace `1.0.8`. Its user configuration allows only `demo-workspace`, OAuth remains enabled, Host filtering remains enabled, and the service binds to `127.0.0.1`. ngrok still forwards HTTPS to the local MCP endpoint. Subagents, desktop control, and SSH remain disabled.

### npm audit

The installed tree reports 7 vulnerable package entries: 5 high and 2 moderate. `npm audit fix` made no changes. The Pi coding-agent package includes its own `npm-shrinkwrap.json`; DevSpace 1.0.8 also pins `protobufjs` to `7.6.4` and `undici` to `8.5.0`. Although patched releases exist for `brace-expansion` and `protobufjs`, npm cannot apply them through the current shrinkwrap and DevSpace pin without changing that dependency chain. No `--force` update or DevSpace upgrade was applied. The dependency tree remains unchanged; the gateway reduces which public MCP tools can reach those code paths but does not remove vulnerable packages.

| Package | Installed chain and issue | Current exposure and disposition |
| --- | --- | --- |
| `@waishnav/devspace@1.0.8` | Direct runtime dependency; high severity is inherited from vulnerable dependencies, with no separate DevSpace advisory identified. | No compatible stable DevSpace update was applied. |
| `@anthropic-ai/sandbox-runtime@0.0.71` | Transitive runtime package; includes `node-forge@1.4.0`, high severity GHSA-86w9-cpqp-85rv. The advisory has no patched version. | Its Pi subagent sandbox path is inactive because subagents are disabled. |
| `@earendil-works/pi-coding-agent@0.80.10` | Transitive runtime package; npm audit flags the `0.75.4`–`0.83.0` chain because it contains vulnerable `undici`. DevSpace's `^0.80.3` range cannot select a later compatible Pi release. | Subagents and shell are not public tools. File handling remains in use, so the package is not treated as unreachable. |
| `brace-expansion@5.0.6` | Transitive through Pi's `minimatch@10.2.5`; six denial-of-service advisories are listed in npm audit. The maintained [advisory list](https://github.com/juliangruber/brace-expansion/security/advisories) includes fixes through `5.0.12`. | Search and shell tools are not exposed by the public gateway; no direct trigger through the remaining file tools was identified. The Pi shrinkwrap prevents the compatible update. |
| `protobufjs@7.6.4` | Transitive through Pi's Google GenAI package; moderate denial-of-service advisory [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww). `7.6.5` is patched. | Google/Pi subagent provider paths are inactive. DevSpace 1.0.8 pins `7.6.4`, so the patched version was not forced in. |
| `node-forge@1.4.0` | Transitive under the Anthropic sandbox runtime; high signature-verification advisory [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). No patched release is listed. | The sandbox subagent path is inactive; no safe package update is available. |
| `undici@8.5.0` | Transitive under Pi; 15 high advisories affect versions below `8.10.2`, including retry response handling, cache/cookie behavior, TLS options, and denial of service. See the [maintainer advisory list](https://github.com/nodejs/undici/security/advisories). | The cited HTTP/provider paths are not exposed by the public tool allowlist; no compatible update was possible through the nested Pi shrinkwrap and DevSpace pin. |

The aggregate npm report counts packages, not unique advisories. The public MCP endpoint requires OAuth and does not provide anonymous command execution. The gateway authenticates denied calls through DevSpace before returning a policy error, and never forwards shell tool calls to the upstream.

### Windows permission boundary

The DevSpace process runs with a medium-integrity, non-elevated Windows token. The account is in the local Administrators group with that group disabled in this process token, but its own ACL still grants access to its profile and DevSpace authentication data. This is not a separate low-privilege service account or a filesystem sandbox.

DevSpace 1.0.8 has no official Bash command allowlist; its Bash tool remains available on the local upstream but is not exposed by the public gateway. The gateway exposes only `open_workspace`, `read`, `write`, and `edit`, pins `open_workspace` to the test workspace, and rejects traversal and paths that cross symlinks or junctions. Synthetic tests against DevSpace itself confirmed that its native file-root check alone can still be bypassed through a Windows junction; no private files were read. The gateway path check is defense in depth and remains subject to local-process races. It is not an OS permission boundary.

ngrok targets only gateway port 7676. DevSpace port 7677 is bound to loopback and still has its full upstream tool set behind OAuth; a local process with valid DevSpace authorization can bypass the public gateway policy. Do not treat this design as isolation from other processes running under the same Windows account.

Runtime logs are excluded from source control. Shell command previews are disabled by default and were not enabled.

### Shell isolation decision

The public MCP uses the restricted gateway (option 2): only the four file/workspace tools are exposed, and shell, process-control, and other tools are denied. This reduces remote capability without changing the existing OAuth or ngrok configuration, but it does not isolate the DevSpace process from the Windows account. A dedicated standard account with scoped ACLs (option 1) is the required next step for an operating-system boundary; it needs explicit authorization because it changes Windows accounts/ACLs and requires carefully granting that identity access to the existing DevSpace and ngrok credential files. A separate local service for individually approved high-risk actions (option 3) is a higher-maintenance follow-up if such operations are needed later.

### Before expanding access

Keep the current workspace limited to `demo-workspace`. Before exposing real projects or enabling subagents, desktop control, or SSH, run the service under a dedicated non-administrator Windows identity whose ACL grants access only to the required workspace and runtime files; verify the DevSpace release's junction/symlink handling; and review the gateway against the exact tool schema after any upgrade. No Windows account, ACL, firewall, or registry settings were changed for this phase.

DevSpace 1.0.8 documentation: [security model](https://raw.githubusercontent.com/Waishnav/devspace/v1.0.8/docs/security.md) · [release notes](https://github.com/Waishnav/devspace/releases/tag/v1.0.8). The junction-escape fix appears in the prerelease [v1.1.0-beta.4 notes](https://github.com/Waishnav/devspace/releases/tag/v1.1.0-beta.4); that prerelease was not installed because it changes the configuration structure and the current OAuth/MCP setup was kept intact.
