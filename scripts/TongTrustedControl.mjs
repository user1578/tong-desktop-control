import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { TongProjectAccess } from "./TongProjectAccess.mjs";
import { TongTrustedPolicy, TongTrustedCodexBroker, normalizeLoopbackProxy } from "./TongTrustedCodexBroker.mjs";
import {confirmLocally} from './TongLocalConfirmation.mjs';
import {authorizeAgentDockDevelopment} from './TongAgentDockAuthorization.mjs';

const input = process.argv.slice(2);
let stateDir;
if (input[0] === "--state-dir") {
  if (!input[1] || !isAbsolute(input[1])) throw new Error("State directory must be absolute");
  stateDir = resolve(input[1]);
  input.splice(0, 2);
}
const policy = new TongTrustedPolicy(stateDir ? { policyPath: join(stateDir, "trusted-codex.json"),
  taskStatePath: join(stateDir, "agent-tasks.json") } : {});
const access = new TongProjectAccess(stateDir ? { registryPath: join(stateDir, "project-access.json"),
  agentAccessPath: join(stateDir, "agent-execution.json") } : {});
const [command, ...args] = input;

function usage() {
  throw new Error("Usage: node scripts/TongTrustedControl.mjs [--state-dir ABSOLUTE_DIRECTORY] status | proxy set LOOPBACK_HTTP_URL | proxy off | enable --codex ABSOLUTE_CODEX_EXE | disable | stop | grant PROJECT_ID | authorize-development PROJECT_ID [--git-commit] [--git-push] | preflight PROJECT_ID | revoke PROJECT_ID | task TASK_ID | approve TASK_ID");
}

