# Tong Desktop Control

Local DevSpace MCP for ChatGPT, exposed through the existing ngrok domain via a loopback-only restricted gateway.

## Tong · one-time trusted folders and automatic Codex project onboarding (development only)

User-friendly folder onboarding is prepared: the user can double-click `scripts/Connect-TongFolder.cmd`, pick a project parent folder such as `D:\\作业`, and confirm **once locally**. Later ChatGPT calls `tong_project_prepare` with a specific project folder; under the already approved root, Tong automatically registers the project and creates/reuses the persistent native-Codex development grant. Folders outside approved roots are rejected until locally confirmed, and high-impact work still requires separate approval. Trusted-root revocation invalidates inherited grants. **This feature is not yet deployed to production Tong and has not yet authorized `D:\\作业` there.** See [quick-folder onboarding](docs/Tong-Quick-Folder-Trust.md) and `node --test tests/Test-TongQuickProject.mjs`.

## P3 · Local provider session acceptance kit (development only)

A development-only local Windows console runner supports Claude CLI native text-session acceptance, version validation, read-only `--auth-check`, and bounded `--auth-isolate` diagnosis. Two **independent, opt-in** flags preserve the user's chosen authentication and routing without displaying their values: `--inherit-anthropic-auth-token` and `--inherit-claude-routing` (only selected API endpoint/model variables). Default runs reject mismatched custom routing rather than silently switching endpoints; errors return redacted categories. Actual model execution requires an interactive PowerShell 7 window and a local `Y` confirmation, is not OS-sandboxed, and never uses production Tong grants. DSH Desktop's bundled CLI is inspected only; DSH live execution remains disabled pending its own restricted runner. See [docs/P3-Local-Provider-Acceptance-StageE.md](docs/P3-Local-Provider-Acceptance-StageE.md). **Both real Claude native session creation and exact-session resume passed on 2026-10-19.** The resume uses `--session-id` plus `--resume-from-report`, validates the original receipt, reuses the original Claude working directory, and tests historical context without repeating the marker in the prompt. See [live-session closeout](docs/P3-Claude-Live-Session-Closeout.md). This is not yet the production Job-backed multi-Agent runner.

## P3 · DSH-S1-B1B restricted native child loader: blocked (no models)

A native Win32 fixed mock child (compiled using existing local MinGW GCC) was tested alongside the managed Windows Job Object controller and a restricted Windows SID token. **Privilege-reduced baseline launches; adding the actual restricting SID still causes pre-entry `0xC0000022`** even after using a temporary directory on the drive root and switching from UCRT to MSVCRT. The fail-closed diagnostic intentionally exits nonzero; it is **not an acceptance pass**. No system ACLs were changed, DSH SDK/model was never started, and production authorization remains off. See [native loader diagnostic and S1-B1C blocker](docs/P3-DSH-S1B1B-Restricted-Native-Loader-Blocker.md).

## P3 · DSH-S1-B1A restricted Windows ACL and synthetic task grant (no models)

The Windows test-only `CreateRestrictedToken` + `AccessCheck` canary now checks **real DACL allow/deny behavior** on isolated temporary files, and the HMAC mock-only grant validates exact project/task/session/scope/expiry, rejecting tampering and single-process nonce replay. **This is not a production sandbox:** the synthetic restricting SID is the built-in Users group; a real restricted .NET child failed pre-entry with Windows `0xC0000022`, and network isolation plus Job/Token integration remain unresolved. No DSH SDK or model was launched. See [S1-B1A findings and blockers](docs/P3-DSH-S1B1A-Restricted-ACL-and-Synthetic-Grant.md).

## P3 · DSH-S1-B0 Windows native Job Object canary (mock processes only)

The independent C# test harness in `tests/TongDshS1BJobCanary.cs` now demonstrates actual Windows Job Object containment for fixed mock normal completion, timeout, cancellation and descendant-process cleanup; every child is assigned while suspended, and Job close/termination clears the tree. Run `pwsh -NoProfile -File tests/Test-TongDshS1BJobObject.ps1` for the Windows-only test; the compiler output lives under a cleaned temporary directory. **No DSH CLI, user-authorized Agent, restricted Windows token, or model is launched.** This is not yet a trusted, OS-permission-sandboxed production DSH Runner. See [DSH-S1-B0 report](docs/P3-DSH-S1B0-Windows-Job-Canary.md).

