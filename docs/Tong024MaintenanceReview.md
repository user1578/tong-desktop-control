# 024 维护适配器独立复核（2026-10-24）

结论：**NOT READY**。开发分支为 `codex/024-maintenance-adapter-20261024`。本次交付用于 GitHub 复审，不构成生产恢复授权。生产维护的全部写入口已在生产 I/O 前固定拒绝 `MAINTENANCE_NOT_READY`，没有可开启生产执行的环境变量或 CLI 开关。

## 实际审查范围

接手 HEAD：`5a87bdcc91aac506fed4893315de80e31989793c`，工作树干净。核对了下列完整提交链及其最终源码：

- 原始基线 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`。
- 最小启动候选 `34e26801876d8b1a2fc874dddce72b0939924e87`。
- 适配器提交 `6e777fd90efa19ee54c730acd955992c0b8305e0`、`c2a69c7aa9b6b571b75fcffb8a224cf66e92d3d3`、`e9d12d4ca7df0055b6899e174cb6425fedd15267`、`5a87bdcc91aac506fed4893315de80e31989793c`。

审查文件包括 `Tong024ProductionMaintenance.mjs`、`TongProductionState.mjs/.ps1`、`TongRuntimeCandidate.mjs`、`TongRuntimeSecurity.mjs/.ps1`、`TongProductionProfile.mjs`、`TongProductionApproval.ps1`、`TongRuntimeRelease.mjs`，以及运行、登录恢复调用方、五个维护测试和夹具。读取并遵守了项目 `AGENTS.md`。

`TongProductionState`、候选校验器、授权及发布实现保持原样；七个启动核心文件与 `34e2680` 的 Git 内容一致。另用原始哈希检查确认：共享协议文件原字节相同，其余六个文件仅有 Windows 工作树 CRLF 与 Git 归档 LF 的换行差异，归一化后逐字节一致。基线测试仅将本分支明确授权的维护适配器加入允许文件清单，并新增启动核心不变及不导入维护适配器的断言。

## Zcode 八项修复的独立结论

| 项目 | 复核结果 |
| --- | --- |
| 1. 正式源码／原生安装与哈希 | 存在逐文件复制及哈希检查。没有完整旧源码／原生文件／新增文件冲突快照，也没有中断恢复。安装在切 pin 校验前就覆写文件；本轮补齐路径、链接和全输入预检，生产安装仍禁用。 |
| 2. freeze 与状态备份协调 | 原实现确实移走旧 freeze，但没有其他启动者共同遵守的独占保护。`maintenance.lock` 仅约束适配器。已删除移锁窗口，旧 freeze 持续保留；真实备份实测按设计拒绝 `STATE_BUSY`。连续生命周期租约交接仍未实现。 |
| 3. 原生进程／Job／端口／监控 | 原生 identity 和 Job API 可用；适配器没有接入完整全局进程及监控枚举，旧默认空库存却声称完整。现在缺失库存即拒绝，精确身份存活不依赖 marker，复用 PID 和不可读身份均安全处理；瞬间静止不再声称持有生命周期独占。 |
| 4. 归档前后安全证明 | 旧现场与归档后评估分开，模拟归档／部分归档／恢复用例通过。原生独占尚无，故不能将这些模型证明作为生产归档许可。补齐启动 Job 清单完整性及恢复前全目标冲突检查。 |
| 5. 持久化事务及故障 | 原实现有 JSON 文件，但重复运行会复用并改写旧事务，profileDigest 未写入，备份结果未保存。现已绑定 root／profile／plan，拒绝已有事务，持久化备份结果及安装前意图。安装内进程退出后，新进程能识别未完成安装并保留现场；未证明断电恢复和完整跨阶段重放。 |
| 6. 跨进程回滚 | 旧用例实际在同一进程调用，且只恢复控制记录。状态备份字段始终空；没有源码、原生、profile、双 pin 或授权材料恢复。现在安装后的事务明确拒绝 `MAINTENANCE_RELEASE_RESTORE_UNSUPPORTED`，不再宣称成功回滚。独立进程安装前控制记录回滚已验证，但观察证明为显式模拟。 |
| 7. 事务／候选／基线／授权绑定 | 单项校验存在，但只用一个 profile 验证旧版并安装新版：旧 profile 的 releaseDigest 不能通过新 pin 的绑定；若改用新 profile，旧文件又不能通过前置候选验证。没有旧／新 profile 和授权的一致切换。状态备份／恢复路径还必须位于 profile.root 内，不能传普通 state 同级目录。本轮收紧路径与事务校验，整体切换仍未闭合。 |
| 8. 完整成功及故障注入 | 五个模型测试存在并通过，但其 verify、snapshot、install、start、doctor 等关键步骤有注入。真实原生组件路径已补测；完整维护事务成功和安装后原生回滚尚未验证，不能宣布生产可执行。 |

## Windows 原生证据

命令宿主为 PowerShell 7.6.6，Node v24.15.0。现有 DPAPI、Job 和启动帮助程序保留项目固定的 Windows PowerShell 5.1／.NET Framework 执行链，没有更改全局 shell、ACL 或安全门禁。

复用已停止的 `D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a` 及其原有 `candidate-release`，没有重建依赖或发布包：

- `processIdentity` 实际查询当前进程和既有运行身份；`startupJobsState` 实际查询四类命名 Job。
- `verifyRelease` 重新核对提交 `34e2680` 的完整 299 源文件／23 原生文件；App 和 Manager 均通过 `verifyRuntimeCandidate`。
- 通过受支持的 `issueSimulationApproval` 签发并由 `verifyRuntimeApproval` 验证 start／backup／restore 隔离回执；变更 releaseDigest 的授权被拒绝。未签发正式生产回执。
- `createProductionStateBackup` 实际产生 CurrentUser DPAPI 加密的 5 文件备份，随后由 `verifyProductionStateBackup` 重新验证。持有测试 freeze 时拒绝 `STATE_BUSY`，原字节不变。
- 真正调用 `startRuntime` 达到 ready，`runtimeDoctor.healthy === true`，AgentDock、DevSpace、Gateway 三组件存在。成功运行 ID：`75ba018d-93f4-4687-858f-7f6b91ce2988`。
- 使用绑定 runId 的 `stopRuntime` 安全停止；原始身份消失，四类 Job 均为 0。
- 独立 Node 进程触发真实 1ms 启动超时，失败运行 ID：`08682941-f5cd-4eee-9b34-2111b9c0278d`。Launcher 回执证明未创建 Guardian、预检已清理，四类 Job 为 0，freeze 正常释放。

首次原生脚本把登录恢复入口动作误写为 `stop`，在 ready／doctor 成功后退出 1；正确动作是 `stop-run`。已修正测试，并复用同一运行的现有证据完成停止／独立进程失败清理，继续验收退出 0。保留了失败及成功两次原始 stdout、stderr、退出码和哈希，没有把第一次报告为通过。上述原生链未出现此前沙箱的 EPERM。

关键绑定：

- sourceDigest：`d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9`
- releaseDigest：`83c6b49346b3947c6baa6cd65b97ea9c3f3932de797cd2468829a81f589e080f`
- 状态备份 manifest SHA256：`4a33570e817a0611212e5de2fea7e3c455a13031532f264e87e20e99204f006f`
- 原生证据目录：上述隔离根内 `native-review-d410da66-5fd1-40eb-994e-3ea5daced594`。
- 加密备份目录：上述隔离根内 `native-backup-de8b86a8-766b-4ff7-980c-a5347a7bdb98`。

## 回归与剩余限制

最终维护回归 26/26（原五文件及新增 21 个安全用例）通过；启动预算、readiness、旧现场离线恢复三项通过；024 基线源文件／原生依赖／Node 绑定通过。

原有 `Test-TongStartupArtifactBinding.mjs` 也实际退出 0，验证 23 个原生文件、App／Manager 一致绑定，及原生文件篡改、共享协议篡改和 Manager pin 不匹配均拒绝。

**原有 `Test-TongLoginAutoRecovery.mjs` 实际失败，退出 1。** 本轮使用新的隔离根 `D:\Tong\state\b23-login-5b7bc475924e49dbbf5f6e26ec32752e`，共享既有依赖并复制约 27MB 源码／DevSpace 文件，不覆盖已提交候选实例。正常停止／重启和 Supervisor 崩溃恢复已走过，随后第一个 Guardian 丢失场景返回 `CLEANUP_REQUIRED`，未完成后续第二次 Guardian 丢失、健康 start 复用及撤销场景。

该失败运行 ID 为 `558ac4e9-828f-4c8e-b6f0-a0fa8bd54338`。日志顺序为 `recovery_succeeded` → `runtime_lost(stale_record)` → `recovery_attempt` → `manager_command_failed(CLEANUP_REQUIRED)`。Manager 的真实错误为 `STALE_RECORD`，stage=`previous_status`，cleanup.proven=`false`。保留了该运行的原始 ready 记录、未完成 Guardian 记录、按 runId 保存的 stale-reconciliation 和 freeze；没有制造终态证明或移动锁。此次失败发生在与 `34e2680` 相同的启动核心中，不能归因于适配器变更，也不能声称原有登录回归全绿。未盲目重复测试或修改启动核心门禁。

失败后的独立只读观察确认所有原始身份已消失、四类 Job 为 0、29761／29762／29763 端口空闲，proof 的 runtime／guardian 哈希仍匹配，identityCount=13；此时 `runtimeStatus` 返回 `abnormal_exit` 且 `reconciled=true`。这只能说明后续观察条件通过，不能证明失败时为何未通过。PID 复用或瞬态观察只是待证假设，没有当时逐身份明细，根因仍未确定。保留现场且不重试启动；已撤销该新测试实例的隔离登录恢复授权。该失败属于本轮剩余验收阻塞。

新增故障覆盖包括：备份失败不移锁、缺失备份拒绝、备份证据持久化、非法根目录／marker、重复或损坏事务、事务换根、安装部分写入／进程崩溃、空 Job 清单、缺失／失败进程观察、不可读身份、PID 复用、端口不确定、全目标冲突预检、路径穿越和 junction。生产入口的测试在独立进程替换全部 fs/promises I/O；即使未来门禁被删除，也只能报告 I/O 企图，不能接触真实生产文件。

尚无完整原生维护事务成功、安装后恢复旧源码／原生文件／profile／双 pin／授权／控制记录的一致性证明，也没有生产监控、正式任务或真实关机重启验收。这些是产品集成缺口，不以环境 EPERM 代替说明。本轮没有通过增加超时、减少断言或绕过授权解决这些问题。

原始本地日志位于 `artifacts/024-native-review/`；可从 GitHub 读取的脱敏原始输出、退出码和 SHA256 放在 [交付证据](evidence/024-maintenance-20261024.json)。不上传 DPAPI 回执、密文备份、凭据或真实业务状态。

## 本轮边界事故（必须保留）

2026-10-24 18:20:42（Asia/Tokyo），新增回归用例在门禁修复前误用了真实 production profile。旧实现先写事务再调用注入验证，导致未经授权新建：

`D:\Tong\runtime\logs\maintenance-transaction.json`

文件 2107 字节，事务 ID `9288f925-ebbb-4768-9365-551cf0080f18`，phase=`failed`，error=`MUST_NOT_REACH`，journal 为空。创建／修改时间均为 `2026-10-24T09:20:42.9730408Z`，SHA256 为 `76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473`。

这是本轮执行者违反“不修改生产目录”的隔离错误，不属于用户授权，也不能声称生产完全未写入。该调用未进入安装、归档、pin、授权签发或启动；已立即向用户披露。只读核对后保留现场，没有删除、移动或覆盖该文件。后续生产入口测试全部采用独立进程的文件系统替身，修复的生产门禁先于任何 I/O。

本轮未执行真实生产恢复。GitHub 开发交付后停止，等待 ChatGPT 复审。
