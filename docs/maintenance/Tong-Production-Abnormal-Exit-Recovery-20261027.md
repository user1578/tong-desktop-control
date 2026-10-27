# Tong生产异常退出诊断与最小恢复记录（2026-10-27）

**结论：本轮最小恢复已成功，READY、doctor.healthy=true、三端口及Codex侧认证MCP均通过实测；网页端独立复验与底层native/监控异常原因仍有明确边界。**

## 本次故障与直接触发链

只读基线：正式runtime/run/runtime.json为abnormal_exit，旧runId为1ea3cb16-2266-41d2-b134-843aca4ae614；7676/7677/18765均未监听，TongLoginRuntime为Ready、Enabled、LastTaskResult=1，正式TongLoginHost/AgentDock/旧Supervisor/Guardian均未运行；ngrok服务仍运行。双pin为b9fe80150f9cdea47130e8952e85e39503187677，sourceDigest=c1bc5c18e5a91193a8d634c14a82cc2e56675c5db28e28de252e70c0d6593888，releaseDigest=1f3cfcfd6f12212e1c9eb82e5de93c889dd52d82a16bbeba26cde1f365551015。没有用当前文档分支HEAD替换生产绑定。

时间线（JST；原日志为UTC）：

| 时间 | 实测事件 | 证据 |
| --- | --- | --- |
| 10月27日01:26:58.323 | 旧run进入ready | runtime/logs/lifecycle.jsonl，event=ready |
| 01:27:21.625 | 登录Runner完成健康验收 | login-management.jsonl，runtime_healthy，runnerPid=7916 |
| 12:22:39.585 | 定期doctor进程native退出，0xC0000409（-1073740791），输出为空 | login-management.jsonl，manager_command_failed，managerAction=doctor |
| 12:22:39.608 | Runner因doctor异常退出，Host转交退出码1 | login-management.jsonl runner_failed；部署的TongLoginHost.cs返回Runner退出码；计划任务LastTaskResult=1 |
| 19:02:22.273 | Supervisor主动进入异常关闭，reason=MONITOR_FAILED | 同run的lifecycle.jsonl；不是CHILD_EXIT或startup_failure |
| 19:03:47.566/569 | Gateway、DevSpace分别exit 0 | 同run process_exit，发生在shutdown之后 |
| 19:03:52.210 | AgentDock exit 1 | 同run process_exit，属于关闭过程中的结果，不能反推为最初触发因素 |
| 19:03:53.776 | shutdown_complete，phase=abnormal_exit，remainingPids=[] | lifecycle.jsonl及runtime.json |
| 19:03:55.896/977 | Guardian确认Job清理到0、Supervisor exit 1、关闭Job句柄 | guardian.json、guardian.jsonl和supervisor.jsonl |
| 19:33:40之后 | 第一批两处历史npm缓存删除 | Tong-Disk-Cleanup-Batch1-20261027.md；故障早于删除 |

**确定的触发路径**：已正常运行的Supervisor在周期监控里捕获异常，按fail-closed逻辑以MONITOR_FAILED关闭全套服务；此前登录监护Runner已因一次native doctor进程非零退出而结束，故没有持续监护进程在本次关闭后恢复服务。部署TongAgentDockRuntime.mjs:447/467显示监控分支只读取stop请求、枚举后代并持久化状态；异常统一转成MONITOR_FAILED。TongLoginRuntime.ps1的Runtime函数对native非零退出直接throw，外围catch记录runner_failed并exit 1；三次连续健康失败逻辑只覆盖正常返回healthy=false，不能覆盖本次native失败。

**仍不能确定的底层原因**：MONITOR_FAILED的catch没有保存原异常/阶段，安全辅助程序stderr被丢弃，因此无法从本次现有日志区分具体是CIM/后代查询、辅助PowerShell、读写持久化或其他监控子步骤失败。0xC0000409在部署诊断函数中分类为native_fast_fail，但没有本次崩溃栈/转储证明其微观原因，也不能证明12:22的native失败与19:02的监控异常来自同一底层缺陷。此次是已知触发链上的最小运行恢复，不是声称已修复长期稳定性的根本软件缺陷。

## 已排除与证据限制