## P3 · DSH-S1-A restricted SDK policy + synthetic task runner (no models)

A pinned **98-entry SDK 0.2.0-rc.2 baseline** and SHA-256 check now reject unreviewed plugin additions or replacements; a generated config-only `--patch` disables **46 risk-capability entries** and enforces `read-only` / `approval: ask`. `node scripts/Inspect-TongDshS1Config.mjs` validated this on the installed CLI in an independent temporary `DSH_HOME`, then cleaned it up without starting SDK or an LLM. An injected **synthetic-only** runner tests scoped approval, native-session new/resume semantics, same-project exclusion, cancellation and timeout. **This is NOT Windows Job Object isolation or a live DSH Agent**; real SDK launches and model calls remain disabled. See [DSH-S1-A contract and remaining Windows execution gates](docs/P3-DSH-S1-Restricted-Synthetic-Runner.md).

## P3 · DSH-S0 protocol and permission audit (no model execution)

Completed the local 0.2.0-rc.2 read-only audit of Headless, SDK JSON-RPC and sdk-minimal default profile compositions, including a temporary **config-only** proof that `--patch` can switch `sandbox-policy` to `read-only` and disable selected tools. **The default Headless/SDK mode is `workspace-write`; sdk-minimal defaults to `danger-full-access` and provides persistent shell. Neither is automatically safe for text-only model execution.** Added `scripts/TongDshS0Audit.mjs` and synthetic tests, and recorded official SDK methods, the missing cancel method, and requirements for a Windows trusted runner in [DSH-S0 audit](docs/P3-DSH-S0-Protocol-Capability-Audit.md). No real DSH model was called and no Desktop profile was changed.

## P3 · Existing DeepSeek Harness Desktop runtime (development only)

Tong can now locate and validate the **CLI bundled with an existing DeepSeek Harness Desktop installation**, without installing a duplicate DSH or changing PATH. This is a read-only discovery layer; a bundled Headless/SDK CLI session is **not yet verified to appear or resume in the Desktop UI**. Claude Code remains a separate CLI-only Agent. See [docs/P3-DSH-Desktop-StageD.md](docs/P3-DSH-Desktop-StageD.md) and `node --test tests/Test-TongDshDesktopRuntime.mjs`.

## P3 · DeepSeek Harness and durable workflow logs (development only)

An optional third provider bridge now supports a **mocked DeepSeek Harness Python SDK contract** with version-bound per-stage approval, exact new/resumed session IDs and typed completion checks. A separate atomic workflow journal records task statuses and native session IDs and rejects conflicting project workflows across coordinator instances. **No real DSH model calls or production provider are enabled:** the existing DSH Desktop *does* bundle a verified `dsh.cmd` (0.2.0-rc.2), but the standalone Python SDK distribution is not verified and safe tool restrictions are not established. See the [next DSH safe-execution handoff](docs/P3-DSH-Next-Safe-Execution-Handoff.md). See [docs/P3-DSH-and-Durable-StageC.md](docs/P3-DSH-and-Durable-StageC.md). The real Windows runner, restricted DSH profile and production integration remain future milestones.

## P3 · Multi-agent orchestration core (development only)

P3 Stage B introduces a provider registry and a serial Codex→Claude workflow coordinator with per-stage authorization checks, scoped native session handling, bounded result handoff, cancellation, status events and in-memory same-project exclusion. **This is a synthetic-tested core, not yet wired to production MCP or persistent task storage.** Claude requires its own approved runner and authorization; Codex still uses its reviewed broker. Details: [docs/P3-MultiAgent-Core-StageB.md](docs/P3-MultiAgent-Core-StageB.md). Run `node --test tests/Test-TongMultiAgentOrchestrator.mjs` for the contract suite.

