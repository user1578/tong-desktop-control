# 024 维护集成阻塞闭环（2026-10-24）

结论：**NOT READY**。这是开发隔离验收和 GitHub 复审交付，不是生产恢复许可。被测正式生产维护写 API 继续在生产文件系统 I/O 前拒绝 `MAINTENANCE_NOT_READY`，没有环境变量或 CLI 解锁开关。

接手基点为 `b03f6d858585ca53998a97ddb12beb9703ab5bbf`，分支为 `codex/024-maintenance-adapter-20261024`，接手时工作树干净。本轮实际隔离发布候选固定为 `f182e55f501930d4e062e1dea9fffc69fdef85d5`；后续交付提交只包含测试入口调整和本报告、证据，不把文档提交冒充已经安装的运行版本。

原有八项复核及前轮失败证据保留在 [前轮报告](Tong024MaintenanceReview.md)。本轮审查和修改只涉及：

- `Tong024ProductionMaintenance.mjs` 的新事务调用和跨进程恢复分派。
- `TongLifecycleFreeze.mjs/.ps1` 的原 freeze 独占句柄及进程内能力传递。
- `TongMaintenanceTransaction.mjs` 的完整版本快照、安装、授权切换、启动及回滚。
- `TongProductionState.mjs` 的共享生命周期门禁。
- `TongAgentDockRuntime.mjs` 的启动/停止/profile 门禁、请求身份持久化观察点和诊断。
- `TongRuntimeSecurity.mjs/.ps1` 的库存观察及观察器子树修复。
- 对应维护、原生事务、观察器测试和夹具，以及基线范围断言。

与 `34e2680` 比较，Launcher、Guardian、StartupProtocol 和 LoginRecovery 四个模块内容不变。候选校验、发布、生产授权、生产状态加密 helper、依赖及 lockfile 没有修改，没有新增其他调度系统内容。

## 连续独占

维护不再移动或重建 `backup.freeze`。PowerShell 7 helper 以 `FileAccess.ReadWrite + FileShare.Read` 打开**原文件**并持续持有 Windows 句柄：允许备份读取，拒绝其他写入、删除、重命名和第二个维护持有者。每个检查点重新通过绑定的持有者 PID 校验原文件 SHA256；控制进程退出时，管道 EOF 关闭句柄，原 freeze 仍留在原位。

启动、停止、profile 更新和状态备份共用这一门禁。被审核的 App/Manager 模块副本通过同一 Node 进程内的能力借用句柄；独立进程没有该能力。真实原生竞争测试确认 start、stop、profile 均拒绝 `RUNTIME_BUSY`，backup 拒绝 `STATE_BUSY`；原 freeze 内容不变。另验证了竞争创建、重命名拒绝，模块副本借用，以及控制进程退出后的重新进入。

原生成功、停止和回滚后仍保留测试 freeze。正式维护结束后的激活、监控交接和正式锁处置不在本轮执行范围内，生产入口也没有启用。

## 完整版本事务

`TongProductionState` 仍只负责其原有业务状态/config/OAuth/policy 范围，**不被当作源码或原生文件快照**。新版本事务另外保存 App 和 Manager 的全部已发布源码、23 个原生文件、profile、双 pin、必要的旧/新 DPAPI 授权和六种动作的 bootstrap index，以及旧控制记录。

固定拓扑、旧版完整候选验证、新发布 commit/sourceDigest/releaseDigest、两版原生授权、原生身份/Job/端口静止证明全部通过后才建事务。新增候选路径已有文件时拒绝冲突。每次写入前持久化意图，原子写入后复核哈希；旧版移除文件和控制记录归档保留。原生文件在这两版中哈希相同，仍完整快照和复验，没有人为更换依赖或 ABI。

重新进入时重新读取磁盘事务及 snapshot seal，检查 root、profile、ID、freeze、操作索引、前后哈希和全部目标现状。外部修改或新运行身份会拒绝，不能覆盖现场。启动前持久化真实 request 身份；启动失败记录原始清理证明。没有可用终态证明时拒绝 `MAINTENANCE_STARTUP_CLEANUP_UNPROVEN`，不把瞬时无进程当作成功清理。

受控启动、doctor 和停止实际调用安装目录内、受新 Manager pin 绑定的代码。独立进程回滚经维护适配器入口恢复全部旧文件，将候选新增文件归档移出原路径，再核验旧 App/Manager、profile、双 pin、授权/index 和控制记录。重复恢复也重新校验现状。

