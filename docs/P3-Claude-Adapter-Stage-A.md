# Tong P3 — Claude Code Adapter (isolated preparation stage)

Status: **development only**, branch `codex/p3-claude-adapter`. No production upgrade, no new MCP tool, and no Claude model request is performed by this change.

## Verified local capability

- Claude Code CLI: `C:\Users\Rune\.local\bin\claude.exe` (reported version 2.1.236 on 2026-10-18).
- Local `claude --help` advertises `--print`, `--output-format json`, `--session-id`, `--resume`, `--tools`, `--strict-mcp-config`, `--disable-slash-commands`, and `--permission-mode dontAsk`.
- These are CLI capabilities, not yet proof that any Claude Code session appears in a desktop UI or that authorization works in a multi-agent task.

## Interface in this increment

`scripts/TongClaudeCodeAdapter.mjs` exports `prepareClaudeCodeTask`, `parseClaudeCodeResult`, and `TongClaudeCodeAdapter`. It accepts only `new` and `existing` session modes with native UUIDs. New sessions receive a UUID; existing sessions use `--resume` with the exact approved session. Prompts travel in **stdin**, not in process argv. CLI args are fixed to noninteractive JSON output with built-in tools disabled, MCP config restricted, slash commands disabled and `dontAsk` permissions.

The adapter **does not spawn processes**. Its `execute(request, {signal})` dependency must come from a separately authorized Windows Job-backed runner. This is intentional: the current production Tong broker only approves Codex, and merely adding `agent: claude` to an input enum would bypass the necessary agent-specific capability and session policy review. On success, the parser returns only `{agent,status,sessionId,text,resumed}` and checks the requested session ID. Unknown provider logs and stderr are not exposed by this module. JSON output is capped at 256 KiB.

Disabling interactive Claude tools does not prove that the CLI never reads user/project configuration during startup. No real CLI prompt has yet been sent. The future runner must have explicit environment, account, scope, cwd, process-tree lifecycle, authorized tool profile and task-approval policies.

## Acceptance performed

- `node --test tests/Test-TongClaudeCodeAdapter.mjs` — synthetic new/resume, malformed args, id mismatch, error handling, callback flow, no unauthenticated default runner, cancellation.
- `.github/workflows/p3-claude-adapter.yml` runs the same contract tests on Windows and Ubuntu.
- Existing Codex task manager, `TongTrustedCodexBroker`, MCP schemas, production pin and on-disk state are unchanged.

## Required before real multi-agent execution

1. Define an AgentProvider interface with provider-specific capability descriptors; migrate Codex behind it without changing Codex authorization/session semantics.
2. Add a local, separately reviewed Claude executable/hash policy and explicit per-project/per-task permissions.
3. Implement a Windows Job-backed runner, bounded streaming/results, process-tree cancellation and native session resume. Test provider availability, failures and version drift without using real project data.
4. Add cross-agent workflow state: serial tasks on one checkout, optional isolated worktrees, explicit artifact/result handoff, idempotency, recovery and user-facing task traces.
5. Only after local user approval, carry out a real Claude Code dry-run, then Codex→Claude code review and Claude→Codex follow-up with project diffs checked.