## P3 · Claude Code adapter (development only)

An isolated Claude Code adapter now prepares fixed noninteractive text-only CLI requests, supports new or explicitly resumed native session IDs, and validates bounded JSON results. It does **not** launch Claude itself: a separately approved Windows runner is required, and the production task manager continues to accept only Codex. Details, limitations and next integration stages are in [docs/P3-Claude-Adapter-Stage-A.md](docs/P3-Claude-Adapter-Stage-A.md). Run its synthetic contract test with `node --test tests/Test-TongClaudeCodeAdapter.mjs`.

## P3 · Windows read-only inspection (development)

The first P3 increment adds `tong_windows_inspect` with `kind: "processes" | "services"`, an optional **exact** `name` filter and a `limit` of 1–100 (default 30). Process results contain only name, PID and working-set bytes; service results contain service name, display name and status. Responses explicitly report `truncated`. The tool runs a fixed local PowerShell 7 script, never accepts scripts or shell arguments, and cannot terminate processes or change services. No command lines, environment variables, account information or executable paths are returned.

For example, after refreshing the tools for a future approved release: `tong_windows_inspect({kind: "services", name: "EventLog", limit: 5})`.

The next P3 increment adds `tong_dev_environment({tool: "all"})` (or `tool: "python"`, `"py"`, `"node"`, `"npm"`, `"git"`, `"pwsh"`, `"cmake"`, `"gcc"`, `"java"`, `"mvn"`). It enumerates **only commands discoverable on the current process PATH**, returning up to three unique application paths per tool with an explicit `truncated` flag. `fileVersion` is read from Windows file metadata and can be `null` for `.cmd` scripts or files without version information; it is **not** necessarily the same as a command-line `--version` or a complete inventory of installations. The probe does not execute discovered programs, install software, inspect credentials or mutate Windows.

These are development changes: **the running production MCP is unchanged until separately released**. Targeted tests are `tests/Test-TongWindowsInspect.mjs` and `tests/Test-TongDevEnvironment.mjs`; the narrow Windows/Ubuntu GitHub workflow is `.github/workflows/p3-windows-inspection.yml`. Future adapters and broader system-management operations must retain their own permissions and Windows identity checks.

## P0 local workspace tools (2026-10-16 development build)

This build reuses DevSpace workspace IDs, its read/write/edit tools, the Gateway and the existing local project registry. `open_workspace({})` selects the configured default (`TONG_RESTRICTED_ROOT`); `open_workspace({path: "D:\\作业\\111"})` selects a locally registered, enabled project with read or write permission. File permissions and execution grants are rechecked on every call. Opening a workspace does not create a grant. File writes need `project.write`; commands additionally need the existing independent `agent.execute` grant. Existing Guardian, OAuth, AgentDock and Codex task approval flows are unchanged.

| MCP tool | Arguments beyond `workspaceId` | Result |
| --- | --- | --- |
| `read`, `write`, `edit` | Existing relative path/content/edit schemas | Existing DevSpace result |
| `tong_list_directory` | Optional `path` (default `.`), `limit` (1–1000) | Entries, actual path, truncation flag |
| `tong_move_file` | `path`, `destination` | Actual move; rejects existing destination |
| `tong_delete_file` | `path` | Actual single-file deletion; no recursive deletion |
| `tong_run_command` | `program`: `python`, `node`, `git`, `npm`, `pwsh`; optional `args` array, `timeoutMs` (100–120000, default 30000) | Exit code, stdout, stderr, error, timeout/cancellation, duration, cwd, file changes |

Example after obtaining `workspaceId`: `tong_run_command({workspaceId, program: "python", args: ["test.py"]})`. PowerShell uses PowerShell 7 (`pwsh`); npm on Windows runs its CLI through Node without a shell wrapper. Executables must be installed on the service's PATH. Nonzero exit, spawn errors and timeout return `isError: true` with structured results. Output is limited to 64 KiB per stream, with an explicit truncation flag. File change observations use content hashes, with limits of 2000 entries, 32 MiB and 3 seconds per scan; dependency/VCS directories and links are skipped and `complete: false` is reported. Changes outside the workspace and transient files created then deleted during a command are not observed.