本轮实际修复的集成缺陷包括：状态备份和旧 freeze 冲突、停止/profile 更新缺少共享门禁、不同物理模块副本不能借用同一租约、调用工作树 Manager 不能证明安装版本、启动请求身份未持久化、回滚完成后重复调用未复验，以及候选 request 已归档后回滚重入误判替换运行。

## Windows 原生验收

宿主：PowerShell 7.6.6、Node v24.15.0。新租约 helper 使用 PowerShell 7。原有 DPAPI/命名管道、Job/CodeDom 链保留项目固定的 Windows PowerShell 5.1/.NET Framework 路径，没有修改系统执行策略或全局配置。

主要隔离根为：

`D:\Tong\state\b23-maint-native-ab2ecf441a184dcaa798023010f3e70f`

这里的基线是通过现有 `buildRelease` 构建、`verifyRelease` 验证的原始 `024d5b0`，不是伪造 pin。基线的 283 个源码文件和 23 个原生文件真实安装到 App/Manager，并通过其安装目录入口启动、doctor 和停止。候选同样通过真实发布清单、双 pin 和合法隔离回执绑定。

最终候选绑定：

- commit：`f182e55f501930d4e062e1dea9fffc69fdef85d5`
- sourceDigest：`9f9e0fcce63513b69840300e20b65ae3d0bc4e51c363472c571c07f9647e320d`
- releaseDigest：`c43d86a99f3d77f693b9bd44bba5f6569aa6ab3e2fe9ff6045edcfd6ca261186`

原生测试没有注入全部成功的 verify/backup/install/start/doctor。注入点只用于检查点退出和记录证据。阶段中断使用进程退出码 71，新 Node 进程读取同一持久事务并恢复，恢复成功退出 0。完整成功流程另外要求退出 0、ready、doctor 健康和安全停止。

最终固定代码的九个中断点 `app-files`、`manager-files`、`app-pin`、`manager-pin`、`profile`、`permissions`、`controls`、`starting`、`started` 全部通过：中断进程退出 71，独立恢复进程退出 0，每次重新验证 639 项旧版材料。整轮 `closure-024-frozen-matrix` 退出 0，stdout SHA256=`7c386de4405315ca207fd0ef1c4d64ed90516033a0bf48154eb108e300c7cea6`。

最终完整成功事务为 `9786314d-905d-4152-8f40-c3c8b42fdf07`，真实运行 ID=`264dca8b-c5c0-4233-9b68-1234668b3a94`。安装目录内 Manager 完成 ready、doctor 健康、安全停止和独立进程回滚，四个命令均退出 0，snapshot seal=`569c169db3cdd5affbf7fc94b996ac3f74acda8d06bd1b95107e72a57d8bb5bd`。

**最终组合回滚用例仍失败。** 它已经通过四个并发入口拒绝、新的真实匹配进程拒绝、双 pin 之间暂停、外部源码修改拒绝。随后 apply worker 在全部 109 项安装操作完成、尚未写启动意图时以 `3221226505 (0xC0000409)` 原生异常退出，stdout/stderr 为空。新进程只读复核确认双候选和加密备份完整、库存无匹配进程、四类旧 Job 为零、隔离端口空闲。

独立重入随后实际取得 `START_TIMEOUT`，cleanup=`{proven:true,proof:launcher_terminal}`，并通过回滚中断及替换 request 拒绝；但继续恢复的另一个 Node worker 再次以 `0xC0000409` 退出。两次异常发生在不同阶段，尚不能归因于环境或产品。指定时间窗的 Application/Defender 日志没有找到能够归因的匹配事件；Defender 查询的 `NoMatchingEventsFound` 不能被解读成权限拒绝。本轮没有升级/重装 Node、调整安全设置或改写启动协议，也不再反复尝试该事务。

最终保留事务：

- 路径：上述隔离根的 `logs/maintenance-transaction.json`。
- transactionId：`a10c4a5a-0cf0-4031-a3db-0f755867bd61`。
- phase=`rolling-back`，index=109，pending=`{index:108,reverse:true}`。
- snapshot seal：`e0ca6cc0041898b2fa9ca0c65b4fb76d0ed916c9fddc7e8daa1f8ca1168d6286`。
- 主事务 SHA256：`128e00436536cdfdd5a0def4a06a5eb7723cbfe752694da90e10dd66cd7897e2`。
- 原 freeze 保留，SHA256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

