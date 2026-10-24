# Tong 024d5b0 最小启动恢复候选

基线：`024d5b0920d9ad8f1a2baf2e55640a5666ad4739`。工作树：`D:\Tong\development\tong-024-startup-recovery`。分支：`codex/024-startup-recovery-20261024`。

本轮候选准备的启动协议、登录监控与旧现场离线演练已通过针对性验收。真实本地提交的归档及 App/Manager 运行绑定另由 `artifacts/024-recovery/committed-candidate-binding.json` 记录；该记录尚未成功时仍不可交付为 READY。本文件不构成生产授权，离线迁移模块也不是正式生产执行器。

## 产品差异与必要依赖

| 文件 | 必须包含的原因 |
|---|---|
| `scripts/TongAgentDockRuntime.mjs` | 用请求截止时间约束 Launcher，而非固定 15 秒；取消后验证本次 Launcher、Guardian、Node 和全部命名 Job；缺失/矛盾证明保持锁；清理观察共享 30 秒预算并取消实际观察进程。 |
| `scripts/TongRuntimeLaunch.ps1` | 保留完整生产/登录安全预检，改为可取消、受私有 Job 约束的子进程；记录创建边界及 Guardian 接管结果。 |
| `scripts/TongRuntimeGuardian.ps1` | Guardian 接管生命周期 Job，Node 在创建时即进入 Runtime Job；终态回执区分预检结束与实际 Runtime 清理。 |
| `scripts/TongStartupProtocol.ps1` | 上述两个入口共同依赖的截止时间、abort 检查、JOB_LIST 原子创建、非继承所有权、原子回执和结构化错误。 |
| `scripts/TongRuntimeSecurity.ps1` | 只读查询本次 owner、Launcher 预检、Guardian 预检、Runtime 四类 Job；查询失败不当作清理成功。 |
| `scripts/TongRuntimeSecurity.mjs` | 暴露四类 Job 查询，并让清理观察接受同一取消信号；超时终止所拥有的 PowerShell 观察进程，避免 CLI 被迟到观察保活。 |
| `scripts/TongLoginRecovery.mjs` | 原生登录恢复描述符的关键文件清单绑定新的共享协议，拒绝遗漏该文件的候选。 |
| `scripts/Tong024LegacyRecovery.mjs` | 与正常启动完全分离的本次事件离线恢复演练；区分旧运行与失败请求，保留原始证据并演练受控归档、冲突拒绝和回滚。始终拒绝生产根目录。 |

七个启动文件源自已保存 WIP 的闭合依赖；另有本轮收紧的观察预算/实际取消。未移植整个 WIP。`TongLoginRuntime.ps1`、运行服务、生产授权实现、候选校验器、发布工具、依赖版本和业务/Agent 功能保持 024 基线；没有移入 5362210、DSH、会话协调、工具清单或原生 worker 的无关修复。

全部与基线的差异由最终 `git diff 024d5b0` / 本地候选提交记录给出；完整补丁位于本工作树 `artifacts/024-recovery/candidate-vs-024d5b0.patch`。

## 正常启动协议

1. 现有授权、目录 ACL、App/Manager 文件、原生资产、二进制、端口和凭据检查保留。
2. 新请求发布 `startupDeadline`。Launcher 的完整预检在受限 Job 内执行，并同时检查 deadline、请求身份和本次 abort。
3. 预检、Guardian、Node 都在进程创建时绑定对应 Job，不存在创建后再加入 Job 的逃逸窗口。Guardian 接管句柄不可继承给编译器或其他后代。
4. 释放启动锁需要本次完整终态证明、精确进程身份已消失、四类 Job 为空。旧运行终态、仅预检结束、stdout 确认或仅 PID 消失均不够。
5. 清理观察最多使用共同的 30 秒窗口；到期取消观察子进程，迟到结果不改变锁释放决定。未知、读取失败和不完整回执均保持锁。

## 024 旧现场：独立的一次性恢复

本次事件固定绑定：旧运行 `74cd4ad3-f21b-40ec-96f5-3f9015649e5d`；第一次失败请求 `bee3d9d4-1dd9-4ed6-80d1-07a2b7e11bdd`；当前失败请求 `d348ae39-27cf-4167-8e35-58de75421309`。

普通启动明确拒绝自动升级旧证明。离线演练也不生成 `launcher.<runId>.json` 或 `guardian.<runId>.json`。它保存缺失回执的事实，而非推断 Guardian 未创建。

正式适配须在获批维护窗口内重新取得以下证据，不能把本轮离线布尔值、合成授权或旧日志当作现场证明：

- 旧运行：精确 runtime/Guardian 身份一致，Guardian 确认 Job 清理完成；Supervisor、Guardian、所有记录中的 children/descendants 均按 PID + exe + creation time 核对原身份消失。
- 当前失败请求：request/abort 均属于 d348ae39，时间顺序与 START_ABORT 一致；分别检查本次回执缺失及实际进程，而非借用 74cd4ad3 的终态。
- 完整进程库存除三套 runId 外，还应匹配生产根目录、Launcher/Guardian/预检/Supervisor 入口，排除旧版未带 runId 的残留预检进程。未知归属时停止，不能按历史父 PID 批量杀进程。
- 三套身份的相关命名 Job 无活动进程；7676、7677、18765 空闲；登录宿主、runner、任务实例均已受控停止，生命周期互斥量独占。观察须新鲜且成功，确认后再次观察。
- 原始 runtime、Guardian、request、abort、freeze、stop/budget/reconciliation 及已保留的 bee3d9d4 证据分别留存，记录哈希，不覆盖日志。

