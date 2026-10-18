# Tong P3 — DeepSeek Harness adapter and durable workflow state (Stage C)

Status: development branch `codex/p3-dsh-adapter`, not installed in production or exposed through an MCP execution tool. No DeepSeek model prompt was sent.

## External interface evidence (2026-10-19)

- Official DeepSeek Harness repository: https://github.com/deepseek-ai/deepseek-harness (preview, APIs can break).
- Official CLI documentation: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md — `dsh headless` (stdin/stdout, persisted sessions), `dsh sdk` (stdio JSON-RPC), and `dsh acp` (ACP).
- Official SDK guide: https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md — `DeepSeekHarness(dsh_home, cwd, provider, model)`, `run(prompt, session_id=...)`, and `resume_session(id).run(prompt)`. Result fields include `session_id`, `final_response`, `finish_reason`.
- Local `Get-Command dsh` and global npm listing found no installed DSH command. `npm view @deepseek-ai/dsh version --json` returned `0.2.0-rc.2`. Python 3.11 `pip index versions deepseek-harness-sdk` reported no matching distribution on the configured package index. Published CLI version and repository development version may differ.

## New isolated modules

- `TongDshSdkAdapter.mjs`: pure Python SDK request/result contract, not a Python SDK implementation. A separately reviewed runner must explicitly configure `DSH_HOME` outside the project, pin a compatible runtime version, honor `sdk` profile and `deepseek-official/deepseek-v4-flash`, run a new Session or call `resume_session()` for an existing one, and return bounded structured fields. This adapter does **not** spawn a process, install packages, read credentials, grant Windows tools or call an LLM.
- `dshProvider()` in `TongAgentProviders.mjs`: additional provider for Tong's development multi-agent coordinator. Its independent authorization callback must bind workflow ID, stage index, project, task/scope, session selection, SHA-256 approval digest, exact Harness runtime version, Harness home and SDK profile. A Codex or Claude grant cannot be silently reused.
- `TongWorkflowJournal.mjs`: optional per-coordinator durable status journal. It writes metadata only (no prompts, handoff summaries, API tokens or raw provider output), stores stage start/completion/failure and native session IDs, and uses exclusive per-project lock files across instances. Atomic state replacement is used after initialization. A stale lock blocks work and requires explicit operator review. A crash does NOT auto-resume a previous run.

## Verification

- `node --test tests/Test-TongDshSdkAdapter.mjs tests/Test-TongWorkflowJournal.mjs tests/Test-TongMultiAgentOrchestrator.mjs tests/Test-TongClaudeCodeAdapter.mjs` tests exact session IDs and resume, completed/error results, mismatched version/grants, fake Codex→DSH, persistent event recovery, deliberate stale locks, multi-instance contention and pre-existing regressions.
- `.github/workflows/p3-dsh-durable.yml` runs the targeted synthetic tests on Windows and Ubuntu. It does not download DSH, access accounts, run a model or use the production Windows service.

## Important limitations

1. DSH Python SDK has not been installed or run on this machine. No claim about real-model compatibility, account authorization or installed plugin permissions can be made.
2. The default DSH SDK profile can load tools and credentials. A prompt asking for text-only behavior is NOT an isolation boundary. Before real execution, Tong requires a separate user-approved Job-backed worker, exact executable/runtime versions, an isolated Harness home and a deliberately restricted tool profile.
3. Journal root must be provisioned with a trusted Windows account and ACL; POSIX mode flags alone do not secure Windows data. The journal is a building block and not yet wired into the existing production task manager. Locks are deliberately fail-closed after crashes and must not be forcibly deleted automatically.
4. No production upgrades, project modifications outside this feature branch, persistent task-manager schema migration, or real Codex→Claude→DSH workflow execution occurred in Stage C.

## Next acceptance step

Validate the published npm DSH CLI in an isolated, unprivileged development directory with a pinned version, initially `--version`/`--help` only. Evaluate headless vs SDK JSON-RPC based on the installed CLI. Then implement an independently authorized Windows worker and state-home boundaries, followed by an explicitly approved single text-only provider test. Only after that test should multi-Agent production integration or interactive UI work be considered.
