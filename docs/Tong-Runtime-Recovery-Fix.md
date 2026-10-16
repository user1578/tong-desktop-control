# Tong 运行恢复修复与部署准备

本轮基线为 `2de48eac0f61f00dc16ee54692d0da2053f57bd3`，开发分支为 `codex/p25-tong-migration`。只开发、隔离测试和准备候选；正式 P1、任务、双 pin、profile、授权、运行记录及历史证明未切换或清理。候选的最终 commit 和文件 SHA-256 以本轮发布材料的 `release/release-manifest.json`、`deployment.json` 为准。

## 诊断结论及证据边界

- **首次退出根因尚未证实。** P1 在 `2026-10-16T11:37:04.547Z` 就绪，登录监控于 `12:15:51.661Z` 报失联；运行记录最后保持 ready，未记录子进程退出。该 run 为 `171a4a0b-ba6b-47a1-a4e6-f7ec9fb6879c`。Guardian 只有启动记录，没有 finishedAt、对应退出事件或 guardian-failure.json。限定时间的 TaskScheduler Operational / Application Error / WER 查询未取得解释此次退出的事件；不能证明 Scheduler 已重试，也不能据此断言 Windows 或 Codex 终止了服务。
- **已确认：** 旧监控在发现 Supervisor 不存活或不再 ready 时立即退出 1。任务定义有登录延迟 20 秒、IgnoreNew、无限运行时间、失败重试 3 次/间隔 1 分钟，但即使重试进入旧 manager，也可能被固定文件名证明阻塞。
- **已确认：** 固定 `stale-reconciliation.json` 用独占创建，现存证明属于 `db1c58c8-4fe2-4841-9abc-473b2a16f773`，与当前 P1 run 不同。历史证明冲突是恢复缺陷，不能解释第一次进程退出。
- Guardian 的私有 Job 使用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。最后一个句柄关闭会终止该 Job 及下级 Job 的进程；正常结束会写清理和退出记录，外部强制终止或登录会话结束可能来不及执行 catch/finally。详见 [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。这条机制可以解释一种故障形态，仍不是此次首次退出的根因证明。
- 原生 Codex App Server / Native Worker 的取消和清理针对其自己创建的 ChildProcess / 私有 Job；未发现按正式 Supervisor PID、全局进程名或父级 Job 终止 Tong 的代码路径。本轮未修改原生会话能力。
- 登录任务仍为现有 Interactive 登录上下文；本轮不承诺用户注销后继续运行。要求是下次 Windows 登录恢复，不需要创建服务、账号或任务。

## 修改行为

1. 新证明为 `run/stale-reconciliation.<runId>.json`，独占创建、不可覆盖。v2 保存原 runtime/guardian JSON 字节及其 SHA-256；审计追加在 `logs/reconciliation.jsonl`。同 run 有效证明重复协调返回 alreadyReconciled；不同 run 不冲突。旧 v1 固定文件原地保留、兼容读取；损坏、当前 run 哈希不符或两份证据冲突均拒绝恢复。
2. 所有原记录 PID 必须消失；PID 仍存在，包括身份不匹配或复用，均拒绝。相关三个端口必须空闲。新 Guardian 使用按 run ID 命名的 Job，并实际查询其 active process count，包含最后快照未记录的成员。旧无名 Job 仅沿用 jobAssigned、全部已记身份消失、端口空闲的既有恢复条件，不伪造 native Job 清理回执。
3. 监控通过原 manager 的 status / reconcile-stale / start / stop-run 和版本绑定登录 grant 恢复，继续使用既有 lifecycle mutex 与 backup.freeze。最多每 30 分钟 3 次恢复、间隔至少 60 秒，预算持久化到 `run/login-recovery-budget.json`，Scheduler 重启不会清零；预算损坏或安全检查失败保留现场并退出 1。跨 PS5.1/PS7 的 JSON 日期类型显式处理。
4. 三次连续健康失败后，只允许按当前 run ID 受控停止，再尝试恢复。观察到同 run stop.json 时正常退出监控，防止主动停机被 Scheduler 拉起。健康运行和其他启动中的实例不重复创建 Supervisor。
5. 隐藏启动使用显式 `CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_CONSOLE`，不继承句柄；调用方 Job 禁止脱离时拒绝启动。只有启动器明确证明尚未创建 Guardian，manager 才释放该失败启动的锁；超时、错误确认或未知子进程继续保留现场。消除仅靠新控制台隔离生命周期的不充分条件，保留 Windows PowerShell 5.1 的正式宿主契约。
6. Guardian 新增阶段、Job 分配、每分钟心跳、失败和关闭记录；Supervisor 新增同步致命异常元数据和退出码记录。Supervisor 在首份 runtime 之前退出时，Guardian 核对 request 后写本 run 终态，使后续连续失败仍可安全重试。日志不记录环境、原始异常消息或凭据。

## 验证与限制

执行入口均在开发目录，测试 root 使用 `D:\Tong\state\b23-login-*` / `login-test-*` / `guardian-test-*`，故障只终止夹具的精确进程身份。三组件使用独立端口 17876/17877/18766，协调拒绝测试使用 27886/27887/28776，早退测试使用 27876/27877/28766。只有固定 AgentDock exe 被只读复用，不操作其生产实例。

- `Test-TongStaleRuntimeReconciliation.mjs`：不同 run、同 run 幂等、旧 v1 证明、hash 损坏、文件冲突、活进程/PID 复用、占用端口、命名 Job 中未入快照的活成员。
- `Test-TongLoginManagement.mjs`：PS5.1/PS7 的启动、停止、监控恢复、跨 Scheduler 重试的预算、损坏预算、锁竞争、主动停止、既有任务登录触发和重试配置。Task Scheduler 边界在隔离 harness 中模拟，不注册实际任务。
- `Test-TongLoginAutoRecovery.mjs`：实际三组件正常启停重启、Supervisor 意外退出、连续两次 Guardian 意外退出、旧证明保留、正常健康复用、关闭监控后服务仍健康、grant 撤销。
- `Test-TongRuntimeStartupCleanup.mjs`：连续三次首份记录前退出，终态 run ID 与 Guardian 对齐，锁释放，包含缺记录与旧运行记录场景。
- `Test-TongRuntimeGuardian.mjs`：PS5.1/PS7 隐藏启动、正常清理与退出码；启动方置于允许脱离且关闭即杀的 Job，随后退出，Guardian 仍独立完成工作。
- `Test-TongLoginRecoveryAuthorization.mjs`、`Test-TongProductionRuntimeGate.mjs`、`Test-TongRuntimePowerShell.ps1`：持续授权范围、版本绑定、撤销、拒绝伪授权、脚本解析和外部 tunnel 边界。

这些是开发和隔离证据，不能代替真实重启/登录、真实关闭 Codex 客户端和正式端口的验收。依赖仅复制一份约 601 MB，并各保留一份约 12 MB DevSpace 相对导入文件；失败夹具、旧运行证据和日志保留，后续重试复用该目录，不重装依赖或 Worker。

## 准确部署文件与绑定

app `D:\Tong\app` 与 manager `D:\Tong\runtime\releases\manager` 各需同步以下 6 个运行脚本：

- `scripts/TongAgentDockRuntime.mjs`
- `scripts/TongLoginRuntime.ps1`
- `scripts/TongRuntimeGuardian.ps1`
- `scripts/TongRuntimeLaunch.ps1`
- `scripts/TongRuntimeSecurity.mjs`
- `scripts/TongRuntimeSecurity.ps1`

完整 sourceFiles 校验还要求两个目标同步本次文档及 6 个测试/夹具：`docs/Tong-Runtime-Recovery-Fix.md`、`tests/Test-TongLoginAutoRecovery.mjs`、`tests/Test-TongLoginManagement.mjs`、`tests/Test-TongRuntimeGuardian.mjs`、`tests/Test-TongRuntimeStartupCleanup.mjs`、`tests/Test-TongStaleRuntimeReconciliation.mjs`、`tests/fixtures/TongLoginRecoveryFixture.mjs`。共 13 个源码文件/目标。精确 before/after digest、候选及回滚位置由候选材料 deployment.json 列明；不能只换 6 个运行脚本后声称完整 pin 校验通过。

另外需要在批准的正式维护窗口更新：

- `D:\Tong\runtime\login-management\TongLoginRuntime.ps1`，必须与新 manager manifest 的 runnerSha256 相同。
- `run/release-pin.json`、`run/manager-pin.json`，分别绑定完整的新发布 manifest；`profile.json` 仅改变 sourceDigest/releaseDigest，拓扑保持原值。
- 使用既有 start、stop、enable-agentdock、manager 维护许可和 `TongProductionApproval.ps1` 原版挑战。新版本的登录恢复 descriptor 绑定两份 profile/digest 和 runnerSha256，必须本人重新启用。授权持续到撤销或版本改变；不包含业务权限。

不更新依赖、DevSpace patch、OAuth、ngrok、PIN、业务文件或计划任务定义。既有 `D:\Tong\state\p1-deploy-2de48ea` 的材料是历史 P0→P1 专用且哈希固定，不能直接重跑。复用其版本验证、精确增量、维护窗口互斥、受控切换和停止后回滚方式，为本候选重新绑定材料；不复制旧版本常量冒充新授权。

## 待批准维护窗口的顺序

1. 只读重验候选 manifest、Node/原生/依赖哈希、13 个增量的 before/after、回滚副本及原版挑战入口；复核正式 run、PID 身份、端口、双 pin/profile、恢复 grant、runner 与任务 XML。存在漂移、未知进程或证据损坏时停止。
2. **先恢复当前 P1。** 需明确授权处理当前 stale_record 及旧固定证明：验证当前旧 Supervisor/Guardian/关联进程均已消失、端口清空；将已知旧固定证明按其 run ID 和原 hash 独占归档，保留原字节、原 runtime/guardian 和审计。仅为旧 manager 当前协调腾出固定名；通过其原恢复授权执行 reconcile-stale，再 start、doctor。不能删除证据、改 run ID、强杀未知 PID或伪造 finishedAt。本轮未执行这些操作。
3. P1 ready/healthy 后进入同一个有界维护窗口，持有既有 lifecycle mutex；停止既有监控实例，按本 run stop-run 并确认 Guardian finishedAt、Job active=0、全部身份和端口已清理。备份本次确切增量、双 pin、profile、runner 和恢复密文的原字节/哈希到受保护回滚目录；保留完整恢复审计，不备份或回灌业务数据。
4. 本人完成新版本维护挑战后，精确增量替换 app、manager 和部署 runner，核验全部 source/native/patched 文件；通过原 pinRuntimeRelease/updateRuntimeProfile 机制更新绑定。本人的持续登录恢复挑战成功后，独立验证 descriptor、双 pin 和 runner 哈希，再通过正式 manager 启动。任何拒绝均保留现场，停止切换或回滚。
5. 释放互斥后只启动同一个既有 TongLoginRuntime 任务，不重新注册/更改设置。检查任务持续 Running、正式 7676/7677/18765、manager doctor healthy、guardian/session/日志和双 pin；随后由用户完成一次真实 Codex 关闭观察及 Windows 重启登录恢复。正式故障注入需另有具体授权，不能用本轮模拟结果替代。
6. 失败时先停止本候选的确切运行并确认其 Job 清理；按 deployment.json 的 before hash 恢复增量、双 pin、profile 和旧 runner。新增源码移入受保护 retained 目录而非删除。旧恢复密文仅在当前密文属于本维护窗口且未撤销时才可恢复；否则保留独立新授权并由本人用原版挑战重新绑定 P1。不得清除审计或自动复活已撤销 grant。验证完整 P1 候选、授权、start/doctor及原任务；回滚失败停在安全停止状态，报告具体差异，不越过验证强启。

批准时应说明：具体允许的 P1 恢复与候选切换范围、两个源码目标及绑定/runner、是否含原证明归档、最坏为服务继续停止/需回滚、恢复材料位置，以及仅本维护窗口有效；业务权限和系统配置不在其中。此次开发授权不包含上述正式操作。
