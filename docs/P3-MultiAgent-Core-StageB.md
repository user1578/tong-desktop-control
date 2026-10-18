# Tong P3 — Multi-agent coordinator (isolated Stage B)

Status: **development-only** on `codex/p3-multi-agent-core`. This is an orchestration core and synthetic contract tests. Production Tong continues to accept Codex only. No new MCP execution tool, Windows service deployment, Claude authentication or live paid model calls were performed.

## Added modules

- `scripts/TongAgentProviders.mjs`: an explicit provider registry and two thin bridges. `codexProvider(broker)` delegates to the existing Tong ExecutorRouter's own preflight, native session selection and execution path. `claudeProvider({adapter, authorize})` requires a separately approved Claude runner and an independent project/task-scoped authorization callback; it does not fall back to Codex credentials. Unregistered providers cannot run.
- `scripts/TongMultiAgentOrchestrator.mjs`: 2–6 stages run sequentially against the same authorized project root. The coordinator checks all stages before starting any work, rechecks each before execution, and rejects a second concurrent workflow for the same project within that coordinator instance. Explicit `new`, `existing`, or supported `latest` native-session selection is retained per provider.
- The next stage receives a bounded summary of the previous result as JSON-marked **untrusted data**, not new instructions. Basic token/credential masking is applied. A failed, interrupted, cancelled or unverified stage blocks the rest. Events reveal stage/task IDs and statuses only; provider diagnostics remain internal. If the assembled prompt exceeds the CLI limit, execution is refused.

## Authorization contract

`claudeProvider.authorize()` receives `workflowId`, `stepIndex`, a SHA-256 `approvalDigest` binding the project, stage, agent, task, scope, native session selection, timeout and requested capabilities, plus the scope itself. It must return matching fields, `agent: 'claude'`, `approved: true` and `mode: 'trusted-windows'`. Both the initial plan and the pre-execution check must succeed. This callback **does not currently exist in the production trusted policy**; it is injected only by synthetic tests.

The coordinator never calls `child_process.spawn`, writes the provider's private session files or grants system access. The pre-existing Codex broker retains its own Windows runtime isolation and authorization semantics. The Claude adapter still requires an independent reviewed Job-backed executor; registering a Claude provider without it does not make it usable from MCP.

## Limits of Stage B

- No persistent, resumable cross-agent workflow state yet; the per-project conflict lock is **in-memory within one coordinator**, not a cross-process lock.
- No public MCP tool or current `TongAgentTaskManager` integration yet; no claim that real Claude/Windows task execution is enabled.
- No parallel file modifications; no retry/fallback after failed steps; no automatic Git commit/push, deployment or cleanup.
- Claude's `--tools ''` CLI flag must not be mistaken for an OS isolation boundary. Actual process, credential, file-system and cancellation security require a separate runner verification.
- As with any model output, marking prior-agent text as untrusted is not a guarantee against prompt injection. Staged authorizations, code review and explicit capability restrictions remain necessary.

## Tests

`node --test tests/Test-TongMultiAgentOrchestrator.mjs` tests provider registration, both adapters, native session reuse through a fake runner, cross-agent handoff, redaction, scope-bound grant digests, preflight denial, expiry between stages, cancellation, failure, overlong prompts and same-project concurrency refusal.

Run the existing Codex regressions too: `node --test tests/Test-TongCodexAppServer.mjs tests/Test-TongNativeSessions.mjs tests/Test-TongAgentTasks.mjs`. GitHub Actions `.github/workflows/p3-multi-agent-core.yml` tests the isolated contracts on Windows and Ubuntu.

## Next integration milestone

1. Review provider-specific capabilities and add a trusted Claude executable/hash/identity policy (not the Codex policy).
2. Implement a Windows Job-backed process runner with explicit shell/tool/environment restrictions and genuine cancellation.
3. Integrate providers into persistent task records and per-project locks, while preserving Codex's existing native-session behavior and caller approval paths.
4. Run a user-approved text-only Claude acceptance followed by an approved Codex→Claude code-review workflow with observed files, diff and task results; only then consider an MCP execution API.