12:32:52 UTC 的只读观察没有匹配的可见进程或监听端口；这不代表该事务已经回滚成功。完整快照、归档、原生失败和反向写入意图均保留，没有覆盖成 `rolled-back`。

此前针对 request 归档重入缺陷的事务 `cf91c6c9-726e-43e1-9c87-f349d09f4aba` 已用同一修复原生恢复成功，并通过真实 DPAPI 解密、明文哈希及兼容 OAuth 副本校验。该成功证据与上述最终组合失败分别保存，不能合并声称整组通过。

原有维护 26 项和新增租约、观察器、生产 I/O 隔离检查共 29/29 通过。024 基线/原生依赖/Node 绑定通过。启动预算、观察预算和真实早退清理三项通过。`Test-TongGuardianOwnership` 与 `Test-TongStartupReceiptAtomic` 两项被 Windows 执行策略拒绝未签名临时脚本；保留退出 1 和原始错误，没有改策略或降低断言，因此不能声称启动相关测试全部通过。

最终夹具还在读取元数据前检查隔离根和证据标签；生产根及路径穿越标签用文件系统替身测试，旧入口触发 I/O 企图时退出 1，修复后退出 0，没有实际读取生产目录。最新整组 29/29 的 stdout SHA256=`d8443d8fa9acf0dcecece89a0660f92c47621cad42637132cf66ce766c449aac`。

中间失败均保留：Git 硬链接工具路径被拒绝；包含隔离根的测试宿主命令行被库存拒绝；生产 ngrok 身份不可读导致完整性拒绝；早期候选缺少跨模块租约能力被拒绝；一次人工抄错事务 ID 被拒绝；回滚 request 归档后的重入缺陷。最后一项已针对同一失败事务完成原生恢复。没有把这些退出 1 改写为通过。

证据夹具还有一项已修正的命名冲突：测试用替换 request 的归档覆盖了同名子命令结果 JSON。原 stdout/stderr 及聚合原始日志完整保留；从 SHA 验证通过的聚合日志恢复了独立 `.result-recovered.json` 副本，明确标记来源，没有覆盖当前保留的 request 样本。交付证据标记 `resultRecoveredFromAggregate`，不把重建副本冒充原文件。

## Guardian 丢失问题

原失败现场完整保留：`D:\Tong\state\b23-login-5b7bc475924e49dbbf5f6e26ec32752e`，runId=`558ac4e9-828f-4c8e-b6f0-a0fa8bd54338`。

原始 UTC 时间顺序为：

| 时间 | 当时可见证据 |
| --- | --- |
| 09:37:50.771 | monitor 报 `recovery_succeeded`，runtime ready、Guardian 可见 |
| 09:38:05.786 | 最后 descendants 中 conhost PID 12740 创建，parent PID 43488；按旧过滤逻辑推断为观察器残留 |
| 09:38:08.091 | `runtime_lost`，原 runtime 记录仍 ready，真实 Supervisor/Guardian 不可见，status=`stale_record` |
| 09:38:27.577 | 写入按 runId 保存的 stale-reconciliation，identityCount=13 |
| 09:38:57.030 | 后续 start 返回 `CLEANUP_REQUIRED`，managerFailure=`STALE_RECORD`、cleanup 未证明 |

原 runtime 和未完成 Guardian 记录的哈希至今仍匹配该 proof。前轮事后观察是所有原始身份消失、四类 Job 为零、端口空闲、reconciled=true；它不能替代 09:38:57 当时的逐身份/Job/端口结果。

本轮确认了一个独立可复现的软件缺陷：旧 descendants 只按 helper 命令行过滤，遗漏 helper 的 conhost，同时会误过滤命令行碰巧包含 helper 文件名的真实 backend。定向测试在旧实现退出 1，修复后退出 0。修复仅排除精确观察器 PID 及时间一致的子树；没有放宽旧运行的 PID、Job、回执或哈希证明。

`Test-TongLoginAutoRecovery.mjs` 在修复后的观察器上完整退出 0：正常停止重启、Supervisor 崩溃、连续两次 Guardian 丢失、旧 proof 保留、重复启动拒绝、健康 start 复用、发起者退出存活及撤销都通过。最终登录回归根为 `D:\Tong\state\b23-login-daf14840b8ca400990162e06934a626b`，stdout SHA256=`c747760a3be50becb713c4b6950dba770c9501e8881e9ac31b279b338ed48fe6`。

