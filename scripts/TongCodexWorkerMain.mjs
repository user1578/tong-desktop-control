import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TongCodexWorker } from "./TongCodexWorker.mjs";
import { serveTongCodexWorker } from "./TongWorkerStdio.mjs";
import { assertWorkerEnvironment } from "./TongWorkerProtocol.mjs";

const execFileAsync = promisify(execFile);
const workerEnvironmentNames = new Set([
  "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "HOME", "CODEX_HOME", "PATH", "PATHEXT", "ComSpec",
  "TONG_WORKER_BOOTSTRAP", "TONG_WORKER_TASK_ID", "TONG_WORKER_TASK_SID",
  "TONG_WORKER_SID", "TONG_GATEWAY_SID", "TONG_GATEWAY_ACCOUNT_SID", "TONG_SUPERVISOR_SERVICE_SID",
  "TONG_WORKER_NATIVE", "TONG_WORKER_CODEX", "TONG_WORKER_CODEX_SHA256",
].map((name) => name.toLowerCase()));
if (Object.keys(process.env).some((name) => !workerEnvironmentNames.has(name.toLowerCase()))) {
  throw new Error("Native Worker environment contains an unexpected variable");
}

async function inspectNative(request) {
  if (request.taskId !== process.env.TONG_WORKER_TASK_ID) throw new Error("Native Worker task identity mismatch");
  const { stdout } = await execFileAsync(process.env.TONG_WORKER_NATIVE,
    ["--attest", process.env.TONG_WORKER_SID, process.env.TONG_WORKER_TASK_SID,
      process.env.TONG_GATEWAY_ACCOUNT_SID, request.projectRoot, request.taskId,
      process.env.TONG_SUPERVISOR_SERVICE_SID],
    { windowsHide: true, shell: false, timeout: 5_000, maxBuffer: 8_192,
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TONG_WORKER_TASK_ID: process.env.TONG_WORKER_TASK_ID,
        TONG_WORKER_TASK_SID: process.env.TONG_WORKER_TASK_SID } });
  const attestation = JSON.parse(stdout);
  if (attestation.verified !== true || attestation.actualSid?.toLowerCase() !== process.env.TONG_WORKER_SID?.toLowerCase()) {
    throw new Error("Native Worker token, Job, or ACL attestation failed");
  }
  return { ready: true, gatewaySid: process.env.TONG_GATEWAY_SID,
    workerSid: attestation.actualSid, ipcPeerSid: process.env.TONG_GATEWAY_SID,
    restrictingSid: attestation.restrictingSid,
    taskId: request.taskId, projectId: request.projectId, projectRoot: request.projectRoot,
    restrictedToken: attestation.restrictedToken, taskAclVerified: attestation.taskAclVerified,
    credentialsSeparated: attestation.credentialsSeparated, cleanEnvironment: attestation.cleanEnvironment,
    jobObjectKillOnClose: attestation.jobObjectKillOnClose, privateIpcAuthenticated: true };
}

const environment = assertWorkerEnvironment(Object.fromEntries([
  "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "HOME", "CODEX_HOME", "PATH", "PATHEXT", "ComSpec",
].map((name) => [name, process.env[name]])));

const worker = new TongCodexWorker({
  policy: { codexExecutablePath: process.env.TONG_WORKER_CODEX,
    codexExecutableSha256: process.env.TONG_WORKER_CODEX_SHA256,
    environment },
  inspectIsolation: inspectNative,
});

await serveTongCodexWorker({ worker, bootstrapSecret: process.env.TONG_WORKER_BOOTSTRAP,
  input: process.stdin, output: process.stdout });
