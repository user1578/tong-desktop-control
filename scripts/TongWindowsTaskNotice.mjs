import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./TongWindowsTaskNotice.ps1", import.meta.url));
const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const STATUSES = new Set(["success", "failed", "cancelled", "waiting_user_action"]);

// Show a short, dismissible local Windows desktop card. Not a ChatGPT reply,
// and not the Windows notification center. Never block Codex's task queue
// for the card's display lifetime.
export async function notifyWindowsTask({ projectId, status } = {},
  { platform = process.platform, launch = spawn } = {}) {
  if (platform !== "win32" || !PROJECT_ID.test(projectId ?? "") || !STATUSES.has(status)) return false;
  const child = launch("pwsh",
    ["-NoProfile", "-NonInteractive", "-Sta", "-File", scriptPath,
      "-ProjectId", projectId, "-TaskStatus", status],
    { windowsHide: true, detached: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return true; // Process launched, not proof that the user saw the card.
}