**剩余证据限制：**原失败没有保存当时逐 PID 的 actual 身份及每个拒绝分支，无法确定那一次究竟由哪个瞬态条件阻断。观察器库存污染是已证实并修复的缺陷，但“它是历史失败唯一原因”仍未证实。没有用后来的成功或 PID 消失倒推当时已安全。

## 生产误写文件及后续受控处理

本轮未读取、修改、删除或移动该事故文件。以下沿用前轮已核对的元数据，未来操作前必须重新只读核对：

- 精确路径：`D:\Tong\runtime\logs\maintenance-transaction.json`
- SHA256：`76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473`
- 大小：2107 字节；创建/修改时间：`2026-10-24T09:20:42.9730408Z`
- transactionId：`9288f925-ebbb-4768-9365-551cf0080f18`
- phase=`failed`，error=`MUST_NOT_REACH`，journal 为空。

它占用了未来正式事务的唯一主记录路径。新入口必须拒绝已有事务，不能复用、覆盖或自动归档这个事故文件。

未来处理必须是**另获明确本机生产维护授权**后的具体步骤：先只读核对精确路径、普通文件属性、大小、SHA 和事务身份；在已审核且持续持有的生命周期独占内，重新核对并把原字节及元数据保存到事先指定、受保护且不存在冲突的事故证据目录；只有该次授权明确允许后，才将这一精确文件原子归档并核对归档 SHA。任何差异都停止，不处理其他文件、锁或历史记录。正式维护使用新的事务 ID，并在同一独占期间验证新旧版本/profile/双 pin/本机授权后才能开始。

本轮资源授权只允许开发隔离证据上限 1.4GB，不包含上述生产处理。生产锁、ACL、计划任务、凭据、pin、登录监控和运行版本均未修改，没有真实恢复或关机重启。

## 未关闭项及交付边界

| 请求项 | 本轮结论 |
| --- | --- |
| 连续生命周期独占 | 隔离原生闭环：原 freeze 从未交接移走，四种并发入口及第二维护进程被拒绝 |
| 完整切换与持久回滚 | 主成功流程和九阶段回滚闭环；最终组合回滚遭重复原生异常，整体尚未关闭 |
| Guardian 丢失回归 | 当前完整回归通过，确认并修复观察器子树过滤缺陷；历史唯一根因仍不可追溯 |
| 生产事故边界 | 原文件未触碰，路径/SHA/身份/冲突及未来受控方案已记录；未实施生产处置 |

1. 最终组合用例发生两次未归因的 `0xC0000409`，当前隔离事务在反向操作中保留，不能宣称完成回滚。
2. 正式生产入口仍固定禁用；原生产遗留现场和事故主事务冲突尚未在获批窗口处理。
3. 当前权限无法读取生产 ngrok 的完整进程身份；production 库存实际返回 `SECURITY_UNAVAILABLE`。隔离 profile 不包含 ngrok，不能把隔离完整性证明推广成生产证明。
4. 两项原有原生测试受未签名脚本执行策略限制，未通过；没有扩大权限或绕过该拒绝。
5. Guardian 历史失败的精确瞬态拒绝条件仍不可追溯；当前回归通过与这一历史证据缺口分别报告。
6. 验收覆盖进程退出/崩溃重入，没有进行断电、真实重启或生产监控激活。缺失清理证明的中途启动现场继续保留并拒绝覆盖。

原始 stdout、stderr、退出码、SHA、事务 seal 和恢复结果见 [交付证据](evidence/024-maintenance-closure-20261024.json)。原始字节日志在本地 `artifacts/024-native-review/`，完整事务、原文件快照、DPAPI 密文及解密校验副本保留在上述隔离根；不上传授权密文或凭据。

两个主要原生测试根、登录回归根和早退清理根的文件逻辑大小合计约 1.340GB（不跟随 junction），另有少量小夹具和日志；本轮已获用户 1.4GB 上限授权。没有清理历史产物，没有重新复制整套共享依赖。所有源码改动保持在上述八个直接相关脚本中，没有调用其他计费 Agent。

开发分支正常提交、推送后停止，等待 ChatGPT 从 GitHub 复审，不执行生产操作。