try {
  if (command === "status" && args.length === 0) {
    console.log(JSON.stringify(await policy.status(), null, 2));
  } else if (command === "proxy" && args[0] === "set" && args.length === 2) {
    const origin = normalizeLoopbackProxy(args[1]);
    await confirmLocally({action:"Enable Codex-only local proxy "+origin,targets:"Tong trusted Codex proxy policy",
      scope:"Only future Codex App Server child processes use this loopback proxy. Does not change Windows proxy settings.",
      risk:"If the local proxy is unavailable, Codex network requests may fail.",
      recovery:"Use proxy off from a local interactive PowerShell 7 terminal.",
      duration:"Persists until disabled or changed."});
    const stored = await policy.configureCodexProxy(origin);
    console.log("Codex-only local proxy stored: "+stored);
  } else if (command === "proxy" && args[0] === "off" && args.length === 1) {
    await confirmLocally({action:"Disable Codex-only local proxy",targets:"Tong trusted Codex proxy policy",
      scope:"Future Codex App Server child processes use the default network behavior; existing turns stay unchanged.",
      risk:"Previous Codex reconnect delays may return.",recovery:"Use proxy set with the same trusted loopback address.",
      duration:"Persists until changed."});
    await policy.configureCodexProxy(null);
    console.log("Codex-only local proxy disabled.");
  } else if (command === "enable" && args.length === 2 && args[0] === "--codex") {
    await policy.enable(args[1]);
    console.log("Trusted Windows Codex enabled locally. Each project and task still requires its own grant and approval.");
  } else if (command === "disable" && args.length === 0) {
    await policy.disable();
    console.log("Trusted Windows Codex disabled. Running turns were asked to stop.");
  } else if (command === "stop" && args.length === 0) {
    await policy.emergencyStop();
    console.log("Emergency stop recorded. Running turns were asked to stop; descendant process cleanup is not guaranteed.");
  } else if (command === "grant" && args.length === 1) {
    await policy.grant(args[0], access);
    console.log(`Trusted execution granted to project ${args[0]}.`);
  } else if(command === 'authorize-development' && args.length >= 1) {
    const dock={gitDiffPaths:[]};let dockPolicy;
    for(let i=1;i<args.length;i++){
      if(['--git-commit','--git-push'].includes(args[i]))continue;
      const key={'--agentdock-policy':'policy','--git-exe':'gitExe','--python-exe':'pythonExe','--pytest-entry':'pytestEntry','--git-diff-path':'gitDiffPaths'}[args[i]];
      if(!key||!args[i+1])usage();const value=args[++i];
      if(key==='policy')dockPolicy=value;else if(key==='gitDiffPaths')dock.gitDiffPaths.push(value);else dock[key]=value;
    }
    const project=(await access.listProjects()).find(p => p.id === args[0] && p.available && p.status === 'enabled');
    if(!project || !await access.authorize('project.write',project.id) || !await access.authorize('agent.execute',project.id)) throw new Error('Project requires write and agent.execute authorization');
    const gitCommit=args.includes('--git-commit'),gitPush=args.includes('--git-push');
    await confirmLocally({action:'持续允许项目内文件读写/常规清理、代码开发、构建测试调试、项目依赖安装、Codex 会话创建和继续'+(gitCommit?'、Git 提交':'')+(gitPush?'、Git 推送':'')+(dockPolicy?'；同时启用 AgentDock 项目文件操作和已列出的固定测试/Git 读命令':''),targets:project.root+(dockPolicy?'；AgentDock 本地策略：'+dockPolicy+'；固定命令配置：'+JSON.stringify(dock):''),scope:'新增持续开发授权；不包含生产部署、系统设置/权限/服务、重要数据删除或其他项目',risk:'项目代码可能被修改'+(gitPush?'，提交可能被推送至项目远端':''),recovery:'撤销项目或可信执行权限；按已有 Git 历史及备份恢复文件',duration:'直到本人撤销或调整；包含本项目后续普通开发任务'});
    await policy.authorizeDevelopment(project.id,access,{gitCommit,gitPush,expectedRoot:project.root});
    if(dockPolicy)await authorizeAgentDockDevelopment(access,dockPolicy,project.id,{...dock,trustedPolicyPath:policy.policyPath});
    console.log('Persistent development authorization saved. System, production and outside-project rights were not granted.');
  } else if(command === 'preflight' && args.length === 1) {
    const project=(await access.listProjects()).find(p => p.id === args[0]);
    if(!project) throw new Error('Project not found');
    const broker=new TongTrustedCodexBroker({access,policy});
    console.log(JSON.stringify((await broker.preflight({projectId:project.id,projectRoot:project.root})).authorization,null,2));
  } else if (command === "revoke" && args.length === 1) {
    await policy.revoke(args[0]);
    console.log(`Trusted execution revoked from project ${args[0]}.`);
  } else if (command === "task" && args.length === 1) {
    const state = JSON.parse(await readFile(policy.taskStatePath, "utf8"));
    const task = state?.tasks?.find((item) => item.taskId === args[0]);
    if (!task) throw new Error("Task not found");
    console.log(JSON.stringify({ taskId: task.taskId, status: task.status, projectId: task.projectId,
      projectRoot: task.projectRoot, task: task.task, scope: task.scope,
      continuationMessage: task.continuationMessage, timeoutMs: task.timeoutMs,
      codexSessionId: task.codexSessionId, sessionMode: task.sessionMode,
      pendingApproval: task.pendingApproval }, null, 2));
  } else if (command === "approve" && args.length === 1) {
    const {task,fingerprint}=await policy.taskForConfirmation(args[0]);
    await confirmLocally({action:task.task+(task.continuationMessage?'\n继续消息：'+task.continuationMessage:''),targets:task.projectRoot,scope:'本次任务申请：'+task.scope+'；类型：'+(task.workType ?? 'legacy')+'；所需能力：'+JSON.stringify(task.requiredCapabilities ?? ['project.read','project.write','command.execute','dependency.install','codex.session'])+'。不自动扩大操作系统权限。',risk:'仅执行上面明确范围内的任务；高影响操作可能影响代码、环境或数据，必须先具备对应备份',recovery:'取消任务、撤销项目授权；恢复依赖任务中明确的 Git 或备份材料',duration:'本次完整任务/执行流程一次，最长 '+task.timeoutMs+' 毫秒；不包含未列明的后续任务'});
    await policy.approveTask(args[0],fingerprint);
    console.log(`Approved one execution of task ${args[0]}.`);
  } else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Trusted control failed");
  process.exitCode = 1;
}
