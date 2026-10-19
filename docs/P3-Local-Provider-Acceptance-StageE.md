# Tong P3 — Local manual acceptance kit (Stage E)

Status: `codex/p3-local-provider-acceptance`, **development only**, never installed as a production Tong MCP tool. The user must personally start the process from a local interactive PowerShell 7 console and explicitly enter `Y` before any paid-model call.

## Why this milestone is separate

Review found the current native Supervisor and `TongTrustedCodexBroker` are Codex-specific and enforce fixed executables, identity/SID checks, project ACL, Job Object and task approval. Substituting Claude or DeepSeek binaries into that flow would not preserve those guarantees. Stage E does not modify that Supervisor, any production Manager, registration, grant, task store or live session. It prepares an independent **manual acceptance kit**, not a reusable production executor.

## Commands and local prerequisites

On the user's installed Windows machine in PowerShell 7:

```powershell
Set-Location 'D:\Tong\development\tong-desktop-control'
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --dry-run
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider dsh --dry-run
```

These previews are read-only: check the installed binary's regular-file canonical path and show the exact version pin, flags and acceptance marker. They do not launch the provider or install packages.

Once the user has inspected the plan, a **user-owned interactive PowerShell window** may run:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --run
```

The script refuses `--run` from Tong's non-interactive shell or CI. It prints the exact binary and test scope, validates the executable and version, then runs the **read-only** `claude auth status` check in the **same filtered environment and temporary working directory** intended for the model call. That filtered environment now **preserves `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME` from the user's current interactive shell**, along with normal Windows profile and PATH variables. It does not forward `ANTHROPIC_API_KEY` (an API key can override subscription-based OAuth and change billing), `GITHUB_TOKEN` or unrelated process variables. Only the presence of relevant Claude environment keys is printed, never their values. If the CLI is not logged in or its status cannot be confirmed, the test stops **before asking for model-call approval**. It does not automatically run login or import API secrets. If authentication succeeds, it asks `Approve ONE text-only Claude test? Type Y:`. Any answer other than the exact capital `Y` cancels. The tested Claude flags are `-p --output-format json --tools '' --strict-mcp-config --disable-slash-commands --permission-mode dontAsk --session-id <UUID>`; the prompt is delivered via stdin. Existing Claude authentication is used (no extra login). It verifies the pinned Claude Code version `2.1.236` and checks the executable hash before launch, executes from a fresh empty temp workspace, caps output/time and writes only a limited report to a fresh temp folder. It does not print full stderr or raw provider stdout. On CLI failure, it now prints only the categorical reason (`authentication`, `network`, `rate-limit`, `cli-arguments`, `timeout`, etc.), exit code and elapsed milliseconds, keeping bounded raw error details in memory only. Failed test temporary workspaces are cleaned up. Successful reports remain limited to the session ID, result, version, timing and binary hash.

After a successful new-session receipt, the user can request continuation by passing the **verified** returned session ID:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --run --session-id '<the actual returned UUID>'
```

Again an independent interactive `Y` is required. The session's origin is Claude CLI and its native continuation must be confirmed by the actual provider. This is *not* a Claude Desktop session.

## First failure and follow-up (2026-10-19)

An interactive Claude text-only acceptance returned only `Provider acceptance: provider run unsuccessful`. The previous script discarded stderr and the exit code, so the **original root cause cannot be proven retrospectively**. A subsequent **read-only** `claude auth status` check via Tong, both with the filtered run environment and with its inherited environment, returned `loggedIn:false, authMethod:none`, exit code 1. This is strong evidence that the Tong-side process has no authenticated Claude session, but it does not establish the state of the user's interactive PowerShell session.

User's interactive PowerShell 7 later reported `loggedIn:true`, `authMethod:oauth_token`, `apiProvider:firstParty`, while the local acceptance script's filtered child still reported `not-authenticated`. This confirms a configuration/environment mismatch for that invocation, but does not prove which variable was missing. The accepted fix to try is *only* to forward the known Claude OAuth/config directory selectors from the interactive parent to the child; there is no need to log in again just because the filtered subprocess failed.