- 本次旧run此前已ready并持续运行约17.6小时，没有本次startup_failure证据；不能拿10月26日以前的START_TIMEOUT、EPERM、ACL_DENIED直接归因。
- Host.failure.log最后修改在10月17日，属于旧事故，不能拿其中日志文件占用当作今天原因。host.stderr.log包含混合历史错误，只有本次login-management.jsonl的时间/action/exitCode用于结论。
- Guardian记录runId/nodePid匹配，jobActiveAfterCleanup=0，finishedAt已落盘；当前正式status确认supervisorAlive=false，原PID没有被当作仍在运行的证据。没有删旧状态、改PID记录或伪造清理证明。
- 预算文件原有一项10月27日01:24:46 JST的attempt，已经自然超出30分钟窗口，非耗尽。原始预算原件已保存，未手动清空/重置；正式Runner只按既有3次/30分钟、60秒间隔规则登记本次新尝试。
- 正式preflight-login退出0，approved=true、stopRunSupported=true、loginRecoverySupported=true；恢复授权与Runner哈希绑定有效。正式status退出0；恢复前doctor退出0、phase=abnormal_exit、healthy=false，但10项ACL全部secure。没有本次持续权限拒绝或认证失效证据，无需改ACL或重新授权。
- Task设置Enabled=true、ExecutionTimeLimit=PT0S、RestartCount=3、RestartInterval=PT1M；TaskScheduler Operational日志本来为Disabled，未开启。Application在两个故障时间窗查询1000/1001/1026、System在19:02附近查询2004/2019/2020均无匹配事件，不能据“无匹配”声称native崩溃或资源原因已被排除。未找到12:22之后自动重启的runner_started记录，调度器为何未持续恢复缺少任务历史证据，仍待后续专项分析。

## 最小恢复动作

本轮用户已授权诊断与使用现有正式恢复入口；未涉及升级、重部署、重建Host、修改ACL/认证、扩大权限、删除/重建运行态或重置恢复预算。既有版本绑定本机授权经正式入口验证有效，未产生新的人工挑战，也没有代填或绕过挑战。

1. 先读取通信交接和第一批清理记录，保护当前分支及已有用户修改。
2. 在正常权限下完成上述诊断、status、preflight-login及恢复前doctor；未触发生产启动。
3. 为避免正式启动按正常状态机更新runtime.json等文件后丢失事故身份，仅保存6个小型控制记录，合计6944字节，加一个清单文件：D:\Tong\state\production-abnormal-exit-20261027-1ea3cb16。包括旧runtime、guardian、request、budget、该run的guardian/launcher回执；逐文件复制后SHA-256一致。没有复制真实业务库、凭据、完整源码、node_modules或大型恢复副本。原始日志继续保留，未清理。
4. 2026-10-27 19:51:20 JST，仅执行一次Start-ScheduledTask -TaskName TongLoginRuntime，调用退出0。正式Host继续运行原打包PS5.1 Runner（版本绑定兼容要求），诊断命令使用PS7；没有把部署Runner改成PS7。
5. 正式Runner使用已有授权、Job/身份/端口/版本安全检查，自动写入新request。新runId为2b871eeb-ea5c-4690-b4ec-d46454f3a9ed，request创建于19:52:03.417 JST。原180秒总预算、DevSpace75秒/Gateway35秒及重试规则均不变；没有第二次Task.Run或直接另起Host来制造成功。

## 实际验收与最终状态

| 验收项 | 本轮实际结果 |
| --- | --- |
| 唯一正式任务启动 | Start-ScheduledTask仅1次，调用退出0；新Host PID49740、Runner PID28684，Task Running/Enabled |
| 新运行身份 | runId=2b871eeb-ea5c-4690-b4ec-d46454f3a9ed；Supervisor PID50596、Guardian PID47896，Guardian Job已分配、未结束 |
| READY | 19:54:12.451 JST，request→READY=129.034秒；DevSpace readiness=47.153秒，Gateway readiness=24.685秒，无本次startup_failure/child exits |
| 正式doctor | 部署manager的doctor --login-recovery --error-json退出0；phase=ready，healthy=true，10项ACL secure |
| AgentDock认证 | doctor.health.agentdock.authenticatedMcp=true，listTools=7 |
| Tong认证边界 | doctor.health.tong.discovery=true，unauthenticatedRejected=true（未认证MCP请求被拒绝） |
| 三端口 | 127.0.0.1:7676→PID21752；7677→25860；18765→5484，实际LISTEN |
| ngrok | Windows服务Running/Auto、原PID40764未重启；本地4040/api/tunnels返回200，HTTPS tunnel的publicOrigin与生产profile匹配，转发到http://127.0.0.1:7676 |
| 认证MCP通信 | 本Codex会话实际调用Tong连接器tong_list_projects成功，返回12个项目；不是只看到工具名或从旧聊天重述结果，未打印令牌 |
| Runner自身健康回执 | login-management.jsonl于19:54:35.669记录runtime_healthy，newRunId相同，supervisorAlive/guardianAlive均true |
| 预算 | 正式Runner自然淘汰超出30分钟窗口的旧attempt，并写入19:51:29.792 login_start这一项；未改limit/window/backoff、未手动重置；旧预算原件仍在小型事故快照 |
| 版本和配置 | 恢复前后profile、双pin、Host二进制、Runner脚本SHA-256全部一致；App/Manager仍为b9fe80150f9cdea47130e8952e85e39503187677，source/release digest均保持 |

