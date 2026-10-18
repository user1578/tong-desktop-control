# Tong P3 — Desktop-owned DeepSeek Harness CLI detection (Stage D)

Status: development-only, `codex/p3-dsh-desktop-runtime`. No production code deployment, Desktop automation, new model request, system PATH registration or changes to the user's existing DSH profile.

## Local observed facts (2026-10-19)

- Desktop executable: `C:\Users\Rune\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe`; five application processes were present.
- Desktop's `FileVersion`: `0.2.0-rc.2` (Windows `ProductVersion` metadata: `0.2.0.0`).
- Bundled CLI: `<Desktop installation>\resources\runtime\cli\bin\dsh.cmd`, exists and runs.
- Live read-only probes: `dsh.cmd --version` reported `0.2.0-rc.2`; `--profile headless --help` and `--profile sdk --help` succeeded.
- The global PATH did not contain `dsh`; therefore absence of a global command **does not** mean that DSH Desktop is missing.

## Official integration boundaries

Official reference: https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md . Desktop ships a supported CLI launcher; its UI can register the command with *Manage dsh Command…*, but registration is optional and not required by Tong.

Desktop owns the `desktop` profile, which the command cannot boot as a regular CLI profile. Headless and SDK launch **separate profiles** and do not automatically prove visibility/continuity in the Desktop UI. Some product state under DSH_HOME may be shared, but never read or alter Desktop private session databases to fake integration. True external Desktop session continuation remains a separate acceptance item requiring a documented public API or observed supported behavior.

## New module

`scripts/TongDshDesktopRuntime.mjs` provides `discoverDshDesktopRuntime()` and `verifyDshDesktopCliVersion()`.

- Locates the user's installed Desktop under `%LOCALAPPDATA%\Programs\DeepSeek Harness` (with a user-profile fallback) without global PATH edits.
- Confirms Desktop EXE and bundled CLI are regular files within one canonicalized installation directory; rejects symbolic links, missing or redirected files.
- Returns a *read-only descriptor* with an explicit `desktopSessionInterop: 'unverified'` status; it does not invoke applications or authorizations.
- Validates a separately gathered bounded `--version` result. Only the caller's approved runner may execute any profile; no code path falls back to npm installation.

## Tests and next milestones

- `node --test tests/Test-TongDshDesktopRuntime.mjs` — synthetic Windows install tests on Windows and Ubuntu.
- On a real authorized Windows desktop, set `TONG_TEST_INSTALLED_DSH_DESKTOP=1` only for the test process to additionally check the existing EXE and CLI file metadata, without launching DSH.
- `.github/workflows/p3-dsh-desktop-runtime.yml` runs portable contract tests on Windows and Ubuntu.
- Continue Claude only through its CLI. For DSH choose the user-installed bundled CLI and a **separate Tong-owned runtime profile/home**, not Desktop's exclusive profile. The current Python SDK bridge remains a separate experimental adapter until that distribution is verified.
- Before claiming the DSH sessions appear in Desktop or are recoverable there, perform user-approved real-session acceptance against a supported interface, preserving the user's logged-in desktop and existing sessions.