Commands are trusted execution under the Windows service account, **not an OS sandbox**: Python, Node, PowerShell and project scripts can access anything that account can. The execution grant therefore authorizes local execution, not just a working-directory change. Only a small OS environment allowlist is inherited; Tong/OAuth credentials are not passed in the child environment. A private PowerShell 7 host uses a kill-on-close Windows Job Object to terminate descendants on timeout, cancellation and host exit, including children whose immediate parent already exited. PowerShell 7 is required for all Windows commands; its small native helper is compiled in memory. No new account, ACL or authorization system is introduced.

Local registration still uses `node scripts/TongProjects.mjs add --id homework --name Homework --path "D:\\作业\\111" --permission write`, then `grant-agent homework` when execution is authorized. For an isolated development instance, set `TONG_LOCAL_STATE_DIR` to its state directory and `TONG_RESTRICTED_ROOT` to its default workspace before running that CLI and server. Do not point these commands at production state without authorization. Revoking `agent.execute` blocks subsequent commands; disabling/revoking the project blocks subsequent file calls. An already running command finishes or reaches its timeout; grant revocation does not kill it.

Real Windows acceptance, through OAuth and HTTP Gateway, without touching production configuration:

```powershell
node tests/Test-TongLocalWorkspace.mjs --http 'D:\作业\111'
```

The test creates uniquely named files, verifies Python output and exit codes, moves/deletes its files and compares the final directory listing with the original. Its small isolated state is retained at the printed `D:\tong-p0-*` path. Dependencies are reused; no release build is needed. The development interface is ready for MCP discovery, but this change does **not** deploy/restart the production service or refresh the existing ChatGPT connection. That connection will retain its old schemas until an authorized release is activated and its tools refreshed.

The sections below describe the earlier production baseline and deployment history; their demo-only/14-tool statements do not describe the P0 development toolset above.

## Connection

- Local MCP gateway: `http://127.0.0.1:7676/mcp`
- DevSpace upstream (loopback only): `http://127.0.0.1:7677/mcp`
- Public MCP: `https://your-ngrok-domain.ngrok-free.dev/mcp`
- Public tool allowlist: the four workspace/file tools, three metadata tools, and seven `tong_agent_*` task tools
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

## Disk metadata and project registration

`tong_list_drives` returns C/D capacity and free space. `tong_scan_directory` accepts an absolute C/D directory `path`, optional `maxDepth` (0–3), `limit` (1–200), and a returned `cursor` for the next page. It returns names, types, sizes, modification times, bounded counts, and possible project directories. The scan reads no file content; each call has time, entry, directory, and response size limits. It skips protected system and credential paths and does not follow junctions or symbolic links. Results can be partial (`truncated: true`), and pagination may change if a directory changes during scanning.

Local project authorizations are stored in ignored `runtime\project-access.json`, outside `demo-workspace`. Manage them **locally**, not through MCP:

```powershell
node .\scripts\TongProjects.mjs list
node .\scripts\TongProjects.mjs add --id sample --name 'Sample project' --path 'D:\path\to\project' --permission metadata
node .\scripts\TongProjects.mjs disable sample
node .\scripts\TongProjects.mjs revoke sample
```

The `add` command also accepts `read` or `write` as a recorded permission level, but this phase grants real projects only effective `project.metadata`. `tong_list_projects` shows registered projects and their effective capabilities after OAuth. Only the built-in `demo` project is available to `open_workspace`, `read`, `write`, and `edit`. `agent.execute` is stored independently from project metadata/read/write permission. No remote MCP tool can register, disable, revoke, or change a project's permission.

## Codex task management (P2)

The restricted MCP registers these lifecycle tools:

