import { execFile } from "node:child_process";

// Only fixed Codex thread URLs can be passed to the Windows protocol handler.
// A failed UI launch must not affect an independently successful Codex task.
const NATIVE_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function openCodexDesktopThread(threadId, { platform = process.platform, execute = execFile } = {}) {
  if (platform !== "win32" || typeof threadId !== "string" || !NATIVE_THREAD_ID.test(threadId)) return false;
  const url = `codex://threads/${threadId}`;
  await new Promise((resolve, reject) => {
    execute("pwsh", ["-NoProfile", "-NonInteractive", "-Command",
      `Start-Process -FilePath '${url}'`], { windowsHide: true, timeout: 8_000 },
    (error) => error ? reject(error) : resolve());
  });
  return true;
}