A targeted follow-up fix in `codex/p3-claude-auth-diagnostics` forwards only the current interactive session's Claude OAuth/config-directory selectors into the Claude subprocess; it does not forward other provider tokens or API keys. A new **read-only** command checks authentication without user approval, model requests or session creation:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --auth-check
```

This prints only the presence of OAuth/config selectors, and auth status in the filtered context. If that remains unauthenticated, it also checks `claude auth status` with the *same local PowerShell process environment* for comparison, without running the model or outputting credentials. Exit code 0 means the filtered auth check passed; code 2 means no authenticated Claude session could be confirmed. The user should run this in the PowerShell window where their direct CLI login was verified; the separate Tong-runner login status cannot substitute for that comparison.

**Confirmed follow-up:** In the user's *same* interactive PowerShell, the narrowed child reported `not-authenticated`, while `claude auth status` launched with its full inherited environment reported `authenticated`. The cause is environment filtering, not a proven expired OAuth login. No model call was sent during this comparison.

The Stage E auth environment selector now tries three non-mutating, fixed allowlists in order: `base`, `windows-context` (e.g. `USERNAME`, `HOMEDRIVE`, `HOMEPATH`, `USERDOMAIN`), then `network-context` (existing HTTP(S) proxy, CA path and no-proxy settings). It reports only the status of each probe and the selected tier. The *first authenticated tier* is used unchanged for a separately approved model call; none of the tiers inherit `ANTHROPIC_API_KEY`, `NODE_OPTIONS`, `GITHUB_TOKEN` or arbitrary environment values. If they all fail, the full inherited environment is used **only** for a read-only diagnostic, never for a model call. This preserves the signed-in PowerShell credentials without copying token values or prompting for login.

### Stage F — read-only excluded-variable isolation

The user's newest local diagnostic still reports `base`, `windows-context` and `network-context` as `not-authenticated` while the **full inherited** PowerShell environment returns `authenticated`. The difference is now confirmed at the process environment level; the specific responsible variable(s) are not yet known.

Run the following **only** in the same interactive PowerShell 7 session:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --auth-isolate
```

This mode performs bounded (`<=16`) `claude auth status` probes in a fresh temporary directory. It starts with the previous `network-context` allowlist and only adds subsets of excluded environment variables, identifying a single candidate when possible. **Only variable names and categorical outcomes are printed—never values, account identities, or raw Claude output.** CLI execution-modifier variables (including `NODE_OPTIONS` and `NODE_PATH`) are excluded from those probes. Values under investigation are used only for read-only `auth status` checks: **never copied into a model invocation or production worker**.

A `single-variable-candidate` means the named variable appears necessary/sufficient within this diagnostic, **not** that it is safe to forward it automatically. If `requiresManualReview` is true (for example `ANTHROPIC_API_KEY`), do not enable it in the model runner; API-key authentication may have a different billing path than the existing OAuth session. `multiple-variables-needed`, `probe-limit` or `execution-modifiers-excluded` need further manual investigation. The test can take several seconds; it never requests interactive approval or runs a model.

### Stage G — explicit, local-only ANTHROPIC_AUTH_TOKEN transfer

The user's PowerShell `--auth-isolate` diagnostic identified exactly one excluded variable, **`ANTHROPIC_AUTH_TOKEN`**, as sufficient to make `claude auth status` succeed. The token's **value was not retrieved or displayed**. This does not, by itself, prove its provider or billing method.

The new flag `--inherit-anthropic-auth-token` is **opt-in** and accepted only with the Claude `--auth-check` or interactive `--run` commands. Without that flag, the variable stays excluded. No copy is written to disk, no model is started by an auth check, and no production Tong environment policy changes.