| Tool | Purpose |
| --- | --- |
| `tong_agent_start` | Queue a Codex request for a registered project, with `projectId`, `agent: "codex"`, `task`, `scope`, `idempotencyKey`, and optional `timeoutSeconds` (1–3600). |
| `tong_agent_status` | Read one task's state, timestamps, runtime, error and saved Codex thread ID. |
| `tong_agent_list` | Page through persisted tasks (`limit` up to 100). |
| `tong_agent_logs` | Page through task logs (`limit` up to 100). |
| `tong_agent_cancel` | Cancel one queued/running task and interrupt its associated Codex turn. |
| `tong_agent_resume` | Continue an interrupted saved Codex thread. It does not create a replacement session. |
| `tong_agent_result` | Read the final agent summary, changed-file list, Git diff summary, and observed test command events. |

Task state is atomically saved in ignored `runtime\agent-tasks.json`. The manager defaults to two concurrent tasks and does not run two tasks against the same project at once. A required client idempotency key maps retries to the existing task. Logs are capped at 256 KiB per task, each entry is capped at 8 KiB, and token-like strings are redacted before persistence and paging.

`agent.execute` grants are stored separately in ignored `runtime\agent-execution.json`. A local administrator can grant or revoke this app-level permission with `node .\scripts\TongProjects.mjs grant-agent <project-id>` and `revoke-agent <project-id>`. Project read/write registration does not imply this grant.

**Real Codex execution is disabled in the MCP manager.** A valid `agent.execute` grant still receives an explicit disabled response. No public request can choose an executable, shell command, model, or raw CLI argument. The adapter uses the local Codex App Server JSON-RPC interface (`initialize`, `thread/start`, `turn/start`, `turn/completed`, `thread/resume`, and `turn/interrupt`) and keeps process launch arguments fixed. The installed CLI inspected for P2 is `codex-cli 0.154.0`; its App Server is marked experimental.

The local Windows probe showed that Codex's `:workspace` sandbox could read and write a synthetic file under `%TEMP%` outside the project root. This does not isolate project files from the current Windows account. Real execution stays disabled until a separate low-privilege identity or an equivalent OS boundary is configured and verified against project and private-file canaries. No Windows account or ACL changes were made.

### P2.2 Windows Worker isolation (Stage A)

Branch `codex/p2-worker-isolation` adds a fail-closed Worker Broker, authenticated private-stdio protocol, fixed-executable Worker, and synthetic restricted-token canaries. The Windows canary probe passed for authorized project access, outside read/write/delete denial, junction denial, child-process inheritance, Job Object kill-on-close, and a clean Worker environment. The probe changed ACLs only inside its temporary synthetic tree and removed that tree. **No real Worker launcher is configured; real Codex execution remains disabled, and no account, service, or project ACL was changed.** The Stage B account/service/ACL/authentication plan and plan-only scripts are in [docs/P2.2-Worker-Isolation-StageB.md](docs/P2.2-Worker-Isolation-StageB.md).

The gateway stdout log contains redacted JSON request traces. Correlate `requestId` across `request_start`, `mcp_request`, `upstream_*`, and `request_finish`; pair the upstream interval with DevSpace's request log by UTC time, method, path, and status. `http_client_error` records HTTP parser rejects that never reach the gateway request handler. Gateway traces omit authorization values, cookies, request/response bodies, tool arguments, and raw MCP session IDs; session IDs appear only as short hashes in those traces.

When the shell inherits HTTP proxy variables, the launcher clears them only in the ngrok child process because this ngrok free endpoint rejects proxy connections. The parent environment and ngrok config remain unchanged.

## Change the public domain

Edit only `config\tong.config.json` and change `publicOrigin` to the new HTTPS origin (no path and no `/mcp`). Then run `Start-TongDesktopControl.ps1`; it synchronizes DevSpace's public origin and restarts the processes this project owns. The ngrok executable path and existing ngrok config path are in that same file. The project never edits the existing ngrok config.

## Validate

