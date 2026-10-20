import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./TongWindowsTaskNotice.ps1", import.meta.url));
const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const STATUSES = new Set(["success", "failed", "cancelled", "waiting_user_action"]);

// A best-effort Windows desktop notification, not a ChatGPT message.
// Only project identifiers and fixed status labels are passed to the OS.
export async function notifyWindowsTask({ projectId, status } = {},
  { platform = process.platform, execute = execFile } = {}) {
  if (platform !== "win32" || !PROJECT_ID.test(projectId ?? "") || !STATUSES.has(status)) return false;
  await new Promise((resolve, reject) => {
    execute("pwsh", ["-NoProfile", "-NonInteractive", "-File", scriptPath,
      "-ProjectId", projectId, "-TaskStatus", status],
    { windowsHide: true, timeout: 12000 }, error => error ? reject(error) : resolve());
  });
  return true;
}
