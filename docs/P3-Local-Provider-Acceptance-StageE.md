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

The script refuses `--run` from Tong's non-interactive shell or CI. It prints the exact binary and test scope, then asks `Approve ONE text-only Claude test? Type Y:`. Any answer other than the exact capital `Y` cancels. The tested Claude flags are `-p --output-format json --tools '' --strict-mcp-config --disable-slash-commands --permission-mode dontAsk --session-id <UUID>`; the prompt is delivered via stdin. Existing Claude authentication is used (no extra login). It verifies the pinned Claude Code version `2.1.236` and checks the executable hash before launch, executes from a fresh empty temp workspace, caps output/time and writes only a limited report to a fresh temp folder. It does not print full stderr or raw provider stdout.

After a successful new-session receipt, the user can request continuation by passing the **verified** returned session ID:

```powershell
& 'D:\node\node.exe' .\scripts\Run-TongP3LocalAcceptance.mjs --provider claude --run --session-id '<the actual returned UUID>'
```

Again an independent interactive `Y` is required. The session's origin is Claude CLI and its native continuation must be confirmed by the actual provider. This is *not* a Claude Desktop session.

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