```powershell
& '.\tests\Test-TongConfiguration.ps1'
& '.\tests\Test-TongPortListenerArray.ps1'
pwsh -NoProfile -ExecutionPolicy Bypass -File '.\tests\Test-TongEndpoints.ps1'
node .\tests\Test-TongWorkerIsolation.mjs
node .\tests\Test-TongAgentTasks.mjs
node .\tests\Test-TongMcpMetadataTools.mjs
node .\tests\Test-TongCodexAppServer.mjs
& '.\tests\Test-TongWorkerCanaries.ps1'
node --test
& '.\node_modules\.bin\devspace.cmd' doctor
& '<path-to-ngrok.exe>' config check --config "$env:LOCALAPPDATA\ngrok\ngrok.yml"
```

The doctor checks the installed Node, Git, Git Bash, SQLite binding, configured URLs, roots, and allowed hosts. The tests confirm the 14-tool allowlist, strict task arguments, authorization, persistence, bounded logs, adapter lifecycle, workspace pinning, and path traversal protection. The endpoint test runs in Windows PowerShell 5.1; it uses the installed `curl.exe` for public HTTPS because the legacy .NET HTTP clients on this host report some public 401 responses as 200.

## Connect ChatGPT

The existing ChatGPT MCP connection and OAuth authorization are preserved. Open the existing **Tong Desktop Control** connection in ChatGPT web and refresh or reconnect it so ChatGPT reloads the tool list. Do not create a duplicate connection. The public list should contain the four existing file tools, three metadata tools, and seven `tong_agent_*` task tools. Bash and other unsafe tools remain unavailable.

After reconnecting, call `tong_list_drives`, then scan a small directory with `maxDepth: 0` and `limit: 5`, request its next page if offered, and call `tong_list_projects`. Call `tong_agent_list`, verify `tong_agent_start` on an ungranted project returns an `agent.execute` denial, and check that a request containing an `executable` or `command` field is rejected by the Gateway. With the current build, a granted task also returns the real-execution-disabled message. Then use `demo-workspace` for the existing open → read → write → read → edit → read smoke test with synthetic content. Check that Bash and remote project registration are absent.

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

DevSpace 1.0.8 has no official Bash command allowlist. The pinned, repeatable restricted-instance patch omits Bash and other dangerous tool registrations, rejects direct Shell execution, and checks real filesystem paths before file operations. The gateway independently restricts its public tool list and keeps the four file tools pinned to `demo-workspace`. Synthetic tests cover traversal, junctions and hard links; a file symlink test could not run where Windows denied creating that link. These checks still have a check-to-use race and are not an OS permission boundary.

ngrok targets only gateway port 7676. DevSpace port 7677 is bound to loopback, requires OAuth for MCP, and uses the restricted tool registration even when called directly. A process running as the same Windows account can still modify local runtime files or race path checks. Do not treat this design as isolation from that account.

Runtime logs are excluded from source control. Shell command previews are disabled by default and were not enabled.

### Shell isolation decision

The public MCP uses the restricted gateway and restricted DevSpace instance. The four file/workspace tools and three metadata tools keep their existing policy. Seven task-management tools are exposed, with `agent.execute` authorization checked separately and real Codex execution disabled. Shell, process-control, remote project registration, and administrative tools remain unavailable. This does not isolate the DevSpace process from the Windows account. A dedicated standard account with scoped ACLs is a future prerequisite for an operating-system boundary and requires separate authorization; no such Windows changes were made here.

### Before expanding access

Keep the current workspace limited to `demo-workspace`. Before exposing real projects or enabling subagents, desktop control, or SSH, run the service under a dedicated non-administrator Windows identity whose ACL grants access only to the required workspace and runtime files; verify the DevSpace release's junction/symlink handling; and review the gateway against the exact tool schema after any upgrade. No Windows account, ACL, firewall, or registry settings were changed for this phase.

DevSpace 1.0.8 documentation: [security model](https://raw.githubusercontent.com/Waishnav/devspace/v1.0.8/docs/security.md) · [release notes](https://github.com/Waishnav/devspace/releases/tag/v1.0.8). The junction-escape fix appears in the prerelease [v1.1.0-beta.4 notes](https://github.com/Waishnav/devspace/releases/tag/v1.1.0-beta.4); that prerelease was not installed because it changes the configuration structure and the current OAuth/MCP setup was kept intact.