19:56:22 JST再次只读观察：新run仍为ready、exits=[]，Host仅一个实例，Task仍Running。Task的LastTaskResult=267009（0x00041301，当前任务正在运行状态值），不是一次已结束任务的失败退出码；不能要求长期运行任务此时LastTaskResult必须为0。旧LastTaskResult=1及旧事故状态已经单独记录。

**网页端边界**：这里验证的是Codex侧真实认证连接器调用和本机正式doctor/端口/ngrok，不冒充用户ChatGPT网页会话的读写验收。请ChatGPT网页端重新调用tong_list_projects，并通过获准开发工作区读取本记录，核对新runId 2b871eeb-ea5c-4690-b4ec-d46454f3a9ed和本次时间线，即可确认其网页会话已重新连通；无须重启生产或使用旧nonce声称新一轮验收。真实Windows重启后恢复、长时间稳定性、本次未重做网页端新建/编辑文件均未验证。

### ChatGPT网页端独立复验（2026-10-27，本轮恢复后补充）

本记录原作者Codex完成验收后，ChatGPT网页会话通过**真实Tong MCP**再次执行以下只读操作，不依赖Codex聊天的口头回传：

- `tong_list_projects` 成功返回12个已登记项目。
- `tong_windows_inspect(processes, TongLoginHost)` 检测到恰好一个正式Host（PID49740），与恢复时记录匹配。
- `open_workspace(D:\\作业\\111)` 成功；`read` 真正读到此前网页端创建编辑的验收文件 `Tong-Web-Write-Test-20261027\\web-write-acceptance.txt`，内容含 `marker=TONG-WEB-20261027-111-7F4C9A` 和 `state=EDITED_AND_REREAD`。该旧marker只用于验证文件可读，不作为新一轮随机写入验收。
- `open_workspace(D:\\Tong\\development)` 成功后，`read` 实际读取本故障恢复记录和新runId。
- 使用该已授权开发工作区的PowerShell 7只读核验正式 `runtime/run/runtime.json`、TongLoginRuntime Task、Host进程和本地端口：`runId=2b871eeb-ea5c-4690-b4ec-d46454f3a9ed`、`phase=ready`、Task Running、Host数量1，127.0.0.1上7676、7677、18765均LISTEN，对应PID分别为21752、25860、5484。

**结论：ChatGPT网页端认证MCP真实连接和当前READY/核心进程、端口已独立复验通过。** 此次未再次运行原生doctor（避免为重复验证触发历史fast-fail），所以 `doctor.healthy=true` 仍以Codex恢复时实际正式doctor回执为证据；也没有执行新一轮write/edit、重启或长期稳定性验收。底层native/monitor故障原因未根治。

## 仍需处理的原因与风险

本轮恢复了当前运行与MCP通信，未复现或消除导致native_fast_fail/MONITOR_FAILED的底层缺陷。后续若再次出现，应在同一run的监控错误处保留最小脱敏阶段/原错误码，并获取native故障证据，再评估Runner是否应对native doctor异常采用既有预算下的有限处理；任何源码修复及部署都需独立评审/正式授权，不在本轮偷偷修改打包文件或扩大重试预算。调度器为何没有留下后续runner_started，也需有可用任务历史才能确认，不能根据当前任务配置推断历史已正确重试。

本次没有重新安装/部署、初始化数据库/认证、修改ACL或计划任务配置、清理事故材料、停止ngrok、重置恢复预算；仅使用预检通过的现有恢复授权启动一次正式任务。后续不要为“再证明成功”重复启动服务。

## 证据、文件与Git

- 私有原件位置：D:\Tong\runtime\logs\login-management.jsonl、lifecycle.jsonl、supervisor.jsonl、guardian.jsonl及login-management目录的Host日志；未把私有原始日志、令牌、OAuth或DPAPI封套上传GitHub。
- 小型事故快照：D:\Tong\state\production-abnormal-exit-20261027-1ea3cb16；6个控制记录6944字节，snapshot-manifest.json列出实际SHA-256。仅新增一份必要的覆盖前控制记录，不复制大型源码/依赖/状态备份。该私有目录不纳入Git提交。
- 唯一新增公开记录：docs/maintenance/Tong-Production-Abnormal-Exit-Recovery-20261027.md。既有未提交docs/maintenance/Tong-Five-Root-Consolidation-ChatGPT-Review-20261027.md保持原始SHA-256 52f8d54e08431b04b6d075d5c4ea7ba351b18ace6acbb19b893cbfbe8a192d79，不混入本次提交。
- 分支codex/024-maintenance-adapter-20261024；起始HEAD c45b5fef8f69df78035550baabc90d5308670dc1。只正常提交/推送本记录；main、其他分支和既有用户修改不变。实际提交SHA及push/upstream状态在最终聊天按真实回执报告（文档不能自引用自己的commit）。
- 验证为实际生产status/preflight、单次正式启动、正式doctor、MCP连接器、端口/任务/服务和原件哈希对照；未运行无关完整测试矩阵或大型隔离模拟，不声称它们passed。
