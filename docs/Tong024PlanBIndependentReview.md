# 024 方案B最终独立复核（2026-10-25）

**NOT READY。未实现、未启用可执行的生产恢复器，也未执行生产恢复。** 本轮在精确候选的启动协议处找到不可绕过的阻塞，按任务要求停止扩大实现。生产 `D:\Tong\runtime`、App、ACL、计划任务、凭据、双 pin、ngrok 配置和事故文件均未修改。

接手 `36c1df19a063ebc0f6add9d7f07d24c0efe461c8`，工作分支 `codex/024-maintenance-adapter-20261024`。生产基线 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`，恢复候选 `34e26801876d8b1a2fc874dddce72b0939924e87`。最终交付 SHA 以 Git 提交及最终回复为准，避免文档自引用 SHA。

## 1. 独立审查发现及最小修正

审阅了 `Tong024PlanBRecovery/Final/Closure`、此前 `Tong024MaintenanceReview/Closure`、`Tong024RecoveryDecision`、最新三次测试/文档提交，以及启动、冻结、发布校验、授权、登录 runner、安全观察器和维护事务的直接调用链。

| 发现 | 结论与处理 |
| --- | --- |
| Orchestrator 的 `archive()` 移走冻结后才安装、改 profile/pin、授权和启动 | 串行步骤之间有真实竞争窗口。撤回“连续锁已闭环”；保留旧组件成功记录，测试输出改为串行组件演示及 NOT READY。 |
| 把测试编排当作生产执行器 | 旧脚本没有完整密封安装快照、原生停止监控、持续独占和全量独立回滚。没有将其放开到生产。 |
| 混用精确候选与后续维护分支协议 | `34e2680` 不导入 `TongLifecycleFreeze`，不能借用租约；当前开发 HEAD 的进程内借用也不会传入独立 Node CLI。 |
| 同字节双 pin 被当作错误 | App/Manager 同版本时同字节是合法的；关键是两个实际树分别完成校验。本轮生产双组件均验证通过。 |
| 将 ngrok inventory 拒绝推断为登录监控唯一根因 | 调用链和时间线都不支持；改为历史根因 UNKNOWN。当前服务身份未知继续失败关闭。 |

唯一产品修改位于 `Tong024ProductionMaintenance.mjs`：生产拒绝错误附带精确候选交接阻塞；`describe` 标记操作顺序不可执行；固定生产根的 CLI `run/rollback` 在读取 profile 前拒绝，`--error-json` 返回可审查原因。原有 API 生产拒绝门保持关闭，未修改启动、Launcher、Guardian、授权或安全协议。

## 2. 连续锁：原生反例，而非成功交接证明

精确候选 `TongAgentDockRuntime.mjs` 的 `freeze()` 是 `open(backup.freeze,'wx')`，释放为 `close()+unlink()`；没有租约参数、交接令牌或外部共同锁。

`Test-Tong024PlanBHandoff.mjs` 先完整 `verifyRelease`，绑定本次 manifest/source 摘要和候选 runtime 文件 SHA256 `3b7ab8ab21914f16a1f83633468df02b5424a567e23a6064c103a59118ce0694`，随后在独立 Windows 进程中逐字执行该冻结函数：

1. 原冻结文件存在时，竞争原语返回 `RUNTIME_BUSY`。
2. 后续分支维护 helper 持有原文件句柄时，重命名被 Windows 拒绝；精确候选的冻结原语也被拒绝。
3. helper 释放后，按旧测试顺序归档控制记录、最后移走 freeze；用 IPC 明确同步后启动竞争进程，竞争者成功取得同一 `wx` 门。
4. 第二竞争者被拒绝。关闭竞争进程后保留其文件为证据，原 freeze 最先恢复，五项旧记录逐字节一致，没有删除 freeze 或伪造回执。

测试明确标记 `nativeGatePrimitiveOnly=true`、`continuousHandoffProven=false`。这是对真实 Windows 文件门的确定性反例，不是完整 `startRuntime`、安装中断或生产回滚验收。

**阻塞的具体形式：** 原文件保留则精确候选不能启动；原文件移走则任何其他启动者都能抢占。仅增加不被普通启动共同遵守的锁、缩短间隔、同进程排序、删除 NOT_READY，均不能解决。要形成受支持的连续交接，必须审核新的启动协议及新候选绑定；这超出本轮“完整安装精确 34e2680、不能扩大启动协议”的边界，因此没有继续建造另一套维护架构。

## 3. 生产只读复核

`Test-Tong024PlanBProductionAudit.mjs` 对 App 与 Manager 分别调用只读 `verifyRuntimeCandidate`（Manager 使用已审阅 profile，未解封授权）：

- 两树均为 `024d5b0`，283 源文件、23 原生文件、Node/ABI、三项 DevSpace 补丁及依赖版本绑定通过。
- 双 pin SHA256 均为 `482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd`；profile SHA256 为 `ab96bbad1d41db71451bb86f4e55f67f21dbdc1a935f4ede7d80f98bac81ca35`。
- 旧记录去重后的 10 个 PID 均已消失；三组 runId 的 runtime/owner/launcher/guardian 共 12 项 Job 活动数均为零；三个生产端口无监听。
- `runtimeStatus=abnormal_exit`，Supervisor/Guardian 均不存活。登录任务 `Ready`、上次结果 1；当前未观察到生产 Host/runner。任务 Ready 不等于监控健康或持有维护独占。
- 旧 Guardian 无 `containment`，失败请求无 launcher 回执；0 字节 freeze 仍原样保留。
- 全局生产 inventory 返回 `SECURITY_UNAVAILABLE`，不能声明完整进程集合已安全清空。
- 对 profile、run、登录文件、授权密文文件及指定事故/管理日志共 88 个文件做前后哈希比较，集合摘要始终为 `ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642`。这是指定文件集合的只读证据，不是整个磁盘的快照或生命周期锁。
- 事故 `logs/maintenance-transaction.json` 仍为 2107 字节，SHA256 `76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473`；未移动、覆盖或清理。

最终审计有意不调用 `runtimeDoctor`：若并发运行变为 ready，doctor 会读取 backend token。前两次审计当时是 abnormal_exit 且 healthy=false，未进入健康探测；最终脚本消除了该潜在解封路径。第一次监控枚举误把观察器自己的命令行算入，现已排除观察器 PID，原始结果仍保留。

## 4. ngrok 与监控调用链

当前 PID 40452 的 ngrok 由 Windows 服务 `ngrok`（Running/Auto）托管；父 PID 2728 是 `services.exe`，创建于 `2026-10-16T16:33:13.6102720Z`，不是登录 runner。ngrok 创建于 `2026-10-23T03:27:46.4025660Z`，路径及命令行不可读。

`TongRuntimeSecurity.ps1` 的 production inventory 将 ngrok 纳入后台名称集合，在按 root/runId 筛选前检查元数据；缺少 CommandLine/ExecutablePath/CreationDate 即拒绝，JS 层映射为 `SECURITY_UNAVAILABLE`。本轮未忽略 ngrok、未将未知当作消失、未终止服务或改变权限。任何需要这项完整库存的未来恢复器仍受此阻塞。

调用链分别为：

- 登录 runner → Manager `status/doctor` → 指定 PID 身份、Job/旧记录或 loopback MCP/HTTP 健康检查；不调用 inventory。
- Supervisor 周期循环 → 读取 stop.json → `capture()` → `processDescendants(supervisorPid)` → `persist()`；这条 promise 拒绝才映射为 `MONITOR_FAILED`，原始错误未随事件保存。
- 维护事务 → `runtimeProcessInventory()` → production inventory；这是当前 ngrok 身份拒绝的已证实路径。

历史旧运行在 `2026-10-23T01:51:02.854Z`（日本时间 10:51）写入 `MONITOR_FAILED`，比当前 ngrok 的创建时间（日本时间 12:27）早约 97 分钟。这个 PID 不可能解释此前停机。`processDescendants` 只遍历时间一致的所选祖先子树，不能把全局 inventory 的失败搬到这条链上。历史具体失败分支仍 **UNKNOWN**，不排除当时的其他原生观察/文件持久化错误。未宣称当前不可读服务直接阻塞普通启动或登录监控；公网隧道实际连通性也未验证。

## 5. 本轮原生验收及证据边界

所有实际测试的命令、退出码、stdout/stderr 摘要及原始路径见 [脱敏证据](evidence/024-planb-independent-20261025.json)。本地捕获根为 `artifacts/024-native-review/planb-*-20261025/`；不会上传授权密文、备份、数据库或凭据。

| 项目 | 本轮结果 |
| --- | --- |
| 生产入口 I/O 前拒绝 | 定向测试先红（1）后绿（0）；两种实际 CLI 在文件系统替身中均返回 NOT_READY，未访问生产文件。 |
| 原生冻结竞争 | 反例通过（0），四个竞争子进程均退出 0；结论是交接缺失。首次测试的 IPC 清理 EPIPE（1）已修正并保留。 |
| 生产完整基线绑定、原生 SQLite/ConPTY | 通过（0）。 |
| 原有维护安全/执行/归档回归 | 23/23，退出 0；其中库存、授权、安装和回滚存在显式模型替身，不能当原生全量恢复证明。 |
| 真实发布绑定与 OAuth | 复用既有精确 34e2680 实例，不复制依赖、不重新打包。先前 helper 的 25 工具断言失败（1），服务 ready/doctor 已通过且正常停止。当前候选哈希绑定的完整白名单为 38，修正后 OAuth+PKCE、MCP initialize/tools/list 的精确集合检查通过。后续停止/重启及 runner 结果见机器证据。 |

修正后的原生运行链整体退出 0：首次 runId `2336e2b7-0042-4cf5-83f2-7d1062d61671`，正常重启 runId `cdbfaede-2c7f-4cf0-bb99-0530b8dab702`；11 个 start/status/doctor/stop-run 管理命令均为 0，隔离 runner 退出 0，最终四类 Job 为零且无 freeze。证据根为 `D:\Tong\state\b23-login-8e32da332608430bb4971bc668ef4ace\logs\planb-independent-771db1f4-6663-436f-9f5d-30b32172bb74`。

该运行启动后，独立复审要求加强测试自身失败清理（从 start 立即保存 runId，停止失败后仍独立结束 runner/撤销隔离授权）及收窄结果标签；这些修改随后做静态验证。原始成功 stdout 中 `nativeMonitorTakeover=true` 是旧标签，只按下述初始健康、存活和停止事件解读，不作为正式任务接管证据。未因这次测试清理/标签调整再次运行完整服务链；服务、依赖和目标提交字节均未改变。新增密封摘要断言亦核对已有实际摘要，不把脚本静态检查说成完整故障路径已验证。

现有发布的 sourceDigest 为 `d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9`，releaseDigest 为 `160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062`，299 源文件、23 原生文件。Node 为 v24.15.0 / ABI 137。外层检查使用 PowerShell 7.6.6；原生启动 helper 及隔离 runner 复用正式 Host 固定的 Windows PowerShell 5.1 链，没有更改系统配置或执行策略。

隔离 runner 只改固定 root 和 mutex 名称，以避免与生产登录互斥。它不是实际计划任务/Host 的接管证明。初始 runtime_healthy、持续存活观察和 requested_stop_observed 可由日志验证；没有额外埋点时，不把存活时间等同于逐次周期 doctor 已被观察。

## 6. 未完成项与执行停止点

以下验收**未实施、没有退出码，不得填成通过**：

1. 连续独占下安装完整候选，并在归档/安装/启动全期间让普通启动入口竞争。
2. 原始控制记录、完整旧源码/原生、profile、双 pin、授权密文及监控现场的密封安装快照。
3. 各安装阶段中断、启动失败、维护进程异常退出后的恢复。
4. 新进程恢复完整 `024d5b0` 的源码/原生/profile/pin/授权/控制记录，并核对全部哈希。
5. 正式 Windows 登录任务/Host 接管、长期监控稳定性及 ngrok 公网健康。

冻结反例中的五个记录恢复，绝不是上述全量独立回滚。此前完整 f182e55 系统中的原生异常和失败事务也没有在本轮解决或复用为成功证据。

**本轮没有正式可执行生产操作单或可执行全量回滚入口。** 原有操作顺序被标记 BLOCKED_NOT_EXECUTABLE。不能批准“先移锁再安装”、测试脚本生产放行或仅取消 NOT_READY。

下一项需要 ChatGPT 最终复审的具体决策，是是否允许审查一个支持连续锁交接的新启动候选及相应发布绑定；精确 34e2680 本身无法提供该能力。即使后续解除该协议阻塞，仍必须补齐完整安装/独立回滚、未知库存与真实登录接管验收，然后才能形成正式操作单。未来任何生产批准还须明确列出影响文件、密封快照/独立回滚命令、本机原生挑战、一次维护窗口及失败停止条件；本轮未请求、未获得该生产授权。

开发分支提交并正常推送后停止，等待 ChatGPT 复审。