离线流程只允许 `D:\Tong\state` 下带专用 marker 的普通目录。准备阶段密封原始文件；确认绑定 root、事务目录、快照 seal、两套身份、动作和有限有效期。确认后再次验证快照与现场。归档时最后处理 freeze；回滚先恢复 freeze。第三方改动、新请求、快照篡改或路径替换立即拒绝；部分归档/部分恢复可保留证据并按原绑定回滚。该模块没有任务、ACL、生产授权签发或生产安装入口，不能把开关改成允许生产后直接执行。

## 单次生产维护方案（尚未授权、未执行）

1. 准备只包含本候选精确 SHA/归档哈希的文件清单；核实 App/Manager 同一提交、完整源码与 23 原生资产、Node/ABI、DevSpace 补丁及 024 基线。正式维护适配须实现上述原生互斥、观察、授权校验，先在真实格式的隔离现场演练，不能调用离线确认代替原生授权。
2. 向用户说明一次窗口允许的快照、精确源文件/元数据替换、旧控制记录归档、必要启动/监控恢复及失败回滚。授权只覆盖该候选、该事件和该窗口；不包含功能升级、系统配置更改、关机重启、历史清理或后续版本。
3. 使用可见本机原生挑战取得授权，不能代填。备份现有代码/新增文件冲突清单、profile、双 pin、登录 runner、任务状态/XML、相关 ACL 和授权密文，保留业务状态；验证快照可读、哈希正确、恢复材料完整。不输出授权明文。
4. 独占生命周期互斥并受控停止监控，复核本次停止证明。安装及授权绑定校验期间始终保留旧 freeze，阻止普通启动。安装已核对候选、更新绑定并完成原生 start/manager/enable/login-recovery 授权后，再次核对静止现场；只归档批准且哈希仍匹配的旧控制记录，freeze 最后处理，随后在同一独占窗口调用候选正常启动。不得先开放启动再安装，不删除/改写旧回执。完整安全预检照常执行。
5. 观察 ready、doctor、Gateway/MCP、任务 Running、唯一登录宿主及监控首个健康结果。任一步失败，停止继续安装/启动，保留本次记录，不扩大重试或改低门禁。
6. 回滚须先证明候选进程树/Job 已停止且端口空闲；候选生成的控制记录按其精确新 runId 单独保留，确认无替代运行后才能恢复旧控制记录，先恢复 freeze。只恢复密封旧版本、profile/pin/runner/任务及对应授权材料，新增候选文件移入证据目录。遇到外部改动或新身份不覆盖。旧代码和状态恢复后仍必须验证；若旧版仍不能安全启动，明确保持停机，不声称服务已恢复。
7. 成功恢复基础服务后另行批准并执行登录、关机再开机和完整重启验收。Windows 内核启动时间与用户关机开机记录分开核实，不能把快速启动当作完整重启。随后才推进功能升级，最后统一清理历史产物。

## 验收证据与边界

本工作树 `artifacts/024-recovery/` 保存各测试的原始 stdout/stderr、退出码和耗时。所有服务测试均使用隔离根目录与合成授权，复用已有依赖和已停止的完整隔离实例；无生产写入、push、合并、部署、真实关机重启或历史文件清理。

本轮 15 项针对性测试均实际退出 0：LauncherBudget、StartupProtocol、AtomicJobCreation、GuardianOwnership、StartupReceiptAtomic、LauncherCancellation、RuntimeStartupCleanup、StartupSafety、StartupArtifactBinding、StartupObservationBudget、024LegacyRecovery、024LegacyCompatibility、024BaselineBinding、StartupRecovery、LoginAutoRecovery。19 个 Node 文件语法检查，以及 6 个 PowerShell 文件在 PS7 和固定 PS5.1 下解析通过。源码 diff 检查通过。

关键实测：慢预检超过 15 秒仍取得真实结果；预检超时/取消及所有者退出后子进程消失；创建边界/Guardian 接管失败无泄漏；回执长读、只读拒绝和中断不丢原始文件；Node 已绑定后失败正确清理；缺失/矛盾/迟到证明保留锁；真实元数据观察取消后约 1.3 秒退出且不启动后续观察；旧终态不能覆盖新失败请求；旧现场密封篡改、确认期间变化、junction、部分归档/恢复及冲突均按设计处理。

StartupRecovery 实测正常、慢启动、阶段停滞、子进程退出、1ms 总超时清理及随后重启。LoginAutoRecovery 使用未移植 5362210 的 024 登录监控器，完成正常停启、Supervisor 崩溃、两次 Guardian 丢失、旧证明保留、重复启动拒绝、关闭发起者后运行、健康 start 复用及撤销授权拒绝。既有依赖树复用，无整套重新安装。

024 历史归档哈希及全部 283 个源文件与生产 pin 匹配；23 个原生文件、Node/ABI 保持基线，SQLite 内存库与 ConPTY 原生加载通过。合成绑定测试覆盖双组件同 pin、原生篡改、协议篡改及错 Manager pin；它明确使用合成提交，不能代替上述真实提交归档记录。

本轮尚未进行生产维护、正式原生挑战、真实任务/ACL/授权恢复、生产 Gateway/MCP 连接或真实关机重启。正式生产适配仍须在后续恢复任务中按本设计实现并隔离验收，不能直接把离线模块用于生产。历史 WIP 的 0xC0000409 不自动归因到生产事件，也不算作已定位修复；本轮最小候选未出现该异常或错误解锁。若真实归档验证发现此类安全异常，必须降为 NOT READY。