First run the following from the SAME interactive PowerShell with the working direct Claude login:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --auth-check --inherit-anthropic-auth-token
```

Only if the returned line is `Claude explicitly inherited token authentication: first-party-oauth` should a separate interactive `--run --inherit-anthropic-auth-token` acceptance be considered. The local `--run` keeps its `Y` approval, fixed text-only prompt, version check, no-tools CLI flags and bounded process. It still is **NOT a production Job-backed sandbox**. Other authentication methods and providers are refused when using the explicit token option; do not assume a different credential grants the same account entitlements or billing. The token is **not** registered in Tong, exported to files, or copied into the CLI command-line arguments. Do not paste its value into chat or commit it to Git.

### Stage H — real CLI failure telemetry without credential leaks

After the local Claude session invocation was retried with connectivity restored, the run still failed rapidly with `exitCode=1`. This rules out treating a prior temporary disconnection as the established root cause. **The exact original error remains unknown**, because the earlier runner suppressed stderr and structured output details.

The runner now computes **safe structured failure metadata**: `category`, `exitCode`, `elapsedMs`, `stdoutKind`, `stderrPresent`, recognized `resultType`/`resultSubtype`, and count of structured errors. It analyzes bounded CLI JSON `errors`, `error.message`, and failed `result` in memory to recognize authentication, network, model, quota or provider errors. It never prints or saves raw stderr, URLs, response text, tokens, account data or session prompts.

A further potentially important mismatch: the interactive shell can define `ANTHROPIC_BASE_URL` (custom provider/gateway) or model override environment variables while the filtered acceptance child omits those settings. A successful `auth status` does **not** prove that an actual model call targets the intended API endpoint. The `--auth-check` output now reports only booleans:
`customApiEndpointConfigured`, `modelOverrideConfigured`, `anthropicAuthTokenConfigured`, `anthropicApiKeyConfigured`. If the custom API endpoint exists, **the local --run fails closed before a model request**, rather than silently substituting a default endpoint. This change does not copy the endpoint or credentials into any log or Tong production grant. A separately reviewed user opt-in would be required for intentional gateway calls.

First, ask the user to run **only** the previous no-model, explicit-OAuth auth-check command and report the four boolean indicators, not endpoint values or tokens. Only after the endpoint / provider routing question is resolved should a new paid-model run be considered.

User should check locally:

```powershell
& 'C:\Users\Rune\.local\bin\claude.exe' auth status
```

If `loggedIn` is false, the user—not Tong—can run `& 'C:\Users\Rune\.local\bin\claude.exe' auth login` and complete authentication. Do not paste account IDs or credentials into chat. After authentication, rerun the opt-in acceptance command in that same local PowerShell. No automatic retry or production authorization change is permitted.

## DeepSeek Harness desktop distinction

- Local installed Desktop 0.2.0-rc.2 exposes a valid bundled `dsh.cmd`, so no second npm installation is needed.
- Stage E supports DSH `--dry-run` to inspect its version and planned Headless options. **DSH `--run` is intentionally disabled** until a restricted profile and independently authorized local runner are designed and checked. The default Headless profile may load tool plugins and credentials; a text-only prompt alone does not restrict OS capabilities.
- Even after a future approved Headless test, its session is **not automatically proven to appear in the Desktop UI**. Desktop's exclusive `desktop` profile is separate, and private session databases must not be edited to fabricate affiliation.

## Security and testing limitations

- This manual acceptance kit is **not OS sandboxed**, and its process tree termination is best effort rather than the native Supervisor's Job Object. The empty working directory and no-tools CLI options are helpful but do not limit the signed-in user's OS access. Do not use it on untrusted code or for project write tasks.
- A successful receipt verifies the response text and session ID, not complete system isolation or every capability supported by a provider.
- CI runs only synthetic validation, never provider applications or models.
- No automatic registration in Tong, no persistent provider grant changes, no new public MCP actions or release cutover are part of Stage E.

Tests: `node --test tests/Test-TongP3LocalAcceptance.mjs`. CI: `.github/workflows/p3-local-acceptance.yml` on Windows and Ubuntu.

Next: after the user runs and confirms the Claude acceptance, check the native session using the supported Claude CLI. In parallel, design a separate agent-specific Windows Job-backed runner, approval storage with exact request digests, account-safe environment, and a restricted DSH profile before real DSH agent turns.
