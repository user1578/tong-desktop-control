import { TongCodexWorker } from "./TongCodexWorker.mjs";
import { serveTongCodexWorker } from "./TongWorkerStdio.mjs";
import { assertWorkerEnvironment } from "./TongWorkerProtocol.mjs";

const workerEnvironmentNames = new Set([
  "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "HOME", "CODEX_HOME", "PATH", "PATHEXT", "ComSpec",
  "TONG_WORKER_BOOTSTRAP", "TONG_WORKER_TASK_ID", "TONG_WORKER_TASK_SID",
  "TONG_WORKER_SID", "TONG_GATEWAY_SID", "TONG_GATEWAY_ACCOUNT_SID", "TONG_SUPERVISOR_SERVICE_SID",
  "TONG_WORKER_APPCONTAINER_SID", "TONG_WORKER_PROJECT_ROOT", "TONG_WORKER_TOKEN_VERIFIED",
  "TONG_WORKER_TASK_ACL_VERIFIED", "TONG_WORKER_JOB_VERIFIED", "TONG_WORKER_IPC_VERIFIED",
  "TONG_WORKER_NATIVE", "TONG_WORKER_CODEX", "TONG_WORKER_CODEX_SHA256",
].map((name) => name.toLowerCase()));
if (Object.keys(process.env).some((name) => !workerEnvironmentNames.has(name.toLowerCase()))) {
  throw new Error("Native Worker environment contains an unexpected variable");
}

async function inspectNative(request) {
  if (request.taskId !== process.env.TONG_WORKER_TASK_ID) throw new Error("Native Worker task identity mismatch");
  if (request.projectRoot.toLowerCase() !== process.env.TONG_WORKER_PROJECT_ROOT?.toLowerCase()) {
    throw new Error("Native Worker project root mismatch");
  }
  if (["TONG_WORKER_TOKEN_VERIFIED", "TONG_WORKER_TASK_ACL_VERIFIED",
    "TONG_WORKER_JOB_VERIFIED", "TONG_WORKER_IPC_VERIFIED"].some((name) => process.env[name] !== "1")) {
    throw new Error("Native Supervisor isolation attestation is incomplete");
  }
  const workerSid = process.env.TONG_WORKER_SID;
  const gatewaySid = process.env.TONG_GATEWAY_SID;
  const taskSid = process.env.TONG_WORKER_TASK_SID;
  const appContainerSid = process.env.TONG_WORKER_APPCONTAINER_SID;
  if (![workerSid, gatewaySid, taskSid, appContainerSid].every((sid) => typeof sid === "string" && /^S-1-(?:\d+-)+\d+$/.test(sid))) {
    throw new Error("Native Worker security identity is invalid");
  }
  return { ready: true, gatewaySid: process.env.TONG_GATEWAY_SID,
    workerSid, ipcPeerSid: gatewaySid, restrictingSid: taskSid, appContainerSid,
    taskId: request.taskId, projectId: request.projectId, projectRoot: request.projectRoot,
    restrictedToken: true, taskAclVerified: true,
    credentialsSeparated: workerSid.toLowerCase() !== process.env.TONG_GATEWAY_ACCOUNT_SID?.toLowerCase(),
    cleanEnvironment: true, jobObjectKillOnClose: true, privateIpcAuthenticated: true,
    appContainerBoundary: true };
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
